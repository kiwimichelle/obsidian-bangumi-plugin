import { requestUrl } from 'obsidian';
import type {
  ApiCharacter,
  ApiEpisode,
  ApiRelation,
  ApiSubject,
  BangumiSettings,
  CastCredit,
  EpisodeData,
  SearchQuery,
  SearchResponse,
  SearchResultItem,
  SubjectData,
  SubjectRelation,
  SubjectTypeKey,
} from '../types';
import { BGM_API_BASE, BGM_UA, DEFAULT_PAGE_SIZE, SUBJECT_TYPE_MAP } from '../constants';
import { DataAdapter, normalizeRelation } from './DataAdapter';

// ─────────────────────────────────────────────
// 配置常量
// ─────────────────────────────────────────────

const REQUEST_TIMEOUT_MS  = 15_000;
const MAX_RETRIES         = 2;
const RETRY_BASE_DELAY_MS = 800;

// ─────────────────────────────────────────────
// 内部类型
// ─────────────────────────────────────────────

interface V0SearchResponse {
  total:  number;
  limit:  number;
  offset: number;
  data:   ApiSearchItem[];
}

interface ApiSearchItem {
  id:       number;
  type:     number;
  name:     string;
  name_cn:  string;
  date?:    string;
  image?:   string;
  images?:  ApiSubject['images'];
  rating?:  { score?: number; rank?: number };
  tags?:    Array<{ name: string; count: number }>;
}

const NOT_FOUND = Symbol('NOT_FOUND');

// ─────────────────────────────────────────────
// OnlineFetcher
// ─────────────────────────────────────────────

export class OnlineFetcher {
  constructor(private readonly getSettings: () => BangumiSettings) {}

  /**
   * 按 ID 精确拉取条目。
   * 并行请求 subjects（关联）、characters（声优）、episodes（分集/曲目）。
   */
  async fetchById(id: number): Promise<SubjectData | null> {
    const subjectResult = await this.requestRaw<ApiSubject>(`/v0/subjects/${id}`);
    if (subjectResult === NOT_FOUND) return null;

    // 三路并行：关联条目、声优、分集/曲目
    const [relsResult, charsResult, epsResult] = await Promise.allSettled([
      this.requestRaw<ApiRelation[]>(`/v0/subjects/${id}/subjects`),
      this.requestRaw<ApiCharacter[]>(`/v0/subjects/${id}/characters`),
      this.requestRaw<{ data: ApiEpisode[] }>(`/v0/subjects/${id}/episodes?limit=100`),
    ]);

    let relations:      ApiRelation[] = [];
    let relationsLoaded = true;
    if (relsResult.status === 'fulfilled') {
      const r = relsResult.value;
      if (r !== NOT_FOUND && Array.isArray(r)) relations = r;
    } else {
      relationsLoaded = false;
      console.warn(`[bangumi] #${id} 关联条目请求失败`, relsResult.reason);
    }

    let castCredits: CastCredit[] = [];
    if (charsResult.status === 'fulfilled') {
      const c = charsResult.value;
      if (c !== NOT_FOUND && Array.isArray(c)) {
        castCredits = normalizeCharacters(c);
      }
    } else {
      console.warn(`[bangumi] #${id} 声优数据请求失败`, charsResult.reason);
    }

    // 分集/曲目：API 返回 { data: ApiEpisode[] }
    let onlineEpisodes: EpisodeData[] = [];
    if (epsResult.status === 'fulfilled') {
      const e = epsResult.value;
      if (e !== NOT_FOUND && e && Array.isArray(e.data)) {
        onlineEpisodes = normalizeEpisodes(id, e.data);
      }
    } else {
      console.warn(`[bangumi] #${id} 分集数据请求失败`, epsResult.reason);
    }

    const data = DataAdapter.fromApi(subjectResult, relations, castCredits, onlineEpisodes);
    if (!relationsLoaded) data.relationsLoaded = false;
    return data;
  }

  /**
   * 仅拉取关联条目，供 RelationFetcher 补全离线条目使用。
   */
  async fetchRelations(id: number): Promise<SubjectRelation[]> {
    const result = await this.requestRaw<ApiRelation[]>(`/v0/subjects/${id}/subjects`);
    if (result === NOT_FOUND || !Array.isArray(result)) return [];
    return result.map(normalizeRelation);
  }

  /**
   * 仅拉取角色/声优数据，供离线条目补全 castCredits 使用。
   * 失败返回空数组，不抛错。
   */
  async fetchCharactersOnly(id: number): Promise<CastCredit[]> {
    try {
      const result = await this.requestRaw<ApiCharacter[]>(`/v0/subjects/${id}/characters`);
      if (result === NOT_FOUND || !Array.isArray(result)) return [];
      return normalizeCharacters(result);
    } catch {
      return [];
    }
  }

  /**
   * 仅拉取分集/曲目数据，供离线条目补全 onlineEpisodes 使用。
   * 失败返回空数组，不抛错。
   */
  async fetchEpisodesOnly(id: number): Promise<EpisodeData[]> {
    try {
      const result = await this.requestRaw<{ data: ApiEpisode[] }>(
        `/v0/subjects/${id}/episodes?limit=100`,
      );
      if (result === NOT_FOUND || !result || !Array.isArray(result.data)) return [];
      return normalizeEpisodes(id, result.data);
    } catch {
      return [];
    }
  }

  /**
   * 关键词在线搜索。
   */
  async searchByKeyword(query: SearchQuery): Promise<SearchResponse> {
    const limit  = query.limit > 0 ? query.limit : DEFAULT_PAGE_SIZE;
    const offset = Math.max(0, (query.page - 1) * limit);

    const body: Record<string, unknown> = {
      keyword: query.keyword,
      sort:    'match',
    };
    if (query.typeFilter > 0) {
      body.filter = { type: [query.typeFilter] };
    }

    let resp: V0SearchResponse | null = null;
    try {
      const result = await this.requestRaw<V0SearchResponse>(
        `/v0/search/subjects?limit=${limit}&offset=${offset}`,
        { method: 'POST', body },
      );
      resp = result === NOT_FOUND ? null : result;
    } catch (err) {
      console.warn('[bangumi] 在线搜索失败', err);
    }

    if (!resp) return { list: [], total: 0, fromOffline: false };

    const list: SearchResultItem[] = (resp.data ?? []).map(toSearchResultItem);
    return { list, total: resp.total ?? list.length, fromOffline: false };
  }

  // ─────────────────────────────────────────────
  // 内部：请求核心
  // ─────────────────────────────────────────────

  private async requestRaw<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T | typeof NOT_FOUND> {
    const url     = `${BGM_API_BASE}${path}`;
    const headers = this.buildHeaders(init.body !== undefined);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * attempt);

      let status = 0;
      try {
        const resp = await withTimeout(
          requestUrl({
            url,
            method:  init.method ?? 'GET',
            headers,
            body:    init.body !== undefined ? JSON.stringify(init.body) : undefined,
            throw:   false,
          }),
          REQUEST_TIMEOUT_MS,
        );

        status = resp.status;
        if (status === 200)  return resp.json as T;
        if (status === 404)  return NOT_FOUND;

        const shouldRetry = status === 429 || status >= 500;
        if (shouldRetry && attempt < MAX_RETRIES) continue;
        throw new FetchError(`HTTP ${status}`, status);
      } catch (err) {
        if (err instanceof FetchError) throw err;
        if (attempt < MAX_RETRIES) continue;
        throw new FetchError(
          err instanceof Error ? err.message : String(err),
          status,
          err instanceof Error ? err : undefined,
        );
      }
    }

    throw new FetchError('重试次数耗尽', 0);
  }

  private buildHeaders(hasBody = false): Record<string, string> {
    const settings = this.getSettings();
    const h: Record<string, string> = {
      'User-Agent': BGM_UA,
      Accept:       'application/json',
    };
    if (settings.token) h['Authorization'] = `Bearer ${settings.token}`;
    if (hasBody)        h['Content-Type']  = 'application/json';
    return h;
  }
}

// ─────────────────────────────────────────────
// 公共错误类
// ─────────────────────────────────────────────

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly cause?: Error,
  ) {
    super(`[bangumi] ${message}`);
    this.name = 'FetchError';
  }

  get isNetworkError(): boolean { return this.status === 0; }
  get isRateLimited():  boolean { return this.status === 429; }
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`request timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 将 API characters 响应归一化为 CastCredit[]
 */
function normalizeCharacters(chars: ApiCharacter[]): CastCredit[] {
  const result: CastCredit[] = [];
  for (const ch of chars) {
    if (!ch.actors || ch.actors.length === 0) continue;
    for (const actor of ch.actors) {
      result.push({
        characterId:   ch.id,
        characterName: ch.name ?? '',
        actorId:       actor.id,
        actorName:     actor.name_cn?.trim() || actor.name,
        actorOriginal: actor.name,
      });
    }
  }
  return result;
}

/**
 * 将 API episodes 响应归一化为 EpisodeData[]，与离线索引结构对齐。
 * 按 type → sort 排序：正篇(0)在前，SP/OP/ED 在后。
 */
function normalizeEpisodes(subjectId: number, eps: ApiEpisode[]): EpisodeData[] {
  return eps
    .map(ep => ({
      id:        ep.id,
      subjectId,
      type:      ep.type ?? 0,
      sort:      ep.sort ?? 0,
      name:      ep.name ?? '',
      nameCn:    ep.name_cn?.trim() ?? '',
      airdate:   ep.airdate ?? '',
      duration:  ep.duration ?? '',
      desc:      ep.desc ?? '',
    }))
    .sort((a, b) => a.type !== b.type ? a.type - b.type : a.sort - b.sort);
}

function toSearchResultItem(item: ApiSearchItem): SearchResultItem {
  const typeKey: SubjectTypeKey = SUBJECT_TYPE_MAP[item.type] ?? 'anime';
  const name     = item.name_cn?.trim() || item.name;
  // 修复：同 DataAdapter，用 || 链避免空字符串问题
  const coverUrl =
    item.image?.trim()          ||
    item.images?.large?.trim()  ||
    item.images?.common?.trim() ||
    item.images?.medium?.trim() ||
    '';

  return {
    id:           item.id,
    name,
    nameOriginal: item.name,
    typeKey,
    year:         (item.date ?? '').slice(0, 4),
    score:        item.rating?.score ?? 0,
    coverUrl,
    source:       'api',
  };
}
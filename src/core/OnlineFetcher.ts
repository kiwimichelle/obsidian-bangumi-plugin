import { requestUrl } from 'obsidian';
import type {
  ApiRelation,
  ApiSubject,
  BangumiSettings,
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

const REQUEST_TIMEOUT_MS = 15_000;
/** 遇到 429 / 5xx / 网络错误时最多重试次数 */
const MAX_RETRIES = 2;
/** 重试基础等待时间（ms），实际等待 = RETRY_BASE * attempt，线性退避 */
const RETRY_BASE_DELAY_MS = 800;

// ─────────────────────────────────────────────
// 内部类型
// ─────────────────────────────────────────────

/** v0 POST /v0/search/subjects 响应 */
interface V0SearchResponse {
  total: number;
  limit: number;
  offset: number;
  data: ApiSearchItem[];
}

/** 搜索结果中的单个条目（比完整 ApiSubject 字段少） */
interface ApiSearchItem {
  id: number;
  type: number;
  name: string;
  name_cn: string;
  date?: string;
  /** 封面缩略图，直接是 URL 字符串 */
  image?: string;
  images?: ApiSubject['images'];
  rating?: { score?: number; rank?: number };
  tags?: Array<{ name: string; count: number }>;
}

/** 可区分"404"和"请求失败"的内部 sentinel */
const NOT_FOUND = Symbol('NOT_FOUND');

// ─────────────────────────────────────────────
// OnlineFetcher
// ─────────────────────────────────────────────

/**
 * 在线数据采集器
 *
 * 职责（仅 I/O 层）：
 * - `fetchById`：调 `/v0/subjects/:id` + `/v0/subjects/:id/subjects`，
 *   归一化为 `SubjectData`（source = 'api'），不负责写缓存。
 * - `searchByKeyword`：调 `POST /v0/search/subjects`，返回 `SearchResponse`。
 *
 * 数据落缓存 → DataManager 负责（OnlineFetcher 不持有 CacheManager 引用）。
 *
 * 错误策略：
 * - 404 → fetchById 返回 null；搜索返回空列表
 * - 429 / 5xx / 网络超时 → 最多重试 MAX_RETRIES 次，用尽后抛 FetchError
 * - 其它 4xx → 不重试，直接抛 FetchError
 *
 * 使用 `getSettings` getter 而非持有 settings 引用，确保 token 更新后即时生效。
 */
export class OnlineFetcher {
  constructor(private readonly getSettings: () => BangumiSettings) {}

  /**
   * 按 ID 精确拉取条目。
   * - 返回 `SubjectData`（source='api'）：命中
   * - 返回 `null`：该 ID 在 Bangumi 不存在（404）
   * - 抛出 `FetchError`：网络/服务端故障
   */
  async fetchById(id: number): Promise<SubjectData | null> {
    const subjectResult = await this.requestRaw<ApiSubject>(`/v0/subjects/${id}`);
    if (subjectResult === NOT_FOUND) return null;

    let relations: ApiRelation[] = [];
    let relationsLoaded = true;
    try {
      const relsResult = await this.requestRaw<ApiRelation[]>(`/v0/subjects/${id}/subjects`);
      if (relsResult !== NOT_FOUND && Array.isArray(relsResult)) {
        relations = relsResult;
      }
    } catch (err) {
      // relations 是次要数据：请求失败时仅记录，不阻塞主流程
      // relationsLoaded=false 让 RelationFetcher 日后补全
      relationsLoaded = false;
      console.warn(`[bangumi] #${id} 关联条目请求失败，待 RelationFetcher 补全`, err);
    }

    const data = DataAdapter.fromApi(subjectResult, relations);
    if (!relationsLoaded) {
      data.relationsLoaded = false;
    }
    return data;
  }

  /**
   * 仅拉取关联条目（`/v0/subjects/:id/subjects`），供 RelationFetcher 补全
   * 离线条目使用。
   *
   * - 200 → 返回归一化后的 `SubjectRelation[]`
   * - 404 → 返回空数组（关联端点 404 视为"无关联"而非错误）
   * - 429 / 5xx / 网络故障 → 抛 `FetchError`，由调用方（RelationFetcher）
   *   决定是否吞掉。本方法本身不静默吞错，保留信号让上层能区分
   *   "确认无关联" vs "暂时不可用"。
   */
  async fetchRelations(id: number): Promise<SubjectRelation[]> {
    const result = await this.requestRaw<ApiRelation[]>(`/v0/subjects/${id}/subjects`);
    if (result === NOT_FOUND || !Array.isArray(result)) return [];
    return result.map(normalizeRelation);
  }

  /**
   * 关键词在线搜索（调 `POST /v0/search/subjects`）。
   * 网络失败时返回空结果而不抛，避免打断 SearchModal 展示流程。
   */
  async searchByKeyword(query: SearchQuery): Promise<SearchResponse> {
    const limit = query.limit > 0 ? query.limit : DEFAULT_PAGE_SIZE;
    const offset = Math.max(0, (query.page - 1) * limit);

    const body: Record<string, unknown> = {
      keyword: query.keyword,
      sort: 'match',
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

    if (!resp) {
      return { list: [], total: 0, fromOffline: false };
    }

    const list: SearchResultItem[] = (resp.data ?? []).map(toSearchResultItem);
    return { list, total: resp.total ?? list.length, fromOffline: false };
  }

  // ─────────────────────────────────────────────
  // 内部：请求核心
  // ─────────────────────────────────────────────

  /**
   * 发起带重试的请求。
   * - 成功 → 返回解析后的 JSON（类型 T）
   * - 404 → 返回 `NOT_FOUND` symbol
   * - 429 / 5xx / 网络超时 → 线性退避重试，用尽后抛 `FetchError`
   * - 其它 4xx → 直接抛 `FetchError`（不重试）
   */
  private async requestRaw<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T | typeof NOT_FOUND> {
    const url = `${BGM_API_BASE}${path}`;
    const headers = this.buildHeaders(init.body !== undefined);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await delay(RETRY_BASE_DELAY_MS * attempt);
      }

      let status = 0;
      try {
        const resp = await withTimeout(
          requestUrl({
            url,
            method: init.method ?? 'GET',
            headers,
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            throw: false,
          }),
          REQUEST_TIMEOUT_MS,
        );

        status = resp.status;

        if (status === 200) {
          return resp.json as T;
        }

        if (status === 404) {
          return NOT_FOUND;
        }

        const shouldRetry = status === 429 || status >= 500;
        if (shouldRetry && attempt < MAX_RETRIES) {
          continue;
        }

        throw new FetchError(`HTTP ${status}`, status);
      } catch (err) {
        if (err instanceof FetchError) throw err;

        // 网络错误 / 超时
        if (attempt < MAX_RETRIES) continue;
        throw new FetchError(
          err instanceof Error ? err.message : String(err),
          status,
          err instanceof Error ? err : undefined,
        );
      }
    }

    // 理论上不可达，但满足 TS 控制流
    throw new FetchError('重试次数耗尽', 0);
  }

  private buildHeaders(hasBody = false): Record<string, string> {
    const settings = this.getSettings();
    const h: Record<string, string> = {
      'User-Agent': BGM_UA,
      Accept: 'application/json',
    };
    if (settings.token) {
      h['Authorization'] = `Bearer ${settings.token}`;
    }
    if (hasBody) {
      h['Content-Type'] = 'application/json';
    }
    return h;
  }
}

// ─────────────────────────────────────────────
// 公共错误类
// ─────────────────────────────────────────────

/** API 请求失败时抛出的结构化错误，供 DataManager / UI 层区分处理 */
export class FetchError extends Error {
  constructor(
    message: string,
    /** HTTP 状态码；0 表示网络层错误（无 HTTP 响应）*/
    public readonly status: number,
    public readonly cause?: Error,
  ) {
    super(`[bangumi] ${message}`);
    this.name = 'FetchError';
  }

  /** 是否是网络/超时类错误（无 HTTP 响应） */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** 是否是限流错误 */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
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

function toSearchResultItem(item: ApiSearchItem): SearchResultItem {
  const typeKey: SubjectTypeKey = SUBJECT_TYPE_MAP[item.type] ?? 'anime';
  const name = item.name_cn?.trim() || item.name;
  const coverUrl =
    item.image ??
    item.images?.large ??
    item.images?.common ??
    item.images?.medium ??
    '';

  return {
    id: item.id,
    name,
    nameOriginal: item.name,
    typeKey,
    year: (item.date ?? '').slice(0, 4),
    score: item.rating?.score ?? 0,
    coverUrl,
    source: 'api',
  };
}

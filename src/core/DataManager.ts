import type {
  BangumiSettings,
  EpisodeData,
  InfoboxEntry,
  PersonCredit,
  SearchDataEntry,
  SearchQuery,
  SearchResponse,
  SearchResultItem,
  SubjectData,
} from '../types';
import { DEFAULT_PAGE_SIZE, SUBJECT_TYPE_MAP } from '../constants';
import type { CacheManager }         from './CacheManager';
import type { IndexBuilder }         from './IndexBuilder';
import type { JsonlReader }          from './JsonlReader';
import type { SearchIndexBuilder }   from './SearchIndexBuilder';
import type { OnlineFetcher }        from './OnlineFetcher';
import type { BgmScraper }           from './BgmScraper';
import type { RelationFetcher }      from './RelationFetcher';
import type { RelationIndexBuilder } from './RelationIndexBuilder';
import type { EpisodeIndexBuilder }  from './EpisodeindexBuilder';
import type { PersonIndexBuilder }   from './PersonindexBuilder';
import { DataAdapter }               from './DataAdapter';
import type { ArchiveLocator }       from '../vault/ArchiveLocator';

// ─────────────────────────────────────────────
// 公共错误类型
// ─────────────────────────────────────────────

export class SubjectNotFoundError extends Error {
  constructor(public readonly id: number) {
    super(`[bangumi] 条目 #${id} 在缓存、离线包、在线 API 均未找到`);
    this.name = 'SubjectNotFoundError';
  }
}

// ─────────────────────────────────────────────
// 构造依赖
// ─────────────────────────────────────────────

export interface DataManagerDeps {
  cache:          CacheManager;
  index:          IndexBuilder;
  searchIndex:    SearchIndexBuilder;
  jsonl:          JsonlReader;
  fetcher:        OnlineFetcher;
  scraper:        BgmScraper;
  relations:      RelationFetcher;
  relationIndex?: RelationIndexBuilder;
  episodeIndex?:  EpisodeIndexBuilder;
  personIndex?:   PersonIndexBuilder;
  getJsonlPath:   () => string | null;
  getSettings:    () => BangumiSettings;
  archiveLocator: ArchiveLocator;
}

// ─────────────────────────────────────────────
// DataManager
// ─────────────────────────────────────────────

export class DataManager {
  private readonly cache:          CacheManager;
  private readonly index:          IndexBuilder;
  private readonly searchIndex:    SearchIndexBuilder;
  private readonly jsonl:          JsonlReader;
  private readonly fetcher:        OnlineFetcher;
  private readonly scraper:        BgmScraper;
  private readonly relations:      RelationFetcher;
  private readonly relationIndex:  RelationIndexBuilder | undefined;
  private readonly episodeIndex:   EpisodeIndexBuilder  | undefined;
  private readonly personIndex:    PersonIndexBuilder   | undefined;
  private readonly getJsonlPath:   () => string | null;
  private readonly getSettings:    () => BangumiSettings;
  private readonly archiveLocator: ArchiveLocator;

  private readonly enriching = new Set<number>();

  constructor(deps: DataManagerDeps) {
    this.cache          = deps.cache;
    this.index          = deps.index;
    this.searchIndex    = deps.searchIndex;
    this.jsonl          = deps.jsonl;
    this.fetcher        = deps.fetcher;
    this.scraper        = deps.scraper;
    this.relations      = deps.relations;
    this.relationIndex  = deps.relationIndex;
    this.episodeIndex   = deps.episodeIndex;
    this.personIndex    = deps.personIndex;
    this.getJsonlPath   = deps.getJsonlPath;
    this.getSettings    = deps.getSettings;
    this.archiveLocator = deps.archiveLocator;
  }

  // ─────────────────────────────────────────────
  // 主流程：按 ID 取条目（四级级联）
  // ─────────────────────────────────────────────

  async getSubject(id: number): Promise<SubjectData> {
    // ① 内存缓存
    const cached = this.cache.get(id);
    if (cached) {
      if (!cached.relationsLoaded) this.scheduleEnrich(cached, false);
      return cached;
    }

    // ② 离线包
    const archiveHit = await this.tryArchive(id);
    if (archiveHit) {
      if (this.relationIndex?.isReady()) {
        archiveHit.relations      = this.relationIndex.getRelations(id);
        archiveHit.relationsLoaded = true;
        this.cache.set(id, archiveHit);
        this.scheduleEnrich(archiveHit, true, true);
      } else {
        this.cache.set(id, archiveHit);
        this.scheduleEnrich(archiveHit, true);
      }
      return archiveHit;
    }

    // ③ 在线 API
    const apiData = await this.fetcher.fetchById(id);
    if (apiData) {
      this.cache.set(id, apiData);
      if (!apiData.relationsLoaded) this.scheduleEnrich(apiData, false);
      return apiData;
    }

    // ④ 全部未命中
    throw new SubjectNotFoundError(id);
  }

  // ─────────────────────────────────────────────
  // 全量索引构建
  // ─────────────────────────────────────────────

  async buildAllOfflineIndices(
    onProgress?: (stage: string, lines: number) => void,
  ): Promise<void> {
    const settings = this.getSettings();
    const paths    = settings.offlineDbPaths;

    const subjectPath = await this.archiveLocator.resolveCustom(paths.subject);
    if (!subjectPath) {
      console.warn('[bangumi] 主条目路径未配置或无效，放弃构建');
      return;
    }

    onProgress?.('主条目行号索引', 0);
    await this.index.build(subjectPath, lines => onProgress?.('主条目行号索引', lines));

    // 搜索索引（同时构建轻量数据缓存）
    onProgress?.('关键词搜索索引', 0);
    await this.searchIndex.build(subjectPath, lines => onProgress?.('关键词搜索索引', lines));

    if (this.episodeIndex && paths.episodes) {
      const p = await this.archiveLocator.resolveCustom(paths.episodes);
      if (p) {
        onProgress?.('分集信息索引', 0);
        await this.episodeIndex.build(p, lines => onProgress?.('分集信息索引', lines));
      } else {
        console.warn('[bangumi] episodes 路径无效，跳过分集索引');
      }
    }

    if (this.personIndex && paths.persons && paths.subjectPersons) {
      const p1 = await this.archiveLocator.resolveCustom(paths.persons);
      const p2 = await this.archiveLocator.resolveCustom(paths.subjectPersons);
      if (p1 && p2) {
        onProgress?.('制作人员索引', 0);
        await this.personIndex.build(p1, p2, lines => onProgress?.('制作人员索引', lines));
      } else {
        console.warn('[bangumi] persons 路径无效，跳过制作人员索引');
      }
    }

    if (this.relationIndex && paths.relations) {
      const p = await this.archiveLocator.resolveCustom(paths.relations);
      if (p) {
        onProgress?.('关联条目索引', 0);
        await this.relationIndex.build(p, lines => onProgress?.('关联条目索引', lines));
      } else {
        console.warn('[bangumi] relations 路径无效，跳过关联索引');
      }
    }
  }

  // ─────────────────────────────────────────────
  // 分集 / 制作人员数据访问
  // ─────────────────────────────────────────────

  getEpisodes(subjectId: number): EpisodeData[] {
    if (!this.episodeIndex?.isReady()) return [];
    return this.episodeIndex.getEpisodes(subjectId);
  }

  getMainEpisodes(subjectId: number): EpisodeData[] {
    if (!this.episodeIndex?.isReady()) return [];
    return this.episodeIndex.getMainEpisodes(subjectId);
  }

  getCredits(subjectId: number): PersonCredit[] {
    if (!this.personIndex?.isReady()) return [];
    return this.personIndex.getCredits(subjectId);
  }

  getCreditsByPosition(subjectId: number): Map<string, PersonCredit[]> {
    if (!this.personIndex?.isReady()) return new Map();
    return this.personIndex.getCreditsByPosition(subjectId);
  }

  // ─────────────────────────────────────────────
  // 主流程：搜索
  // ─────────────────────────────────────────────

  async search(query: SearchQuery): Promise<SearchResponse> {
    const settings     = this.getSettings();
    const limit        = query.limit > 0 ? query.limit : DEFAULT_PAGE_SIZE;
    const modeOverride = query.mode;
    const wantOffline  = modeOverride === 'offline'
      ? true
      : modeOverride === 'online'
      ? false
      : settings.offlineMode;

    const useOffline = wantOffline && this.searchIndex.isReady();

    if (useOffline) {
      const offline = await this.searchOffline(query, limit);
      if (offline.list.length > 0) return this.applyNsfwFilter(offline, settings);
    }

    const result = await this.fetcher.searchByKeyword(query);
    return this.applyNsfwFilter(result, settings);
  }

  // ─────────────────────────────────────────────
  // 内部：NSFW 过滤
  // 修复：不再用比例估算 total，直接返回真实过滤后数量（离线场景 total 准确）
  // ─────────────────────────────────────────────

  private applyNsfwFilter(resp: SearchResponse, settings: BangumiSettings): SearchResponse {
    if (!settings.hideNsfw) return resp;
    const filtered = resp.list.filter(item => !item.nsfw);
    if (filtered.length === resp.list.length) return resp;
    // 离线场景 total 是精确值；在线场景 total 是服务端返回的总数，
    // 过滤后只能近似，但至少不低于当前页实际数量
    const total = resp.fromOffline
      ? filtered.length
      : Math.max(filtered.length, resp.total - (resp.list.length - filtered.length));
    return { ...resp, list: filtered, total };
  }

  // ─────────────────────────────────────────────
  // 内部：离线搜索（方案A：完全基于内存，不读 jsonl）
  // ─────────────────────────────────────────────

  private async searchOffline(query: SearchQuery, limit: number): Promise<SearchResponse> {
    const allIds = this.searchIndex.search(query.keyword);
    if (allIds.length === 0) return { list: [], total: 0, fromOffline: true };

    // 类型过滤：直接从 dataCache 读，O(1)
    const filtered = query.typeFilter > 0
      ? allIds.filter(id => {
          const entry = this.searchIndex.getDataEntry(id);
          return entry ? SUBJECT_TYPE_MAP[entry.type] === SUBJECT_TYPE_MAP[query.typeFilter] : false;
        })
      : allIds;

    const total   = filtered.length;
    const offset  = Math.max(0, (query.page - 1) * limit);
    const pageIds = filtered.slice(offset, offset + limit);

    // 物化：优先 userCache，其次 searchIndex.dataCache，完全不读 jsonl
    const list = pageIds
      .map(id => {
        const cached = this.cache.get(id);
        if (cached) return toSearchItemFromData(cached);

        const entry = this.searchIndex.getDataEntry(id);
        if (entry) return toSearchItemFromEntry(entry);

        return null;
      })
      .filter((item): item is SearchResultItem => item !== null);

    return { list, total, fromOffline: true };
  }

  // ─────────────────────────────────────────────
  // 内部：archive 命中
  // ─────────────────────────────────────────────

  private async tryArchive(id: number): Promise<SubjectData | null> {
    if (!this.index.isReady()) return null;
    const lineNum = this.index.getLine(id);
    if (lineNum === undefined) return null;

    const jsonlPath = this.getJsonlPath();
    if (!jsonlPath) return null;

    const raw = await this.jsonl.readLine(jsonlPath, lineNum);
    if (!raw || raw.id !== id) return null;

    return DataAdapter.fromArchive(raw);
  }

  // ─────────────────────────────────────────────
  // 内部：异步补全
  // ─────────────────────────────────────────────

  private scheduleEnrich(
    data:           SubjectData,
    alsoScrape:     boolean,
    skipRelations = false,
  ): void {
    if (this.enriching.has(data.id)) return;
    this.enriching.add(data.id);

    void (async () => {
      let touched = false;
      try {
        if (!skipRelations && this.relations.needsEnrich(data)) {
          const ok = await this.relations.enrich(data);
          if (ok) touched = true;
        }

        if (alsoScrape) {
          const extra = await this.scraper.scrapeInfobox(data.id);
          if (extra.length > 0 && mergeMissingInfobox(data.infobox, extra)) {
            touched = true;
          }
        }

        if (touched) this.cache.set(data.id, data);
      } catch (err) {
        console.warn(`[bangumi] #${data.id} 补全任务异常`, err);
      } finally {
        this.enriching.delete(data.id);
      }
    })();
  }
}

// ─────────────────────────────────────────────
// 模块内私有：转换工具
// ─────────────────────────────────────────────

function toSearchItemFromData(data: SubjectData): SearchResultItem {
  return {
    id:           data.id,
    name:         data.name,
    nameOriginal: data.nameOriginal,
    typeKey:      data.typeKey,
    year:         (data.date ?? '').slice(0, 4),
    score:        data.score,
    coverUrl:     data.coverUrl,
    nsfw:         data.nsfw ?? false,
    source:       data.source,
  };
}

/** 方案A：从轻量数据缓存直接构建搜索结果项，完全不读 jsonl */
function toSearchItemFromEntry(entry: SearchDataEntry): SearchResultItem {
  const typeKey = SUBJECT_TYPE_MAP[entry.type] ?? 'anime';
  const name    = entry.name_cn?.trim() || entry.name;
  return {
    id:           entry.id,
    name,
    nameOriginal: entry.name,
    typeKey,
    year:         entry.date.slice(0, 4),
    score:        entry.score,
    coverUrl:     entry.image,
    nsfw:         entry.nsfw,
    source:       'archive',
  };
}

function mergeMissingInfobox(existing: InfoboxEntry[], extra: InfoboxEntry[]): boolean {
  const known   = new Set(existing.map(e => e.key));
  let touched   = false;
  for (const entry of extra) {
    if (!known.has(entry.key)) {
      existing.push(entry);
      known.add(entry.key);
      touched = true;
    }
  }
  return touched;
}
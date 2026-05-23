import type {
  BangumiSettings,
  InfoboxEntry,
  RawArchiveSubject,
  SearchQuery,
  SearchResponse,
  SearchResultItem,
  SubjectData,
} from '../types';
import { DEFAULT_PAGE_SIZE, SUBJECT_TYPE_MAP } from '../constants';
import type { CacheManager } from './CacheManager';
import type { IndexBuilder } from './IndexBuilder';
import type { JsonlReader } from './JsonlReader';
import type { SearchIndexBuilder } from './SearchIndexBuilder';
import type { OnlineFetcher } from './OnlineFetcher';
import type { BgmScraper } from './BgmScraper';
import type { RelationFetcher } from './RelationFetcher';
import { DataAdapter } from './DataAdapter';

// ─────────────────────────────────────────────
// 公共错误类型
// ─────────────────────────────────────────────

/**
 * 四级级联全部未命中时抛出。
 * 与 `OnlineFetcher.FetchError` 不同：FetchError 表示网络层失败（可重试），
 * SubjectNotFoundError 表示条目在所有数据源都不存在（重试无意义）。
 */
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
  cache: CacheManager;
  index: IndexBuilder;
  searchIndex: SearchIndexBuilder;
  jsonl: JsonlReader;
  fetcher: OnlineFetcher;
  scraper: BgmScraper;
  relations: RelationFetcher;
  /**
   * 已解析为绝对路径的 `bangumi.jsonl` 位置，由 main.ts 通过 ArchiveLocator
   * 注入。未配置 / 文件不可用时返回 null —— DataManager 据此跳过第②级。
   */
  getJsonlPath: () => string | null;
  /** 实时获取最新 settings（offlineMode 等运行时可变项）。 */
  getSettings: () => BangumiSettings;
}

// ─────────────────────────────────────────────
// DataManager
// ─────────────────────────────────────────────

/**
 * 数据层总调度（唯一对外接口）
 *
 * 设计哲学：
 * - **本地优先**：cache → archive → online → throw
 * - **数据反哺**：archive / api 命中后立即写入 CacheManager
 * - **异步补全**：archive 命中后 fire-and-forget 调
 *   RelationFetcher（API 拉关联）+ BgmScraper（网页补 infobox），
 *   完成后再次反哺。不阻塞 `getSubject` 的 resolve
 *
 * 红线（违反就是 bug）：
 * - `getSubject` 全部未命中才 throw（`SubjectNotFoundError`），绝不静默返回 null
 * - 不持有任何 Obsidian Vault / Note 概念，纯数据层
 * - 不直接读 settings 字段，所有运行时配置走 `getSettings()` getter
 */
export class DataManager {
  private readonly cache: CacheManager;
  private readonly index: IndexBuilder;
  private readonly searchIndex: SearchIndexBuilder;
  private readonly jsonl: JsonlReader;
  private readonly fetcher: OnlineFetcher;
  private readonly scraper: BgmScraper;
  private readonly relations: RelationFetcher;
  private readonly getJsonlPath: () => string | null;
  private readonly getSettings: () => BangumiSettings;

  /** 正在执行补全任务的条目 ID，去重避免短时间重复触发 */
  private readonly enriching = new Set<number>();

  constructor(deps: DataManagerDeps) {
    this.cache = deps.cache;
    this.index = deps.index;
    this.searchIndex = deps.searchIndex;
    this.jsonl = deps.jsonl;
    this.fetcher = deps.fetcher;
    this.scraper = deps.scraper;
    this.relations = deps.relations;
    this.getJsonlPath = deps.getJsonlPath;
    this.getSettings = deps.getSettings;
  }

  // ─────────────────────────────────────────────
  // 主流程：按 ID 取条目（四级级联）
  // ─────────────────────────────────────────────

  /**
   * 按 ID 取条目，四级级联：
   * ① CacheManager.get(id)
   * ② IndexBuilder.getLine(id) + JsonlReader.readLine
   * ③ OnlineFetcher.fetchById(id)
   * ④ SubjectNotFoundError
   *
   * 命中 ② 或 ③ 后立即反哺缓存；命中 ② 后异步补全 relations + 网页 infobox。
   */
  async getSubject(id: number): Promise<SubjectData> {
    // ① 内存缓存
    const cached = this.cache.get(id);
    if (cached) {
      // 旧缓存可能缺 relations（早期由 archive 反哺时关联还未补全）：
      // fire-and-forget 异步补，不阻塞返回
      if (!cached.relationsLoaded) this.scheduleEnrich(cached, false);
      return cached;
    }

    // ② 离线包
    const archiveHit = await this.tryArchive(id);
    if (archiveHit) {
      // 反哺缓存（一次，让用户至少持有基础数据）
      this.cache.set(id, archiveHit);
      // 异步：补 relations + 网页 infobox，完成后再反哺一次
      this.scheduleEnrich(archiveHit, true);
      return archiveHit;
    }

    // ③ 在线 API
    const apiData = await this.fetcher.fetchById(id);
    if (apiData) {
      this.cache.set(id, apiData);
      // API 拉关联失败时 relationsLoaded=false（见 OnlineFetcher.fetchById），
      // 留待 RelationFetcher 重试；scraper 仅在 API 缺关键字段时有意义，
      // 此处 API 数据通常已完整，暂不触发，避免无谓抓站
      if (!apiData.relationsLoaded) this.scheduleEnrich(apiData, false);
      return apiData;
    }

    // ④ 全军覆没
    throw new SubjectNotFoundError(id);
  }

  // ─────────────────────────────────────────────
  // 主流程：关键词搜索
  // ─────────────────────────────────────────────

  /**
   * 关键词搜索：
   * - 无 forceMode 时按 settings.offlineMode 自动决策；离线命中为 0 时回退在线
   * - forceMode='offline'：强制离线，索引未就绪则抛错
   * - forceMode='online'：强制在线，跳过离线索引
   *
   * @param query     搜索关键词与分页参数
   * @param forceMode 由 UI 层显式指定的数据源模式（可选）
   */
  async search(query: SearchQuery, forceMode?: 'offline' | 'online'): Promise<SearchResponse> {
    const limit = query.limit > 0 ? query.limit : DEFAULT_PAGE_SIZE;

    // 1. 如果 UI 显式强制走在线模式
    if (forceMode === 'online') {
      return this.fetcher.searchByKeyword(query);
    }

    // 2. 如果 UI 显式强制走离线模式
    if (forceMode === 'offline') {
      if (!this.searchIndex.isReady()) {
        throw new Error('离线索引未就绪');
      }
      return this.searchOffline(query, limit);
    }

    // 3. 兜底逻辑：无强制指定时，按照 Setting 自动决策
    const settings = this.getSettings();
    const useOffline = settings.offlineMode && this.searchIndex.isReady();

    if (useOffline) {
      const offline = await this.searchOffline(query, limit);
      if (offline.list.length > 0) return offline;
      // 命中为 0 → 回退到在线（关键词可能不在离线包字典中）
    }

    return this.fetcher.searchByKeyword(query);
  }

  // ─────────────────────────────────────────────
  // 内部：离线搜索
  // ─────────────────────────────────────────────

  private async searchOffline(query: SearchQuery, limit: number): Promise<SearchResponse> {
    const allIds = this.searchIndex.search(query.keyword);
    if (allIds.length === 0) {
      return { list: [], total: 0, fromOffline: true };
    }

    const filtered = query.typeFilter > 0
      ? await this.filterByType(allIds, query.typeFilter)
      : allIds;

    const total = filtered.length;
    const offset = Math.max(0, (query.page - 1) * limit);
    const pageIds = filtered.slice(offset, offset + limit);

    const list = await this.materializeIds(pageIds);
    return { list, total, fromOffline: true };
  }

  /**
   * 把 ID 列表展开成 SearchResultItem 列表（顺序与传入一致）。
   * 缓存命中直接读，未命中的批量走 JsonlReader.readLines（单次流扫描）。
   */
  private async materializeIds(ids: number[]): Promise<SearchResultItem[]> {
    if (ids.length === 0) return [];

    const fromCache = new Map<number, SearchResultItem>();
    const missing: number[] = [];
    for (const id of ids) {
      const cached = this.cache.get(id);
      if (cached) {
        fromCache.set(id, toSearchItemFromData(cached));
      } else {
        missing.push(id);
      }
    }

    const fromArchive = new Map<number, SearchResultItem>();
    if (missing.length > 0) {
      const rows = await this.readArchiveRows(missing);
      for (const raw of rows) {
        if (raw) fromArchive.set(raw.id, toSearchItemFromRaw(raw));
      }
    }

    const result: SearchResultItem[] = [];
    for (const id of ids) {
      const item = fromCache.get(id) ?? fromArchive.get(id);
      if (item) result.push(item);
    }
    return result;
  }

  /**
   * 按类型过滤候选 ID。
   * 缓存命中条目用其 typeKey；未命中条目需读 jsonl 拿 type，单次批量读完成。
   */
  private async filterByType(ids: number[], typeFilter: number): Promise<number[]> {
    const targetKey = SUBJECT_TYPE_MAP[typeFilter];
    if (!targetKey) return ids;

    const kept: number[] = [];
    const needCheck: number[] = [];
    for (const id of ids) {
      const cached = this.cache.get(id);
      if (cached) {
        if (cached.typeKey === targetKey) kept.push(id);
      } else {
        needCheck.push(id);
      }
    }

    if (needCheck.length > 0) {
      const rows = await this.readArchiveRows(needCheck);
      for (const raw of rows) {
        if (raw && SUBJECT_TYPE_MAP[raw.type] === targetKey) kept.push(raw.id);
      }
    }

    return kept;
  }

  /**
   * 按 ID 列表批量读 jsonl。索引未就绪 / 路径不可用时返回空数组（视为离线包失效，
   * 让外层走在线兜底，而不是 throw 打断搜索 UI）。
   */
  private async readArchiveRows(ids: number[]): Promise<Array<RawArchiveSubject | null>> {
    if (!this.index.isReady()) return [];
    const jsonlPath = this.getJsonlPath();
    if (!jsonlPath) return [];

    const lineNums: number[] = [];
    for (const id of ids) {
      const ln = this.index.getLine(id);
      if (ln !== undefined) lineNums.push(ln);
    }
    if (lineNums.length === 0) return [];

    return this.jsonl.readLines(jsonlPath, lineNums);
  }

  // ─────────────────────────────────────────────
  // 内部：第②级 archive 命中
  // ─────────────────────────────────────────────

  /**
   * 尝试从离线包取条目。索引未就绪 / 路径无效 / 行号未命中 / 行损坏 / id 不一致
   * 均视为未命中，返回 null（继续走第③级）。
   */
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
  // 内部：异步补全编排
  // ─────────────────────────────────────────────

  /**
   * fire-and-forget 触发补全任务，完成后视情况反哺缓存。
   * - `data` 被直接 mutate（RelationFetcher 与本方法都按引用写）
   * - 同一 ID 同时只跑一个补全任务，避免短时间多次 getSubject 叠加请求
   *
   * @param data       要补全的条目（mutate 进行中）
   * @param alsoScrape 是否同时跑 BgmScraper（仅 archive 来源建议为 true）
   */
  private scheduleEnrich(data: SubjectData, alsoScrape: boolean): void {
    if (this.enriching.has(data.id)) return;
    this.enriching.add(data.id);

    void (async () => {
      let touched = false;
      try {
        if (this.relations.needsEnrich(data)) {
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
        // 兜底：补全失败绝不抛到顶层 Promise，避免污染未处理 rejection
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
    id: data.id,
    name: data.name,
    nameOriginal: data.nameOriginal,
    typeKey: data.typeKey,
    year: (data.date ?? '').slice(0, 4),
    score: data.score,
    coverUrl: data.coverUrl,
    source: data.source,
  };
}

function toSearchItemFromRaw(raw: RawArchiveSubject): SearchResultItem {
  const typeKey = SUBJECT_TYPE_MAP[raw.type] ?? 'anime';
  const name = raw.name_cn?.trim() || raw.name;
  return {
    id: raw.id,
    name,
    nameOriginal: raw.name,
    typeKey,
    year: (raw.date ?? '').slice(0, 4),
    score: 0,
    coverUrl: '',
    source: 'archive',
  };
}

/**
 * 把 extra 中 key 不在原 infobox 的条目就地 push 到原数组。
 * 已有 key 不覆盖（信任原数据，scraper 只做"补缺"角色）。
 * 返回是否真有更新。
 */
function mergeMissingInfobox(existing: InfoboxEntry[], extra: InfoboxEntry[]): boolean {
  const known = new Set(existing.map(e => e.key));
  let touched = false;
  for (const entry of extra) {
    if (!known.has(entry.key)) {
      existing.push(entry);
      known.add(entry.key);
      touched = true;
    }
  }
  return touched;
}
import type {
  BangumiSettings,
  EpisodeData,
  InfoboxEntry,
  PersonCredit,
  RawArchiveSubject,
  SearchQuery,
  SearchResponse,
  SearchResultItem,
  SubjectData,
} from '../types';
import { DEFAULT_PAGE_SIZE, SUBJECT_TYPE_MAP } from '../constants';
import type { CacheManager }          from './CacheManager';
import type { IndexBuilder }          from './IndexBuilder';
import type { JsonlReader }           from './JsonlReader';
import type { SearchIndexBuilder }    from './SearchIndexBuilder';
import type { OnlineFetcher }         from './OnlineFetcher';
import type { BgmScraper }            from './BgmScraper';
import type { RelationFetcher }       from './RelationFetcher';
import type { RelationIndexBuilder }  from './RelationIndexBuilder';
import type { EpisodeIndexBuilder }   from './EpisodeindexBuilder';
import type { PersonIndexBuilder }    from './PersonindexBuilder';
import { DataAdapter }                from './DataAdapter';
import type { ArchiveLocator }        from '../vault/ArchiveLocator'; // 用于解析绝对路径s

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
  cache:         CacheManager;
  index:         IndexBuilder;
  searchIndex:   SearchIndexBuilder;
  jsonl:         JsonlReader;
  fetcher:       OnlineFetcher;
  scraper:       BgmScraper;
  relations:     RelationFetcher;
  /** Priority 3: 离线关联索引（可选；未配置时降级到 RelationFetcher） */
  relationIndex?: RelationIndexBuilder;
  /** Priority 4: 离线分集索引（可选） */
  episodeIndex?:  EpisodeIndexBuilder;
  /** Priority 5: 离线制作人员索引（可选） */
  personIndex?:   PersonIndexBuilder;
  /**
   * 已解析为绝对路径的 `bangumi.jsonl` 位置，由 main.ts 通过 ArchiveLocator
   * 注入。未配置 / 文件不可用时返回 null —— DataManager 据此跳过第②级。
   */
  getJsonlPath: () => string | null;
  /** 实时获取最新 settings（offlineMode 等运行时可变项）。 */
  getSettings: () => BangumiSettings;
  archiveLocator: ArchiveLocator;
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
 * Priority 3 新增：
 * - archive 命中时若 `RelationIndexBuilder` 就绪，直接从本地索引填充 relations，
 *   `relationsLoaded` 置 true，不再触发 RelationFetcher
 *
 * 红线（违反就是 bug）：
 * - `getSubject` 全部未命中才 throw（`SubjectNotFoundError`），绝不静默返回 null
 * - 不持有任何 Obsidian Vault / Note 概念，纯数据层
 * - 不直接读 settings 字段，所有运行时配置走 `getSettings()` getter
 */
export class DataManager {
  private readonly cache:         CacheManager;
  private readonly index:         IndexBuilder;
  private readonly searchIndex:   SearchIndexBuilder;
  private readonly jsonl:         JsonlReader;
  private readonly fetcher:       OnlineFetcher;
  private readonly scraper:       BgmScraper;
  private readonly relations:     RelationFetcher;
  private readonly relationIndex: RelationIndexBuilder | undefined;
  private readonly episodeIndex:  EpisodeIndexBuilder  | undefined;
  private readonly personIndex:   PersonIndexBuilder   | undefined;
  private readonly getJsonlPath:  () => string | null;
  private readonly getSettings:   () => BangumiSettings;
  private readonly archiveLocator: ArchiveLocator;
  

  /** 正在执行补全任务的条目 ID，去重避免短时间重复触发 */
  private readonly enriching = new Set<number>();

  constructor(deps: DataManagerDeps) {
    this.cache         = deps.cache;
    this.index         = deps.index;
    this.searchIndex   = deps.searchIndex;
    this.jsonl         = deps.jsonl;
    this.fetcher       = deps.fetcher;
    this.scraper       = deps.scraper;
    this.relations     = deps.relations;
    this.relationIndex = deps.relationIndex;
    this.episodeIndex  = deps.episodeIndex;
    this.personIndex   = deps.personIndex;
    this.getJsonlPath  = deps.getJsonlPath;
    this.getSettings   = deps.getSettings;
    this.archiveLocator = deps.archiveLocator;
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
   * Priority 3: archive 命中且 RelationIndexBuilder 就绪时，直接填充 relations，
   *             跳过网络补全。
   */
  async getSubject(id: number): Promise<SubjectData> {
    // ① 内存缓存
    const cached = this.cache.get(id);
    if (cached) {
      // 旧缓存可能缺 relations：fire-and-forget 异步补，不阻塞返回
      if (!cached.relationsLoaded) this.scheduleEnrich(cached, false);
      return cached;
    }

    // ② 离线包
    const archiveHit = await this.tryArchive(id);
    if (archiveHit) {
      // Priority 3: 若离线关联索引已就绪，直接填充
      if (this.relationIndex?.isReady()) {
        archiveHit.relations     = this.relationIndex.getRelations(id);
        archiveHit.relationsLoaded = true;
        this.cache.set(id, archiveHit);
        // 仍可选跑 scraper 补 infobox，但无需补 relations
        this.scheduleEnrich(archiveHit, true, /* skipRelations */ true);
      } else {
        // 反哺缓存（一次，让用户至少持有基础数据）
        this.cache.set(id, archiveHit);
        // 异步：补 relations + 网页 infobox，完成后再反哺一次
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

    // ④ 全军覆没
    throw new SubjectNotFoundError(id);
  }

/**
 * 全量构建所有离线索引。
 * 路径约定：旁路文件（episodes / persons 等）与主数据包同目录。
 * 任一旁路文件不存在时，对应索引跳过构建（不抛错）。
 *
 * @param onProgress - (stage, linesScanned) 阶段进度回调
 */
async buildAllOfflineIndices(
  onProgress?: (stage: string, lines: number) => void,
): Promise<void> {
  const settings = this.getSettings();
  const paths    = settings.offlineDbPaths;

  // ── 阶段 1 & 2：主条目（必须）──────────────────────────────
  const subjectPath = await this.archiveLocator.resolveCustom(paths.subject);
  if (!subjectPath) {
    console.warn('[bangumi] 主条目路径未配置或无效，放弃构建');
    return;
  }

  onProgress?.('主条目行号索引', 0);
  await this.index.build(subjectPath, (lines) =>
    onProgress?.('主条目行号索引', lines),
  );

  onProgress?.('关键词搜索索引', 0);
  await this.searchIndex.build(subjectPath, (lines) =>
    onProgress?.('关键词搜索索引', lines),
  );

  // ── 阶段 3：分集（可选）────────────────────────────────────
  if (this.episodeIndex && paths.episodes) {
    const p = await this.archiveLocator.resolveCustom(paths.episodes);
    if (p) {
      onProgress?.('分集信息索引', 0);
      await this.episodeIndex.build(p, (lines) =>
        onProgress?.('分集信息索引', lines),
      );
    } else {
      console.warn('[bangumi] episodes 路径无效，跳过分集索引');
    }
  }

  // ── 阶段 4：制作人员（两个文件配套，缺一不构建）───────────
  if (this.personIndex && paths.persons && paths.subjectPersons) {
    const p1 = await this.archiveLocator.resolveCustom(paths.persons);
    const p2 = await this.archiveLocator.resolveCustom(paths.subjectPersons);
    if (p1 && p2) {
      onProgress?.('制作人员索引', 0);
      await this.personIndex.build(p1, p2, (lines) =>
        onProgress?.('制作人员索引', lines),
      );
    } else {
      console.warn('[bangumi] persons 路径无效，跳过制作人员索引');
    }
  }

  // ── 阶段 5：关联（可选）────────────────────────────────────
  if (this.relationIndex && paths.relations) {
    const p = await this.archiveLocator.resolveCustom(paths.relations);
    if (p) {
      onProgress?.('关联条目索引', 0);
      await this.relationIndex.build(p, (lines) =>
        onProgress?.('关联条目索引', lines),
      );
    } else {
      console.warn('[bangumi] relations 路径无效，跳过关联索引');
    }
  }
}

  // ─────────────────────────────────────────────
  // Priority 4: 分集数据访问
  // ─────────────────────────────────────────────

  /**
   * 获取条目的分集列表（离线索引）。
   * episodeIndex 未就绪或条目无分集数据时返回空数组。
   * 供 NoteBuilder 生成带分集信息的 eps_checkboxes。
   */
  getEpisodes(subjectId: number): EpisodeData[] {
    if (!this.episodeIndex?.isReady()) return [];
    return this.episodeIndex.getEpisodes(subjectId);
  }

  /**
   * 获取正篇（type=0）分集列表。
   */
  getMainEpisodes(subjectId: number): EpisodeData[] {
    if (!this.episodeIndex?.isReady()) return [];
    return this.episodeIndex.getMainEpisodes(subjectId);
  }

  // ─────────────────────────────────────────────
  // Priority 5: 制作人员数据访问
  // ─────────────────────────────────────────────

  /**
   * 获取条目的制作人员列表（离线索引）。
   * personIndex 未就绪时返回空数组。
   */
  getCredits(subjectId: number): PersonCredit[] {
    if (!this.personIndex?.isReady()) return [];
    return this.personIndex.getCredits(subjectId);
  }

  /**
   * 获取按职位分组的制作人员。
   */
  getCreditsByPosition(subjectId: number): Map<string, PersonCredit[]> {
    if (!this.personIndex?.isReady()) return new Map();
    return this.personIndex.getCreditsByPosition(subjectId);
  }

  // ─────────────────────────────────────────────
  // 主流程：关键词搜索
  // ─────────────────────────────────────────────

  /**
   * 关键词搜索：
   * - `offlineMode=true` 且离线索引就绪：优先走 SearchIndexBuilder 离线搜索；
   *   命中数为 0 时**自动回退**到在线 API（避免离线索引太稀疏让用户抓瞎）
   * - 否则：直接调 OnlineFetcher
   *
   * Priority 2: 若 settings.hideNsfw=true，过滤掉 nsfw 条目。
   *
   * 返回的 `fromOffline` 字段供 UI 标记结果来源。
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
  const settings = this.getSettings();
  const limit    = query.limit > 0 ? query.limit : DEFAULT_PAGE_SIZE;

  // ✅ 修复：query.mode 明确指定时优先使用，否则回退到全局设置
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
  // 内部：NSFW 过滤（Priority 2）
  // ─────────────────────────────────────────────

  /**
   * 若 settings.hideNsfw 为 true，过滤搜索结果中的 NSFW 条目。
   * total 随之调整（近似值；精确值需要知道全集合 nsfw 比例）。
   */
  private applyNsfwFilter(resp: SearchResponse, settings: BangumiSettings): SearchResponse {
    if (!settings.hideNsfw) return resp;
    const filtered = resp.list.filter(item => !item.nsfw);
    if (filtered.length === resp.list.length) return resp;
    // total 按过滤比例近似缩减，避免翻页出现空页
    const ratio  = resp.list.length > 0 ? filtered.length / resp.list.length : 1;
    const total  = Math.max(filtered.length, Math.round(resp.total * ratio));
    return { ...resp, list: filtered, total };
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

    const total  = filtered.length;
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
    const missing:   number[] = [];
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

    const kept:      number[] = [];
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
   * 按 ID 列表批量读 jsonl。索引未就绪 / 路径不可用时返回空数组。
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
   *
   * @param data           要补全的条目
   * @param alsoScrape     是否同时跑 BgmScraper（仅 archive 来源建议为 true）
   * @param skipRelations  Priority 3：已由 RelationIndexBuilder 填充时传 true，
   *                       跳过 RelationFetcher 网络调用
   */
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
    // Priority 2: propagate nsfw flag through search results
    nsfw:         data.nsfw ?? false,
    source:       data.source,
  };
}

function toSearchItemFromRaw(raw: RawArchiveSubject): SearchResultItem {
  const typeKey = SUBJECT_TYPE_MAP[raw.type] ?? 'anime';
  const name    = raw.name_cn?.trim() || raw.name;
  return {
    id:           raw.id,
    name,
    nameOriginal: raw.name,
    typeKey,
    year:         (raw.date ?? '').slice(0, 4),
    score:        raw.score ?? 0,
    coverUrl:     '',
    nsfw:         raw.nsfw ?? false,
    source:       'archive',
  };
}

/**
 * 把 extra 中 key 不在原 infobox 的条目就地 push 到原数组。
 * 已有 key 不覆盖（信任原数据，scraper 只做"补缺"角色）。
 * 返回是否真有更新。
 */
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
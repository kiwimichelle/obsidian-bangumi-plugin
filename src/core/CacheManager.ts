import type { App } from 'obsidian';
import { Notice, normalizePath } from 'obsidian';

import type { SubjectData } from '../types';
import { CACHE_FILE_NAME, PLUGIN_DATA_DIR } from '../constants';

/**
 * 增量缓存管理器
 *
 * 职责：
 * - 维护 `user_added.json` 的内存 Map 镜像
 * - 通过 `app.vault.adapter` 跨平台异步读写
 * - `set/delete` 触发去抖写盘，避免高频 IO
 *
 * 数据流：
 * - `set(id, data)` 接收 `archive` / `api` 来源数据，落盘时统一标记 source='cache'
 * - `get(id)` 返回的对象 source 必为 'cache'，DataManager 可据此区分级联层级
 *
 * 仅由 `DataManager` 调用，下游模块不直接持有实例。
 */
export class CacheManager {
  private readonly app: App;
  private readonly filePath: string;
  private readonly dirPath: string;

  private store = new Map<number, SubjectData>();
  private loaded = false;

  /** 去抖写盘计时器；null 表示当前无待写任务 */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 正在进行的写盘 Promise，flush() / unload() 会 await 它 */
  private writing: Promise<void> | null = null;
  private static readonly FLUSH_DELAY_MS = 300;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.dirPath = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.filePath = normalizePath(`${this.dirPath}/${CACHE_FILE_NAME}`);
  }

  /**
   * 从磁盘加载缓存到内存。
   * 文件不存在 → 空 Map；JSON 损坏 → 警告 + 空 Map（保证插件可用）。
   * 幂等：重复调用直接返回。
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.filePath))) {
      this.store = new Map();
      return;
    }

    try {
      const raw = await adapter.read(this.filePath);
      const parsed = JSON.parse(raw) as Record<string, SubjectData>;
      const map = new Map<number, SubjectData>();
      for (const [key, value] of Object.entries(parsed)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !value || typeof value !== 'object') continue;
        map.set(id, { ...value, source: 'cache' });
      }
      this.store = map;
    } catch (err) {
      console.warn('[bangumi] user_added.json 解析失败，将使用空缓存', err);
      new Notice('Bangumi 缓存文件损坏，已重置为空');
      this.store = new Map();
    }
  }

  /** 根据 ID 获取缓存条目，无命中返回 undefined。 */
  get(id: number): SubjectData | undefined {
    return this.store.get(id);
  }

  /** 仅判断 ID 是否在缓存中，不构造结果对象。 */
  has(id: number): boolean {
    return this.store.has(id);
  }

  /**
   * 写入或更新一条缓存。
   * 强制覆盖 `source = 'cache'`，调度去抖写盘。
   */
  set(id: number, data: SubjectData): void {
    this.store.set(id, { ...data, source: 'cache' });
    this.scheduleFlush();
  }

  /** 删除一条缓存，返回是否真的删了；命中则调度写盘。 */
  delete(id: number): boolean {
    const ok = this.store.delete(id);
    if (ok) this.scheduleFlush();
    return ok;
  }

  /** 缓存条目数。 */
  size(): number {
    return this.store.size;
  }

  /** 遍历所有缓存条目，供离线搜索回填使用。 */
  entries(): IterableIterator<[number, SubjectData]> {
    return this.store.entries();
  }

  /**
   * 立即写盘（取消尚未触发的去抖计时），并等待写入完成。
   * 主流程退出（plugin.onunload）前必须 await 此方法。
   */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.writeToDisk();
  }

  // ──────────────────────────────────────────────────
  // 内部：去抖与写盘
  // ──────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.writeToDisk();
    }, CacheManager.FLUSH_DELAY_MS);
  }

  /**
   * 将当前内存 Map 序列化并整体覆盖写入磁盘。
   * 通过 `writing` 串行化并发调用，避免后写覆盖前写时的交错。
   */
  private async writeToDisk(): Promise<void> {
    if (this.writing) {
      await this.writing;
    }
    this.writing = this.doWrite().finally(() => {
      this.writing = null;
    });
    await this.writing;
  }

  private async doWrite(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const snapshot: Record<string, SubjectData> = {};
    for (const [id, data] of this.store) {
      snapshot[String(id)] = data;
    }
    const payload = JSON.stringify(snapshot, null, 2);

    try {
      if (!(await adapter.exists(this.dirPath))) {
        await adapter.mkdir(this.dirPath);
      }
      await adapter.write(this.filePath, payload);
    } catch (err) {
      console.error('[bangumi] 写入 user_added.json 失败', err);
      new Notice('Bangumi 缓存写入失败，详情见控制台');
    }
  }
}

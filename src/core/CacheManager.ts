import type { App } from 'obsidian';
import { Notice, normalizePath } from 'obsidian';

import type { SubjectData } from '../types';
import { CACHE_FILE_NAME, PLUGIN_DATA_DIR } from '../constants';

/**
 * 增量缓存管理器
 *
 * 修复：writeToDisk 的串行化改用互斥锁模式（写盘队列），
 * 避免原实现中 Promise 链越来越长导致的内存泄漏和判断失效问题。
 */
export class CacheManager {
  private readonly app:      App;
  private readonly filePath: string;
  private readonly dirPath:  string;

  private store  = new Map<number, SubjectData>();
  private loaded = false;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** 当前是否有写盘任务正在执行 */
  private isWriting = false;
  /** 写盘任务排队标志：true 表示有新数据等待下一次写盘 */
  private pendingWrite = false;

  private static readonly FLUSH_DELAY_MS = 300;

  constructor(app: App, pluginDir: string) {
    this.app      = app;
    this.dirPath  = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.filePath = normalizePath(`${this.dirPath}/${CACHE_FILE_NAME}`);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.filePath))) {
      this.store = new Map();
      return;
    }

    try {
      const raw    = await adapter.read(this.filePath);
      const parsed = JSON.parse(raw) as Record<string, SubjectData>;
      const map    = new Map<number, SubjectData>();
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

  get(id: number): SubjectData | undefined {
    return this.store.get(id);
  }

  has(id: number): boolean {
    return this.store.has(id);
  }

  set(id: number, data: SubjectData): void {
    this.store.set(id, { ...data, source: 'cache' });
    this.scheduleFlush();
  }

  delete(id: number): boolean {
    const ok = this.store.delete(id);
    if (ok) this.scheduleFlush();
    return ok;
  }

  size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[number, SubjectData]> {
    return this.store.entries();
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // 等待当前写盘完成后再执行一次，确保最新数据落盘
    if (this.isWriting) {
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          if (!this.isWriting) { clearInterval(check); resolve(); }
        }, 50);
      });
    }
    await this.doWrite();
  }

  // ──────────────────────────────────────────────────
  // 内部：去抖与写盘（互斥锁模式）
  // ──────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.writeToDisk();
    }, CacheManager.FLUSH_DELAY_MS);
  }

  /**
   * 修复：用互斥锁模式替代 Promise 链。
   * - isWriting=true 时，设 pendingWrite=true 后直接返回，当前写完后自动触发下一次
   * - 不存在无限增长的 Promise 链
   */
  private async writeToDisk(): Promise<void> {
    if (this.isWriting) {
      this.pendingWrite = true;
      return;
    }

    this.isWriting    = true;
    this.pendingWrite = false;

    try {
      await this.doWrite();
    } finally {
      this.isWriting = false;
      // 如果写盘期间又有新数据，立即再写一次
      if (this.pendingWrite) {
        this.pendingWrite = false;
        void this.writeToDisk();
      }
    }
  }

  private async doWrite(): Promise<void> {
    const adapter  = this.app.vault.adapter;
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
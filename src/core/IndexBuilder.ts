import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as readline from 'readline';

import type { IndexMeta } from '../types';
import {
  INDEX_BATCH_SIZE,
  INDEX_FILE_NAME,
  INDEX_META_FILE_NAME,
  PLUGIN_DATA_DIR,
} from '../constants';

/** 进度回调：每个批次结束时回调一次，参数为已扫描行数。 */
export type IndexProgressCallback = (linesScanned: number) => void;

/**
 * 行号索引构建器
 *
 * 职责：
 * - 扫描 `bangumi.jsonl`（数百 MB）建立 `{ id → 行号 }` 内存索引
 * - 持久化到 `bangumi-index.json`，配套 `bangumi-index.meta.json` 元数据
 * - 提供 `getLine(id)` 给 `JsonlReader` 做精确定位
 *
 * 性能约束：
 * - 用 Node `fs.createReadStream` + `readline` 流式扫描，禁止整文件 `JSON.parse`
 * - 每 `INDEX_BATCH_SIZE` 行 `rl.pause()` → `setImmediate` → `rl.resume()` 让出主线程
 * - 索引/元数据走 `vault.adapter`（库内、跨平台）；jsonl 走 Node `fs`（库外大文件）
 *
 * 仅由 `DataManager` 持有；调用方负责在调用 `build()` 前已用 `ArchiveLocator`
 * 把 `settings.offlineDbPath` 解析为绝对路径。
 */
export class IndexBuilder {
  private readonly app: App;
  private readonly dirPath: string;
  private readonly indexPath: string;
  private readonly metaPath: string;

  private index = new Map<number, number>();
  private ready = false;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.dirPath = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.indexPath = normalizePath(`${this.dirPath}/${INDEX_FILE_NAME}`);
    this.metaPath = normalizePath(`${this.dirPath}/${INDEX_META_FILE_NAME}`);
  }

  // ──────────────────────────────────────────────────
  // 查询
  // ──────────────────────────────────────────────────

  /** 索引是否就绪（已 `load()` 成功或 `build()` 完成）。 */
  isReady(): boolean {
    return this.ready;
  }

  /** 索引条目数。 */
  size(): number {
    return this.index.size;
  }

  /**
   * 查询条目的 0-indexed 行号。
   * 未命中返回 `undefined`，由 `DataManager` 走级联下一档（OnlineFetcher）。
   */
  getLine(id: number): number | undefined {
    return this.index.get(id);
  }

  // ──────────────────────────────────────────────────
  // 加载 / 失效检测
  // ──────────────────────────────────────────────────

  /**
   * 从磁盘加载索引到内存。
   * - 文件缺失 → 返回 false（首次启动或未构建）
   * - JSON 损坏 → 返回 false（外层应回退到 `build()`）
   * 成功后 `isReady()` 为 true。
   */
  async load(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.indexPath))) return false;

    try {
      const raw = await adapter.read(this.indexPath);
      const parsed = JSON.parse(raw) as Record<string, number>;
      const map = new Map<number, number>();
      for (const [key, line] of Object.entries(parsed)) {
        const id = Number(key);
        if (!Number.isFinite(id) || typeof line !== 'number') continue;
        map.set(id, line);
      }
      this.index = map;
      this.ready = true;
      return true;
    } catch (err) {
      console.warn('[bangumi] bangumi-index.json 加载失败，需要重建', err);
      return false;
    }
  }

  /**
   * 判断已持久化的索引是否对当前 jsonl 失效。
   * 检测维度：元数据缺失 / jsonl 路径变更 / jsonl 字节大小变化。
   * 任一不匹配返回 true（需要重建）。
   */
  async isStale(jsonlPath: string): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.metaPath))) return true;

    try {
      const raw = await adapter.read(this.metaPath);
      const meta = JSON.parse(raw) as IndexMeta;
      if (meta.jsonlPath !== jsonlPath) return true;
      const stat = await fs.promises.stat(jsonlPath);
      return stat.size !== meta.jsonlSize;
    } catch {
      return true;
    }
  }

  // ──────────────────────────────────────────────────
  // 构建
  // ──────────────────────────────────────────────────

  /**
   * 流式扫描 `jsonlPath`，建立 `{ id → 0-indexed 行号 }`，并持久化。
   *
   * - 行号涵盖所有物理行（含空行），与 `JsonlReader` 按行 seek 的语义对齐
   * - 单行 `JSON.parse` 失败不中断整体构建（容错损坏行）
   * - 每 `INDEX_BATCH_SIZE` 行 `pause` 流并 `setImmediate` 让出主线程
   * - 仅在 `persist()` 成功后才更新内存状态，失败不污染既有索引
   */
  async build(jsonlPath: string, onProgress?: IndexProgressCallback): Promise<void> {
    const map = new Map<number, number>();
    let lineNum = 0;
    let batchCount = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        const currentLine = lineNum++;
        batchCount++;

        const trimmed = line.trim();
        if (trimmed) {
          try {
            const obj = JSON.parse(trimmed) as { id?: unknown };
            if (typeof obj.id === 'number' && Number.isFinite(obj.id)) {
              map.set(obj.id, currentLine);
            }
          } catch {
            /* 损坏行：跳过 */
          }
        }

        if (batchCount >= INDEX_BATCH_SIZE) {
          batchCount = 0;
          rl.pause();
          setImmediate(() => {
            onProgress?.(lineNum);
            rl.resume();
          });
        }
      });

      rl.on('close', resolve);
      rl.on('error', reject);
      stream.on('error', reject);
    });

    const jsonlSize = (await fs.promises.stat(jsonlPath)).size;
    await this.persist(map, jsonlPath, lineNum, jsonlSize);

    this.index = map;
    this.ready = true;
    onProgress?.(lineNum);
  }

  // ──────────────────────────────────────────────────
  // 内部：持久化
  // ──────────────────────────────────────────────────

  private async persist(
    map: Map<number, number>,
    jsonlPath: string,
    totalLines: number,
    jsonlSize: number,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.dirPath))) {
      await adapter.mkdir(this.dirPath);
    }

    const snapshot: Record<string, number> = {};
    for (const [id, line] of map) {
      snapshot[String(id)] = line;
    }
    // 索引体积可达数 MB，不做缩进以节省空间
    await adapter.write(this.indexPath, JSON.stringify(snapshot));

    const meta: IndexMeta = {
      builtAt: Date.now(),
      totalLines,
      jsonlPath,
      jsonlSize,
    };
    await adapter.write(this.metaPath, JSON.stringify(meta, null, 2));
  }
}

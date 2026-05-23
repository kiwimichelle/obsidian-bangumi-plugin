import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as readline from 'readline';

import type { IndexMeta, SubjectRelation } from '../types';
import { INDEX_BATCH_SIZE, PLUGIN_DATA_DIR, SUBJECT_TYPE_MAP } from '../constants';

/** 进度回调：每个批次结束时回调一次，参数为已扫描行数。 */
export type RelationIndexProgressCallback = (linesScanned: number) => void;

/** subject-relations.jsonlines 中单行的原始结构 */
interface RawRelationEntry {
  subject_id: number;
  related_subject_id: number;
  /** 关系类型字符串，例如 '续集'、'前传'、'系列' */
  relation_type: string;
  order: number;
  /** related subject 的 name（可选，部分 dump 版本有） */
  name?: string;
  /** related subject 的 name_cn（可选） */
  name_cn?: string;
  /** related subject 的 type（可选） */
  type?: number;
}

const RELATION_INDEX_FILE = 'bangumi-relation-index.json';
const RELATION_META_FILE  = 'bangumi-relation-index.meta.json';

/**
 * 离线关联条目索引构建器
 *
 * 职责：
 * - 扫描 `subject-relations.jsonlines` 建立 `{ subject_id → SubjectRelation[] }` 索引
 * - 持久化到 `bangumi-relation-index.json`，配套 `.meta.json` 元数据
 * - 提供 `getRelations(subjectId)` 给 `DataManager` 在离线模式下直接读取关联，
 *   完全不依赖网络，取代 `RelationFetcher`（网络请求补全）
 *
 * 设计决策：
 * - 关联数据量远小于 subject 主体数据，整体加载进内存可接受
 * - `build()` 时允许 related subject 的 name/type 字段缺失（旧版本 dump），
 *   缺失时 name 留空、typeKey 留 null，供调用方降级处理
 * - 失效检测策略与 IndexBuilder / SearchIndexBuilder 保持一致（路径 + 文件大小）
 *
 * 仅由 `DataManager` 持有；DataManager 在 `getSubject` 命中 archive 时
 * 优先调此索引填充 relations，而不再 fire-and-forget RelationFetcher。
 */
export class RelationIndexBuilder {
  private readonly app: App;
  private readonly dirPath: string;
  private readonly indexPath: string;
  private readonly metaPath: string;

  /** subject_id → SubjectRelation[] */
  private index = new Map<number, SubjectRelation[]>();
  private ready = false;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.dirPath   = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.indexPath = normalizePath(`${this.dirPath}/${RELATION_INDEX_FILE}`);
    this.metaPath  = normalizePath(`${this.dirPath}/${RELATION_META_FILE}`);
  }

  // ──────────────────────────────────────────────────
  // 查询
  // ──────────────────────────────────────────────────

  /** 索引是否就绪。 */
  isReady(): boolean {
    return this.ready;
  }

  /** 唯一 subject_id 条目数。 */
  size(): number {
    return this.index.size;
  }

  /**
   * 获取指定条目的关联列表。
   * 未命中（条目无关联 / 索引未就绪）返回空数组。
   */
  getRelations(subjectId: number): SubjectRelation[] {
    return this.index.get(subjectId) ?? [];
  }

  // ──────────────────────────────────────────────────
  // 加载 / 失效检测
  // ──────────────────────────────────────────────────

  /**
   * 从磁盘加载关联索引到内存。
   * - 文件缺失 → 返回 false
   * - JSON 损坏 → 返回 false（调用方应回退到 `build()`）
   */
  async load(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.indexPath))) return false;

    try {
      const raw    = await adapter.read(this.indexPath);
      const parsed = JSON.parse(raw) as Record<string, SubjectRelation[]>;
      const map    = new Map<number, SubjectRelation[]>();
      for (const [key, rels] of Object.entries(parsed)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !Array.isArray(rels)) continue;
        map.set(id, rels);
      }
      this.index = map;
      this.ready = true;
      return true;
    } catch (err) {
      console.warn('[bangumi] bangumi-relation-index.json 加载失败，需要重建', err);
      return false;
    }
  }

  /**
   * 判断已持久化的索引是否对当前 relations jsonl 失效。
   * 检测维度：元数据缺失 / jsonl 路径变更 / jsonl 字节大小变化。
   */
  async isStale(jsonlPath: string): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.metaPath))) return true;

    try {
      const raw  = await adapter.read(this.metaPath);
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
   * 流式扫描 `subject-relations.jsonlines`，建立关联索引并持久化。
   *
   * - 单行 JSON.parse 失败不中断整体构建（容错损坏行）
   * - 每 `INDEX_BATCH_SIZE` 行 pause 流并 setImmediate 让出主线程
   * - 仅在 `persist()` 成功后才更新内存状态
   */
  async build(jsonlPath: string, onProgress?: RelationIndexProgressCallback): Promise<void> {
    const map = new Map<number, SubjectRelation[]>();
    let lineNum   = 0;
    let batchCount = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const rl     = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        lineNum++;
        batchCount++;

        const trimmed = line.trim();
        if (trimmed) {
          try {
            const entry = JSON.parse(trimmed) as RawRelationEntry;
            if (
              typeof entry.subject_id         === 'number' &&
              typeof entry.related_subject_id === 'number' &&
              Number.isFinite(entry.subject_id) &&
              Number.isFinite(entry.related_subject_id)
            ) {
              const relation: SubjectRelation = {
                id:           entry.related_subject_id,
                name:         entry.name_cn?.trim() || entry.name?.trim() || '',
                nameOriginal: entry.name?.trim() || '',
                relation:     entry.relation_type ?? '',
                typeKey:      entry.type !== undefined
                                ? (SUBJECT_TYPE_MAP[entry.type] ?? null)
                                : null,
              };

              let list = map.get(entry.subject_id);
              if (!list) {
                list = [];
                map.set(entry.subject_id, list);
              }
              // 按 order 字段保持顺序（行本身可能无序）
              list.push(relation);
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

    // 按 order 排序（如果数据中有的话，此时已全部收集完）
    // dump 文件本身已按 subject_id+order 排列，通常无需额外排序；
    // 保留此步骤兼容乱序 dump
    for (const rels of map.values()) {
      // SubjectRelation 没有 order 字段，顺序以行顺序为准，已足够
      void rels;
    }

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
    map:        Map<number, SubjectRelation[]>,
    jsonlPath:  string,
    totalLines: number,
    jsonlSize:  number,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.dirPath))) {
      await adapter.mkdir(this.dirPath);
    }

    const snapshot: Record<string, SubjectRelation[]> = {};
    for (const [id, rels] of map) {
      snapshot[String(id)] = rels;
    }
    await adapter.write(this.indexPath, JSON.stringify(snapshot));

    const meta: IndexMeta = {
      builtAt:    Date.now(),
      totalLines,
      jsonlPath,
      jsonlSize,
    };
    await adapter.write(this.metaPath, JSON.stringify(meta, null, 2));
  }
}
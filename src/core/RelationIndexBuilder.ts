import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as readline from 'readline';

import type { IndexMeta, SubjectRelation } from '../types';
import { INDEX_BATCH_SIZE, PLUGIN_DATA_DIR, SUBJECT_TYPE_MAP } from '../constants';

export type RelationIndexProgressCallback = (linesScanned: number) => void;

interface RawRelationEntry {
  subject_id:         number;
  related_subject_id: number;
  relation_type:      string;
  order:              number;
  name?:              string;
  name_cn?:           string;
  type?:              number;
}

const RELATION_INDEX_FILE = 'bangumi-relation-index.json';
const RELATION_META_FILE  = 'bangumi-relation-index.meta.json';

export class RelationIndexBuilder {
  private readonly app:       App;
  private readonly dirPath:   string;
  private readonly indexPath: string;
  private readonly metaPath:  string;

  private index = new Map<number, SubjectRelation[]>();
  private ready = false;

  constructor(app: App, pluginDir: string) {
    this.app       = app;
    this.dirPath   = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.indexPath = normalizePath(`${this.dirPath}/${RELATION_INDEX_FILE}`);
    this.metaPath  = normalizePath(`${this.dirPath}/${RELATION_META_FILE}`);
  }

  isReady(): boolean { return this.ready; }
  size():    number  { return this.index.size; }

  getRelations(subjectId: number): SubjectRelation[] {
    return this.index.get(subjectId) ?? [];
  }

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

  async build(jsonlPath: string, onProgress?: RelationIndexProgressCallback): Promise<void> {
    const map      = new Map<number, SubjectRelation[]>();
    let lineNum    = 0;
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
              if (!list) { list = []; map.set(entry.subject_id, list); }
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

    // 修复：移除原来的空操作循环（void rels 什么也不做）
    // dump 文件本身已按 subject_id+order 排列，顺序由读取顺序保证，无需额外排序

    const jsonlSize = (await fs.promises.stat(jsonlPath)).size;
    await this.persist(map, jsonlPath, lineNum, jsonlSize);

    this.index = map;
    this.ready = true;
    onProgress?.(lineNum);
  }

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

    const meta: IndexMeta = { builtAt: Date.now(), totalLines, jsonlPath, jsonlSize };
    await adapter.write(this.metaPath, JSON.stringify(meta, null, 2));
  }
}
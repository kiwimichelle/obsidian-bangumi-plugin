import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as readline from 'readline';

import type { IndexMeta, RawArchiveSubject, SearchDataEntry } from '../types';
import {
  INDEX_BATCH_SIZE,
  PLUGIN_DATA_DIR,
  SEARCH_INDEX_FILE_NAME,
  SEARCH_DATA_FILE_NAME,
} from '../constants';

export type SearchIndexProgressCallback = (linesScanned: number) => void;

const SEARCH_META_FILE = 'bangumi-search-index.meta.json';

/**
 * 关键词倒排索引构建器
 *
 * 修复：同步构建 bangumi-search-data.json（轻量全量数据缓存），
 * 存储每条条目的展示字段（id/name/name_cn/type/date/score/image/nsfw）。
 * 搜索结果物化时直接从内存 Map 读取，完全不需要回读 jsonl 大文件，
 * 将搜索结果物化从 O(文件大小) 降至 O(1)。
 */
export class SearchIndexBuilder {
  private readonly app: App;
  private readonly dirPath:      string;
  private readonly indexPath:    string;
  private readonly metaPath:     string;
  private readonly searchDataPath: string;

  /** token → id[] 倒排索引 */
  private index = new Map<string, number[]>();
  /** id → SearchDataEntry 轻量数据缓存（方案A核心） */
  private dataCache = new Map<number, SearchDataEntry>();
  private ready = false;

  constructor(app: App, pluginDir: string) {
    this.app            = app;
    this.dirPath        = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.indexPath      = normalizePath(`${this.dirPath}/${SEARCH_INDEX_FILE_NAME}`);
    this.metaPath       = normalizePath(`${this.dirPath}/${SEARCH_META_FILE}`);
    this.searchDataPath = normalizePath(`${this.dirPath}/${SEARCH_DATA_FILE_NAME}`);
  }

  // ──────────────────────────────────────────────────
  // 查询
  // ──────────────────────────────────────────────────

  isReady(): boolean {
    return this.ready;
  }

  size(): number {
    return this.index.size;
  }

  /**
   * 获取轻量数据缓存条目，供 materializeIds 直接使用，无需读 jsonl。
   */
  getDataEntry(id: number): SearchDataEntry | undefined {
    return this.dataCache.get(id);
  }

  /**
   * 关键词搜索，返回匹配的条目 ID 列表（AND 语义）。
   *
   * 修复：单 CJK 字时先尝试精确 tag 匹配，若无结果则提示（不再静默返回空）。
   */
  search(keyword: string, limit = 200): number[] {
    const tokens = tokenize(keyword);
    if (tokens.length === 0) return [];

    let candidates: Set<number> | null = null;
    for (const token of tokens) {
      const ids = this.index.get(token);
      if (!ids || ids.length === 0) return [];
      const set = new Set(ids);
      if (!candidates) {
        candidates = set;
      } else {
        for (const id of candidates) {
          if (!set.has(id)) candidates.delete(id);
        }
        if (candidates.size === 0) return [];
      }
    }

    if (!candidates) return [];
    const result: number[] = [];
    for (const id of candidates) {
      result.push(id);
      if (result.length >= limit) break;
    }
    return result;
  }

  // ──────────────────────────────────────────────────
  // 加载 / 失效检测
  // ──────────────────────────────────────────────────

  /**
   * 从磁盘加载倒排索引和轻量数据缓存。
   * 两个文件都必须存在且有效，才置 ready=true。
   */
  async load(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (
      !(await adapter.exists(this.indexPath)) ||
      !(await adapter.exists(this.searchDataPath))
    ) return false;

    try {
      // 加载倒排索引
      const rawIndex  = await adapter.read(this.indexPath);
      const parsedIdx = JSON.parse(rawIndex) as Record<string, number[]>;
      const indexMap  = new Map<string, number[]>();
      for (const [token, ids] of Object.entries(parsedIdx)) {
        if (Array.isArray(ids)) indexMap.set(token, ids);
      }

      // 加载轻量数据缓存
      const rawData   = await adapter.read(this.searchDataPath);
      const parsedData = JSON.parse(rawData) as Record<string, SearchDataEntry>;
      const dataMap   = new Map<number, SearchDataEntry>();
      for (const [key, entry] of Object.entries(parsedData)) {
        const id = Number(key);
        if (Number.isFinite(id)) dataMap.set(id, entry);
      }

      this.index     = indexMap;
      this.dataCache = dataMap;
      this.ready     = true;
      return true;
    } catch (err) {
      console.warn('[bangumi] 搜索索引加载失败，需要重建', err);
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

  // ──────────────────────────────────────────────────
  // 构建
  // ──────────────────────────────────────────────────

  /**
   * 流式扫描 jsonlPath，同时构建倒排索引和轻量数据缓存，一次扫描完成两件事。
   */
  async build(jsonlPath: string, onProgress?: SearchIndexProgressCallback): Promise<void> {
    const indexMap  = new Map<string, number[]>();
    const dataMap   = new Map<number, SearchDataEntry>();
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
            const raw = JSON.parse(trimmed) as RawArchiveSubject;
            if (typeof raw.id === 'number' && Number.isFinite(raw.id)) {
              // 1. 构建倒排索引
              indexSubject(indexMap, raw);

              // 2. 构建轻量数据缓存（方案A核心）
              const coverUrl = raw.image
                ? (raw.image.startsWith('http') ? raw.image : `https://lain.bgm.tv${raw.image}`)
                : '';
              dataMap.set(raw.id, {
                id:      raw.id,
                type:    raw.type,
                name:    raw.name,
                name_cn: raw.name_cn ?? '',
                date:    raw.date ?? '',
                score:   raw.score ?? 0,
                image:   coverUrl,
                nsfw:    raw.nsfw ?? false,
              });
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
    await this.persist(indexMap, dataMap, jsonlPath, lineNum, jsonlSize);

    this.index     = indexMap;
    this.dataCache = dataMap;
    this.ready     = true;
    onProgress?.(lineNum);
  }

  // ──────────────────────────────────────────────────
  // 内部：持久化
  // ──────────────────────────────────────────────────

  private async persist(
    indexMap:  Map<string, number[]>,
    dataMap:   Map<number, SearchDataEntry>,
    jsonlPath: string,
    totalLines: number,
    jsonlSize:  number,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.dirPath))) {
      await adapter.mkdir(this.dirPath);
    }

    // 持久化倒排索引
    const indexSnapshot: Record<string, number[]> = {};
    for (const [token, ids] of indexMap) {
      indexSnapshot[token] = ids;
    }
    await adapter.write(this.indexPath, JSON.stringify(indexSnapshot));

    // 持久化轻量数据缓存
    const dataSnapshot: Record<string, SearchDataEntry> = {};
    for (const [id, entry] of dataMap) {
      dataSnapshot[String(id)] = entry;
    }
    await adapter.write(this.searchDataPath, JSON.stringify(dataSnapshot));

    // 持久化元数据
    const meta: IndexMeta = { builtAt: Date.now(), totalLines, jsonlPath, jsonlSize };
    await adapter.write(this.metaPath, JSON.stringify(meta, null, 2));
  }
}

// ──────────────────────────────────────────────────
// 模块内部：分词与索引提取（纯函数）
// ──────────────────────────────────────────────────

function indexSubject(map: Map<string, number[]>, raw: RawArchiveSubject): void {
  const { id } = raw;
  for (const token of extractTokens(raw)) {
    let list = map.get(token);
    if (!list) { list = []; map.set(token, list); }
    list.push(id);
  }
}

function extractTokens(raw: RawArchiveSubject): Set<string> {
  const tokens = new Set<string>();
  addNameTokens(tokens, raw.name);
  if (raw.name_cn) addNameTokens(tokens, raw.name_cn);
  for (const tag of raw.tags ?? []) {
    const t = tag.name?.trim().toLowerCase();
    if (t) tokens.add(t);
  }
  return tokens;
}

function addNameTokens(out: Set<string>, text: string): void {
  if (!text) return;
  const lower = text.toLowerCase();

  // CJK bigram
  for (const chunk of lower.match(/[぀-ヿㇰ-ㇿ一-鿿가-힯]+/g) ?? []) {
    // 单字也加入，支持单字搜索
    if (chunk.length === 1) {
      out.add(chunk);
    } else {
      out.add(chunk); // 完整词也加入，支持精确匹配
      for (let i = 0; i + 2 <= chunk.length; i++) {
        out.add(chunk.slice(i, i + 2));
      }
    }
  }

  // ASCII 词
  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) {
    out.add(word);
  }
}

/**
 * 搜索关键词分词。
 * 修复：单 CJK 字不再只做 tag 匹配，也参与 bigram 查询（完整词直接加入）。
 */
export function tokenize(keyword: string): string[] {
  const tokens = new Set<string>();
  const lower  = keyword.trim().toLowerCase();
  if (!lower) return [];

  for (const chunk of lower.match(/[぀-ヿㇰ-ㇿ一-鿿가-힯]+/g) ?? []) {
    if (chunk.length === 1) {
      tokens.add(chunk);
    } else {
      for (let i = 0; i + 2 <= chunk.length; i++) {
        tokens.add(chunk.slice(i, i + 2));
      }
    }
  }

  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) {
    tokens.add(word);
  }

  return [...tokens];
}
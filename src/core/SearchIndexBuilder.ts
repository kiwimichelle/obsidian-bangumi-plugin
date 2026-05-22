import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as readline from 'readline';

import type { IndexMeta, RawArchiveSubject } from '../types';
import {
  INDEX_BATCH_SIZE,
  PLUGIN_DATA_DIR,
  SEARCH_INDEX_FILE_NAME,
} from '../constants';

/** 进度回调：每个批次结束时回调一次，参数为已扫描行数。 */
export type SearchIndexProgressCallback = (linesScanned: number) => void;

const SEARCH_META_FILE = 'bangumi-search-index.meta.json';

/**
 * 关键词倒排索引构建器
 *
 * 职责：
 * - 扫描 `bangumi.jsonl` 建立 `{ keyword → id[] }` 倒排索引
 * - 持久化到 `bangumi-search-index.json`，配套 `.meta.json` 元数据
 * - 提供 `search(keyword)` 给 `DataManager` 做离线关键词搜索
 *
 * 关键词提取规则：
 * - `name`/`name_cn` 中连续 CJK 片段（汉字/假名/韩文）：提取所有 2 字 bigram
 * - `name`/`name_cn` 中 ASCII 字母序列（≥2 字符）：整词存入
 * - `tags`：每个 tag 名称直接存入（不做 bigram 切分，保留原始语义）
 *
 * 搜索语义：
 * - 查询词分词后取各 token 命中集合的**交集**，即多词 AND 语义
 * - 单 CJK 字（无法构成 bigram）直接匹配 tag 词条
 *
 * 性能约束（同 IndexBuilder）：
 * - 用 Node `fs.createReadStream` + `readline` 流式扫描
 * - 每 `INDEX_BATCH_SIZE` 行 pause → setImmediate → resume 让出主线程
 * - 索引/元数据走 `vault.adapter`（库内、跨平台）；jsonl 走 Node `fs`（库外大文件）
 */
export class SearchIndexBuilder {
  private readonly app: App;
  private readonly dirPath: string;
  private readonly indexPath: string;
  private readonly metaPath: string;

  private index = new Map<string, number[]>();
  private ready = false;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.dirPath = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.indexPath = normalizePath(`${this.dirPath}/${SEARCH_INDEX_FILE_NAME}`);
    this.metaPath = normalizePath(`${this.dirPath}/${SEARCH_META_FILE}`);
  }

  // ──────────────────────────────────────────────────
  // 查询
  // ──────────────────────────────────────────────────

  /** 索引是否就绪（已 `load()` 成功或 `build()` 完成）。 */
  isReady(): boolean {
    return this.ready;
  }

  /** 唯一关键词条目数（不等于条目总数）。 */
  size(): number {
    return this.index.size;
  }

  /**
   * 关键词搜索，返回匹配的条目 ID 列表。
   *
   * - 查询词与索引构建使用相同分词规则（CJK bigram + ASCII 词）
   * - 多 token 时取所有命中 ID 集合的**交集**（AND 语义）
   * - 任一 token 未命中立即返回 []
   * - 结果数不超过 `limit`
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
   * 从磁盘加载倒排索引到内存。
   * - 文件缺失 → 返回 false
   * - JSON 损坏 → 返回 false（调用方应回退到 `build()`）
   * 成功后 `isReady()` 为 true。
   */
  async load(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.indexPath))) return false;

    try {
      const raw = await adapter.read(this.indexPath);
      const parsed = JSON.parse(raw) as Record<string, number[]>;
      const map = new Map<string, number[]>();
      for (const [token, ids] of Object.entries(parsed)) {
        if (Array.isArray(ids)) map.set(token, ids);
      }
      this.index = map;
      this.ready = true;
      return true;
    } catch (err) {
      console.warn('[bangumi] bangumi-search-index.json 加载失败，需要重建', err);
      return false;
    }
  }

  /**
   * 判断已持久化的倒排索引是否对当前 jsonl 失效。
   * 检测维度：元数据缺失 / jsonl 路径变更 / jsonl 字节大小变化。
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
   * 流式扫描 `jsonlPath`，建立倒排索引并持久化。
   *
   * - 单行 JSON.parse 失败不中断整体构建（容错损坏行）
   * - 每 `INDEX_BATCH_SIZE` 行 pause 流并 setImmediate 让出主线程
   * - 仅在 `persist()` 成功后才更新内存状态
   */
  async build(jsonlPath: string, onProgress?: SearchIndexProgressCallback): Promise<void> {
    const map = new Map<string, number[]>();
    let lineNum = 0;
    let batchCount = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        lineNum++;
        batchCount++;

        const trimmed = line.trim();
        if (trimmed) {
          try {
            const raw = JSON.parse(trimmed) as RawArchiveSubject;
            if (typeof raw.id === 'number' && Number.isFinite(raw.id)) {
              indexSubject(map, raw);
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
    map: Map<string, number[]>,
    jsonlPath: string,
    totalLines: number,
    jsonlSize: number,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.dirPath))) {
      await adapter.mkdir(this.dirPath);
    }

    const snapshot: Record<string, number[]> = {};
    for (const [token, ids] of map) {
      snapshot[token] = ids;
    }
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

// ──────────────────────────────────────────────────
// 模块内部：分词与索引提取（纯函数，不暴露）
// ──────────────────────────────────────────────────

/** 将单个条目的关键词写入倒排 map。 */
function indexSubject(map: Map<string, number[]>, raw: RawArchiveSubject): void {
  const { id } = raw;
  for (const token of extractTokens(raw)) {
    let list = map.get(token);
    if (!list) {
      list = [];
      map.set(token, list);
    }
    list.push(id);
  }
}

/** 从条目提取全部去重 token 集合。 */
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

/**
 * 从 name/name_cn 提取 token 并写入 out：
 * - CJK 连续片段 → 所有 2 字 bigram（滑动窗口）
 * - ASCII 序列 → 整词（≥2 字符）
 */
function addNameTokens(out: Set<string>, text: string): void {
  if (!text) return;
  const lower = text.toLowerCase();

  // CJK：汉字（一-鿿）+ 假名（぀-ヿ, ㇰ-ㇿ）+ 韩文（가-힯）
  for (const chunk of lower.match(/[぀-ヿㇰ-ㇿ一-鿿가-힯]+/g) ?? []) {
    for (let i = 0; i + 2 <= chunk.length; i++) {
      out.add(chunk.slice(i, i + 2));
    }
  }

  // ASCII：字母数字序列（≥2 字符）
  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) {
    out.add(word);
  }
}

/**
 * 将搜索关键词分词为与索引对齐的 token 列表：
 * - CJK 片段长度 1：作为 tag 精确匹配直接加入
 * - CJK 片段长度 ≥2：bigram 展开
 * - ASCII 词（≥2 字符）：整词
 * 返回去重后的 token 数组。
 */
function tokenize(keyword: string): string[] {
  const tokens = new Set<string>();
  const lower = keyword.trim().toLowerCase();
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

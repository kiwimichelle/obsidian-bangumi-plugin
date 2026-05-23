import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as readline from 'readline';

import type { EpisodeData, IndexMeta } from '../types';
import { INDEX_BATCH_SIZE, PLUGIN_DATA_DIR } from '../constants';

/** 进度回调：每个批次结束时回调一次，参数为已扫描行数。 */
export type EpisodeIndexProgressCallback = (linesScanned: number) => void;

/** episodes.jsonlines 中单行的原始结构 */
interface RawEpisode {
  id:         number;
  subject_id: number;
  /** 集类型：0=正篇, 1=SP, 2=OP, 3=ED */
  type:       number;
  /** 集数序号（浮点，SP/OVA 可能为 0.5 之类） */
  sort:       number;
  name:       string;
  name_cn?:   string;
  /** 播出日期，格式 YYYY-MM-DD */
  airdate?:   string;
  /** 时长（分钟） */
  duration?:  string;
  /** 简介 */
  desc?:      string;
  /** 发布状态：0=未播, 1=今日, 2=已播 */
  ep_status?: number;
}

/** 集类型数字 → 显示标签 */
export const EPISODE_TYPE_LABEL: Record<number, string> = {
  0: 'EP',
  1: 'SP',
  2: 'OP',
  3: 'ED',
};

const EPISODE_INDEX_FILE = 'bangumi-episode-index.json';
const EPISODE_META_FILE  = 'bangumi-episode-index.meta.json';

/**
 * 离线分集数据索引构建器
 *
 * 职责：
 * - 扫描 `episodes.jsonlines` 建立 `{ subject_id → EpisodeData[] }` 索引
 * - 持久化到 `bangumi-episode-index.json`，配套 `.meta.json` 元数据
 * - 提供 `getEpisodes(subjectId)` 给 `NoteBuilder` 生成带分集信息的 checkboxes，
 *   取代原来仅靠 `subject.eps` 生成空白序号列表的方式
 *
 * 设计决策：
 * - 分集数据体积较大（全库约数百万行），仅按 subject_id 聚合，不加二级索引
 * - 每条目 EpisodeData[] 按 type → sort 排序：正篇在前，SP/OP/ED 在后
 * - 失效检测策略与其它索引一致（路径 + 文件大小）
 * - `build()` 允许字段缺失（airdate/duration 等可选），统一置为空串
 *
 * 仅由 `DataManager` / `NoteBuilder` 持有；NoteBuilder 调 `getEpisodes`
 * 生成带播出日期、集名的 checkbox 列表。
 */
export class EpisodeIndexBuilder {
  private readonly app: App;
  private readonly dirPath:   string;
  private readonly indexPath: string;
  private readonly metaPath:  string;

  /** subject_id → EpisodeData[] */
  private index = new Map<number, EpisodeData[]>();
  private ready = false;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.dirPath   = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.indexPath = normalizePath(`${this.dirPath}/${EPISODE_INDEX_FILE}`);
    this.metaPath  = normalizePath(`${this.dirPath}/${EPISODE_META_FILE}`);
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
   * 获取指定条目的分集列表（已按 type → sort 排序）。
   * 未命中返回空数组。
   */
  getEpisodes(subjectId: number): EpisodeData[] {
    return this.index.get(subjectId) ?? [];
  }

  /**
   * 获取指定条目的正篇（type=0）分集列表。
   * 常用于生成 eps_checkboxes。
   */
  getMainEpisodes(subjectId: number): EpisodeData[] {
    return this.getEpisodes(subjectId).filter(e => e.type === 0);
  }

  // ──────────────────────────────────────────────────
  // 加载 / 失效检测
  // ──────────────────────────────────────────────────

  /**
   * 从磁盘加载分集索引到内存。
   * - 文件缺失 → 返回 false
   * - JSON 损坏 → 返回 false
   */
  async load(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.indexPath))) return false;

    try {
      const raw    = await adapter.read(this.indexPath);
      const parsed = JSON.parse(raw) as Record<string, EpisodeData[]>;
      const map    = new Map<number, EpisodeData[]>();
      for (const [key, eps] of Object.entries(parsed)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !Array.isArray(eps)) continue;
        map.set(id, eps);
      }
      this.index = map;
      this.ready = true;
      return true;
    } catch (err) {
      console.warn('[bangumi] bangumi-episode-index.json 加载失败，需要重建', err);
      return false;
    }
  }

  /**
   * 判断已持久化的索引是否对当前 episodes jsonl 失效。
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
   * 流式扫描 `episodes.jsonlines`，建立分集索引并持久化。
   *
   * - 单行 JSON.parse 失败不中断整体构建
   * - 每 `INDEX_BATCH_SIZE` 行 pause → setImmediate → resume 让出主线程
   * - 构建完成后对每条目分集按 type → sort 排序
   * - 仅在 `persist()` 成功后才更新内存状态
   */
  async build(jsonlPath: string, onProgress?: EpisodeIndexProgressCallback): Promise<void> {
    const map = new Map<number, EpisodeData[]>();
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
            const raw = JSON.parse(trimmed) as RawEpisode;
            if (
              typeof raw.id         === 'number' && Number.isFinite(raw.id) &&
              typeof raw.subject_id === 'number' && Number.isFinite(raw.subject_id)
            ) {
              const ep: EpisodeData = {
                id:          raw.id,
                subjectId:   raw.subject_id,
                type:        raw.type ?? 0,
                sort:        raw.sort ?? 0,
                name:        raw.name ?? '',
                nameCn:      raw.name_cn?.trim() ?? '',
                airdate:     raw.airdate ?? '',
                duration:    raw.duration ?? '',
                desc:        raw.desc ?? '',
              };

              let list = map.get(raw.subject_id);
              if (!list) {
                list = [];
                map.set(raw.subject_id, list);
              }
              list.push(ep);
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

    // 每条目按 type → sort 排序：正篇(0) 在前，SP(1)/OP(2)/ED(3) 在后
    for (const eps of map.values()) {
      eps.sort((a, b) => a.type !== b.type ? a.type - b.type : a.sort - b.sort);
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
    map:        Map<number, EpisodeData[]>,
    jsonlPath:  string,
    totalLines: number,
    jsonlSize:  number,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.dirPath))) {
      await adapter.mkdir(this.dirPath);
    }

    const snapshot: Record<string, EpisodeData[]> = {};
    for (const [id, eps] of map) {
      snapshot[String(id)] = eps;
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
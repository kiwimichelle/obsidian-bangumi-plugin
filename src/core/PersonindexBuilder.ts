import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as readline from 'readline';

import type { IndexMeta, PersonCredit } from '../types';
import { INDEX_BATCH_SIZE, PLUGIN_DATA_DIR } from '../constants';

/** 进度回调：每个批次结束时回调一次，参数为已扫描行数。 */
export type PersonIndexProgressCallback = (linesScanned: number) => void;

/** subject-persons.jsonlines 中单行的原始结构 */
interface RawPersonEntry {
  person_id:  number;
  subject_id: number;
  /** 职位 ID，对应 persons.jsonlines 中的 career 字段 */
  position:   number;
  /** 职位显示名称（部分版本的 dump 有） */
  position_name?: string;
}

/** persons.jsonlines 中单行的原始结构（仅我们需要的字段） */
interface RawPerson {
  id:      number;
  name:    string;
  /** 中文名（部分人物有） */
  name_cn?: string;
  /** 主要职业列表，字符串数组，例如 ['导演', '声优'] */
  career?: string[];
}

/**
 * 职位 ID → 显示分组名称的映射表。
 *
 * Bangumi 职位定义参考：https://bgm.tv/subject/person/position
 * 常见值（不完整，仅列出插件模板中会用到的）：
 *
 *  1 = 导演
 *  2 = 脚本
 *  3 = 分镜
 *  4 = 演出
 *  5 = 音乐
 *  6 = 人物设计
 *  7 = 系列构成
 *  8 = 美术监督
 *  9 = 色彩设计
 * 10 = 总作画监督
 * 11 = 作画监督
 * 12 = 机械设计
 * 13 = 音响监督
 * 14 = 摄影监督
 * 15 = 原画
 * 16 = 制片人
 * 17 = 动画制作
 * 18 = 制作公司
 *
 * 声优相关：
 * 1002 = 声优（角色配音）
 *
 * 如果 dump 数据附带了 position_name，优先用那个字段，
 * 这里只作为兜底映射。
 */
export const POSITION_LABEL: Record<number, string> = {
  1:    '导演',
  2:    '脚本',
  3:    '分镜',
  4:    '演出',
  5:    '音乐',
  6:    '人物设计',
  7:    '系列构成',
  8:    '美术监督',
  9:    '色彩设计',
  10:   '总作画监督',
  11:   '作画监督',
  12:   '机械设计',
  13:   '音响监督',
  14:   '摄影监督',
  15:   '原画',
  16:   '制片人',
  17:   '动画制作',
  18:   '制作公司',
  1002: '声优',
};

const PERSON_INDEX_FILE = 'bangumi-person-index.json';
const PERSON_META_FILE  = 'bangumi-person-index.meta.json';

/**
 * 离线制作人员索引构建器
 *
 * 职责：
 * - 联合扫描 `subject-persons.jsonlines` 与 `persons.jsonlines`，
 *   建立 `{ subject_id → PersonCredit[] }` 索引
 * - 持久化到 `bangumi-person-index.json`，配套 `.meta.json` 元数据
 * - 提供 `getCredits(subjectId)` 给 `NoteBuilder` 在笔记中生成制作人员表
 *
 * 构建流程（两阶段）：
 * 1. 先扫描 `persons.jsonlines`，建立 `person_id → name/name_cn` 临时 Map
 * 2. 再扫描 `subject-persons.jsonlines`，用临时 Map 填充人名；
 *    如果 dump 已含 `position_name`，直接用，否则用 POSITION_LABEL 映射
 *
 * 失效检测：
 * - 元数据记录 persons.jsonlines 与 subject-persons.jsonlines 的路径和大小，
 *   任一变更则重建
 *
 * 仅由 `DataManager` / `NoteBuilder` 持有。
 */
export class PersonIndexBuilder {
  private readonly app: App;
  private readonly dirPath:   string;
  private readonly indexPath: string;
  private readonly metaPath:  string;

  /** subject_id → PersonCredit[] */
  private index = new Map<number, PersonCredit[]>();
  private ready = false;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.dirPath   = normalizePath(`${pluginDir}/${PLUGIN_DATA_DIR}`);
    this.indexPath = normalizePath(`${this.dirPath}/${PERSON_INDEX_FILE}`);
    this.metaPath  = normalizePath(`${this.dirPath}/${PERSON_META_FILE}`);
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
   * 获取指定条目的制作人员列表。
   * 未命中返回空数组。
   */
  getCredits(subjectId: number): PersonCredit[] {
    return this.index.get(subjectId) ?? [];
  }

  /**
   * 按职位分组，返回 `{ positionLabel: PersonCredit[] }` 结构。
   * 供模板渲染制作人员表使用。
   */
  getCreditsByPosition(subjectId: number): Map<string, PersonCredit[]> {
    const credits = this.getCredits(subjectId);
    const result  = new Map<string, PersonCredit[]>();
    for (const credit of credits) {
      let list = result.get(credit.positionLabel);
      if (!list) {
        list = [];
        result.set(credit.positionLabel, list);
      }
      list.push(credit);
    }
    return result;
  }

  // ──────────────────────────────────────────────────
  // 加载 / 失效检测
  // ──────────────────────────────────────────────────

  /**
   * 从磁盘加载人员索引到内存。
   * - 文件缺失 → 返回 false
   * - JSON 损坏 → 返回 false
   */
  async load(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.indexPath))) return false;

    try {
      const raw    = await adapter.read(this.indexPath);
      const parsed = JSON.parse(raw) as Record<string, PersonCredit[]>;
      const map    = new Map<number, PersonCredit[]>();
      for (const [key, credits] of Object.entries(parsed)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !Array.isArray(credits)) continue;
        map.set(id, credits);
      }
      this.index = map;
      this.ready = true;
      return true;
    } catch (err) {
      console.warn('[bangumi] bangumi-person-index.json 加载失败，需要重建', err);
      return false;
    }
  }

  /**
   * 判断已持久化的索引是否失效。
   * meta 文件记录两个 jsonl 的路径和大小，任一变更则返回 true。
   */
  async isStale(personsJsonlPath: string, subjectPersonsJsonlPath: string): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.metaPath))) return true;

    try {
      const raw  = await adapter.read(this.metaPath);
      const meta = JSON.parse(raw) as PersonIndexMeta;
      if (
        meta.personsJsonlPath        !== personsJsonlPath ||
        meta.subjectPersonsJsonlPath !== subjectPersonsJsonlPath
      ) return true;

      const [personsStat, subjectPersonsStat] = await Promise.all([
        fs.promises.stat(personsJsonlPath),
        fs.promises.stat(subjectPersonsJsonlPath),
      ]);
      return (
        personsStat.size        !== meta.personsJsonlSize ||
        subjectPersonsStat.size !== meta.subjectPersonsJsonlSize
      );
    } catch {
      return true;
    }
  }

  // ──────────────────────────────────────────────────
  // 构建
  // ──────────────────────────────────────────────────

  /**
   * 两阶段构建：
   * 1. 扫描 `persons.jsonlines` 建立 person_id → name 临时 Map
   * 2. 扫描 `subject-persons.jsonlines` 构建主索引
   *
   * @param personsJsonlPath         `persons.jsonlines` 文件路径
   * @param subjectPersonsJsonlPath  `subject-persons.jsonlines` 文件路径
   */
  async build(
    personsJsonlPath:        string,
    subjectPersonsJsonlPath: string,
    onProgress?:             PersonIndexProgressCallback,
  ): Promise<void> {
    // 阶段一：扫描 persons.jsonlines
    const personNames = await this.buildPersonNameMap(personsJsonlPath);

    // 阶段二：扫描 subject-persons.jsonlines
    const map = new Map<number, PersonCredit[]>();
    let lineNum   = 0;
    let batchCount = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(subjectPersonsJsonlPath, { encoding: 'utf8' });
      const rl     = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        lineNum++;
        batchCount++;

        const trimmed = line.trim();
        if (trimmed) {
          try {
            const entry = JSON.parse(trimmed) as RawPersonEntry;
            if (
              typeof entry.person_id  === 'number' && Number.isFinite(entry.person_id) &&
              typeof entry.subject_id === 'number' && Number.isFinite(entry.subject_id)
            ) {
              const personInfo = personNames.get(entry.person_id);
              const posLabel   =
                entry.position_name?.trim() ||
                POSITION_LABEL[entry.position] ||
                String(entry.position);

              const credit: PersonCredit = {
                personId:      entry.person_id,
                name:          personInfo?.nameCn || personInfo?.name || '',
                nameOriginal:  personInfo?.name || '',
                positionId:    entry.position,
                positionLabel: posLabel,
              };

              let list = map.get(entry.subject_id);
              if (!list) {
                list = [];
                map.set(entry.subject_id, list);
              }
              list.push(credit);
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

    const [personsStat, subjectPersonsStat] = await Promise.all([
      fs.promises.stat(personsJsonlPath),
      fs.promises.stat(subjectPersonsJsonlPath),
    ]);

    await this.persist(
      map,
      personsJsonlPath,
      subjectPersonsJsonlPath,
      lineNum,
      personsStat.size,
      subjectPersonsStat.size,
    );

    this.index = map;
    this.ready = true;
    onProgress?.(lineNum);
  }

  // ──────────────────────────────────────────────────
  // 内部：阶段一
  // ──────────────────────────────────────────────────

  private async buildPersonNameMap(
    personsJsonlPath: string,
  ): Promise<Map<number, { name: string; nameCn: string }>> {
    const map = new Map<number, { name: string; nameCn: string }>();

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(personsJsonlPath, { encoding: 'utf8' });
      const rl     = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const raw = JSON.parse(trimmed) as RawPerson;
          if (typeof raw.id === 'number' && Number.isFinite(raw.id)) {
            map.set(raw.id, {
              name:   raw.name ?? '',
              nameCn: raw.name_cn?.trim() ?? '',
            });
          }
        } catch {
          /* 跳过 */
        }
      });

      rl.on('close', resolve);
      rl.on('error', reject);
      stream.on('error', reject);
    });

    return map;
  }

  // ──────────────────────────────────────────────────
  // 内部：持久化
  // ──────────────────────────────────────────────────

  private async persist(
    map:                     Map<number, PersonCredit[]>,
    personsJsonlPath:        string,
    subjectPersonsJsonlPath: string,
    totalLines:              number,
    personsJsonlSize:        number,
    subjectPersonsJsonlSize: number,
  ): Promise<void> {
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(this.dirPath))) {
      await adapter.mkdir(this.dirPath);
    }

    const snapshot: Record<string, PersonCredit[]> = {};
    for (const [id, credits] of map) {
      snapshot[String(id)] = credits;
    }
    await adapter.write(this.indexPath, JSON.stringify(snapshot));

    const meta: PersonIndexMeta = {
      builtAt:                 Date.now(),
      totalLines,
      personsJsonlPath,
      subjectPersonsJsonlPath,
      personsJsonlSize,
      subjectPersonsJsonlSize,
      // Satisfy the IndexMeta interface shape used by other index builders
      jsonlPath:  subjectPersonsJsonlPath,
      jsonlSize:  subjectPersonsJsonlSize,
    };
    await adapter.write(this.metaPath, JSON.stringify(meta, null, 2));
  }
}

// ──────────────────────────────────────────────────
// 扩展的元数据类型（持久化用）
// ──────────────────────────────────────────────────

interface PersonIndexMeta extends IndexMeta {
  personsJsonlPath:        string;
  subjectPersonsJsonlPath: string;
  personsJsonlSize:        number;
  subjectPersonsJsonlSize: number;
}
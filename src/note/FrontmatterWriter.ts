import { App, TFile } from 'obsidian';
import { BGM_WEB_BASE } from '../constants';
import type { SubjectData, Subjective, SubjectTypeKey } from '../types';
import { buildSubjectiveFields } from './Subjectivemapper';

// ─────────────────────────────────────────────
// 固定键集合（不从 infobox 平铺，单独处理）
// ─────────────────────────────────────────────

const INFOBOX_FIXED_KEYS = new Set<string>([
  '中文名', '日文名',
  'tags', 'Tags', 'Tag', 'tag', '标签',
]);

/**
 * bangumi 插件写入的固定 frontmatter 键。
 * 更新笔记时用于识别"上次写入的 infobox 键"：
 * 先删除所有非固定的旧键，再写入新值，防止键名累积。
 */
const BGM_FIXED_FRONTMATTER_KEYS = new Set<string>([
  '中文名', '日文名', 'cover', 'bangumi_id', 'BGM链接',
  'BGM评分', 'BGM排名', 'tags',
  // 主观输入字段
  'my_status', 'my_rating', 'my_comment', 'my_progress', 'my_source',
  'my_channel', 'my_version', 'my_read_progress', 'my_hours',
  'my_platform', 'my_game_progress', 'my_music_source',
]);

// ─────────────────────────────────────────────
// FrontmatterWriter
// ─────────────────────────────────────────────

export class FrontmatterWriter {
  constructor(private readonly app: App) {}

  /**
   * 写入/更新 Bangumi 数据字段。
   *
   * 修复：更新场景下先删除上次写入的 infobox 平铺键（识别方式：不在
   * BGM_FIXED_FRONTMATTER_KEYS 集合内的非下划线键），再写入新值，
   * 防止 infobox 键名在多次更新后无限累积。
   */
  async writeBangumiFields(
    file:           TFile,
    data:           SubjectData,
    coverLocalPath: string,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      // 先清除上次写入的 infobox 平铺键（避免累积）
      this.clearOldInfoboxKeys(fm);

      // 固定字段
      fm['中文名']     = data.name;
      fm['日文名']     = data.nameOriginal;
      fm['cover']      = coverLocalPath || data.coverUrl;
      fm['bangumi_id'] = data.id;
      fm['BGM链接']    = `${BGM_WEB_BASE}/subject/${data.id}`;

      setOrDelete(fm, 'BGM评分', data.score > 0 ? data.score : undefined);
      setOrDelete(fm, 'BGM排名', data.rank  > 0 ? data.rank  : undefined);

      // tags
      fm['tags'] = buildTagsArray(data.tags);

      // infobox 平铺（跳过固定键）
      for (const entry of data.infobox) {
        if (INFOBOX_FIXED_KEYS.has(entry.key)) continue;
        fm[entry.key] = entry.value;
      }
    });
  }

  /**
   * 写入用户主观字段。
   * 仅在新建笔记时调用，更新时跳过以保留用户已填值。
   */
  async writeSubjectiveFields(
    file:       TFile,
    typeKey:    SubjectTypeKey,
    subjective: Subjective,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const fields = buildSubjectiveFields(typeKey, subjective);
      for (const [key, value] of Object.entries(fields)) {
        setOrDelete(fm, key, value);
      }
    });
  }

  // ─────────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────────

  /**
   * 删除 frontmatter 中上次由 infobox 平铺写入的键。
   * 判断依据：不在 BGM_FIXED_FRONTMATTER_KEYS 集合内，且不包含下划线
   * （下划线键通常是用户手写字段或主观输入字段，不删除）。
   */
  private clearOldInfoboxKeys(fm: Record<string, unknown>): void {
    for (const key of Object.keys(fm)) {
      if (BGM_FIXED_FRONTMATTER_KEYS.has(key)) continue;
      // 保留用户手写字段（含下划线的约定为用户字段）
      if (key.includes('_')) continue;
      // 删除上次 infobox 写入的键
      delete fm[key];
    }
  }
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function setOrDelete(fm: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === '' || value === null) {
    delete fm[key];
  } else {
    fm[key] = value;
  }
}

function buildTagsArray(tags: string[]): string[] {
  return ['bangumi', ...tags.map(t => `bgm/${t}`)];
}
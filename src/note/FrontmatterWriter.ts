import { App, TFile } from 'obsidian';
import { BGM_WEB_BASE } from '../constants';
import type {
  AnimeSubjective, BookSubjective, GameSubjective,
  MusicSubjective, RealSubjective,
  SubjectData, Subjective, SubjectTypeKey,
} from '../types';

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

/**
 * infobox 中应跳过的键
 *
 * 这些键要么已由固定字段写入（中文名 / 日文名），
 * 要么会与 tags 数组冲突，避免重复或覆盖
 */
const INFOBOX_FIXED_KEYS = new Set<string>([
  '中文名', '日文名',
  'tags', 'Tags', 'Tag', 'tag', '标签',
]);

// ─────────────────────────────────────────────
// FrontmatterWriter
// ─────────────────────────────────────────────

/**
 * 通过 Obsidian 官方 `fileManager.processFrontMatter` API 写入 frontmatter
 *
 * 设计要点：
 * - `processFrontMatter` 只修改回调中显式赋值的键，未触及的字段（含用户手写字段）原样保留，
 *   因此天然满足「保留手动编辑字段」的需求
 * - YAML 转义、引号、特殊字符全部交给 Obsidian 处理，调用方传原始 JS 值即可
 * - 拆成两个方法：
 *   - `writeBangumiFields` — 每次导入/更新都调用，覆盖 BGM 元数据
 *   - `writeSubjectiveFields` — 仅在新建笔记时调用；更新已存在笔记时跳过，
 *     避免抹掉用户已经填好的「观看状态 / 已观看集数」等
 */
export class FrontmatterWriter {
  constructor(private readonly app: App) {}

  /**
   * 写入/更新 Bangumi 数据字段：基础元数据 + tags + infobox 全字段
   *
   * 未在此处显式设置的字段会被 Obsidian 自动保留
   */
  async writeBangumiFields(
    file: TFile,
    data: SubjectData,
    coverLocalPath: string,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      // ── 固定字段 ──
      fm['中文名']     = data.name;
      fm['日文名']     = data.nameOriginal;
      fm['cover']      = coverLocalPath || data.coverUrl;
      fm['bangumi_id'] = data.id;
      fm['BGM链接']    = `${BGM_WEB_BASE}/subject/${data.id}`;

      setOrDelete(fm, 'BGM评分', data.score > 0 ? data.score : undefined);
      setOrDelete(fm, 'BGM排名', data.rank  > 0 ? data.rank  : undefined);

      // ── tags（YAML 数组） ──
      fm['tags'] = buildTagsArray(data.tags);

      // ── infobox 全字段平铺 ──
      for (const entry of data.infobox) {
        if (INFOBOX_FIXED_KEYS.has(entry.key)) continue;
        fm[entry.key] = entry.value;
      }
    });
  }

  /**
   * 写入用户主观字段
   *
   * 调用时机：仅在新建笔记时；更新已存在笔记应跳过此调用以保留用户已填值
   */
  async writeSubjectiveFields(
    file: TFile,
    typeKey: SubjectTypeKey,
    subjective: Subjective,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const fields = buildSubjectiveFields(typeKey, subjective);
      for (const [key, value] of Object.entries(fields)) {
        setOrDelete(fm, key, value);
      }
    });
  }
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

/** 空值（'' / undefined）则删除字段，否则赋值 */
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

function buildSubjectiveFields(
  typeKey: SubjectTypeKey,
  subjective: Subjective,
): Record<string, string> {
  const fields: Record<string, string> = {
    my_status:  subjective.status,
    my_rating:  (subjective as AnimeSubjective).rating  ?? '',
    my_comment: (subjective as AnimeSubjective).comment ?? '',
  };

  switch (typeKey) {
    case 'anime': {
      const s = subjective as AnimeSubjective;
      fields['my_progress'] = s.progress;
      fields['my_source']   = s.source;
      break;
    }
    case 'book': {
      const s = subjective as BookSubjective;
      fields['my_channel'] = s.channel;
      fields['my_version'] = s.version;
      const parts = [
        s.volNum  ? `第${s.volNum}卷`  : '',
        s.unitNum ? `第${s.unitNum}话` : '',
      ].filter(Boolean);
      fields['my_read_progress'] = parts.join(' / ');
      break;
    }
    case 'game': {
      const s = subjective as GameSubjective;
      fields['my_hours']         = s.hours;
      fields['my_platform']      = s.platform;
      fields['my_game_progress'] = s.progress;
      break;
    }
    case 'music': {
      const s = subjective as MusicSubjective;
      fields['my_music_source'] = s.source;
      break;
    }
    case 'real': {
      const s = subjective as RealSubjective;
      fields['my_progress'] = s.progress;
      fields['my_source']   = s.source;
      break;
    }
  }

  return fields;
}

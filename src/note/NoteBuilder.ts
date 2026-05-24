import { App, TFile } from 'obsidian';
import { getInfoboxValue } from '../core/WikiParser';
import {
  AnimeSubjective, BangumiSettings, BookSubjective,
  GameSubjective, InfoboxEntry, MusicSubjective,
  RealSubjective, SubjectData,
  SubjectTypeKey, Subjective,
} from '../types';
import { BGM_WEB_BASE, DEFAULT_TEMPLATES } from '../constants';
import {
  buildCreditsFrontmatter,
  buildCreditsMain,        // ✅ 新增
  buildCreditsCast,        // ✅ 新增
  buildEpsCheckboxes,
  buildInfoboxFrontmatter,
  buildInfoboxTableRows,
  buildNetabaIframe,
  buildRelationLinks,
  buildRelationNames,
  buildTagsYaml,
  renderTemplate,
} from './TemplateEngine';
import type { DataManager } from '../core/DataManager';

// ─────────────────────────────────────────────
// 公开接口
// ─────────────────────────────────────────────

export interface BuildResult {
  /** 渲染好的笔记正文（模板决定是否含 frontmatter） */
  content: string;
  /** 解析出的开播年份，供 vault 归档路径使用 */
  year: string;
  /** 解析出的季度（01月/04月/07月/10月），供 vault 归档路径使用 */
  season: string;
}

// ─────────────────────────────────────────────
// NoteBuilder
// ─────────────────────────────────────────────

/**
 * 笔记内容构建器
 *
 * Priority 4 新增：
 * - 接受可选的 `dataManager` 参数，若存在则调 `getMainEpisodes()` 获取分集数据，
 *   生成带集名和播出日期的 `eps_checkboxes`
 *
 * Priority 5 新增：
 * - 若 `dataManager.personIndex` 就绪，生成 `credits_table_rows` 和
 *   `credits_frontmatter` 槽位
 */
export class NoteBuilder {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => BangumiSettings,
    /** Priority 4/5: 数据管理器引用，用于获取分集和制作人员数据 */
    private readonly dataManager?: DataManager,
  ) {}

  async build(
    data: SubjectData,
    subjective: Subjective,
    /** 封面已下载到 vault 内的相对路径，未下载时传空字符串 */
    coverLocalPath: string,
  ): Promise<BuildResult> {
    const { year, season } = parseYearSeason(data.date);
    const settings = this.getSettings();
    const template = await this.loadTemplate(data.typeKey, settings);
    const vars = this.buildVars(data, subjective, coverLocalPath, year, season);
    return { content: renderTemplate(template, vars), year, season };
  }

  private async loadTemplate(typeKey: SubjectTypeKey, settings: BangumiSettings): Promise<string> {
    const config = settings.subjectTypes[typeKey];
    if (config.templateSource === 'file' && config.templateFile) {
      const file = this.app.vault.getAbstractFileByPath(config.templateFile);
      if (file instanceof TFile) {
        return this.app.vault.read(file);
      }
    }
    return DEFAULT_TEMPLATES[typeKey];
  }

  // 在 buildVars 方法的复杂槽位部分替换如下
private buildVars(
  data:           SubjectData,
  subjective:     Subjective,
  coverLocalPath: string,
  year:           string,
  season:         string,
): Record<string, string> {
  const episodes = this.dataManager?.getMainEpisodes(data.id) ?? [];
  const credits  = this.dataManager?.getCredits(data.id) ?? [];

  return {
    // ── 基础 ───────────────────────────────────────────────────
    title:               data.name,
    original_title:      data.nameOriginal,
    cover_local:         coverLocalPath || data.coverUrl,
    bangumi_id:          String(data.id),
    bangumi_url:         `${BGM_WEB_BASE}/subject/${data.id}`,
    score:               data.score > 0 ? String(data.score) : '',
    rank:                data.rank  > 0 ? String(data.rank)  : '',
    summary:             data.summary,
    today:               getToday(),
    year,
    season,
    eps_count:           data.eps > 0 ? String(data.eps) : '',
    tags_yaml:           buildTagsYaml(data.tags),

    // ── infobox（已过滤人员类字段）──────────────────────────────
    infobox_table_rows:  buildInfoboxTableRows(data.infobox),
    infobox_frontmatter: buildInfoboxFrontmatter(data.infobox),

    // ── 分集 ───────────────────────────────────────────────────
    eps_checkboxes:      buildEpsCheckboxes(data.eps, episodes.length > 0 ? episodes : undefined),
    netaba_iframe:       buildNetabaIframe(data.id),

    // ── 关联 ───────────────────────────────────────────────────
    related_series:      buildRelationNames(data.relations, '系列'),
    related_series_link: buildRelationLinks(data.relations, '系列'),
    sequel_link:         buildRelationLinks(data.relations, '续集'),
    prequel_link:        buildRelationLinks(data.relations, '前传'),

    // ── 分类特有 ───────────────────────────────────────────────
    adaptation:          data.typeKey === 'anime' ? detectAdaptation(data.infobox) : '',
    artist:              getInfoboxValue(data.infobox, ['艺术家', '作曲', '演唱']),
    track_count:         getInfoboxValue(data.infobox, ['曲目数', '曲目']),

    // ── 制作人员（拆分为主创和声优）────────────────────────────
    credits_main:        buildCreditsMain(credits),
    credits_cast:        buildCreditsCast(credits),
    credits_frontmatter: buildCreditsFrontmatter(credits),

    // ── 主观输入 ───────────────────────────────────────────────
    ...buildSubjectiveVars(data.typeKey, subjective),
  };
}
}
// ─────────────────────────────────────────────
// 纯函数工具（部分导出供 vault 层使用）
// ─────────────────────────────────────────────

/** 从 YYYY-MM-DD 日期字符串解析年份和季度 */
export function parseYearSeason(dateStr: string): { year: string; season: string } {
  if (!dateStr) return { year: '未知年份', season: '未知季度' };
  const parts = dateStr.split('-');
  const yearStr  = parts[0] ?? '未知年份';
  const month    = parseInt(parts[1] ?? '0');
  let season = '未知季度';
  if      (month >= 1  && month <= 3)  season = '01月';
  else if (month >= 4  && month <= 6)  season = '04月';
  else if (month >= 7  && month <= 9)  season = '07月';
  else if (month >= 10 && month <= 12) season = '10月';
  return { year: yearStr, season };
}

function getToday(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

function detectAdaptation(entries: InfoboxEntry[]): string {
  const source = getInfoboxValue(entries, ['原作', '原案']);
  if (!source) return '';
  const s = source.toLowerCase();
  if (s.includes('漫画') || s.includes('manga') || s.includes('comic')) return '漫画改编';
  if (s.includes('小说') || s.includes('轻小说') || s.includes('novel')) return '小说改编';
  if (s.includes('游戏') || s.includes('game')  || s.includes('gal'))   return '游戏改编';
  if (s.includes('原创') || source === '-')                               return '原创';
  return source;
}

// ─────────────────────────────────────────────
// 主观输入变量映射
// ─────────────────────────────────────────────

function buildSubjectiveVars(typeKey: SubjectTypeKey, subjective: Subjective): Record<string, string> {
  const base: Record<string, string> = {
    my_status:        subjective.status,
    my_rating:        (subjective as AnimeSubjective).rating   ?? '',
    my_comment:       (subjective as AnimeSubjective).comment  ?? '',
    my_progress:      '',
    my_source:        '',
    my_channel:       '',
    my_version:       '',
    my_read_progress: '',
    my_hours:         '',
    my_platform:      '',
    my_game_progress: '',
    my_music_source:  '',
  };

  switch (typeKey) {
    case 'anime': {
      const s = subjective as AnimeSubjective;
      base.my_progress = s.progress;
      base.my_source   = s.source;
      break;
    }
    case 'book': {
      const s = subjective as BookSubjective;
      base.my_channel  = s.channel;
      base.my_version  = s.version;
      const parts = [
        s.volNum  ? `第${s.volNum}卷`  : '',
        s.unitNum ? `第${s.unitNum}话` : '',
      ].filter(Boolean);
      base.my_read_progress = parts.join(' / ');
      break;
    }
    case 'game': {
      const s = subjective as GameSubjective;
      base.my_hours         = s.hours;
      base.my_platform      = s.platform;
      base.my_game_progress = s.progress;
      break;
    }
    case 'music': {
      const s = subjective as MusicSubjective;
      base.my_music_source = s.source;
      break;
    }
    case 'real': {
      const s = subjective as RealSubjective;
      base.my_progress = s.progress;
      base.my_source   = s.source;
      break;
    }
  }

  return base;
}
import { App, TFile } from 'obsidian';
import { getInfoboxValue } from '../core/WikiParser';
import type {
  AnimeSubjective, BangumiSettings, BookSubjective,
  GameSubjective, InfoboxEntry, MusicSubjective,
  RealSubjective, SubjectData, SubjectTypeKey,
  Subjective, SubjectRelation,
} from '../types';
import { BGM_WEB_BASE, DEFAULT_TEMPLATES } from '../constants';
import {
  buildCreditsFrontmatter,
  buildCreditsMain,
  buildCreditsCast,
  buildEpsCheckboxes,
  buildInfoboxFrontmatter,
  buildInfoboxTableRows,
  buildNetabaIframe,
  buildRelationLinks,
  buildTagsYaml,
  renderTemplate,
} from './TemplateEngine';
import type { DataManager } from '../core/DataManager';

export interface BuildResult {
  content: string;
  year:    string;
  season:  string;
}

export class NoteBuilder {
  constructor(
    private readonly app:          App,
    private readonly getSettings:  () => BangumiSettings,
    private readonly dataManager?: DataManager,
  ) {}

  async build(
    data:           SubjectData,
    subjective:     Subjective,
    coverLocalPath: string,
  ): Promise<BuildResult> {
    const { year, season } = parseYearSeason(data.date);
    const settings  = this.getSettings();
    const template  = await this.loadTemplate(data.typeKey, settings);
    const vars      = this.buildVars(data, subjective, coverLocalPath, year, season);
    return { content: renderTemplate(template, vars), year, season };
  }

  private async loadTemplate(typeKey: SubjectTypeKey, settings: BangumiSettings): Promise<string> {
    const config = settings.subjectTypes[typeKey];
    if (config.templateSource === 'file' && config.templateFile) {
      const file = this.app.vault.getAbstractFileByPath(config.templateFile);
      if (file instanceof TFile) return this.app.vault.read(file);
    }
    return DEFAULT_TEMPLATES[typeKey];
  }

  private buildVars(
    data:           SubjectData,
    subjective:     Subjective,
    coverLocalPath: string,
    year:           string,
    season:         string,
  ): Record<string, string> {
    const episodes = data.onlineEpisodes?.length > 0
      ? data.onlineEpisodes                              // 在线模式：直接用 API 拉取的数据
      : (this.dataManager?.getMainEpisodes(data.id) ?? []); // 离线模式：从索引读取
    const credits     = this.dataManager?.getCredits(data.id) ?? [];
    const castCredits = data.castCredits ?? [];

    return {
      // 基础
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

      // infobox
      infobox_table_rows:  buildInfoboxTableRows(data.infobox),
      infobox_frontmatter: buildInfoboxFrontmatter(data.infobox),

      // 分集
      eps_checkboxes: buildEpsCheckboxes(data.eps, episodes.length > 0 ? episodes : undefined),
      netaba_iframe:  buildNetabaIframe(data.id),

      // 关联（修复：series_section 现在正确生成）
      series_section: buildSeriesSection(data.relations),

      // 制作人员（修复：castCredits 正确传入 buildCreditsCast）
      credits_main:        buildCreditsMain(credits),
      credits_cast:        buildCreditsCast(castCredits, credits),
      credits_frontmatter: buildCreditsFrontmatter(credits),

      // 分类特有
      adaptation:  data.typeKey === 'anime' ? detectAdaptation(data.infobox) : '',
      artist:      getInfoboxValue(data.infobox, ['艺术家', '作曲', '演唱']),
      track_count: getInfoboxValue(data.infobox, ['曲目数', '曲目']),

      // 主观输入
      ...buildSubjectiveVars(data.typeKey, subjective),
    };
  }
}

// ─────────────────────────────────────────────
// 纯函数工具
// ─────────────────────────────────────────────

export function parseYearSeason(dateStr: string): { year: string; season: string } {
  if (!dateStr) return { year: '未知年份', season: '未知季度' };
  const parts   = dateStr.split('-');
  const yearStr = parts[0] ?? '未知年份';
  const month   = parseInt(parts[1] ?? '0');
  let season    = '未知季度';
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

function buildSeriesSection(relations: SubjectRelation[]): string {
  const series  = buildRelationLinks(relations, '系列');
  const sequel  = buildRelationLinks(relations, '续集');
  const prequel = buildRelationLinks(relations, '前传');

  if (!series && !sequel && !prequel) return '';

  const rows: string[] = [];
  if (series)  rows.push(`| 所属系列 | ${series} |`);
  if (sequel)  rows.push(`| 续集     | ${sequel} |`);
  if (prequel) rows.push(`| 前传     | ${prequel} |`);

  return `## 系列关联\n| 类型 | 条目 |\n|:--|:--|\n${rows.join('\n')}`;
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
      base['my_progress'] = s.progress;
      base['my_source']   = s.source;
      break;
    }
    case 'book': {
      const s = subjective as BookSubjective;
      base['my_channel'] = s.channel;
      base['my_version'] = s.version;
      const parts = [
        s.volNum  ? `第${s.volNum}卷`  : '',
        s.unitNum ? `第${s.unitNum}话` : '',
      ].filter(Boolean);
      base['my_read_progress'] = parts.join(' / ');
      break;
    }
    case 'game': {
      const s = subjective as GameSubjective;
      base['my_hours']          = s.hours;
      base['my_platform']       = s.platform;
      base['my_game_progress']  = s.progress;
      break;
    }
    case 'music': {
      const s = subjective as MusicSubjective;
      base['my_music_source'] = s.source;
      break;
    }
    case 'real': {
      const s = subjective as RealSubjective;
      base['my_progress'] = s.progress;
      base['my_source']   = s.source;
      break;
    }
  }

  return base;
}
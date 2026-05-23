import { App, TFile } from 'obsidian';
import { getInfoboxValue } from '../core/WikiParser';
import {
  BangumiSettings, InfoboxEntry,
  SubjectData, SubjectTypeKey, Subjective,
} from '../types';
import { BGM_WEB_BASE, DEFAULT_TEMPLATES } from '../constants';
import {
  buildEpsCheckboxes, buildInfoboxFrontmatter, buildInfoboxTableRows,
  buildNetabaIframe, buildRelationLinks, buildRelationNames,
  buildTagsYaml, renderTemplate,
} from './TemplateEngine';
import { buildSubjectiveFields } from './Subjectivemapper';

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

export class NoteBuilder {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => BangumiSettings,
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

  private buildVars(
    data: SubjectData,
    subjective: Subjective,
    coverLocalPath: string,
    year: string,
    season: string,
  ): Record<string, string> {
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
      summary_raw:         '',
      today:               getToday(),
      year,
      season,
      eps_count:           data.eps > 0 ? String(data.eps) : '',
      tags_yaml:           buildTagsYaml(data.tags),

      // ── infobox ────────────────────────────────────────────────
      infobox_table_rows:  buildInfoboxTableRows(data.infobox),
      infobox_frontmatter: buildInfoboxFrontmatter(data.infobox),

      // ── 复杂槽位 ───────────────────────────────────────────────
      eps_checkboxes:      buildEpsCheckboxes(data.eps),
      netaba_iframe:       buildNetabaIframe(data.id),

      // ── 关联 ───────────────────────────────────────────────────
      related_series:      buildRelationNames(data.relations, '系列'),
      related_series_link: buildRelationLinks(data.relations, '系列'),
      sequel_link:         buildRelationLinks(data.relations, '续集'),
      prequel_link:        buildRelationLinks(data.relations, '前传'),

      // ── 分类特有字段 ───────────────────────────────────────────
      adaptation:          data.typeKey === 'anime' ? detectAdaptation(data.infobox) : '',
      artist:              getInfoboxValue(data.infobox, ['艺术家', '作曲', '演唱']),
      track_count:         getInfoboxValue(data.infobox, ['曲目数', '曲目']),

      // ── 主观输入 ───────────────────────────────────────────────
      ...buildSubjectiveFields(data.typeKey, subjective),
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
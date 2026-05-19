import { App, TFile } from 'obsidian';
import { InfoboxEntry, getInfoboxValue } from './api';
import { DEFAULT_TEMPLATES } from './defaults';
import { SubjectTypeKey, BangumiSettings } from './types';

// infobox 展开进 frontmatter 时排除的 key（避免和固定字段冲突）
const FRONTMATTER_EXCLUDE = ['tags', 'Tags', '标签', 'tag'];

export interface TemplateVars {
  title: string;
  original_title: string;
  cover_local: string;
  adaptation: string;
  eps_count: string;
  year: string;
  season: string;
  today: string;
  related_series: string;
  related_series_link: string;
  bangumi_url: string;
  bangumi_id: string;
  score: string;
  rank: string;
  summary: string;
  summary_raw: string;
  tags_yaml: string;
  infobox_frontmatter: string;
  infobox_table_rows: string;
  eps_checkboxes: string;
  netaba_iframe: string;
  // 书籍专属
  author: string;
  publisher: string;
  volumes: string;
  // 游戏专属
  developer: string;
  platform: string;
  // 音乐专属
  artist: string;
  track_count: string;
}

export function getToday(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

export function parseYearSeason(dateStr: string): { year: string; season: string } {
  if (!dateStr) return { year: '未知年份', season: '未知季度' };
  const parts = dateStr.split('-');
  const yearStr = parts[0] ?? '未知年份';
  const month = parseInt(parts[1] ?? '0');
  let season = '未知季度';
  if (month >= 1  && month <= 3)  season = '01月';
  else if (month >= 4  && month <= 6)  season = '04月';
  else if (month >= 7  && month <= 9)  season = '07月';
  else if (month >= 10 && month <= 12) season = '10月';
  return { year: yearStr, season };
}

export function detectAdaptation(entries: InfoboxEntry[]): string {
  const source = getInfoboxValue(entries, ['原作', '原案']);
  if (!source) return '';
  const s = source.toLowerCase();
  if (s.includes('漫画') || s.includes('manga') || s.includes('comic')) return '漫画改编';
  if (s.includes('小说') || s.includes('轻小说') || s.includes('novel')) return '小说改编';
  if (s.includes('游戏') || s.includes('game') || s.includes('gal'))    return '游戏改编';
  if (s.includes('原创') || source === '-') return '原创';
  return '';
}

export function resolveArchivePath(
  archiveRoot: string,
  archiveMode: string,
  year: string,
  season: string
): string {
  if (archiveMode === 'season') return `${archiveRoot}/${year}/${season}新番`;
  if (archiveMode === 'year')   return `${archiveRoot}/${year}`;
  return archiveRoot;
}

function yamlValue(val: string): string {
  if (!val) return '""';

  if (val.includes('\n')) {
    const indented = val.split('\n').map(l => `  ${l}`).join('\n');
    return `|\n${indented}`;
  }

  const needsQuote =
    /[:#\[\]{},&*?|<>=!%@`'"\\]/.test(val) ||
    val.startsWith(' ') ||
    val.endsWith(' ') ||
    val === 'true' || val === 'false' ||
    val === 'null' || val === '~' ||
    /^\d/.test(val) ||
    val.includes('(') ||   // 含括号也要加引号
    val.includes(')') ||
    val.includes('→');     // 特殊字符

  if (needsQuote) {
    return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  return val;
}

export function buildTemplateVars(
  detail: any,
  relations: any[],
  infobox: InfoboxEntry[],
  coverLocalPath: string,
): TemplateVars {
  const { year, season } = parseYearSeason(detail.date ?? '');

  // tags
  const tags: string[] = ['bangumi'];
  for (const t of (detail.tags ?? [])) {
    tags.push(`bgm/${String(t.name)}`);
  }
  const tagsYaml = tags.map(t => `  - ${t}`).join('\n');

const infoboxFrontmatter = infobox
  .filter(e => !FRONTMATTER_EXCLUDE.includes(e.key))
  .map(e => {
    const k = /[\s:#\[\]{}]/.test(e.key) ? `"${e.key}"` : e.key;
    return `${k}: ${yamlValue(e.value)}`;
  })
  .join('\n');

  // infobox 正文表格行
  const infoboxTableRows = infobox
    .map(e => `| ${e.key} | ${e.value.replace(/\|/g, '｜').replace(/\n/g, '<br>')} |`)
    .join('\n');

  // 分集 checkboxes
  const eps = parseInt(String(detail.eps ?? '0')) || 0;
  const epsCheckboxes = eps > 0
    ? Array.from({ length: eps }, (_, i) => {
        const n = i + 1;
        const num = n < 10 ? `0${n}` : `${n}`;
        return `- [ ] **EP ${num}** ｜ `;
      }).join('\n')
    : '- [ ] **EP 01** ｜ ';

  // 关联系列
  const seriesRelations = relations.filter(r =>
    r.relation === 'series' || r.relation === '系列'
  );
  const relatedSeries = seriesRelations.map((r: any) =>
    String(r.name_cn || r.name)
  ).join('、');
  const relatedSeriesLink = seriesRelations.map((r: any) =>
    `[[${String(r.name_cn || r.name)}]]`
  ).join('、');

  const summary = String(detail.summary ?? '');

  const netabaIframe = `<div style="width:100%;height:600px;border:1px solid #ddd;border-radius:5px;overflow:hidden;"><iframe src="https://netaba.re/subject/${String(detail.id)}" style="width:100%;height:600px;border:0;"></iframe></div>`;

  // 分类专属字段
  const author      = getInfoboxValue(infobox, ['作者', '原作', '著']);
  const publisher   = getInfoboxValue(infobox, ['出版社', '发行']);
  const volumes     = getInfoboxValue(infobox, ['册数', '卷数', '话数']);
  const developer   = getInfoboxValue(infobox, ['开发', '开发商', '开发者']);
  const platform    = getInfoboxValue(infobox, ['平台', '游戏平台', '运行平台']);
  const artist      = getInfoboxValue(infobox, ['艺术家', '演唱', '歌手', 'Artist']);
  const track_count = getInfoboxValue(infobox, ['曲目数', '曲数', 'Tracks']);

  return {
    title:               (String(detail.name_cn || detail.name)).replace(/[\\/:*?"<>|]/g, '_'),
    original_title:      String(detail.name ?? ''),
    cover_local:         coverLocalPath,
    adaptation:          detectAdaptation(infobox),
    eps_count:           String(detail.eps ?? ''),
    year,
    season,
    today:               getToday(),
    related_series:      relatedSeries,
    related_series_link: relatedSeriesLink,
    bangumi_url:         `https://bgm.tv/subject/${String(detail.id)}`,
    bangumi_id:          String(detail.id),
    score:               String(detail.rating?.score ?? ''),
    rank:                String(detail.rating?.rank ?? ''),
    summary,
    summary_raw:         summary,
    tags_yaml:           tagsYaml,
    infobox_frontmatter: infoboxFrontmatter,
    infobox_table_rows:  infoboxTableRows,
    eps_checkboxes:      epsCheckboxes,
    netaba_iframe:       netabaIframe,
    author,
    publisher,
    volumes,
    developer,
    platform,
    artist,
    track_count,
  };
}

export async function resolveTemplate(
  app: App,
  typeKey: SubjectTypeKey,
  settings: BangumiSettings
): Promise<string> {
  const config = settings.subjectTypes[typeKey];
  if (config.templateSource === 'file' && config.templateFile) {
    const file = app.vault.getAbstractFileByPath(config.templateFile);
    if (file instanceof TFile) {
      return await app.vault.read(file);
    }
  }
  return DEFAULT_TEMPLATES[typeKey];
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  let result = template;
  const keys = Object.keys(vars) as Array<keyof TemplateVars>;
  for (const key of keys) {
    const value = vars[key] ?? '';
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
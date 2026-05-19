import { App, TFile } from 'obsidian';
import { InfoboxEntry, getInfoboxValue } from './api';
import { DEFAULT_TEMPLATES } from './defaults';
import { SubjectTypeKey, BangumiSettings } from './types';

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
  my_status: string;
  my_rating: string;
  my_comment: string;
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
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildTemplateVars(
  detail: any,
  relations: any[],
  infobox: InfoboxEntry[],
  coverLocalPath: string,
  subjective?: { status: string; rating: string; comment: string }
): TemplateVars {
  const title = String(detail.name_cn || detail.name || '');
  const original_title = String(detail.name || '');

  let year = '';
  let season = '';
  const dateStr = detail.date || '';
  if (dateStr && dateStr.length >= 4) {
    year = dateStr.substring(0, 4);
    if (dateStr.length >= 7) {
      const m = parseInt(dateStr.substring(5, 7), 10);
      if (m >= 1 && m <= 3) season = '01月';
      else if (m >= 4 && m <= 6) season = '04月';
      else if (m >= 7 && m <= 9) season = '07月';
      else if (m >= 10 && m <= 12) season = '10月';
    }
  }

  const eps_count = String(detail.eps || detail.total_episodes || '0');

  let adaptation = '';
  const platformVal = getInfoboxValue(infobox, ['轻小说改编', '漫画改编', '游戏改编', '小说改编', '原创']);
  if (platformVal) {
    if (platformVal.includes('小说')) adaptation = '小说改编';
    else if (platformVal.includes('漫画')) adaptation = '漫画改编';
    else if (platformVal.includes('游戏')) adaptation = '游戏改编';
    else if (platformVal.includes('原创')) adaptation = '原创';
  }

  const relatedAnimes = (relations || [])
    .filter(r => r.type === 2)
    .map(r => String(r.name_cn || r.name))
    .filter(Boolean);
  const relatedSeries = relatedAnimes.slice(0, 3).join('、');
  const relatedSeriesLink = relatedAnimes.map(name => `[[${name}]]`).slice(0, 3).join('、');

  const summary = String(detail.summary || '').replace(/\r?\n/g, ' ').trim();

  const tags = (detail.tags || []).map((t: any) => String(t.name)).slice(0, 8);
  const tagsYaml = tags.length > 0 ? tags.map((t: string) => `  - ${t}`).join('\n') : '';

  let infoboxFrontmatter = '';
  let infoboxTableRows = '';
  infobox.forEach(item => {
    const safeKey = item.key.replace(/[:\s]/g, '_');
    if (!FRONTMATTER_EXCLUDE.includes(item.key) && item.value) {
      infoboxFrontmatter += `${safeKey}: "${item.value.replace(/"/g, '\\"')}"\n`;
    }
    if (item.value) {
      infoboxTableRows += `| ${item.key} | ${item.value} |\n`;
    }
  });

  let epsCheckboxes = '';
  const totalEps = parseInt(eps_count, 10);
  if (!isNaN(totalEps) && totalEps > 0) {
    for (let i = 1; i <= totalEps; i++) {
      epsCheckboxes += `- [ ] 第 ${String(i).padStart(2, '0')} 话\n`;
    }
  } else {
    epsCheckboxes = '- [ ] 第 01 话\n';
  }

  const netabaIframe = `<iframe src="https://netaba.re/subject/${String(detail.id)}" width="100%" height="450" frameborder="0" allowtransparency="true"></iframe>`;

  const author = getInfoboxValue(infobox, ['作者', '原著']);
  const publisher = getInfoboxValue(infobox, ['出版社']);
  const volumes = getInfoboxValue(infobox, ['册数', '卷数']);
  const developer = getInfoboxValue(infobox, ['开发', '制作公司', '游戏制作']);
  const platform = getInfoboxValue(infobox, ['平台']);
  const artist = getInfoboxValue(infobox, ['艺术家', '歌手', '演值']);
  const track_count = getInfoboxValue(infobox, ['播放时长', '曲目数']);

  return {
    title,
    original_title,
    cover_local: coverLocalPath,
    adaptation,
    eps_count,
    year,
    season,
    today: getToday(),
    related_series: relatedSeries,
    related_series_link: relatedSeriesLink,
    bangumi_url: `https://bgm.tv/subject/${String(detail.id)}`,
    bangumi_id: String(detail.id),
    score: String(detail.rating?.score || ''),
    rank: String(detail.rating?.rank || ''),
    summary,
    summary_raw: String(detail.summary || ''),
    tags_yaml: tagsYaml,
    infobox_frontmatter: infoboxFrontmatter.trim(),
    infobox_table_rows: infoboxTableRows.trim(),
    eps_checkboxes: epsCheckboxes.trim(),
    netaba_iframe: netabaIframe,
    my_status: subjective?.status || '',
    my_rating: subjective?.rating || '',
    my_comment: subjective?.comment || '',
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
  let output = template;
  (Object.keys(vars) as Array<keyof TemplateVars>).forEach(k => {
    const regex = new RegExp(`\\{\\{${k}\\}\\}`, 'g');
    output = output.replace(regex, vars[k] || '');
  });
  return output;
}

export function resolveArchivePath(
  root: string,
  mode: string,
  year: string,
  season: string
): string {
  if (!root) return '';
  if (mode === 'season' && year && season) return `${root}/${year}/${season}新番`;
  if (mode === 'year' && year) return `${root}/${year}`;
  return root;
}
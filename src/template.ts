import { App, TFile } from 'obsidian';
import { InfoboxEntry, getInfoboxValue } from './api';
import { DEFAULT_TEMPLATES } from './defaults';
import {
  SubjectTypeKey, BangumiSettings,
  BookSubtype, BOOK_SUBTYPE_DIR, GamePlatform,
  AnimeSubjective, BookSubjective, GameSubjective,
  MusicSubjective, RealSubjective, Subjective,
} from './types';
import { LIGHTNOVEL_SERIES_KEYWORDS } from './constants';

// frontmatter 展开时排除的 key（和固定字段重复或会破坏结构）
const FM_EXCLUDE = new Set([
  'tags', 'Tags', '标签', 'tag',
  '中文名', '日文名', '别名',
]);

// ── 日期 ────────────────────────────────────────────────────────

export function getToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYearSeason(dateStr: string): { year: string; season: string } {
  if (!dateStr || dateStr.length < 4) return { year: '未知年份', season: '未知季度' };
  const year = dateStr.substring(0, 4);
  if (dateStr.length < 7) return { year, season: '未知季度' };
  const m = parseInt(dateStr.substring(5, 7), 10);
  let season = '未知季度';
  if (m >= 1  && m <= 3)  season = '01月';
  else if (m >= 4  && m <= 6)  season = '04月';
  else if (m >= 7  && m <= 9)  season = '07月';
  else if (m >= 10 && m <= 12) season = '10月';
  return { year, season };
}

// ── 归档路径 ────────────────────────────────────────────────────

export function resolveArchivePath(
  root: string,
  mode: string,
  year: string,
  season: string
): string {
  if (mode === 'season') return `${root}/${year}/${season}新番`;
  if (mode === 'year')   return `${root}/${year}`;
  return root;
}

// 书籍归档路径：root/漫画 or root/轻小说 or root/小说
export function resolveBookArchivePath(root: string, subtype: BookSubtype): string {
  return `${root}/${BOOK_SUBTYPE_DIR[subtype]}`;
}

// 游戏归档路径：root/Steam etc.
export function resolveGameArchivePath(root: string, platform: GamePlatform): string {
  return `${root}/${platform}`;
}

// ── 书籍类型自动判断 ────────────────────────────────────────────

export function detectBookSubtype(
  platform: string,
  infobox: InfoboxEntry[]
): BookSubtype {
  // 1. API 直接返回 platform 字段
  if (platform === '漫画') return 'manga';

  // 2. 从书系判断轻小说
  const series = getInfoboxValue(infobox, ['书系', '文库', 'レーベル']);
  if (series) {
    for (const kw of LIGHTNOVEL_SERIES_KEYWORDS) {
      if (series.includes(kw)) return 'lightnovel';
    }
  }

  // 3. 默认小说
  return 'novel';
}

// ── 改编类型判断 ────────────────────────────────────────────────

export function detectAdaptation(infobox: InfoboxEntry[]): string {
  const source = getInfoboxValue(infobox, ['原作', '原案']);
  if (!source) return '';
  const s = source.toLowerCase();
  if (s.includes('漫画') || s.includes('manga'))   return '漫画改编';
  if (s.includes('小说') || s.includes('novel') ||
      s.includes('轻小说'))                          return '小说改编';
  if (s.includes('游戏') || s.includes('game'))     return '游戏改编';
  if (s.includes('原创') || source === '-')         return '原创';
  return '';
}

// ── 模板变量接口 ────────────────────────────────────────────────

export interface TemplateVars {
  // 通用
  title:                string;
  original_title:       string;
  cover_local:          string;
  today:                string;
  score:                string;
  rank:                 string;
  bangumi_url:          string;
  bangumi_id:           string;
  summary:              string;
  tags_yaml:            string;
  infobox_table_rows:   string;
  related_series:       string;
  related_series_link:  string;
  sequel:               string;
  sequel_link:          string;
  prequel:              string;
  prequel_link:         string;
  netaba_iframe:        string;
  my_status:            string;
  my_rating:            string;
  my_comment:           string;
  // 动画 / 三次元
  adaptation:           string;
  eps_count:            string;
  year:                 string;
  season:               string;
  eps_checkboxes:       string;
  my_progress:          string;   // 已观看集数
  my_source:            string;   // 观看网址
  // 书籍
  author:               string;
  publisher:            string;
  volumes:              string;
  isbn:                 string;
  my_channel:           string;   // 阅读渠道
  my_version:           string;   // 翻译版本
  my_read_progress:     string;   // 第X卷 | 第XXX话
  // 游戏
  developer:            string;
  platform:             string;
  my_platform:          string;   // 游玩平台
  my_hours:             string;   // 游玩时长
  my_game_progress:     string;   // 当前进度
  // 音乐
  artist:               string;
  track_count:          string;
  my_music_source:      string;   // 收听平台
}

// ── 构建模板变量 ────────────────────────────────────────────────

export function buildTemplateVars(
  detail: any,
  relations: any[],
  infobox: InfoboxEntry[],
  coverLocal: string,
  subjective: Subjective,
  typeKey: SubjectTypeKey,
): TemplateVars {
  const { year, season } = parseYearSeason(String(detail.date ?? ''));

  // tags
  const bgmTags = ((detail.tags ?? []) as any[])
    .map((t: any) => String(t.name))
    .filter(Boolean);
  const tagsYaml = ['bangumi', ...bgmTags.map(t => `bgm/${t}`)]
    .map(t => `  - ${t}`)
    .join('\n');

  // infobox 正文表格行
  const infoboxTableRows = infobox
    .map(e => `| ${e.key} | ${e.value.replace(/\|/g, '｜')} |`)
    .join('\n');

  // 关联条目（直接相关系列，排除联动/片头曲等杂项）
  const SERIES_RELATIONS = new Set(['续集', '前传', '系列', '衍生', '番外篇']);
  const seriesItems = relations.filter(r => SERIES_RELATIONS.has(r.relation) && r.type === 2);
  const relatedSeries     = seriesItems.map(r => String(r.name_cn || r.name)).join('、');
  const relatedSeriesLink = seriesItems.map(r => `[[${String(r.name_cn || r.name)}]]`).join('、');

  // 续集/前传
  const sequelItem  = relations.find(r => r.relation === '续集');
  const prequelItem = relations.find(r => r.relation === '前传');
  const sequel      = sequelItem  ? String(sequelItem.name_cn  || sequelItem.name)  : '';
  const prequel     = prequelItem ? String(prequelItem.name_cn || prequelItem.name) : '';

  // 分集 checkboxes
  const eps = parseInt(String(detail.eps ?? '0')) || 0;
  const epsCheckboxes = eps > 0
    ? Array.from({ length: eps }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return `- [ ] **EP ${n}** ｜ `;
      }).join('\n')
    : '- [ ] **EP 01** ｜ ';

  // Netaba iframe
  const netabaIframe = `<div style="width:100%;height:600px;border:1px solid #ddd;border-radius:5px;overflow:hidden;"><iframe src="https://netaba.re/subject/${String(detail.id)}" style="width:100%;height:600px;border:0;"></iframe></div>`;

  // 专属字段提取
  const author      = getInfoboxValue(infobox, ['作者', '原作', '著']);
  const publisher   = getInfoboxValue(infobox, ['出版社', '发行']);
  const volumes     = getInfoboxValue(infobox, ['册数', '卷数']);
  const isbn        = getInfoboxValue(infobox, ['ISBN']);
  const developer   = getInfoboxValue(infobox, ['开发', '开发商']);
  const platform    = getInfoboxValue(infobox, ['平台', '游戏平台', '运行平台']);
  const artist      = getInfoboxValue(infobox, ['艺术家', '演唱', '歌手']);
  const trackCount  = getInfoboxValue(infobox, ['曲目数', '曲数']);

  // 主观字段解构
  const s = subjective as any;

  // 书籍进度格式化
  let myReadProgress = '';
  if (typeKey === 'book' && s.volNum !== undefined) {
    const vol  = String(s.volNum  || '0').padStart(2, '0');
    const unit = String(s.unitNum || '0').padStart(3, '0');
    const unitLabel = (detail.platform === '漫画') ? '话' : '章';
    myReadProgress = `第 ${vol} 卷 ｜ 第 ${unit} ${unitLabel}`;
  }

  return {
    title:               String(detail.name_cn || detail.name || '').replace(/[\\/:*?"<>|]/g, '_'),
    original_title:      String(detail.name ?? ''),
    cover_local:         coverLocal,
    today:               getToday(),
    score:               String(detail.rating?.score ?? ''),
    rank:                String(detail.rating?.rank  ?? ''),
    bangumi_url:         `https://bgm.tv/subject/${String(detail.id)}`,
    bangumi_id:          String(detail.id),
    summary:             String(detail.summary ?? ''),
    tags_yaml:           tagsYaml,
    infobox_table_rows:  infoboxTableRows,
    related_series:      relatedSeries,
    related_series_link: relatedSeriesLink,
    sequel,
    sequel_link:         sequel  ? `[[${sequel}]]`  : '',
    prequel,
    prequel_link:        prequel ? `[[${prequel}]]` : '',
    netaba_iframe:       netabaIframe,
    my_status:           String(s.status  ?? ''),
    my_rating:           String(s.rating  ?? ''),
    my_comment:          String(s.comment ?? ''),
    // 动画/三次元
    adaptation:          detectAdaptation(infobox),
    eps_count:           String(detail.eps ?? ''),
    year,
    season,
    eps_checkboxes:      epsCheckboxes,
    my_progress:         String(s.progress ?? ''),
    my_source:           String(s.source   ?? ''),
    // 书籍
    author, publisher, volumes, isbn,
    my_channel:          String(s.channel  ?? ''),
    my_version:          String(s.version  ?? ''),
    my_read_progress:    myReadProgress,
    // 游戏
    developer, platform,
    my_platform:         String(s.platform ?? ''),
    my_hours:            String(s.hours    ?? ''),
    my_game_progress:    String(s.progress ?? ''),
    // 音乐
    artist,
    track_count:         trackCount || String(detail.total_episodes ?? ''),
    my_music_source:     String(s.source   ?? ''),
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
    if (file instanceof TFile) return await app.vault.read(file);
  }
  return DEFAULT_TEMPLATES[typeKey];
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  let out = template;
  for (const key of Object.keys(vars) as Array<keyof TemplateVars>) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), vars[key] ?? '');
  }
  return out;
}
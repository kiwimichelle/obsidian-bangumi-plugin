import type { CastCredit, EpisodeData, InfoboxEntry, PersonCredit, SubjectRelation } from '../types';
import { EPISODE_TYPE_LABEL } from '../core/EpisodeindexBuilder';

const INFOBOX_SKIP_KEYS = new Set([
  '中文名', '日文名', '英文名',
  '导演', '监督', '总导演', '脚本', '系列构成', '分镜', '演出',
  '人物设计', '角色设计', '人物原案',
  '总作画监督', '作画监督', '动作作画监督',
  '音乐', '音乐制作', '音乐制作人', '音响监督', '音响制作',
  '摄影监督', '摄影', '美术监督', '美术设计', '美术',
  '色彩设计', '色彩指定', '机械设计',
  '原画', '第二原画',
  '制片人', '总制片人', '动画制片人', 'プロデューサー',
  '声优', '配音', '副导演', 'CG 导演',
  '企划', '企画', '企画协力',
  '制作统括', '制作管理', '制作进行', '制作进行协力',
  '助理制片人', '设定制作', '道具设计', '背景美术',
  '动画检查', '补间动画', '剪辑', '特效', '录音助理', '音效',
  '监制', '协力', '主题歌演出', 'OP・ED 分镜', '製作',
]);

const MAIN_STAFF_POSITION_IDS = new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]);
const CAST_POSITION_ID = 1002;

export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
  }
  // 清理表格中值为空的行（两列格式：| 键 |  |）
  result = result.replace(/^\|[^|\n]+\|\s*\|\s*$/gm, '');
  // 修复表格空行：表格行之间的空行会导致 Markdown 表格断裂。
  // 清理两个相邻表格行之间的空行（空行被行清理产生的情况）
  result = result.replace(/(^\|[^\n]*\|$)\n\n(^\|)/gm, '$1\n$2');
  // 清理连续空行（3 个以上缩减为 1 个）
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

export function buildTagsYaml(tags: string[]): string {
  return ['bangumi', ...tags.map(t => `bgm/${t}`)].map(t => `  - ${t}`).join('\n');
}

export function buildInfoboxTableRows(infobox: InfoboxEntry[]): string {
  return infobox
    .filter(e => !INFOBOX_SKIP_KEYS.has(e.key))
    .filter(e => e.value.trim())
    .map(e => `| ${e.key} | ${e.value.replace(/\|/g, '｜').replace(/\n/g, ' ')} |`)
    .join('\n');
}

export function buildInfoboxFrontmatter(infobox: InfoboxEntry[]): string {
  return infobox
    .filter(e => !INFOBOX_SKIP_KEYS.has(e.key))
    .filter(e => e.value.trim())
    .map(e => `${e.key}: ${yamlValue(e.value)}`)
    .join('\n');
}

export function buildEpsCheckboxes(eps: number, episodes?: EpisodeData[]): string {
  if (episodes && episodes.length > 0) {
    return episodes.map(ep => {
      const typeLabel = EPISODE_TYPE_LABEL[ep.type] ?? 'EP';
      const sortStr   = ep.sort % 1 === 0 ? String(ep.sort).padStart(2, '0') : ep.sort.toFixed(1);
      const epName    = ep.nameCn || ep.name;
      const namePart  = epName ? ` 「${epName}」` : '';
      const datePart  = ep.airdate ? ` ${ep.airdate}` : '';
      return `- [ ] **${typeLabel} ${sortStr}**${namePart}${datePart} ｜ `;
    }).join('\n');
  }
  const count = eps > 0 ? eps : 1;
  return Array.from({ length: count }, (_, i) =>
    `- [ ] **EP ${String(i + 1).padStart(2, '0')}** ｜ `
  ).join('\n');
}

export function buildCreditsMain(credits: PersonCredit[]): string {
  const main = credits.filter(c => MAIN_STAFF_POSITION_IDS.has(c.positionId));
  if (main.length === 0) return '';
  return buildCreditsTableRows(main);
}

/**
 * 声优表格行
 *
 * 修复：优先使用在线 CastCredit[]（含角色名），每行格式 "| 角色 | 声优 |"。
 * 回退到离线人员索引（positionId=1002），角色名用"—"占位。
 * 模板表头已同步改为 "| 角色 | 声优 |"。
 */
export function buildCreditsCast(
  castCredits:   CastCredit[]   = [],
  personCredits: PersonCredit[] = [],
): string {
  if (castCredits.length > 0) {
    return castCredits.map(c => {
      const actor = (c.actorName || c.actorOriginal).replace(/\|/g, '｜');
      const char  = (c.characterName || '—').replace(/\|/g, '｜');
      return `| ${char} | ${actor} |`;
    }).join('\n');
  }

  const cast = personCredits.filter(c => c.positionId === CAST_POSITION_ID);
  if (cast.length === 0) return '';
  return cast.map(c => {
    const name = c.name && c.nameOriginal && c.name !== c.nameOriginal
      ? `${c.name}（${c.nameOriginal}）`
      : c.name || c.nameOriginal;
    return `| — | ${name.replace(/\|/g, '｜')} |`;
  }).join('\n');
}

export function buildCreditsTableRows(credits: PersonCredit[]): string {
  if (credits.length === 0) return '';
  const grouped = new Map<string, string[]>();
  for (const c of credits) {
    let names = grouped.get(c.positionLabel);
    if (!names) { names = []; grouped.set(c.positionLabel, names); }
    const displayName = c.name && c.nameOriginal && c.name !== c.nameOriginal
      ? `${c.name}（${c.nameOriginal}）` : c.name || c.nameOriginal;
    if (displayName) names.push(displayName);
  }
  return [...grouped.entries()]
    .map(([pos, names]) => `| ${pos} | ${names.join('、').replace(/\|/g, '｜')} |`)
    .join('\n');
}

export function buildCreditsFrontmatter(credits: PersonCredit[]): string {
  if (credits.length === 0) return '';
  const grouped = new Map<string, string[]>();
  for (const c of credits) {
    let names = grouped.get(c.positionLabel);
    if (!names) { names = []; grouped.set(c.positionLabel, names); }
    const n = c.name || c.nameOriginal;
    if (n) names.push(n);
  }
  return [...grouped.entries()]
    .map(([pos, names]) => `${pos}: ${yamlValue(names.join('、'))}`)
    .join('\n');
}

export function buildNetabaIframe(id: number): string {
  return `<div style="width:100%;height:600px;border:1px solid #ddd;border-radius:5px;overflow:hidden;"><iframe src="https://netaba.re/subject/${id}" style="width:100%;height:600px;border:0;"></iframe></div>`;
}

export function buildRelationNames(relations: SubjectRelation[], relationType: string): string {
  return relations.filter(r => r.relation === relationType).map(r => r.name).join('、');
}

export function buildRelationLinks(relations: SubjectRelation[], relationType: string): string {
  return relations.filter(r => r.relation === relationType).map(r => `[[${r.name}]]`).join('、');
}

export function yamlValue(val: string): string {
  if (/[:#\[\]{},&*?|<>=!%@`]/.test(val) || val.includes('\n')) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

export const TEMPLATE_PLACEHOLDER_DOCS: Record<string, string> = {
  title: '条目中文名', original_title: '条目原文名',
  cover_local: '封面本地路径', bangumi_id: 'Bangumi ID', bangumi_url: 'Bangumi 链接',
  score: '评分', rank: '排名', summary: '简介', today: '写入日期',
  year: '开播年份', season: '开播季度', eps_count: '集数',
  tags_yaml: '标签 YAML', infobox_table_rows: 'infobox 表格行',
  infobox_frontmatter: 'infobox frontmatter', eps_checkboxes: '集数 checkbox',
  netaba_iframe: 'Netaba.re iframe', series_section: '系列关联章节（自动）',
  credits_main: '主创人员表格', credits_cast: '声优表格（在线含角色名）',
  credits_frontmatter: '制作人员 frontmatter',
  my_status: '状态', my_rating: '评分', my_comment: '点评',
  my_progress: '进度', my_source: '来源', my_channel: '渠道',
  my_version: '版本', my_read_progress: '阅读进度',
  my_hours: '时长', my_platform: '平台', my_game_progress: '游戏进度',
  my_music_source: '音乐来源',
};

export function buildPreviewVars(): Record<string, string> {
  return {
    title: '魔法少女小圆', original_title: '魔法少女まどか☆マギカ',
    cover_local: 'https://lain.bgm.tv/pic/cover/l/sample.jpg',
    bangumi_id: '103047', bangumi_url: 'https://bgm.tv/subject/103047',
    score: '9.3', rank: '18',
    summary: '平凡的初中生鹿目圆与好友遭遇了一只自称 QB 的白色生物……',
    today: new Date().toISOString().split('T')[0] ?? '',
    year: '2011', season: '01月', eps_count: '12',
    tags_yaml: '  - bangumi\n  - bgm/魔法少女\n  - bgm/SHAFT',
    infobox_table_rows: '| 话数 | 12 |\n| 片长 | 24分钟 |',
    infobox_frontmatter: '话数: 12\n片长: 24分钟',
    eps_checkboxes:
      '- [ ] **EP 01** 「夢の中で逢った、ような…」2011-01-07 ｜ \n' +
      '- [ ] **EP 02** 「それはとても嬉しいなって」2011-01-14 ｜ ',
    netaba_iframe: '<div style="..."><iframe src="https://netaba.re/subject/103047"></iframe></div>',
    series_section: '## 系列关联\n| 类型 | 条目 |\n|:--|:--|\n| 续集 | [[叛逆的物语]] |',
    credits_main: '| 导演 | 新房昭之 |\n| 系列构成 | 虚渊玄 |',
    credits_cast: '| 鹿目まどか | 悠木碧 |\n| 暁美ほむら | 斎藤千和 |',
    credits_frontmatter: '导演: 新房昭之',
    my_status: '看过', my_rating: '10', my_comment: '神作',
    my_progress: '12', my_source: 'https://www.bilibili.com/...',
    my_channel: '电子书', my_version: '完全版', my_read_progress: '第3卷 / 第12话',
    my_hours: '40', my_platform: 'PC', my_game_progress: '通关',
    my_music_source: 'Spotify',
  };
}
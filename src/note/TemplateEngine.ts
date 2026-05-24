import type { EpisodeData, InfoboxEntry, PersonCredit, SubjectRelation } from '../types';
import { EPISODE_TYPE_LABEL } from '../core/EpisodeindexBuilder';

// ─────────────────────────────────────────────
// infobox 过滤键集合
// ─────────────────────────────────────────────

/**
 * 在 infobox 表格/frontmatter 中跳过的键：
 * - 已由固定槽位单独处理（中文名、日文名）
 * - 属于人员类，交给 credits 槽位处理
 */
const INFOBOX_SKIP_KEYS = new Set([
  '中文名', '日文名', '英文名',
  '导演', '监督', '总导演',
  '脚本', '系列构成',
  '分镜', '演出',
  '人物设计', '角色设计', '人物原案',
  '总作画监督', '作画监督', '动作作画监督',
  '音乐', '音乐制作', '音乐制作人',
  '音响监督', '音响制作',
  '摄影监督', '摄影',
  '美术监督', '美术设计', '美术',
  '色彩设计', '色彩指定',
  '机械设计',
  '原画', '第二原画',
  '制片人', '总制片人', '动画制片人', 'プロデューサー',
  '声优', '配音',
  '副导演', 'CG 导演',
  '企划', '企画', '企画协力',
  '制作统括', '制作管理', '制作进行', '制作进行协力',
  '助理制片人',
  '设定制作',
  '道具设计',
  '背景美术',
  '动画检查',
  '补间动画',
  '剪辑',
  '特效',
  '录音助理',
  '音效',
  '监制',
  '协力',
  '主题歌演出',
  'OP・ED 分镜',
  '製作',
]);

// ─────────────────────────────────────────────
// 制作人员职位分类
// ─────────────────────────────────────────────

/**
 * 主创职位 ID 集合（position_id 1-18）
 * 声优 ID 为 1002，单独归入 cast
 */
const MAIN_STAFF_POSITION_IDS = new Set([
  1,  // 导演
  2,  // 脚本
  3,  // 分镜
  4,  // 演出
  5,  // 音乐
  6,  // 人物设计
  7,  // 系列构成
  8,  // 美术监督
  9,  // 色彩设计
  10, // 总作画监督
  11, // 作画监督
  12, // 机械设计
  13, // 音响监督
  14, // 摄影监督
  15, // 原画
  16, // 制片人
  17, // 动画制作
  18, // 制作公司
]);

const CAST_POSITION_ID = 1002; // 声优

// ─────────────────────────────────────────────
// 核心渲染
// ─────────────────────────────────────────────

/** 将模板字符串中所有 {{key}} 替换为 vars[key] */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
  }
  // 清理表格中值为空的行：| 任意内容 |  |
  result = result.replace(/^\|[^|\n]+\|\s*\|\s*$/gm, '');
  // 清理因此产生的连续空行（最多保留一个）
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

// ─────────────────────────────────────────────
// infobox 槽位
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// 分集 checkbox 槽位
// ─────────────────────────────────────────────

/**
 * 生成分集进度 checkbox 列表。
 * 有离线分集数据时生成富文本格式，否则退化为纯序号。
 */
export function buildEpsCheckboxes(eps: number, episodes?: EpisodeData[]): string {
  if (episodes && episodes.length > 0) {
    return episodes.map(ep => {
      const typeLabel = EPISODE_TYPE_LABEL[ep.type] ?? 'EP';
      const sortStr   = ep.sort % 1 === 0
        ? String(ep.sort).padStart(2, '0')
        : ep.sort.toFixed(1);
      const prefix    = `- [ ] **${typeLabel} ${sortStr}**`;
      const epName    = ep.nameCn || ep.name;
      const namePart  = epName ? ` 「${epName}」` : '';
      const datePart  = ep.airdate ? ` ${ep.airdate}` : '';
      return `${prefix}${namePart}${datePart} ｜ `;
    }).join('\n');
  }

  const count = eps > 0 ? eps : 1;
  return Array.from({ length: count }, (_, i) =>
    `- [ ] **EP ${String(i + 1).padStart(2, '0')}** ｜ `
  ).join('\n');
}

// ─────────────────────────────────────────────
// 制作人员槽位
// ─────────────────────────────────────────────

/**
 * 主创人员表格行（导演、脚本、作画监督等，排除声优）
 *
 * 输出格式：
 * | 导演 | 新房昭之 |
 * | 系列构成 | 虚渊玄 |
 */
export function buildCreditsMain(credits: PersonCredit[]): string {
  const main = credits.filter(c => MAIN_STAFF_POSITION_IDS.has(c.positionId));
  if (main.length === 0) return '';
  return buildCreditsTableRows(main);
}

/**
 * 声优表格行
 *
 * 当前阶段无角色名数据，退化为：
 * | 声优 | 种田梨沙、市ノ瀬加那、... |
 */
export function buildCreditsCast(credits: PersonCredit[]): string {
  const cast = credits.filter(c => c.positionId === CAST_POSITION_ID);
  if (cast.length === 0) return '';

  const names = cast.map(c => {
    const displayName = c.name && c.nameOriginal && c.name !== c.nameOriginal
      ? `${c.name}（${c.nameOriginal}）`
      : c.name || c.nameOriginal;
    return displayName;
  }).filter(Boolean);

  return `| 声优 | ${names.join('、').replace(/\|/g, '｜')} |`;
}

/**
 * 完整制作人员表格行（主创 + 声优合并，供旧模板兼容使用）
 */
export function buildCreditsTableRows(credits: PersonCredit[]): string {
  if (credits.length === 0) return '';

  const grouped = new Map<string, string[]>();
  for (const c of credits) {
    let names = grouped.get(c.positionLabel);
    if (!names) {
      names = [];
      grouped.set(c.positionLabel, names);
    }
    const displayName = c.name && c.nameOriginal && c.name !== c.nameOriginal
      ? `${c.name}（${c.nameOriginal}）`
      : c.name || c.nameOriginal;
    if (displayName) names.push(displayName);
  }

  return [...grouped.entries()]
    .map(([position, names]) =>
      `| ${position} | ${names.join('、').replace(/\|/g, '｜')} |`
    )
    .join('\n');
}

/**
 * 制作人员 frontmatter 格式
 */
export function buildCreditsFrontmatter(credits: PersonCredit[]): string {
  if (credits.length === 0) return '';

  const grouped = new Map<string, string[]>();
  for (const c of credits) {
    let names = grouped.get(c.positionLabel);
    if (!names) { names = []; grouped.set(c.positionLabel, names); }
    const displayName = c.name || c.nameOriginal;
    if (displayName) names.push(displayName);
  }

  return [...grouped.entries()]
    .map(([position, names]) => `${position}: ${yamlValue(names.join('、'))}`)
    .join('\n');
}

// ─────────────────────────────────────────────
// 其他工具槽位
// ─────────────────────────────────────────────

export function buildNetabaIframe(id: number): string {
  return (
    `<div style="width:100%;height:600px;border:1px solid #ddd;border-radius:5px;overflow:hidden;">` +
    `<iframe src="https://netaba.re/subject/${id}" style="width:100%;height:600px;border:0;"></iframe>` +
    `</div>`
  );
}

export function buildRelationNames(relations: SubjectRelation[], relationType: string): string {
  return relations
    .filter(r => r.relation === relationType)
    .map(r => r.name)
    .join('、');
}

export function buildRelationLinks(relations: SubjectRelation[], relationType: string): string {
  return relations
    .filter(r => r.relation === relationType)
    .map(r => `[[${r.name}]]`)
    .join('、');
}

export function yamlValue(val: string): string {
  if (/[:#\[\]{},&*?|<>=!%@`]/.test(val) || val.includes('\n')) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

// ─────────────────────────────────────────────
// 占位符文档与预览
// ─────────────────────────────────────────────

export const TEMPLATE_PLACEHOLDER_DOCS: Record<string, string> = {
  title:               '条目中文名',
  original_title:      '条目原文名',
  cover_local:         '封面本地路径（未下载时为远程 URL）',
  bangumi_id:          'Bangumi 条目 ID',
  bangumi_url:         'Bangumi 页面链接',
  score:               '评分（0 时留空）',
  rank:                '排名（0 时留空）',
  summary:             '简介',
  today:               '写入日期（YYYY-MM-DD）',
  year:                '开播年份',
  season:              '开播季度（01月 / 04月 / 07月 / 10月）',
  eps_count:           '集数（0 时留空）',
  tags_yaml:           '标签 YAML 列表行',
  infobox_table_rows:  'infobox 元数据表格行（已过滤人员类字段）',
  infobox_frontmatter: 'infobox 元数据 frontmatter 格式',
  eps_checkboxes:      '集数进度复选框列表（有离线分集数据时含集名和播出日期）',
  netaba_iframe:       'Netaba.re 嵌入 iframe（anime 专用）',
  related_series:      '系列关联条目名（顿号分隔）',
  related_series_link: '系列关联 wiki 链接',
  sequel_link:         '续集 wiki 链接',
  prequel_link:        '前传 wiki 链接',
  adaptation:          '改编类型（anime 专用）',
  artist:              '艺术家（music 专用）',
  track_count:         '曲目数（music 专用）',
  credits_main:        '主创人员表格行（导演/脚本/作画等，需离线人员数据）',
  credits_cast:        '声优表格行（需离线人员数据）',
  credits_frontmatter: '制作人员 frontmatter 格式（需离线人员数据）',
  my_status:           '我的状态',
  my_rating:           '我的评分',
  my_comment:          '我的点评',
  my_progress:         '观看进度',
  my_source:           '来源',
  my_channel:          '渠道（book 专用）',
  my_version:          '版本（book 专用）',
  my_read_progress:    '阅读进度（book 专用）',
  my_hours:            '游玩时长（game 专用）',
  my_platform:         '游玩平台（game 专用）',
  my_game_progress:    '游戏进度（game 专用）',
  my_music_source:     '音乐来源（music 专用）',
};

export function buildPreviewVars(): Record<string, string> {
  return {
    title:               '魔法少女小圆',
    original_title:      '魔法少女まどか☆マギカ',
    cover_local:         'https://lain.bgm.tv/pic/cover/l/sample.jpg',
    bangumi_id:          '103047',
    bangumi_url:         'https://bgm.tv/subject/103047',
    score:               '9.3',
    rank:                '18',
    summary:             '平凡的初中生鹿目圆与好友遭遇了一只自称 QB 的白色生物……',
    today:               new Date().toISOString().split('T')[0] ?? '',
    year:                '2011',
    season:              '01月',
    eps_count:           '12',
    tags_yaml:           '  - bangumi\n  - bgm/魔法少女\n  - bgm/SHAFT',
    infobox_table_rows:
      '| 话数 | 12 |\n| 片长 | 24分钟 |\n| 官方网站 | http://www.madoka-magica.com |',
    infobox_frontmatter: '话数: 12\n片长: 24分钟',
    eps_checkboxes:
      '- [ ] **EP 01** 「夢の中で逢った、ような…」2011-01-07 ｜ \n' +
      '- [ ] **EP 02** 「それはとても嬉しいなって」2011-01-14 ｜ \n' +
      '- [ ] **EP 03** 「もう何も恐くない」2011-01-21 ｜ ',
    netaba_iframe:       '<div style="..."><iframe src="https://netaba.re/subject/103047"></iframe></div>',
    related_series:      '叛逆的物语',
    related_series_link: '[[叛逆的物语]]',
    sequel_link:         '[[叛逆的物语]]',
    prequel_link:        '',
    adaptation:          '原创',
    artist:              'ClariS',
    track_count:         '12',
    credits_main:
      '| 导演 | 新房昭之 |\n| 系列构成 | 虚渊玄 |\n| 人物设计 | 蒼樹うめ |\n| 音乐 | 梶浦由記 |',
    credits_cast:
      '| 声优 | 悠木碧（鹿目まどか）、斎藤千和（暁美ほむら）、水树奈奈（美树さやか） |',
    credits_frontmatter: '导演: 新房昭之\n系列构成: 虚渊玄',
    my_status:           '看过',
    my_rating:           '10',
    my_comment:          '神作',
    my_progress:         '第12集',
    my_source:           'https://www.bilibili.com/...',
    my_channel:          '电子书',
    my_version:          '完全版',
    my_read_progress:    '第3卷 / 第12话',
    my_hours:            '40',
    my_platform:         'PC',
    my_game_progress:    '通关',
    my_music_source:     'Spotify',
  };
}
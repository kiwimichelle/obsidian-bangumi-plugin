import type { InfoboxEntry, SubjectRelation } from '../types';

// ─────────────────────────────────────────────
// 核心渲染
// ─────────────────────────────────────────────

/** 将模板字符串中所有 {{key}} 替换为 vars[key] */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
  }
  return result;
}

// ─────────────────────────────────────────────
// 槽位构建函数
// ─────────────────────────────────────────────

export function buildTagsYaml(tags: string[]): string {
  return ['bangumi', ...tags.map(t => `bgm/${t}`)].map(t => `  - ${t}`).join('\n');
}

export function buildInfoboxTableRows(infobox: InfoboxEntry[]): string {
  return infobox
    .map(e => `| ${e.key} | ${e.value.replace(/\|/g, '｜').replace(/\n/g, ' ')} |`)
    .join('\n');
}

export function buildInfoboxFrontmatter(infobox: InfoboxEntry[]): string {
  return infobox.map(e => `${e.key}: ${yamlValue(e.value)}`).join('\n');
}

export function buildEpsCheckboxes(eps: number): string {
  const count = eps > 0 ? eps : 1;
  return Array.from({ length: count }, (_, i) =>
    `- [ ] **EP ${String(i + 1).padStart(2, '0')}** ｜ `
  ).join('\n');
}

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

/** YAML 值转义：含特殊字符或换行时用双引号包裹 */
export function yamlValue(val: string): string {
  if (/[:#\[\]{},&*?|<>=!%@`]/.test(val) || val.includes('\n')) {
    return `"${val.replace(/"/g, '\\"')}"`;
  }
  return val;
}

// ─────────────────────────────────────────────
// 占位符文档（供 SettingTab 模板预览使用）
// ─────────────────────────────────────────────

/** 所有可用模板占位符及其说明 */
export const TEMPLATE_PLACEHOLDER_DOCS: Record<string, string> = {
  title:               '条目中文名',
  original_title:      '条目原文名',
  cover_local:         '封面本地路径（未下载时为远程 URL）',
  bangumi_id:          'Bangumi 条目 ID',
  bangumi_url:         'Bangumi 页面链接',
  score:               '评分（0 时留空）',
  rank:                '排名（0 时留空）',
  summary:             '简介',
  summary_raw:         '简介（原始 Markdown，暂未实现）',
  today:               '写入日期（YYYY-MM-DD）',
  year:                '开播年份',
  season:              '开播季度（01月 / 04月 / 07月 / 10月）',
  eps_count:           '集数（0 时留空）',
  tags_yaml:           '标签 YAML 列表行（含 bangumi 和 bgm/xxx 前缀）',
  infobox_table_rows:  'infobox 信息表格行（Markdown 表格格式）',
  infobox_frontmatter: 'infobox 信息 frontmatter 格式',
  eps_checkboxes:      '集数进度复选框列表',
  netaba_iframe:       'Netaba.re 嵌入 iframe（anime 专用）',
  related_series:      '系列关联条目名（顿号分隔）',
  related_series_link: '系列关联 wiki 链接（顿号分隔）',
  sequel_link:         '续集 wiki 链接',
  prequel_link:        '前传 wiki 链接',
  adaptation:          '原作改编类型（anime 专用）',
  artist:              '艺术家（music 专用）',
  track_count:         '曲目数（music 专用）',
  my_status:           '我的状态',
  my_rating:           '我的评分',
  my_comment:          '我的点评',
  my_progress:         '观看进度（anime / real 专用）',
  my_source:           '来源（anime / real 专用）',
  my_channel:          '渠道（book 专用）',
  my_version:          '版本（book 专用）',
  my_read_progress:    '阅读进度（book 专用）',
  my_hours:            '游玩时长（game 专用）',
  my_platform:         '游玩平台（game 专用）',
  my_game_progress:    '游戏进度（game 专用）',
  my_music_source:     '音乐来源（music 专用）',
};

/** 各占位符的预览示例值，供 SettingTab 实时渲染模板预览 */
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
    summary_raw:         '',
    today:               new Date().toISOString().split('T')[0] ?? '',
    year:                '2011',
    season:              '01月',
    eps_count:           '12',
    tags_yaml:           '  - bangumi\n  - bgm/魔法少女\n  - bgm/SHAFT',
    infobox_table_rows:  '| 导演 | 新房昭之 |\n| 系列构成 | 虚渊玄 |\n| 制作公司 | SHAFT |',
    infobox_frontmatter: '导演: 新房昭之\n系列构成: 虚渊玄\n制作公司: SHAFT',
    eps_checkboxes:      '- [ ] **EP 01** ｜ \n- [ ] **EP 02** ｜ \n- [ ] **EP 03** ｜ ',
    netaba_iframe:       '<div style="..."><iframe src="https://netaba.re/subject/103047"></iframe></div>',
    related_series:      '叛逆的物语',
    related_series_link: '[[叛逆的物语]]',
    sequel_link:         '[[叛逆的物语]]',
    prequel_link:        '',
    adaptation:          '原创',
    artist:              'ClariS',
    track_count:         '12',
    my_status:           '看过',
    my_rating:           '10',
    my_comment:          '神作',
    my_progress:         '第12集',
    my_source:           'BD',
    my_channel:          '电子书',
    my_version:          '完全版',
    my_read_progress:    '第3卷 / 第12话',
    my_hours:            '40',
    my_platform:         'PC',
    my_game_progress:    '通关',
    my_music_source:     '流媒体',
  };
}

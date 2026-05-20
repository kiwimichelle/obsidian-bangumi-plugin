import { BangumiSettings, SubjectTypeConfig, SubjectTypeKey } from './types';
export type { BangumiSettings } from './types';

// ── 动画默认模板 ────────────────────────────────────────────────
export const DEFAULT_ANIME_TEMPLATE = `**已观看集数**： {{my_progress}}
**观看网址**： {{my_source}}

# 动画信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]
>
| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| 改编类型 | {{adaptation}} |
{{infobox_table_rows}}
| 所属系列 | {{related_series_link}} |
| 续集 | {{sequel_link}} |
| 前传 | {{prequel_link}} |
| 观看状态 | {{my_status}} |
| 记录日期 | {{today}} |
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |
| Netaba 评分趋势 | [查看变化](https://netaba.re/subject/{{bangumi_id}}) |

---

# 简介

{{summary}}

{{netaba_iframe}}

# 🎞️ 分集随笔

{{eps_checkboxes}}

# 个人总结

`;

// ── 书籍默认模板 ────────────────────────────────────────────────
export const DEFAULT_BOOK_TEMPLATE = `**阅读状态**： {{my_status}}
**阅读进度**： {{my_read_progress}}

# 书籍信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]
>
| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
{{infobox_table_rows}}
| 阅读渠道 | {{my_channel}} |
| 翻译版本 | {{my_version}} |
| 记录日期 | {{today}} |
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 📝 读书随笔

> *暂无记录*

# 个人总结

`;

// ── 游戏默认模板 ────────────────────────────────────────────────
export const DEFAULT_GAME_TEMPLATE = `**游玩状态**： {{my_status}}
**游玩时长**： {{my_hours}} 小时
**游玩平台**： {{my_platform}}
**当前进度**： {{my_game_progress}}

# 游戏信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]
>
| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| 游玩平台 | {{my_platform}} |
{{infobox_table_rows}}
| 记录日期 | {{today}} |
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 📝 游玩随笔

> *暂无记录*

# 个人总结

`;

// ── 音乐默认模板 ────────────────────────────────────────────────
export const DEFAULT_MUSIC_TEMPLATE = `**收听状态**： {{my_status}}
**收听平台**： {{my_music_source}}

# 音乐信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]
>
| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| 艺术家 | {{artist}} |
| 曲目数 | {{track_count}} |
{{infobox_table_rows}}
| 记录日期 | {{today}} |
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 🎵 收听笔记

# 个人总结

`;

// ── 三次元默认模板 ──────────────────────────────────────────────
export const DEFAULT_REAL_TEMPLATE = `**已观看集数**： {{my_progress}}
**观看网址**： {{my_source}}

# 作品信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]
>
| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
{{infobox_table_rows}}
| 观看状态 | {{my_status}} |
| 记录日期 | {{today}} |
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 📝 观看随笔

{{eps_checkboxes}}

# 个人总结

`;

export const DEFAULT_TEMPLATES: Record<SubjectTypeKey, string> = {
  anime: DEFAULT_ANIME_TEMPLATE,
  book:  DEFAULT_BOOK_TEMPLATE,
  game:  DEFAULT_GAME_TEMPLATE,
  music: DEFAULT_MUSIC_TEMPLATE,
  real:  DEFAULT_REAL_TEMPLATE,
};

const DEFAULT_TYPE_CONFIGS: Record<SubjectTypeKey, SubjectTypeConfig> = {
  anime: { archiveRoot: 'ACG/Anime', archiveMode: 'season', coverPath: 'ACG/Anime/_covers', templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
  book:  { archiveRoot: 'ACG/Book',  archiveMode: 'flat',   coverPath: 'ACG/Book/_covers',  templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
  game:  { archiveRoot: 'ACG/Game',  archiveMode: 'flat',   coverPath: 'ACG/Game/_covers',  templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
  music: { archiveRoot: 'ACG/Music', archiveMode: 'flat',   coverPath: 'ACG/Music/_covers', templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
  real:  { archiveRoot: 'ACG/Real',  archiveMode: 'season', coverPath: 'ACG/Real/_covers',  templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
};

export const DEFAULT_SETTINGS: BangumiSettings = {
  token: '', videoRootDir: '', createVideoDir: false,
  subjectTypes: DEFAULT_TYPE_CONFIGS,
};

import { BangumiSettings, SubjectTypeConfig, SubjectTypeKey } from './types';
export type { BangumiSettings } from './types';

// ── 默认模板 ────────────────────────────────────────────────────

export const DEFAULT_ANIME_TEMPLATE = `**已观看集数**： 
**观看网址**： 

# 动画信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]
>
| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
{{infobox_table_rows}}
{{relations_section}}
| 所属系列 | {{related_series_link}} |
| 观看状态 | 想看 |
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

export const DEFAULT_BOOK_TEMPLATE = `# {{title}}

![[{{cover_local}}|300]]

## 详细信息

| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
{{infobox_table_rows}}
{{relations_section}}
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 📖 读书笔记

# 个人总结

`;

export const DEFAULT_GAME_TEMPLATE = `# {{title}}

![[{{cover_local}}|300]]

## 详细信息

| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
{{infobox_table_rows}}
{{relations_section}}
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 🎮 游玩记录

# 个人总结

`;

export const DEFAULT_MUSIC_TEMPLATE = `# {{title}}

![[{{cover_local}}|300]]

## 详细信息

| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
{{infobox_table_rows}}
{{relations_section}}
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 🎵 收听笔记

# 个人总结

`;

export const DEFAULT_REAL_TEMPLATE = `# {{title}}

![[{{cover_local}}|300]]

## 详细信息

| 项目 | 内容 |
|:------|:------------------------------------------|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
{{infobox_table_rows}}
{{relations_section}}
| BGM 地址 | [{{title}}]({{bangumi_url}}) |
| BGM 评分 | {{score}} |

---

# 简介

{{summary}}

# 📝 观看笔记

# 个人总结

`;

export const DEFAULT_TEMPLATES: Record<SubjectTypeKey, string> = {
  anime: DEFAULT_ANIME_TEMPLATE,
  book:  DEFAULT_BOOK_TEMPLATE,
  game:  DEFAULT_GAME_TEMPLATE,
  music: DEFAULT_MUSIC_TEMPLATE,
  real:  DEFAULT_REAL_TEMPLATE,
};

// ── 默认分类配置 ────────────────────────────────────────────────

const DEFAULT_TYPE_CONFIGS: Record<SubjectTypeKey, SubjectTypeConfig> = {
  anime: {
    archiveRoot:    'ACG/Anime',
    archiveMode:    'season',
    coverPath:      'ACG/Anime/_covers',
    templateSource: 'default',
    templateFile:   '',
    overwriteMode:  'ask',
  },
  book: {
    archiveRoot:    'ACG/Book',
    archiveMode:    'flat',
    coverPath:      'ACG/Book/_covers',
    templateSource: 'default',
    templateFile:   '',
    overwriteMode:  'ask',
  },
  game: {
    archiveRoot:    'ACG/Game',
    archiveMode:    'flat',
    coverPath:      'ACG/Game/_covers',
    templateSource: 'default',
    templateFile:   '',
    overwriteMode:  'ask',
  },
  music: {
    archiveRoot:    'ACG/Music',
    archiveMode:    'flat',
    coverPath:      'ACG/Music/_covers',
    templateSource: 'default',
    templateFile:   '',
    overwriteMode:  'ask',
  },
  real: {
    archiveRoot:    'ACG/Real',
    archiveMode:    'flat',
    coverPath:      'ACG/Real/_covers',
    templateSource: 'default',
    templateFile:   '',
    overwriteMode:  'ask',
  },
};

export const DEFAULT_SETTINGS: BangumiSettings = {
  token:          '',
  videoRootDir:   '',
  createVideoDir: false,
  subjectTypes:   DEFAULT_TYPE_CONFIGS,
};
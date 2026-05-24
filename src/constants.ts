import type { BookSubtype, GamePlatform, SubjectTypeKey, OfflineDbPaths } from './types';
import type { BangumiSettings } from './types';

// ─────────────────────────────────────────────
// 一、分类映射
// ─────────────────────────────────────────────

/** Bangumi 数字类型码 → 内部分类键 */
export const SUBJECT_TYPE_MAP: Record<number, SubjectTypeKey> = {
  1: 'book',
  2: 'anime',
  3: 'music',
  4: 'game',
  6: 'real',
};

/** 内部分类键 → 中文显示名 */
export const SUBJECT_TYPE_LABEL: Record<SubjectTypeKey, string> = {
  anime: '动画',
  book:  '书籍',
  game:  '游戏',
  music: '音乐',
  real:  '三次元',
};

/** 全部分类键的有序列表（遍历用） */
export const TYPE_KEYS: SubjectTypeKey[] = ['anime', 'book', 'game', 'music', 'real'];

/** 搜索栏类型筛选按钮数据，value=0 表示「全部」 */
export const TYPE_FILTERS = [
  { label: '全部',   value: 0 },
  { label: '动画',   value: 2 },
  { label: '书籍',   value: 1 },
  { label: '游戏',   value: 4 },
  { label: '音乐',   value: 3 },
  { label: '三次元', value: 6 },
] as const;

// ─────────────────────────────────────────────
// 二、用户主观输入选项
// ─────────────────────────────────────────────

/** 各分类的观看/阅读/游玩状态词 */
export const STATUS_OPTIONS: Record<SubjectTypeKey, string[]> = {
  anime: ['想看', '在看', '看过', '搁置', '抛弃'],
  book:  ['想读', '在读', '已读', '搁置', '抛弃'],
  game:  ['想玩', '在玩', '玩过', '搁置', '抛弃'],
  music: ['想听', '在听', '听过'],
  real:  ['想看', '在看', '看过', '搁置', '抛弃'],
};

/** 书籍阅读渠道下拉选项 */
export const BOOK_CHANNELS = [
  '哔哩哔哩漫画', '微信读书', '动漫之家',
  'Kindle', 'BookWalker', '实体书', '其他',
];

/** 书籍翻译版本下拉选项 */
export const BOOK_VERSIONS = [
  '官方正版汉化', '民间汉化组版',
  '台版繁体', '港版繁体', '原版日文', '其他',
];

/** 音乐收听平台下拉选项 */
export const MUSIC_SOURCES = [
  'Spotify', '网易云音乐', 'Apple Music',
  'QQ音乐', 'YouTube Music', '其他',
];

/** 游戏游玩平台下拉选项（与 GamePlatform 联合类型对齐） */
export const GAME_PLATFORMS: GamePlatform[] = [
  'Steam', 'Epic', 'PS5', 'PS4', 'Switch', 'Xbox',
  'iOS', 'Android', 'PC', '其他',
];

// ─────────────────────────────────────────────
// 三、书籍子类型 → 归档目录
// ─────────────────────────────────────────────

/** 书籍子类型 → 归档子目录名（types.ts 仅含类型，此处为运行时常量） */
export const BOOK_SUBTYPE_DIR: Record<BookSubtype, string> = {
  manga:      '漫画',
  lightnovel: '轻小说',
  novel:      '小说',
};

/** 轻小说书系关键词，匹配命中则归类为轻小说 */
export const LIGHTNOVEL_SERIES_KEYWORDS = [
  'MF文庫', '電撃文庫', 'ファンタジア文庫', 'GA文庫',
  'HJ文庫', 'オーバーラップ文庫', 'レジェンドノベルス',
  'カドカワBOOKS', 'アース・スター', 'ヒーロー文庫',
  'モンスター文庫', 'Kラノベブックス', 'ダッシュエックス文庫',
];

// ─────────────────────────────────────────────
// 四、关联条目（DataAdapter / NoteBuilder 共用）
// ─────────────────────────────────────────────

/**
 * 系列关联词白名单
 * DataAdapter 据此判断 ApiRelation 是否归属「同一系列」
 * 用于聚合 {{related_series_link}}、{{sequel_link}}、{{prequel_link}} 等模板槽
 */
export const SERIES_RELATIONS: ReadonlySet<string> = new Set([
  '续集', '前传', '系列', '衍生',
  '番外篇', '主线故事', '不同版本',
]);

// ─────────────────────────────────────────────
// 五、Bangumi API 配置
// ─────────────────────────────────────────────

/** Bangumi v0 API 基地址 */
export const BGM_API_BASE = 'https://api.bgm.tv';

/** Bangumi 主站基地址（BgmScraper 抓侧边栏 HTML 用，与 API 子域分离） */
export const BGM_WEB_BASE = 'https://bgm.tv';

/** 请求 User-Agent（按 Bangumi 文档要求标明 UA） */
export const BGM_UA = 'obsidian-bangumi-plugin/0.3.0 (https://github.com/kiwimichelle/obsidian-bangumi-plugin)';

// ─────────────────────────────────────────────
// 六、离线数据包 / 索引相关
// ─────────────────────────────────────────────

/** 插件数据子目录（位于 vault/.obsidian/plugins/bangumi-obsidian/ 下） */
export const PLUGIN_DATA_DIR = 'bangumi-data';

/** 用户增量缓存文件名（CacheManager 读写） */
export const CACHE_FILE_NAME = 'user_added.json';

/** 行号索引文件名（IndexBuilder 持久化产物） */
export const INDEX_FILE_NAME = 'bangumi-index.json';

/** 关键词倒排索引文件名（SearchIndexBuilder 持久化产物） */
export const SEARCH_INDEX_FILE_NAME = 'bangumi-search-index.json';

/** 索引元数据文件名（IndexMeta 持久化产物） */
export const INDEX_META_FILE_NAME = 'bangumi-index.meta.json';

/**
 * 索引构建批次大小
 * 每处理 INDEX_BATCH_SIZE 行必须 `await new Promise(r => setImmediate(r))`
 * 主动让出主线程，避免阻塞 Obsidian UI
 */
export const INDEX_BATCH_SIZE = 5000;

/**
 * Bangumi 官方 Archive 最新版本元数据
 * ArchiveLocator 拉取此文件检测离线包是否过期
 */
export const ARCHIVE_LATEST_URL = 'https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json';

// ─────────────────────────────────────────────
// 七、搜索分页
// ─────────────────────────────────────────────

/** 搜索结果每页默认数量（与 Bangumi v0 API 默认 limit 对齐） */
export const DEFAULT_PAGE_SIZE = 12;

// ─────────────────────────────────────────────
// 八、各分类默认笔记模板
// ─────────────────────────────────────────────

/** 动画默认模板 */
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

/** 书籍默认模板 */
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

/** 游戏默认模板 */
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

/** 音乐默认模板 */
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

/** 三次元默认模板 */
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

/** 分类键 → 默认模板（TemplateEngine 在 templateSource='default' 时使用） */
export const DEFAULT_TEMPLATES: Record<SubjectTypeKey, string> = {
  anime: DEFAULT_ANIME_TEMPLATE,
  book:  DEFAULT_BOOK_TEMPLATE,
  game:  DEFAULT_GAME_TEMPLATE,
  music: DEFAULT_MUSIC_TEMPLATE,
  real:  DEFAULT_REAL_TEMPLATE,
};
export const DEFAULT_OFFLINE_DB_PATHS: OfflineDbPaths = {
  subject:        '',
  episodes:       '',
  persons:        '',
  subjectPersons: '',
  relations:      '',
};

export const DEFAULT_SETTINGS: BangumiSettings = {
  token:              '',
  offlineDbPath:      '',           // 保留旧字段，迁移兼容用
  offlineDbPaths:     { ...DEFAULT_OFFLINE_DB_PATHS },
  offlineMode:        false,
  indexBuiltAt:       0,
  searchIndexBuiltAt: 0,
  hideNsfw:           false,
  videoRootDir:       '',
  createVideoDir:     false,
  subjectTypes: {
    anime: { archiveRoot: 'Bangumi/Anime', archiveMode: 'season', coverPath: 'assets/covers', templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
    book:  { archiveRoot: 'Bangumi/Book',  archiveMode: 'flat',   coverPath: 'assets/covers', templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
    game:  { archiveRoot: 'Bangumi/Game',  archiveMode: 'flat',   coverPath: 'assets/covers', templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
    music: { archiveRoot: 'Bangumi/Music', archiveMode: 'flat',   coverPath: 'assets/covers', templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
    real:  { archiveRoot: 'Bangumi/Real',  archiveMode: 'season', coverPath: 'assets/covers', templateSource: 'default', templateFile: '', overwriteMode: 'ask' },
  },
};
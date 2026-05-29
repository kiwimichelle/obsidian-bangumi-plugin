import type { BookSubtype, GamePlatform, SubjectTypeKey, OfflineDbPaths } from './types';
import type { BangumiSettings } from './types';

// ─────────────────────────────────────────────
// 一、分类映射
// ─────────────────────────────────────────────

export const SUBJECT_TYPE_MAP: Record<number, SubjectTypeKey> = {
  1: 'book',
  2: 'anime',
  3: 'music',
  4: 'game',
  6: 'real',
};

export const SUBJECT_TYPE_LABEL: Record<SubjectTypeKey, string> = {
  anime: '动画',
  book:  '书籍',
  game:  '游戏',
  music: '音乐',
  real:  '三次元',
};

export const TYPE_KEYS: SubjectTypeKey[] = ['anime', 'book', 'game', 'music', 'real'];

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

export const STATUS_OPTIONS: Record<SubjectTypeKey, string[]> = {
  anime: ['想看', '在看', '看过', '搁置', '抛弃'],
  book:  ['想读', '在读', '已读', '搁置', '抛弃'],
  game:  ['想玩', '在玩', '玩过', '搁置', '抛弃'],
  music: ['想听', '在听', '听过'],
  real:  ['想看', '在看', '看过', '搁置', '抛弃'],
};

export const BOOK_CHANNELS = [
  '哔哩哔哩漫画', '微信读书', '动漫之家',
  'Kindle', 'BookWalker', '实体书', '其他',
];

export const BOOK_VERSIONS = [
  '官方正版汉化', '民间汉化组版',
  '台版繁体', '港版繁体', '原版日文', '其他',
];

export const MUSIC_SOURCES = [
  'Spotify', '网易云音乐', 'Apple Music',
  'QQ音乐', 'YouTube Music', '其他',
];

export const GAME_PLATFORMS: GamePlatform[] = [
  'Steam', 'Epic', 'PS5', 'PS4', 'Switch', 'Xbox',
  'iOS', 'Android', 'PC', '其他',
];

// ─────────────────────────────────────────────
// 三、书籍子类型
// ─────────────────────────────────────────────

export const BOOK_SUBTYPE_DIR: Record<BookSubtype, string> = {
  manga:      '漫画',
  lightnovel: '轻小说',
  novel:      '小说',
};

export const LIGHTNOVEL_SERIES_KEYWORDS = [
  'MF文庫', '電撃文庫', 'ファンタジア文庫', 'GA文庫',
  'HJ文庫', 'オーバーラップ文庫', 'レジェンドノベルス',
  'カドカワBOOKS', 'アース・スター', 'ヒーロー文庫',
  'モンスター文庫', 'Kラノベブックス', 'ダッシュエックス文庫',
];

// ─────────────────────────────────────────────
// 四、关联条目
// ─────────────────────────────────────────────

export const SERIES_RELATIONS: ReadonlySet<string> = new Set([
  '续集', '前传', '系列', '衍生',
  '番外篇', '主线故事', '不同版本',
]);

// ─────────────────────────────────────────────
// 五、Bangumi API 配置
// ─────────────────────────────────────────────

export const BGM_API_BASE = 'https://api.bgm.tv';
export const BGM_WEB_BASE = 'https://bgm.tv';
export const BGM_UA = 'obsidian-bangumi-plugin/0.3.0 (https://github.com/kiwimichelle/obsidian-bangumi-plugin)';

// ─────────────────────────────────────────────
// 六、离线数据包 / 索引相关
// ─────────────────────────────────────────────

export const PLUGIN_DATA_DIR        = 'bangumi-data';
export const CACHE_FILE_NAME        = 'user_added.json';
export const INDEX_FILE_NAME        = 'bangumi-index.json';
export const SEARCH_INDEX_FILE_NAME = 'bangumi-search-index.json';
/** 方案A：搜索轻量数据缓存文件名 */
export const SEARCH_DATA_FILE_NAME  = 'bangumi-search-data.json';
export const INDEX_META_FILE_NAME   = 'bangumi-index.meta.json';
export const INDEX_BATCH_SIZE       = 5000;
export const ARCHIVE_LATEST_URL     = 'https://raw.githubusercontent.com/bangumi/Archive/master/aux/latest.json';

// ─────────────────────────────────────────────
// 七、搜索分页
// ─────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 12;

// ─────────────────────────────────────────────
// 八、各分类默认笔记模板
// 修复：anime 和 real 模板加入 {{series_section}} 占位符
// ─────────────────────────────────────────────

export const DEFAULT_ANIME_TEMPLATE = `**已观看集数**： {{my_progress}}
**观看网址**： {{my_source}}

# 动画信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]

## 基本信息
| 项目 | 内容 |
|:--|:--|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| 改编自 | {{adaptation}} |
| BGM评分 | {{score}} |
| BGM排名 | {{rank}} |
{{infobox_table_rows}}

## 制作人员
| 职位 | 人员 |
|:--|:--|
{{credits_main}}

## 声优
| 角色 | 声优 |
|:--|:--|
{{credits_cast}}

{{series_section}}

---

# 简介
{{summary}}

{{netaba_iframe}}

# 🎞️ 分集随笔
{{eps_checkboxes}}

# 个人总结
`;

export const DEFAULT_BOOK_TEMPLATE = `**阅读状态**： {{my_status}}
**阅读进度**： {{my_read_progress}}

# 书籍信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]

## 基本信息
| 项目 | 内容 |
|:--|:--|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| BGM评分 | {{score}} |
{{infobox_table_rows}}

## 制作人员
| 职位 | 人员 |
|:--|:--|
{{credits_main}}

---

# 简介
{{summary}}

# 📝 读书随笔

> *暂无记录*

# 个人总结
`;

export const DEFAULT_GAME_TEMPLATE = `**游玩状态**： {{my_status}}
**游玩时长**： {{my_hours}} 小时
**游玩平台**： {{my_platform}}
**当前进度**： {{my_game_progress}}

# 游戏信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]

## 基本信息
| 项目 | 内容 |
|:--|:--|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| BGM评分 | {{score}} |
{{infobox_table_rows}}

## 制作人员
| 职位 | 人员 |
|:--|:--|
{{credits_main}}

---

# 简介
{{summary}}

# 📝 游玩随笔

> *暂无记录*

# 个人总结
`;

export const DEFAULT_MUSIC_TEMPLATE = `**收听状态**： {{my_status}}
**收听平台**： {{my_music_source}}

# 音乐信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]

## 基本信息
| 项目 | 内容 |
|:--|:--|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| 艺术家 | {{artist}} |
| 曲目数 | {{track_count}} |
| BGM评分 | {{score}} |
{{infobox_table_rows}}

## 制作人员
| 职位 | 人员 |
|:--|:--|
{{credits_main}}

---

# 简介
{{summary}}

# 🎵 曲目列表
{{eps_checkboxes}}

# 收听笔记

# 个人总结
`;

export const DEFAULT_REAL_TEMPLATE = `**已观看集数**： {{my_progress}}
**观看网址**： {{my_source}}

# 作品信息
> [!bookinfo|noicon]+ **{{title}}**
> ![[{{cover_local}}|400]]

## 基本信息
| 项目 | 内容 |
|:--|:--|
| 中文名 | {{title}} |
| 日文名 | {{original_title}} |
| BGM评分 | {{score}} |
{{infobox_table_rows}}

## 制作人员
| 职位 | 人员 |
|:--|:--|
{{credits_main}}

## 声优
| 角色 | 声优 |
|:--|:--|
{{credits_cast}}

{{series_section}}

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

export const DEFAULT_OFFLINE_DB_PATHS: OfflineDbPaths = {
  subject:        '',
  episodes:       '',
  persons:        '',
  subjectPersons: '',
  relations:      '',
};

export const DEFAULT_SETTINGS: BangumiSettings = {
  token:              '',
  offlineDbPath:      '',
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
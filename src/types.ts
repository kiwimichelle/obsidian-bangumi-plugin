/**
 * bangumi-obsidian 插件类型定义
 * 纯类型文件，不含任何业务逻辑
 */

// ─────────────────────────────────────────────
// 一、基础枚举与字面量类型
// ─────────────────────────────────────────────

export type SubjectTypeKey = 'anime' | 'book' | 'game' | 'music' | 'real';
export type ArchiveMode    = 'season' | 'year' | 'flat';
export type OverwriteMode  = 'ask' | 'always' | 'never';
export type TemplateSource = 'default' | 'file';
export type BookSubtype    = 'manga' | 'lightnovel' | 'novel';
export type GamePlatform   =
  | 'Steam' | 'Epic' | 'PS5' | 'PS4' | 'Switch' | 'Xbox'
  | 'iOS' | 'Android' | 'PC' | '其他';

// ─────────────────────────────────────────────
// 二、原始数据类型（数据源层）
// ─────────────────────────────────────────────

export interface RawArchiveSubject {
  id:        number;
  type:      number;
  name:      string;
  name_cn:   string;
  infobox:   string;
  summary:   string;
  date?:     string;
  volumes:   number;
  eps:       number;
  tags:      Array<{ name: string; count: number }>;
  score?:    number;
  rank?:     number;
  meta_tags?: string[];
  nsfw?:     boolean;
  image?:    string;
}

export interface ApiSubject {
  id:        number;
  type:      number;
  name:      string;
  name_cn:   string;
  date?:     string;
  summary:   string;
  eps?:      number;
  volumes?:  number;
  infobox?:  Array<{ key: string; value: unknown }>;
  images?: {
    large?:  string;
    common?: string;
    medium?: string;
    small?:  string;
    grid?:   string;
  };
  rating?: {
    score:   number;
    rank?:   number;
    total?:  number;
  };
  tags?:     Array<{ name: string; count: number }>;
  platform?: string;
  nsfw?:     boolean;
}

export interface ApiPerson {
  id:       number;
  name:     string;
  type?:    number;
  career?:  string[];
}

export interface ApiRelation {
  id:        number;
  name:      string;
  name_cn:   string;
  relation:  string;
  type:      number;
  images?:   ApiSubject['images'];
}

/** /v0/subjects/:id/characters 单条响应 */
export interface ApiCharacter {
  id:      number;
  name:    string;
  actors?: Array<{
    id:       number;
    name:     string;
    name_cn?: string;
  }>;
}

// ─────────────────────────────────────────────
// 三、归一化统一结构
// ─────────────────────────────────────────────

export interface InfoboxEntry {
  key:   string;
  value: string;
}

export interface SubjectRelation {
  id:           number;
  name:         string;
  nameOriginal: string;
  relation:     string;
  typeKey:      SubjectTypeKey | null;
}

/**
 * 声优条目（来自 /v0/subjects/:id/characters）
 * 含角色名和 CV 名，在线模式专用
 */
export interface CastCredit {
  characterId:   number;
  characterName: string;
  actorId:       number;
  actorName:     string;     // 中文名优先
  actorOriginal: string;     // 日文名
}

export interface SubjectData {
  id:              number;
  typeKey:         SubjectTypeKey;
  nsfw?:           boolean;
  name:            string;
  nameOriginal:    string;
  date:            string;
  summary:         string;
  infobox:         InfoboxEntry[];
  eps:             number;
  volumes:         number;
  platform:        string;
  score:           number;
  rank:            number;
  coverUrl:        string;
  tags:            string[];
  relations:       SubjectRelation[];
  relationsLoaded: boolean;
  /** 在线模式拉取的声优数据；离线模式为空数组 */
  castCredits:     CastCredit[];
  source:          'cache' | 'archive' | 'api';
}

// ─────────────────────────────────────────────
// 四、用户主观输入类型
// ─────────────────────────────────────────────

export interface AnimeSubjective {
  status:   string;
  progress: string;
  source:   string;
  rating:   string;
  comment:  string;
}

export interface BookSubjective {
  status:   string;
  subtype:  BookSubtype;
  volNum:   string;
  unitNum:  string;
  channel:  string;
  version:  string;
  rating:   string;
  comment:  string;
}

export interface GameSubjective {
  status:   string;
  platform: GamePlatform;
  hours:    string;
  progress: string;
  rating:   string;
  comment:  string;
}

export interface MusicSubjective {
  status:  string;
  source:  string;
  rating:  string;
  comment: string;
}

export interface RealSubjective {
  status:   string;
  progress: string;
  source:   string;
  rating:   string;
  comment:  string;
}

export type Subjective =
  | AnimeSubjective
  | BookSubjective
  | GameSubjective
  | MusicSubjective
  | RealSubjective;

// ─────────────────────────────────────────────
// 五、配置与设置类型
// ─────────────────────────────────────────────

export interface SubjectTypeConfig {
  archiveRoot:    string;
  archiveMode:    ArchiveMode;
  coverPath:      string;
  templateSource: TemplateSource;
  templateFile:   string;
  overwriteMode:  OverwriteMode;
}

export interface OfflineDbPaths {
  subject:        string;
  episodes:       string;
  persons:        string;
  subjectPersons: string;
  relations:      string;
}

export interface BangumiSettings {
  token:              string;
  /** @deprecated 已迁移至 offlineDbPaths.subject */
  offlineDbPath:      string;
  offlineDbPaths:     OfflineDbPaths;
  offlineMode:        boolean;
  indexBuiltAt:       number;
  searchIndexBuiltAt: number;
  hideNsfw:           boolean;
  videoRootDir:       string;
  createVideoDir:     boolean;
  subjectTypes:       Record<SubjectTypeKey, SubjectTypeConfig>;
}

// ─────────────────────────────────────────────
// 六、运行时状态类型
// ─────────────────────────────────────────────

export interface PluginState {
  offlineAvailable:  boolean;
  indexReady:        boolean;
  searchIndexReady:  boolean;
  cacheLoaded:       boolean;
}

export interface IndexMeta {
  builtAt:    number;
  totalLines: number;
  jsonlPath:  string;
  jsonlSize:  number;
}

// ─────────────────────────────────────────────
// 七、搜索相关类型
// ─────────────────────────────────────────────

export interface SearchResultItem {
  id:           number;
  name:         string;
  nameOriginal: string;
  typeKey:      SubjectTypeKey;
  year:         string;
  score:        number;
  coverUrl:     string;
  source:       SubjectData['source'];
  nsfw?:        boolean;
}

export interface SearchQuery {
  keyword:    string;
  typeFilter: number;
  page:       number;
  limit:      number;
  mode?:      'offline' | 'online';
}

export interface SearchResponse {
  list:        SearchResultItem[];
  total:       number;
  fromOffline: boolean;
}

// ─────────────────────────────────────────────
// 八、命名冲突解决结果
// ─────────────────────────────────────────────

export interface NamingResult {
  /** 最终确定的文件名（不含 .md 后缀） */
  filename:     string;
  /** 已存在文件的路径，空字符串表示无冲突 */
  existingPath: string;
  /** none=无冲突或同ID更新，same=同目录同名异ID，other=跨媒介同名 */
  conflict:     'none' | 'same' | 'other';
}

// ─────────────────────────────────────────────
// 九、分集与制作人员类型
// ─────────────────────────────────────────────

export interface EpisodeData {
  id:        number;
  subjectId: number;
  type:      number;
  sort:      number;
  name:      string;
  nameCn:    string;
  airdate:   string;
  duration:  string;
  desc:      string;
}

export interface PersonCredit {
  personId:      number;
  name:          string;
  nameOriginal:  string;
  positionId:    number;
  positionLabel: string;
}

// ─────────────────────────────────────────────
// 十、搜索轻量数据缓存（方案A：搜索专用）
// ─────────────────────────────────────────────

/**
 * 构建阶段从 jsonl 提取的轻量条目，仅含搜索展示所需字段。
 * 存储在 bangumi-search-data.json，全量加载进内存，
 * 避免搜索结果物化时回读 jsonl 大文件。
 */
export interface SearchDataEntry {
  id:       number;
  type:     number;
  name:     string;
  name_cn:  string;
  date:     string;
  score:    number;
  image:    string;
  nsfw:     boolean;
}
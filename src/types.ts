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
  /** 封面图片路径（相对或绝对 URL） */
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

/** 各离线数据包的独立路径配置 */
export interface OfflineDbPaths {
  /** subject.jsonlines — 主条目（必须） */
  subject:        string;
  /** episodes.jsonlines — 分集信息（可选） */
  episodes:       string;
  /** persons.jsonlines — 人物信息（可选，与 subjectPersons 配套） */
  persons:        string;
  /** subject-persons.jsonlines — 条目↔人员关联（可选，与 persons 配套） */
  subjectPersons: string;
  /** subject-relations.jsonlines — 条目间关联（可选） */
  relations:      string;
}

export interface BangumiSettings {
  token:              string;
  /** @deprecated 已迁移至 offlineDbPaths.subject，仅保留用于升级兼容 */
  offlineDbPath:      string;
  /** 各数据包独立路径配置 */
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
// 八、防撞命名结果
// ─────────────────────────────────────────────

export interface NamingResult {
  filename:     string;
  existingPath: string;
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
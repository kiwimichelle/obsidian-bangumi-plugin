/**
 * bangumi-obsidian 插件类型定义
 * 纯类型文件，不含任何业务逻辑
 */

// ─────────────────────────────────────────────
// 一、基础枚举与字面量类型
// ─────────────────────────────────────────────

/** 条目分类键 */
export type SubjectTypeKey = 'anime' | 'book' | 'game' | 'music' | 'real';

/** 归档目录层级模式 */
export type ArchiveMode = 'season' | 'year' | 'flat';

/** 笔记已存在时的覆盖策略 */
export type OverwriteMode = 'ask' | 'always' | 'never';

/** 模板来源 */
export type TemplateSource = 'default' | 'file';

/** 书籍子类型 */
export type BookSubtype = 'manga' | 'lightnovel' | 'novel';

/** 游戏游玩平台 */
export type GamePlatform =
  | 'Steam'
  | 'Epic'
  | 'PS5'
  | 'PS4'
  | 'Switch'
  | 'Xbox'
  | 'iOS'
  | 'Android'
  | 'PC'
  | '其他';

// ─────────────────────────────────────────────
// 二、原始数据类型（数据源层）
// ─────────────────────────────────────────────

/**
 * bangumi.jsonl 每行的原始结构
 * 字段与 Bangumi 数据包 schema 保持一致
 */
export interface RawArchiveSubject {
  /** 条目唯一 ID */
  id: number;
  /** 条目类型（1=书籍, 2=动画, 3=音乐, 4=游戏, 6=三次元） */
  type: number;
  /** 日文/原始名称 */
  name: string;
  /** 中文名称（可能为空字符串） */
  name_cn: string;
  /**
   * infobox 原始 wiki 字符串，形如：
   * {{Infobox animanga/Anime\n| 导演 = 斎藤圭一郎\n| ...}}
   * 需经 WikiParser 解析为 InfoboxEntry[]
   */
  infobox: string;
  /** 简介文本 */
  summary: string;
  /** 首播/发行日期，格式 YYYY-MM-DD，可能缺失 */
  date?: string;
  /** 书籍卷数（非书籍类型为 0） */
  volumes: number;
  /** 总集数/话数（非视频类型为 0） */
  eps: number;
  /** BGM 用户标签列表 */
  tags: Array<{ name: string; count: number }>;
  score?: number;
  rank?: number;
  meta_tags?: string[];
  nsfw?: boolean;
}

/**
 * Bangumi v0 API 返回的条目结构（/v0/subjects/:id）
 * infobox 已由 API 解析为数组格式
 */
export interface ApiSubject {
  /** 条目唯一 ID */
  id: number;
  /** 条目类型数字 */
  type: number;
  /** 日文/原始名称 */
  name: string;
  /** 中文名称 */
  name_cn: string;
  /** 首播/发行日期 */
  date?: string;
  /** 简介 */
  summary: string;
  /** 总集数 */
  eps?: number;
  /** 总卷数 */
  volumes?: number;
  /**
   * 已解析的 infobox 数组
   * value 可能是字符串或嵌套数组（API 原始格式）
   */
  infobox?: Array<{ key: string; value: unknown }>;
  /** 封面图片各尺寸 URL */
  images?: {
    large?:  string;
    common?: string;
    medium?: string;
    small?:  string;
    grid?:   string;
  };
  /** 评分信息 */
  rating?: {
    /** 加权评分 */
    score: number;
    /** 排名 */
    rank?: number;
    /** 总评分人数 */
    total?: number;
  };
  /** 用户标签 */
  tags?: Array<{ name: string; count: number }>;
  /**
   * 媒介平台（书籍类型用此字段区分漫画/小说等）
   * 例：'漫画'、'小说'
   */
  platform?: string;
  nsfw?: boolean;
}

/** 在线 API 返回的人物基础数据 */
export interface ApiPerson {
  id: number;
  name: string;
  type?: number;
  career?: string[];
}


/**
 * Bangumi API 返回的关联条目（/v0/subjects/:id/subjects）
 */
export interface ApiRelation {
  /** 关联条目 ID */
  id: number;
  /** 日文/原始名称 */
  name: string;
  /** 中文名称 */
  name_cn: string;
  /**
   * 关联类型文本，如 '续集'、'前传'、'系列'、'衍生'、'番外篇'、
   * '角色出演'、'主题歌'、'片头曲' 等
   */
  relation: string;
  /** 关联条目的类型数字 */
  type: number;
  /** 封面图片（可能缺失） */
  images?: ApiSubject['images'];
}

// ─────────────────────────────────────────────
// 三、归一化统一结构（核心数据层）
// ─────────────────────────────────────────────

/**
 * 解析后的 infobox 条目
 * 所有来源（离线 wiki 解析 / API 数组）统一为此格式
 */
export interface InfoboxEntry {
  /** 字段键名，如 '导演'、'原作'、'出版社' */
  key: string;
  /** 字段值（已扁平化为字符串，多值用 '、' 连接） */
  value: string;
}

/**
 * 归一化后的关联条目
 */
export interface SubjectRelation {
  /** 关联条目 ID */
  id: number;
  /** 显示名称（优先中文名） */
  name: string;
  /** 原始名称 */
  nameOriginal: string;
  /**
   * 关联类型，如 '续集'、'前传'、'系列' 等
   */
  relation: string;
  /** 关联条目的分类键（已映射，未知类型为 null） */
  typeKey: SubjectTypeKey | null;
}

/**
 * 所有下游模块（note、ui、vault）唯一认可的归一化数据结构
 * 由 DataAdapter 从各数据源转换而来
 */
export interface SubjectData {
  // ── 基础标识 ──
  /** Bangumi 条目 ID */
  id: number;
  /** 条目分类键 */
  typeKey: SubjectTypeKey;
  /** 是否为 NSFW 内容 */
  nsfw?: boolean;
  // ── 名称 ──
  /** 中文名称（可能与 nameOriginal 相同） */
  name: string;
  /** 日文/原始名称 */
  nameOriginal: string;

  // ── 核心字段 ──
  /** 首播/发行日期，格式 YYYY-MM-DD */
  date: string;
  /** 简介 */
  summary: string;
  /** 解析后的 infobox 条目列表 */
  infobox: InfoboxEntry[];
  /** 总集数（动画/三次元） */
  eps: number;
  /** 总卷数（书籍） */
  volumes: number;
  /**
   * 媒介平台原始字符串
   * 书籍类型用于子类型判断
   */
  platform: string;

  // ── 评分 ──
  /** BGM 加权评分（0 表示无评分） */
  score: number;
  /** BGM 排名（0 表示未上榜） */
  rank: number;

  // ── 封面 ──
  /** 封面大图 URL（优先 large，降级 common/medium） */
  coverUrl: string;

  // ── 标签 ──
  /** BGM 用户标签（按热度排序，最多取前 15 个） */
  tags: string[];

  // ── 关联 ──
  /**
   * 关联条目列表
   * 注意：离线数据源初始为空数组，由 RelationFetcher 异步填充
   */
  relations: SubjectRelation[];
  /**
   * 关联数据是否已加载
   * - false : 尚未补全（典型为离线数据），RelationFetcher 可发起异步请求
   * - true  : 已补全或来源本身就含 relations，避免重复触发 API
   */
  relationsLoaded: boolean;

  // ── 数据溯源 ──
  /**
   * 数据来源标记
   * - 'cache'   : 来自 user_added.json 内存缓存
   * - 'archive' : 来自本地 bangumi.jsonl 离线包
   * - 'api'     : 来自 Bangumi 在线 API
   */
  source: 'cache' | 'archive' | 'api';
  
}

// ─────────────────────────────────────────────
// 四、用户主观输入类型
// ─────────────────────────────────────────────

/** 动画主观输入 */
export interface AnimeSubjective {
  /** 观看状态：想看 / 在看 / 看过 / 搁置 / 抛弃 */
  status: string;
  /** 已观看集数 */
  progress: string;
  /** 观看来源网址 */
  source: string;
  /** 个人评分（1–10，空字符串表示不评分） */
  rating: string;
  /** 即时短评 */
  comment: string;
}

/** 书籍主观输入 */
export interface BookSubjective {
  /** 阅读状态：想读 / 在读 / 已读 / 搁置 / 抛弃 */
  status: string;
  /** 书籍子类型（影响归档目录） */
  subtype: BookSubtype;
  /** 当前阅读到第几卷 */
  volNum: string;
  /** 当前阅读到第几话/章 */
  unitNum: string;
  /** 阅读渠道，如 '哔哩哔哩漫画'、'微信读书' */
  channel: string;
  /** 翻译版本，如 '官方正版汉化'、'台版繁体' */
  version: string;
  /** 个人评分 */
  rating: string;
  /** 即时短评 */
  comment: string;
}

/** 游戏主观输入 */
export interface GameSubjective {
  /** 游玩状态：想玩 / 在玩 / 玩过 / 搁置 / 抛弃 */
  status: string;
  /** 游玩平台（影响归档目录） */
  platform: GamePlatform;
  /** 游玩时长（小时，可含小数） */
  hours: string;
  /** 当前进度文字，如 '第一章'、'最终Boss前' */
  progress: string;
  /** 个人评分 */
  rating: string;
  /** 即时短评 */
  comment: string;
}

/** 音乐主观输入 */
export interface MusicSubjective {
  /** 收听状态：想听 / 在听 / 听过 */
  status: string;
  /** 收听平台，如 'Spotify'、'网易云音乐' */
  source: string;
  /** 个人评分 */
  rating: string;
  /** 即时短评 */
  comment: string;
}

/** 三次元主观输入 */
export interface RealSubjective {
  /** 观看状态：想看 / 在看 / 看过 / 搁置 / 抛弃 */
  status: string;
  /** 已观看集数 */
  progress: string;
  /** 观看来源网址 */
  source: string;
  /** 个人评分 */
  rating: string;
  /** 即时短评 */
  comment: string;
}

/** 所有分类主观输入的联合类型 */
export type Subjective =
  | AnimeSubjective
  | BookSubjective
  | GameSubjective
  | MusicSubjective
  | RealSubjective;

// ─────────────────────────────────────────────
// 五、配置与设置类型
// ─────────────────────────────────────────────

/** 单个分类的归档与模板配置 */
export interface SubjectTypeConfig {
  /** 归档根目录路径（库内相对路径） */
  archiveRoot: string;
  /**
   * 归档层级模式
   * - 'season' : root/年份/季度新番/
   * - 'year'   : root/年份/
   * - 'flat'   : root/（不分层）
   * 书籍/游戏类型忽略此字段，使用自动子目录
   */
  archiveMode: ArchiveMode;
  /** 封面图片存放路径（库内相对路径） */
  coverPath: string;
  /** 模板来源 */
  templateSource: TemplateSource;
  /** 自定义模板文件路径（templateSource 为 'file' 时有效） */
  templateFile: string;
  /** 笔记已存在时的覆盖策略 */
  overwriteMode: OverwriteMode;
}

/** 插件全局设置（持久化到 data.json） */
export interface BangumiSettings {
  // ── 认证 ──
  /** Bangumi Access Token，空字符串表示未登录 */
  token: string;

  // ── 离线数据库 ──
  /**
   * bangumi.jsonl 离线数据包的完整路径
   * 可以是库内相对路径，也可以是系统绝对路径
   * 空字符串表示未配置
   */
  offlineDbPath: string;
  /**
   * 是否优先使用离线模式
   * true  : 优先查离线包，未命中才请求 API
   * false : 直接使用在线 API（原有行为）
   */
  offlineMode: boolean;
  /**
   * 行号索引最后构建时间（Unix ms 时间戳）
   * 0 表示从未构建
   */
  indexBuiltAt: number;
  /**
   * 关键词倒排索引最后构建时间（Unix ms 时间戳）
   * 0 表示从未构建
   */
  searchIndexBuiltAt: number;
  /** 是否隐藏 NSFW 内容 */
  hideNsfw: boolean;
  // ── 本地视频目录 ──
  /** 本地视频/下载根目录（仅桌面端有效） */
  videoRootDir: string;
  /** 是否在创建动画笔记时同步创建本地视频文件夹 */
  createVideoDir: boolean;

  // ── 各分类配置 ──
  /** 按分类键索引的详细配置 */
  subjectTypes: Record<SubjectTypeKey, SubjectTypeConfig>;
}

// ─────────────────────────────────────────────
// 六、运行时状态类型
// ─────────────────────────────────────────────

/** 插件运行时内存状态（不持久化） */
export interface PluginState {
  /**
   * 离线数据包是否可用
   * （路径已配置且文件存在）
   */
  offlineAvailable: boolean;
  /**
   * 行号索引是否就绪
   * （IndexBuilder 已完成构建并加载到内存）
   */
  indexReady: boolean;
  /**
   * 关键词倒排索引是否就绪
   * （SearchIndexBuilder 已完成构建并加载到内存）
   */
  searchIndexReady: boolean;
  /**
   * user_added.json 缓存是否已加载到内存
   */
  cacheLoaded: boolean;
}

/** 索引元数据（持久化在索引旁的 .meta.json 文件中） */
export interface IndexMeta {
  /** 索引构建完成时间（Unix ms 时间戳） */
  builtAt: number;
  /** 构建时扫描的总行数 */
  totalLines: number;
  /** 构建时使用的 jsonl 文件路径（用于检测路径变化） */
  jsonlPath: string;
  /** 构建时 jsonl 文件的字节大小（用于检测文件变化） */
  jsonlSize: number;
}

// ─────────────────────────────────────────────
// 七、搜索相关类型
// ─────────────────────────────────────────────

/**
 * 搜索结果项（供 SearchModal 展示）
 * 不含完整 infobox，减少内存占用
 */
export interface SearchResultItem {
  /** 条目 ID */
  id: number;
  /** 显示名称 */
  name: string;
  /** 原始名称 */
  nameOriginal: string;
  /** 条目分类键 */
  typeKey: SubjectTypeKey;
  /** 首播/发行年份（从 date 截取） */
  year: string;
  /** BGM 评分 */
  score: number;
  /** 封面缩略图 URL */
  coverUrl: string;
  /** 数据来源 */
  source: SubjectData['source'];
  nsfw?: boolean;
}

/**
 * 搜索请求参数
 */
export interface SearchQuery {
  /** 搜索关键词 */
  keyword: string;
  /**
   * 按类型过滤（0 表示全部）
   * 使用 Bangumi 数字类型码，与 SUBJECT_TYPE_MAP 对应
   */
  typeFilter: number;
  /** 当前页码（从 1 开始） */
  page: number;
  /** 每页结果数 */
  limit: number;
  mode?: 'offline' | 'online';
}

/**
 * 搜索响应
 */
export interface SearchResponse {
  /** 结果列表 */
  list: SearchResultItem[];
  /** 命中总数（用于分页） */
  total: number;
  /** 是否来自离线索引 */
  fromOffline: boolean;
}

// ─────────────────────────────────────────────
// 八、防撞命名结果
// ─────────────────────────────────────────────

/**
 * NamingResolver 的返回值
 */
export interface NamingResult {
  /** 最终使用的文件名（不含 .md 后缀） */
  filename: string;
  /** 冲突文件的完整路径（无冲突时为空字符串） */
  existingPath: string;
  /**
   * 冲突类型
   * - 'none'  : 无冲突，全新创建
   * - 'same'  : 同分类下已存在（可更新）
   * - 'other' : 其他分类下已存在（需警告）
   */
  conflict: 'none' | 'same' | 'other';
}
/**
 * ============================================================
 * types.ts への追記内容（差分）
 * ============================================================
 * 既存の types.ts に以下の変更を加えてください。
 *
 * 1. RawArchiveSubject に score / rank / meta_tags / nsfw を追加
 * 2. SubjectData に nsfw を追加
 * 3. SearchResultItem に nsfw を追加
 * 4. ApiSubject に nsfw を追加
 * 5. BangumiSettings に hideNsfw を追加
 * 6. EpisodeData 型を新規追加
 * 7. PersonCredit 型を新規追加
 * ============================================================
 */

// ─── 1. RawArchiveSubject（差分のみ） ─────────────────────

// 既存の RawArchiveSubject インターフェースに以下を追加：
//
//   /** 評点（2023-07-27 以降の dump に含まれる） */
//   score?: number;
//   /** ランキング（2023-07-27 以降の dump に含まれる） */
//   rank?: number;
//   /** 公式メタタグ（2025-04-18 以降の dump に含まれる）*/
//   meta_tags?: string[];
//   /** NSFW フラグ */
//   nsfw?: boolean;

// ─── 2. SubjectData（差分のみ） ────────────────────────────

// 既存の SubjectData インターフェースに以下を追加：
//
//   /** NSFW コンテンツかどうか（Priority 2） */
//   nsfw?: boolean;

// ─── 3. SearchResultItem（差分のみ） ───────────────────────

// 既存の SearchResultItem インターフェースに以下を追加：
//
//   /** NSFW コンテンツかどうか（Priority 2） */
//   nsfw?: boolean;

// ─── 4. ApiSubject（差分のみ） ─────────────────────────────

// 既存の ApiSubject インターフェースに以下を追加：
//
//   /** NSFW フラグ（API v0 レスポンスに含まれる） */
//   nsfw?: boolean;

// ─── 5. BangumiSettings（差分のみ） ────────────────────────

// 既存の BangumiSettings インターフェースに以下を追加：
//
//   /**
//    * NSFW コンテンツを検索結果から非表示にするか（Priority 2）
//    * デフォルト: false（表示するが徽章付き）
//    */
//   hideNsfw: boolean;

// ─── 6. EpisodeData（新規） ────────────────────────────────

/**
 * 分集データ（episodes.jsonlines の正規化後の形）
 *
 * Priority 4: EpisodeIndexBuilder が構築し、DataManager 経由で
 * NoteBuilder に渡される。
 */
export interface EpisodeData {
  /** 分集 ID */
  id:        number;
  /** 所属条目 ID */
  subjectId: number;
  /** 集タイプ: 0=正篇, 1=SP, 2=OP, 3=ED */
  type:      number;
  /** 集数序号（小数あり：SP は 0.5 など） */
  sort:      number;
  /** 原文タイトル */
  name:      string;
  /** 中文タイトル */
  nameCn:    string;
  /** 放送日（YYYY-MM-DD、不明は空文字） */
  airdate:   string;
  /** 尺（分钟）*/
  duration:  string;
  /** 简介（不明は空文字） */
  desc:      string;
}

// ─── 7. PersonCredit（新規） ───────────────────────────────

/**
 * 制作人员クレジット
 *
 * Priority 5: PersonIndexBuilder が構築し、DataManager 経由で
 * NoteBuilder に渡される。
 */
export interface PersonCredit {
  /** 人物 ID */
  personId:      number;
  /** 中文名（あれば）または原文名 */
  name:          string;
  /** 原文名 */
  nameOriginal:  string;
  /** 職位 ID（POSITION_LABEL のキー） */
  positionId:    number;
  /** 職位表示ラベル（例：'导演', '声优'） */
  positionLabel: string;
}
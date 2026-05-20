export type ArchiveMode  = 'season' | 'year' | 'flat';
export type OverwriteMode = 'ask' | 'always' | 'never';
export type TemplateSource = 'default' | 'file';
export type SubjectTypeKey = 'anime' | 'book' | 'game' | 'music' | 'real';

// 书籍子类型
export type BookSubtype = 'manga' | 'lightnovel' | 'novel';
export const BOOK_SUBTYPE_DIR: Record<BookSubtype, string> = {
  manga:      '漫画',
  lightnovel: '轻小说',
  novel:      '小说',
};

// 游戏平台
export type GamePlatform =
  'Steam' | 'Epic' | 'PS5' | 'PS4' | 'Switch' |
  'Xbox' | 'iOS' | 'Android' | 'PC' | '其他';
export const GAME_PLATFORMS: GamePlatform[] = [
  'Steam', 'Epic', 'PS5', 'PS4', 'Switch',
  'Xbox', 'iOS', 'Android', 'PC', '其他',
];

// ── 各分类专属的用户主观输入 ──────────────────────────────────

export interface AnimeSubjective {
  status:   string;   // 在看 / 想看 / 看过 / 搁置 / 抛弃
  progress: string;   // 已观看集数
  source:   string;   // 观看网址
  rating:   string;
  comment:  string;
}

export interface BookSubjective {
  status:    string;   // 在读 / 想读 / 已读 / 搁置 / 抛弃
  subtype:   BookSubtype;
  volNum:    string;   // 当前卷数
  unitNum:   string;   // 当前话/章数
  channel:   string;   // 阅读渠道
  version:   string;   // 翻译版本
  rating:    string;
  comment:   string;
}

export interface GameSubjective {
  status:   string;   // 在玩 / 想玩 / 玩过 / 搁置 / 抛弃
  platform: GamePlatform;
  hours:    string;   // 游玩时长
  progress: string;   // 当前进度（文字）
  rating:   string;
  comment:  string;
}

export interface MusicSubjective {
  status:   string;   // 在听 / 想听 / 听过
  source:   string;   // 收听平台
  rating:   string;
  comment:  string;
}

export interface RealSubjective {
  status:   string;   // 在看 / 想看 / 看过 / 搁置 / 抛弃
  progress: string;   // 已观看集数（有集数时）
  source:   string;   // 观看网址
  rating:   string;
  comment:  string;
}

export type Subjective =
  | AnimeSubjective
  | BookSubjective
  | GameSubjective
  | MusicSubjective
  | RealSubjective;

// ── 分类配置 ──────────────────────────────────────────────────

export interface SubjectTypeConfig {
  archiveRoot:    string;
  archiveMode:    ArchiveMode;   // 动画/三次元用；书籍/游戏忽略此字段
  coverPath:      string;
  templateSource: TemplateSource;
  templateFile:   string;
  overwriteMode:  OverwriteMode;
}

export interface BangumiSettings {
  token:          string;
  videoRootDir:   string;
  createVideoDir: boolean;
  subjectTypes:   Record<SubjectTypeKey, SubjectTypeConfig>;
}
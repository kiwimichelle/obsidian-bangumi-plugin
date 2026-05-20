import { SubjectTypeKey } from './types';

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

// 各分类状态词
export const STATUS_OPTIONS: Record<SubjectTypeKey, string[]> = {
  anime: ['想看', '在看', '看过', '搁置', '抛弃'],
  book:  ['想读', '在读', '已读', '搁置', '抛弃'],
  game:  ['想玩', '在玩', '玩过', '搁置', '抛弃'],
  music: ['想听', '在听', '听过'],
  real:  ['想看', '在看', '看过', '搁置', '抛弃'],
};

// 书籍阅读渠道
export const BOOK_CHANNELS = [
  '哔哩哔哩漫画', '微信读书', '动漫之家',
  'Kindle', 'BookWalker', '实体书', '其他',
];

// 书籍翻译版本
export const BOOK_VERSIONS = [
  '官方正版汉化', '民间汉化组版',
  '台版繁体', '港版繁体', '原版日文', '其他',
];

// 收听平台
export const MUSIC_SOURCES = [
  'Spotify', '网易云音乐', 'Apple Music',
  'QQ音乐', 'YouTube Music', '其他',
];

export const TYPE_FILTERS = [
  { label: '全部',   value: 0 },
  { label: '动画',   value: 2 },
  { label: '书籍',   value: 1 },
  { label: '游戏',   value: 4 },
  { label: '音乐',   value: 3 },
  { label: '三次元', value: 6 },
];

export const TYPE_KEYS: SubjectTypeKey[] = ['anime', 'book', 'game', 'music', 'real'];

// 书系关键词 → 轻小说判断
export const LIGHTNOVEL_SERIES_KEYWORDS = [
  'MF文庫', '電撃文庫', 'ファンタジア文庫', 'GA文庫',
  'HJ文庫', 'オーバーラップ文庫', 'レジェンドノベルス',
  'カドカワBOOKS', 'アース・スター', 'ヒーロー文庫',
  'モンスター文庫', 'Kラノベブックス', 'ダッシュエックス文庫',
];

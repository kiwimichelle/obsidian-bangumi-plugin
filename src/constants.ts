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

export const TYPE_FILTERS = [
  { label: '全部',  value: 0 },
  { label: '动画',  value: 2 },
  { label: '书籍',  value: 1 },
  { label: '游戏',  value: 4 },
  { label: '音乐',  value: 3 },
  { label: '三次元', value: 6 },
];

export const TYPE_KEYS: SubjectTypeKey[] = ['anime', 'book', 'game', 'music', 'real'];
import type {
  ApiRelation,
  ApiSubject,
  InfoboxEntry,
  RawArchiveSubject,
  SubjectData,
  SubjectRelation,
  SubjectTypeKey,
} from '../types';
import { SUBJECT_TYPE_MAP } from '../constants';
import { parseWikiInfobox } from './WikiParser';

export class DataAdapter {
  static fromArchive(raw: RawArchiveSubject): SubjectData {
    const typeKey = mapTypeKey(raw.type);
    const name = raw.name_cn?.trim() || raw.name;

    return {
      id: raw.id,
      typeKey,
      name,
      nameOriginal: raw.name,
      date: raw.date ?? '',
      summary: raw.summary ?? '',
      infobox: parseWikiInfobox(raw.infobox ?? ''),
      eps: raw.eps ?? 0,
      volumes: raw.volumes ?? 0,
      platform: '',
      score: 0,
      rank: 0,
      coverUrl: '',
      tags: pickTopTags(raw.tags),
      relations: [],
      relationsLoaded: false,
      source: 'archive',
    };
  }

  static fromApi(raw: ApiSubject, relations: ApiRelation[] = []): SubjectData {
    const typeKey = mapTypeKey(raw.type);
    const name = raw.name_cn?.trim() || raw.name;
    const coverUrl =
      raw.images?.large ?? raw.images?.common ?? raw.images?.medium ?? '';

    return {
      id: raw.id,
      typeKey,
      name,
      nameOriginal: raw.name,
      date: raw.date ?? '',
      summary: raw.summary ?? '',
      infobox: parseApiInfobox(raw.infobox ?? []),
      eps: raw.eps ?? 0,
      volumes: raw.volumes ?? 0,
      platform: raw.platform ?? '',
      score: raw.rating?.score ?? 0,
      rank: raw.rating?.rank ?? 0,
      coverUrl,
      tags: pickTopTags(raw.tags),
      relations: relations.map(normalizeRelation),
      relationsLoaded: true,
      source: 'api',
    };
  }
}

function mapTypeKey(type: number): SubjectTypeKey {
  return SUBJECT_TYPE_MAP[type] ?? 'anime';
}

function pickTopTags(tags: Array<{ name: string; count: number }> | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  return [...tags]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 15)
    .map(t => t.name)
    .filter(Boolean);
}

function parseApiInfobox(raw: Array<{ key: string; value: unknown }>): InfoboxEntry[] {
  if (!Array.isArray(raw)) return [];

  const result: InfoboxEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item.key !== 'string') continue;
    const key = item.key.trim();
    if (!key) continue;

    const value = flattenApiValue(item.value);
    if (!value) continue;

    result.push({ key, value });
  }
  return result;
}

/**
 * 将 API 返回的任意 value 安全地转换为字符串
 * - 避免将对象转为 "[object Object]"
 * - 对于数组和多值对象，用 "、" 连接
 */
function flattenApiValue(value: unknown): string {
  // 处理原始类型
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  // 处理数组
  if (Array.isArray(value)) {
    const parts = value
      .map(v => flattenApiValue(v)) // 递归调用，确保子元素也被安全处理
      .filter(s => s.length > 0);
    return parts.join('、');
  }

  // 处理普通对象
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const stringValues = Object.values(obj)
      .map(v => flattenApiValue(v))
      .filter(s => s.length > 0);
    return stringValues.join('、');
  }

  // 兜底（理论上不会执行到这里）
  return '';
}

export function normalizeRelation(r: ApiRelation): SubjectRelation {
  return {
    id: r.id,
    name: r.name_cn?.trim() || r.name,
    nameOriginal: r.name,
    relation: r.relation ?? '',
    typeKey: SUBJECT_TYPE_MAP[r.type] ?? null,
  };
}
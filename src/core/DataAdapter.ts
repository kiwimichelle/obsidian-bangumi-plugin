import type {
  ApiRelation,
  ApiSubject,
  CastCredit,
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
    const typeKey  = mapTypeKey(raw.type);
    const name     = raw.name_cn?.trim() || raw.name;
    const coverUrl = raw.image
      ? (raw.image.startsWith('http') ? raw.image : `https://lain.bgm.tv${raw.image}`)
      : '';

    return {
      id:              raw.id,
      typeKey,
      name,
      nameOriginal:    raw.name,
      date:            raw.date ?? '',
      summary:         raw.summary ?? '',
      infobox:         parseWikiInfobox(raw.infobox ?? ''),
      eps:             raw.eps ?? 0,
      volumes:         raw.volumes ?? 0,
      platform:        '',
      score:           raw.score ?? 0,
      rank:            raw.rank  ?? 0,
      coverUrl,
      tags:            pickTopTags(raw.tags, raw.meta_tags),
      nsfw:            raw.nsfw ?? false,
      relations:       [],
      relationsLoaded: false,
      castCredits:     [],   // 离线包无声优数据
      source:          'archive',
    };
  }

  static fromApi(
    raw:         ApiSubject,
    relations:   ApiRelation[] = [],
    castCredits: CastCredit[]  = [],   // 新增：声优数据
  ): SubjectData {
    const typeKey  = mapTypeKey(raw.type);
    const name     = raw.name_cn?.trim() || raw.name;
    const coverUrl =
      raw.images?.large ?? raw.images?.common ?? raw.images?.medium ?? '';

    return {
      id:              raw.id,
      typeKey,
      name,
      nameOriginal:    raw.name,
      date:            raw.date ?? '',
      summary:         raw.summary ?? '',
      infobox:         parseApiInfobox(raw.infobox ?? []),
      eps:             raw.eps ?? 0,
      volumes:         raw.volumes ?? 0,
      platform:        raw.platform ?? '',
      score:           raw.rating?.score ?? 0,
      rank:            raw.rating?.rank  ?? 0,
      coverUrl,
      tags:            pickTopTags(raw.tags),
      nsfw:            raw.nsfw ?? false,
      relations:       relations.map(normalizeRelation),
      relationsLoaded: true,
      castCredits,     // 声优数据直接存入
      source:          'api',
    };
  }
}

function mapTypeKey(type: number): SubjectTypeKey {
  return SUBJECT_TYPE_MAP[type] ?? 'anime';
}

function pickTopTags(
  tags:     Array<{ name: string; count: number }> | undefined,
  metaTags?: string[],
): string[] {
  const merged: Array<{ name: string; count: number }> = [];

  if (tags && tags.length > 0) merged.push(...tags);

  if (metaTags && metaTags.length > 0) {
    const existingNames = new Set(merged.map(t => t.name));
    for (const name of metaTags) {
      if (name && !existingNames.has(name)) merged.push({ name, count: 0 });
    }
  }

  return [...merged]
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
    const key   = item.key.trim();
    if (!key) continue;
    const value = flattenApiValue(item.value);
    if (!value) continue;
    result.push({ key, value });
  }
  return result;
}

function flattenApiValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(v => flattenApiValue(v)).filter(s => s.length > 0).join('、');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(v => flattenApiValue(v))
      .filter(s => s.length > 0)
      .join('、');
  }
  return '';
}

export function normalizeRelation(r: ApiRelation): SubjectRelation {
  return {
    id:           r.id,
    name:         r.name_cn?.trim() || r.name,
    nameOriginal: r.name,
    relation:     r.relation ?? '',
    typeKey:      SUBJECT_TYPE_MAP[r.type] ?? null,
  };
}
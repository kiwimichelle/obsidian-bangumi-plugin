import { requestUrl } from 'obsidian';

const BASE = 'https://api.bgm.tv';
const UA   = 'obsidian-bangumi-plugin/0.3.0';

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': UA };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function searchSubjects(keyword: string, type: number, token?: string): Promise<any[]> {
  const typeParam = type > 0 ? `&type=${type}` : '';
  const res = await requestUrl({
    url: `${BASE}/search/subject/${encodeURIComponent(keyword)}?responseGroup=small&max_results=10${typeParam}`,
    headers: headers(token),
  });
  return (res.json.list ?? []) as any[];
}

export async function fetchSubject(id: number, token?: string): Promise<any> {
  const res = await requestUrl({
    url: `${BASE}/v0/subjects/${id}`,
    headers: headers(token),
  });
  return res.json;
}

export async function fetchSubjectRelations(id: number, token?: string): Promise<any[]> {
  const res = await requestUrl({
    url: `${BASE}/v0/subjects/${id}/subjects`,
    headers: headers(token),
  });
  return Array.isArray(res.json) ? res.json : [];
}

export type InfoboxEntry = { key: string; value: string };

export function parseInfobox(raw: any[]): InfoboxEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    let val = '';
    if (typeof item.value === 'string') {
      val = item.value;
    } else if (Array.isArray(item.value)) {
      val = item.value
        .map((v: any) => typeof v === 'object'
          ? Object.values(v).filter(Boolean).join('')
          : String(v))
        .filter(Boolean)
        .join('、');
    } else {
      val = String(item.value ?? '');
    }
    return { key: String(item.key), value: val.trim() };
  }).filter(e => e.value !== '');
}

export function getInfoboxValue(entries: InfoboxEntry[], candidates: string[]): string {
  for (const key of candidates) {
    const found = entries.find(e => e.key === key);
    if (found) return found.value;
  }
  return '';
}
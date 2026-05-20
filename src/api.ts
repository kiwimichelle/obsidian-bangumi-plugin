import { requestUrl } from 'obsidian';

const BASE = 'https://api.bgm.tv';
const UA   = 'obsidian-bangumi-plugin/0.3.0 (https://github.com/your/repo)';

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': UA };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function searchSubjects(
  keyword: string,
  type: number,
  token?: string,
  page = 1,
  limit = 12
): Promise<{ list: any[]; total: number }> {
  const offset = (page - 1) * limit;
  const body: Record<string, any> = { keyword, limit, offset };
  if (type > 0) body.filter = { type: [type] };

  const res = await requestUrl({
    url: `${BASE}/v0/search/subjects`,
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = res.json;
  return {
    list:  Array.isArray(data?.data) ? data.data : [],
    total: Number(data?.total ?? 0),
  };
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

function parseInfoboxValue(value: any): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item: any) => {
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object' && item !== null) {
          const k = String(item.k ?? '').trim();
          const v = String(item.v ?? '').trim();
          return k ? `${k}：${v}` : v;
        }
        return String(item);
      })
      .filter(Boolean)
      .join('、');
  }
  return String(value ?? '').trim();
}

export function parseInfobox(raw: any[]): InfoboxEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => ({
      key:   String(item.key ?? '').trim(),
      value: parseInfoboxValue(item.value),
    }))
    .filter(e => e.key && e.value);
}

export function getInfoboxValue(entries: InfoboxEntry[], candidates: string[]): string {
  for (const key of candidates) {
    const found = entries.find(e => e.key === key);
    if (found?.value) return found.value;
  }
  return '';
}

// 基于真实 API 数据的 relation 值
export function getSequelPrequel(relations: any[]): {
  sequel:  { name: string; id: number } | null;
  prequel: { name: string; id: number } | null;
} {
  const sequel  = relations.find(r => r.relation === '续集');
  const prequel = relations.find(r => r.relation === '前传');
  return {
    sequel:  sequel  ? { name: String(sequel.name_cn  || sequel.name),  id: Number(sequel.id)  } : null,
    prequel: prequel ? { name: String(prequel.name_cn || prequel.name), id: Number(prequel.id) } : null,
  };
}

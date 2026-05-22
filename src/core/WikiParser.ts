import type { InfoboxEntry } from '../types';

/**
 * 解析 Bangumi Archive dump 中的原始 infobox wiki 字符串
 *
 * 输入示例：
 * ```
 * {{Infobox Anime
 * |中文名= 葬送的芙莉莲
 * |别名= {
 * [英文名]
 * Frieren: Beyond Journey's End
 * [其他]
 * 葬送のフリーレン
 * }
 * |声优= {
 * [フリーレン|种田梨沙]
 * [フェルン|市ノ瀬加那]
 * }
 * }}
 * ```
 *
 * 输出：
 * ```
 * [
 *   { key: '中文名', value: '葬送的芙莉莲' },
 *   { key: '别名',   value: "Frieren: Beyond Journey's End、葬送のフリーレン" },
 *   { key: '声优',   value: '种田梨沙、市ノ瀬加那' },
 * ]
 * ```
 *
 * 多值字段统一用 '、' 连接，对外格式与 DataAdapter.fromApi 输出保持一致
 */
export function parseWikiInfobox(raw: string): InfoboxEntry[] {
  if (!raw || !raw.trim()) return [];

  const lines = raw.split('\n');
  const results: InfoboxEntry[] = [];
  let i = 0;

  // 跳过首行 {{Infobox TYPE 或 {{Infobox animanga/TYPE
  if (lines[0]?.trim().startsWith('{{')) i = 1;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // 终止标记或空行
    if (!trimmed || trimmed === '}}') { i++; continue; }

    // 非键值行（容错跳过）
    if (!trimmed.startsWith('|')) { i++; continue; }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) { i++; continue; }

    const key = trimmed.slice(1, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();

    if (!key) { i++; continue; }

    if (rawVal === '{') {
      // 多值块：收集后续行直到独立的 }
      i++;
      const values: string[] = [];
      while (i < lines.length) {
        const vline = (lines[i] ?? '').trim();
        i++;
        if (vline === '}') break;
        const extracted = extractBlockValue(vline);
        if (extracted) values.push(extracted);
      }
      if (values.length > 0) {
        results.push({ key, value: values.join('、') });
      }
    } else {
      // 单值（可能内联 [a|b] 或 {a|b}）
      const value = extractInlineValue(rawVal);
      if (value) results.push({ key, value });
      i++;
    }
  }

  return results;
}

/**
 * 按候选键名顺序查找 infobox 中的值，返回第一个非空命中
 * 通用工具，对离线/线上来源的 InfoboxEntry[] 均适用
 */
export function getInfoboxValue(entries: InfoboxEntry[], candidates: string[]): string {
  for (const key of candidates) {
    const found = entries.find(e => e.key === key);
    if (found?.value) return found.value;
  }
  return '';
}

/**
 * 从多值块的单行中提取显示值
 * - `[label]`        → null（纯标签，仅作分组用，忽略）
 * - `[label|value]`  → value
 * - `{a|b}`          → b（无 b 则取 a）
 * - plain text       → 原文（去前后空白）
 */
function extractBlockValue(line: string): string | null {
  if (!line) return null;

  // 形如 [label] 或 [label|value]
  if (line.startsWith('[') && line.endsWith(']')) {
    const inner = line.slice(1, -1);
    const pipeIdx = inner.indexOf('|');
    if (pipeIdx === -1) return null; // 纯标签，跳过
    return inner.slice(pipeIdx + 1).trim() || null;
  }

  // 形如 {a|b} 或 {a}
  if (line.startsWith('{') && line.endsWith('}')) {
    const inner = line.slice(1, -1);
    const pipeIdx = inner.indexOf('|');
    if (pipeIdx === -1) return inner.trim() || null;
    const b = inner.slice(pipeIdx + 1).trim();
    return b || inner.slice(0, pipeIdx).trim() || null;
  }

  return line;
}

/**
 * 处理单值字段（不进入多行块模式时）
 * 兼容内联 [a|b] / {a|b} 形式，通常就是 trim 后原值
 */
function extractInlineValue(raw: string): string {
  return extractBlockValue(raw) ?? '';
}

import { App, TFile } from 'obsidian';
import type { SubjectTypeKey } from '../types';

interface PreservePolicy {
  headerPrefixes:   string[];
  preserveSections: string[];
  appendSections:   string[];
}

/**
 * 修复：anime 和 real 的「分集随笔 / 观看随笔」从 preserveSections 移到
 * appendSections，防止更新笔记时用户已勾选的观看记录被新生成的空列表覆盖。
 *
 * preserveSections  → 整段替换为旧内容（适合「个人总结」这类用户独立书写区）
 * appendSections    → 旧内容追加到新内容之后（适合日志类、会累积新条目的区域）
 */
const POLICIES: Record<SubjectTypeKey, PreservePolicy> = {
  anime: {
    headerPrefixes:   ['**已观看集数**', '**观看网址**'],
    preserveSections: ['# 个人总结'],
    appendSections:   ['# 🎞️ 分集随笔'],   // 修复：旧记录追加在新 checkbox 之后
  },
  book: {
    headerPrefixes:   ['**阅读状态**', '**阅读进度**'],
    preserveSections: ['# 个人总结'],
    appendSections:   ['# 📝 读书随笔'],
  },
  game: {
    headerPrefixes:   ['**游玩状态**', '**游玩时长**', '**游玩平台**', '**当前进度**'],
    preserveSections: ['# 个人总结'],
    appendSections:   ['# 📝 游玩随笔'],
  },
  music: {
    headerPrefixes:   ['**收听状态**', '**收听平台**'],
    preserveSections: ['# 个人总结'],
    appendSections:   ['# 收听笔记'],  // 修复：收听笔记改为追加模式，保留历史记录
  },
  real: {
    headerPrefixes:   ['**已观看集数**', '**观看网址**'],
    preserveSections: ['# 个人总结'],
    appendSections:   ['# 📝 观看随笔'],   // 修复：旧记录追加在新 checkbox 之后
  },
};

export interface PreservedContent {
  headerLines:      Map<string, string>;
  preserveSections: Map<string, string>;
  appendSections:   Map<string, string>;
}

export class NoteUpdater {
  constructor(private readonly app: App) {}

  async extract(file: TFile, typeKey: SubjectTypeKey): Promise<PreservedContent> {
    const result: PreservedContent = {
      headerLines:      new Map(),
      preserveSections: new Map(),
      appendSections:   new Map(),
    };
    const policy = POLICIES[typeKey];

    let raw: string;
    try {
      raw = await this.app.vault.read(file);
    } catch (err) {
      console.warn('[bangumi] NoteUpdater.extract 读取文件失败，将跳过内容保留', err);
      return result;
    }

    const body = stripFrontmatter(raw);

    for (const prefix of policy.headerPrefixes) {
      const value = findHeaderValue(body, prefix);
      if (value !== null) result.headerLines.set(prefix, value);
    }
    for (const heading of policy.preserveSections) {
      const content = extractSection(body, heading);
      if (content) result.preserveSections.set(heading, content);
    }
    for (const heading of policy.appendSections) {
      const content = extractSection(body, heading);
      if (content) result.appendSections.set(heading, content);
    }

    return result;
  }

  inject(newContent: string, preserved: PreservedContent, typeKey: SubjectTypeKey): string {
    const policy = POLICIES[typeKey];
    let result   = newContent;

    for (const prefix of policy.headerPrefixes) {
      const oldValue = preserved.headerLines.get(prefix);
      if (oldValue !== undefined) result = replaceHeaderLine(result, prefix, oldValue);
    }
    for (const heading of policy.preserveSections) {
      const oldContent = preserved.preserveSections.get(heading);
      if (oldContent) result = replaceSection(result, heading, oldContent);
    }
    for (const heading of policy.appendSections) {
      const oldContent = preserved.appendSections.get(heading);
      if (oldContent) result = appendToSection(result, heading, oldContent);
    }

    return result;
  }
}

// ─────────────────────────────────────────────
// 内部纯函数
// ─────────────────────────────────────────────

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return content;
  return content.slice(match[0].length);
}

function findHeaderValue(body: string, prefix: string): string | null {
  const re = new RegExp(`^${escapeRegex(prefix)}\\s*[：:]\\s*(.*)$`, 'm');
  const m  = body.match(re);
  return m ? (m[1] ?? '').trim() : null;
}

function replaceHeaderLine(content: string, prefix: string, value: string): string {
  const re = new RegExp(`^${escapeRegex(prefix)}\\s*[：:].*$`, 'm');
  return content.replace(re, `${prefix}： ${value}`);
}

function extractSection(body: string, heading: string): string {
  const lines    = body.split('\n');
  const startIdx = lines.findIndex(l => l.trim() === heading.trim());
  if (startIdx === -1) return '';

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i]!)) { endIdx = i; break; }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim();
}

function replaceSection(content: string, heading: string, oldContent: string): string {
  return rewriteSection(content, heading, () => oldContent);
}

function appendToSection(content: string, heading: string, oldContent: string): string {
  return rewriteSection(content, heading, (current) => {
    const trimmed = current.trim();
    return trimmed ? `${trimmed}\n\n${oldContent}` : oldContent;
  });
}

function rewriteSection(
  content: string,
  heading: string,
  fn:      (current: string) => string,
): string {
  const lines    = content.split('\n');
  const startIdx = lines.findIndex(l => l.trim() === heading.trim());
  if (startIdx === -1) return content;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i]!)) { endIdx = i; break; }
  }
  const current  = lines.slice(startIdx + 1, endIdx).join('\n');
  const replaced = fn(current);
  const head     = lines.slice(0, startIdx + 1);
  const tail     = lines.slice(endIdx);
  return [...head, '', replaced, '', ...tail].join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
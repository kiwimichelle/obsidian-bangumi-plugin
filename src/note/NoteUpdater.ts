import { App, TFile } from 'obsidian';
import type { SubjectTypeKey } from '../types';

// ─────────────────────────────────────────────
// 每个分类的保留策略
// ─────────────────────────────────────────────

interface PreservePolicy {
  /** 正文顶部以 `**xxx**：` 形式呈现的状态行；整行保留 */
  headerPrefixes: string[];
  /** 整段替换为旧内容（用户手写区） */
  preserveSections: string[];
  /** 旧内容追加到新内容之后（时间线日志：新日志在上，旧日志在下） */
  appendSections: string[];
}

const POLICIES: Record<SubjectTypeKey, PreservePolicy> = {
  anime: {
    headerPrefixes: ['**已观看集数**', '**观看网址**'],
    preserveSections: ['# 🎞️ 分集随笔', '# 个人总结'],
    appendSections:   [],
  },
  book: {
    headerPrefixes: ['**阅读状态**', '**阅读进度**'],
    preserveSections: ['# 个人总结'],
    appendSections:   ['# 📝 读书随笔'],
  },
  game: {
    headerPrefixes: ['**游玩状态**', '**游玩时长**', '**游玩平台**', '**当前进度**'],
    preserveSections: ['# 个人总结'],
    appendSections:   ['# 📝 游玩随笔'],
  },
  music: {
    headerPrefixes: ['**收听状态**', '**收听平台**'],
    preserveSections: ['# 🎵 收听笔记', '# 个人总结'],
    appendSections:   [],
  },
  real: {
    headerPrefixes: ['**已观看集数**', '**观看网址**'],
    preserveSections: ['# 📝 观看随笔', '# 个人总结'],
    appendSections:   [],
  },
};

// ─────────────────────────────────────────────
// 公开类型
// ─────────────────────────────────────────────

export interface PreservedContent {
  /** 旧笔记里收集到的 `**prefix**： value` 行，键为 prefix（带 `**`） */
  headerLines: Map<string, string>;
  /** 替换型板块：标题 → 旧正文内容 */
  preserveSections: Map<string, string>;
  /** 追加型板块（日志区）：标题 → 旧正文内容 */
  appendSections: Map<string, string>;
}

// ─────────────────────────────────────────────
// NoteUpdater
// ─────────────────────────────────────────────

/**
 * 覆盖更新已存在笔记时，用于保留用户在正文中手写的内容
 *
 * 流程：
 * 1. `extract(file, typeKey)` — 从旧笔记正文中提取需要保留的部分
 * 2. NoteBuilder 渲染新正文
 * 3. `inject(newContent, preserved, typeKey)` — 把旧内容合并进新正文
 *
 * frontmatter 不在此模块处理（由 FrontmatterWriter 负责）
 */
export class NoteUpdater {
  constructor(private readonly app: App) {}

  /**
   * 从旧笔记正文中提取所有需保留的内容
   *
   * 若文件不存在或读取失败，返回空集合（不抛错，让覆盖更新仍能继续）
   */
  async extract(file: TFile, typeKey: SubjectTypeKey): Promise<PreservedContent> {
  const result: PreservedContent = {
    headerLines:      new Map(),
    preserveSections: new Map(),
    appendSections:   new Map(),
  };
  const policy = POLICIES[typeKey];

  // ✅ 修复：捕获文件读取异常，安全退化为空集合
  let raw: string;
  try {
    raw = await this.app.vault.read(file);
  } catch (err) {
    console.warn(`[bangumi] NoteUpdater.extract 读取文件失败，将跳过内容保留`, err);
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

  /**
   * 把保留内容注入到 NoteBuilder 渲染出的新正文
   *
   * - headerLines：新正文若有同前缀的行，整行替换为旧值
   * - preserveSections：新正文对应标题下的内容整段替换为旧内容
   * - appendSections：旧日志追加到新正文对应标题的当前内容之后
   */
  inject(newContent: string, preserved: PreservedContent, typeKey: SubjectTypeKey): string {
    const policy = POLICIES[typeKey];
    let result = newContent;

    for (const prefix of policy.headerPrefixes) {
      const oldValue = preserved.headerLines.get(prefix);
      if (oldValue !== undefined) {
        result = replaceHeaderLine(result, prefix, oldValue);
      }
    }
    for (const heading of policy.preserveSections) {
      const oldContent = preserved.preserveSections.get(heading);
      if (oldContent) {
        result = replaceSection(result, heading, oldContent);
      }
    }
    for (const heading of policy.appendSections) {
      const oldContent = preserved.appendSections.get(heading);
      if (oldContent) {
        result = appendToSection(result, heading, oldContent);
      }
    }

    return result;
  }
}

// ─────────────────────────────────────────────
// 内部纯函数
// ─────────────────────────────────────────────

/** 去掉文件开头的 YAML frontmatter 块 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return content;
  return content.slice(match[0].length);
}

/** 找到 `prefix： value` 行并取出 value；未找到返回 null（区别于空字符串） */
function findHeaderValue(body: string, prefix: string): string | null {
  const re = new RegExp(`^${escapeRegex(prefix)}\\s*[：:]\\s*(.*)$`, 'm');
  const m = body.match(re);
  return m ? (m[1] ?? '').trim() : null;
}

/** 把同前缀的整行替换为 `prefix： value` */
function replaceHeaderLine(content: string, prefix: string, value: string): string {
  const re = new RegExp(`^${escapeRegex(prefix)}\\s*[：:].*$`, 'm');
  return content.replace(re, `${prefix}： ${value}`);
}

/**
 * 提取 `# 标题` 与下一个一级标题之间的正文（去掉首尾空白）
 *
 * 区分「标题不存在」与「标题存在但内容为空」：前者返回空串，inject 阶段不会做任何替换
 */
function extractSection(body: string, heading: string): string {
  const lines = body.split('\n');
  const startIdx = lines.findIndex(l => l.trim() === heading.trim());
  if (startIdx === -1) return '';

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i]!)) { endIdx = i; break; }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim();
}

/** 用 oldContent 整段替换 `# 标题` 与下一个一级标题之间的内容 */
function replaceSection(content: string, heading: string, oldContent: string): string {
  return rewriteSection(content, heading, () => oldContent);
}

/** 把 oldContent 追加到 `# 标题` 当前内容之后（中间留一空行） */
function appendToSection(content: string, heading: string, oldContent: string): string {
  return rewriteSection(content, heading, (current) => {
    const trimmed = current.trim();
    return trimmed ? `${trimmed}\n\n${oldContent}` : oldContent;
  });
}

/** 通用板块改写：找到 `# 标题` 后，把它和下一个一级标题之间的内容交给 fn 处理 */
function rewriteSection(
  content: string,
  heading: string,
  fn: (current: string) => string,
): string {
  const lines = content.split('\n');
  const startIdx = lines.findIndex(l => l.trim() === heading.trim());
  if (startIdx === -1) return content;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i]!)) { endIdx = i; break; }
  }
  const current = lines.slice(startIdx + 1, endIdx).join('\n');
  const replaced = fn(current);

  const head = lines.slice(0, startIdx + 1);
  const tail = lines.slice(endIdx);
  return [...head, '', replaced, '', ...tail].join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import { App, Notice, TFile, TFolder, requestUrl } from 'obsidian';
import { BangumiSettings, SubjectTypeKey } from './types';

// ── 封面下载 ────────────────────────────────────────────────────

export async function downloadCover(
  app: App,
  imageUrl: string,
  coverDir: string,
  filename: string
): Promise<string> {
  if (!imageUrl) return '';
  await ensureFolder(app, coverDir);

  const ext = imageUrl.split('.').pop()?.split('?')[0] ?? 'jpg';
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_');
  const localPath = `${coverDir}/${safeName}.${ext}`;

  if (app.vault.getAbstractFileByPath(localPath)) return localPath;

  try {
    const res = await requestUrl({ url: imageUrl });
    await app.vault.createBinary(localPath, res.arrayBuffer);
    return localPath;
  } catch {
    new Notice('⚠️ 封面下载失败，将使用外链');
    return imageUrl;
  }
}

// ── 本地视频文件夹 ──────────────────────────────────────────────

export async function createLocalVideoDir(
  rootDir: string,
  animeName: string
): Promise<void> {
  if (!rootDir) return;
  try {
    const path = (window as any).require('path') as typeof import('path');
    const fs   = (window as any).require('fs')   as typeof import('fs');
    const target = path.join(rootDir, animeName.replace(/[\\/:*?"<>|]/g, '_'));
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  } catch {
    new Notice('⚠️ 本地视频文件夹创建失败');
  }
}

// ── 防撞命名 ────────────────────────────────────────────────────

// 递归收集某文件夹下所有 .md 文件的 stem（不含扩展名）→ Set
function collectMdStems(app: App, folderPath: string): Set<string> {
  const stems = new Set<string>();
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return stems;

  const walk = (f: TFolder) => {
    for (const child of f.children) {
      if (child instanceof TFolder) {
        walk(child);
      } else if (child instanceof TFile) {
        if (child.name.endsWith('.md')) {
          stems.add(child.name.slice(0, -3));
        }
      }
    }
  };
  walk(folder);
  return stems;
}

// 读取某笔记 frontmatter 里的 bangumi_id
async function readBangumiId(app: App, filePath: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!file || !('extension' in file)) return '';
  const content = await app.vault.read(file as TFile);
  const match = content.match(/^bangumi_id:\s*(.+)$/m);
  return match ? match[1].trim().replace(/['"]/g, '') : '';
}

// 在某文件夹及其子目录下找到指定 stem 的文件路径
function findMdByName(app: App, folderPath: string, stem: string): string | null {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder || !('children' in folder)) return null;

  const walk = (f: TFolder): string | null => {
    for (const child of f.children) {
      if ('children' in child) {
        const found = walk(child as TFolder);
        if (found) return found;
      } else if (child.name === `${stem}.md`) {
        return child.path;
      }
    }
    return null;
  };
  return walk(folder as TFolder);
}

export interface NamingResult {
  filename: string;          // 最终文件名（不含 .md）
  conflict: 'none' | 'same' | 'different';  // same=同ID覆盖, different=不同作品
  existingPath: string;      // 已存在文件的路径（conflict !== none 时有值）
}

export async function resolveNaming(
  app: App,
  baseName: string,
  typeKey: SubjectTypeKey,
  typeLabel: string,
  archiveRoot: string,        // 当前类型归档根路径
  otherArchiveRoots: string[], // 其他类型归档根路径
  year: string,
  bangumiId: string,
  subjectTypeDesc: string,    // 如 TV/剧场版/OVA，从 infobox 读取
): Promise<NamingResult> {

  // ── 第一步：跨媒介检测 ──
  let name = baseName;
  let hasCrossConflict = false;

  for (const root of otherArchiveRoots) {
    const stems = collectMdStems(app, root);
    // 检查原始名 和 加了各种后缀的名字
    if (stems.has(baseName) || stems.has(`${baseName} (${typeLabel})`)) {
      hasCrossConflict = true;
      break;
    }
  }

  if (hasCrossConflict) {
    name = `${baseName} (${typeLabel})`;
  }

  // ── 第二步：同类型内检测 ──
  const existingPath = findMdByName(app, archiveRoot, name);

  if (!existingPath) {
    return { filename: name, conflict: 'none', existingPath: '' };
  }

  // 读取已有文件的 bangumi_id
  const existingId = await readBangumiId(app, existingPath);

  if (existingId === bangumiId) {
    // 同一作品，覆盖逻辑
    return { filename: name, conflict: 'same', existingPath };
  }

  // 不同作品，加年份后缀
  const nameWithYear = `${name} (${year})`;
  const existingWithYear = findMdByName(app, archiveRoot, nameWithYear);

  if (!existingWithYear) {
    return { filename: nameWithYear, conflict: 'none', existingPath: '' };
  }

  const existingYearId = await readBangumiId(app, existingWithYear);
  if (existingYearId === bangumiId) {
    return { filename: nameWithYear, conflict: 'same', existingPath: existingWithYear };
  }

  // 年份还冲突，加年份+类型描述（TV/剧场版等）
  const desc = subjectTypeDesc || typeLabel;
  const nameWithYearDesc = `${name} (${year} ${desc})`;
  const existingWithYearDesc = findMdByName(app, archiveRoot, nameWithYearDesc);

  if (!existingWithYearDesc) {
    return { filename: nameWithYearDesc, conflict: 'none', existingPath: '' };
  }

  const existingYearDescId = await readBangumiId(app, existingWithYearDesc);
  if (existingYearDescId === bangumiId) {
    return { filename: nameWithYearDesc, conflict: 'same', existingPath: existingWithYearDesc };
  }

  // 极端情况：加 bangumi_id 保底
  return {
    filename: `${name} (${year} ${desc} ${bangumiId})`,
    conflict: 'none',
    existingPath: ''
  };
}

// ── 覆盖更新：提取手写内容 ─────────────────────────────────────

export interface PreservedContent {
  watchedEps: string;
  watchUrl:   string;
  episodeNotes:    string;
  personalSummary: string;
}

export async function extractPreservedContent(
  app: App,
  filePath: string
): Promise<PreservedContent> {
  const result: PreservedContent = {
    watchedEps: '', watchUrl: '',
    episodeNotes: '', personalSummary: '',
  };
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!file || !('extension' in file)) return result;

  const content = await app.vault.read(file as TFile);
  const lines   = content.split('\n');

  const epsLine = lines.find(l => l.startsWith('**已观看集数**'));
  if (epsLine) result.watchedEps = epsLine.replace('**已观看集数**：', '').trim();

  const urlLine = lines.find(l => l.startsWith('**观看网址**'));
  if (urlLine) result.watchUrl = urlLine.replace('**观看网址**：', '').trim();

  result.episodeNotes    = extractSection(content, '# 🎞️ 分集随笔');
  result.personalSummary = extractSection(content, '# 个人总结');

  return result;
}

function extractSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start === -1) return '';
  const afterHeading = content.indexOf('\n', start) + 1;
  const nextHeading  = content.indexOf('\n# ', afterHeading);
  const end = nextHeading === -1 ? content.length : nextHeading;
  return content.slice(afterHeading, end).trim();
}

export function injectPreservedContent(
  newContent: string,
  preserved: PreservedContent
): string {
  let result = newContent;
  if (preserved.watchedEps) {
    result = result.replace(
      /\*\*已观看集数\*\*：.*/,
      `**已观看集数**： ${preserved.watchedEps}`
    );
  }
  if (preserved.watchUrl) {
    result = result.replace(
      /\*\*观看网址\*\*：.*/,
      `**观看网址**： ${preserved.watchUrl}`
    );
  }
  if (preserved.episodeNotes) {
    result = result.replace(
      /(# 🎞️ 分集随笔\n)([\s\S]*?)(\n# |$)/,
      `$1\n${preserved.episodeNotes}\n$3`
    );
  }
  if (preserved.personalSummary) {
    result = result.replace(
      /(# 个人总结\n)([\s\S]*?)$/,
      `$1\n${preserved.personalSummary}`
    );
  }
  return result;
}

// ── 工具 ────────────────────────────────────────────────────────

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      await app.vault.createFolder(current);
    } else if (!('children' in existing)) {
      throw new Error(`路径 ${current} 已被文件占用`);
    }
  }
}
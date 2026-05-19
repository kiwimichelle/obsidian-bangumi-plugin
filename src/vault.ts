import { App, Notice, TFile, TFolder, requestUrl } from 'obsidian';
import { SubjectTypeKey } from './types';
import type { InfoboxEntry } from './api';

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

export async function createLocalVideoDir(rootDir: string, animeName: string): Promise<void> {
  if (!rootDir) return;
  try {
    const safeName = animeName.replace(/[\\/:*?"<>|]/g, '_');
    // Obsidian 桌面端基于 Electron，可以访问 Node.js 内置模块
    const nodePath = require('path') as typeof import('path');
    const nodeFs   = require('fs')   as typeof import('fs');
    const fullPath = nodePath.join(rootDir, safeName);
    if (!nodeFs.existsSync(fullPath)) {
      nodeFs.mkdirSync(fullPath, { recursive: true });
    }
  } catch {
    new Notice('⚠️ 本地视频文件夹创建失败');
  }
}

function collectMdStems(app: App, folderPath: string): Set<string> {
  const stems = new Set<string>();
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return stems;

  const walk = (f: TFolder) => {
    for (const child of f.children) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile && child.name.endsWith('.md')) {
        stems.add(child.name.slice(0, -3));
      }
    }
  };
  walk(folder);
  return stems;
}

async function readBangumiId(app: App, filePath: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return '';
  const content = await app.vault.read(file);
  const match = content.match(/^bangumi_id:\s*["']?(\d+)["']?$/m);
  return match?.[1] ?? '';
}

function findMdByName(app: App, folderPath: string, stem: string): string | null {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return null;

  const walk = (f: TFolder): string | null => {
    for (const child of f.children) {
      if (child instanceof TFolder) {
        const found = walk(child);
        if (found) return found;
      } else if (child instanceof TFile && child.name === `${stem}.md`) {
        return child.path;
      }
    }
    return null;
  };
  return walk(folder);
}

export interface NamingResult {
  filename: string;
  conflict: 'none' | 'same' | 'different';
  existingPath: string;
}

export async function resolveNaming(
  app: App,
  baseName: string,
  typeKey: SubjectTypeKey,
  typeLabel: string,
  archiveRoot: string,
  otherArchiveRoots: string[],
  year: string,
  bangumiId: string,
  subjectTypeDesc: string,
): Promise<NamingResult> {
  // 第一步：跨媒介检测
  let name = baseName;
  for (const root of otherArchiveRoots) {
    const stems = collectMdStems(app, root);
    if (stems.has(baseName) || stems.has(`${baseName} (${typeLabel})`)) {
      name = `${baseName} (${typeLabel})`;
      break;
    }
  }

  // 第二步：同类型内检测
  const existingPath = findMdByName(app, archiveRoot, name);
  if (!existingPath) return { filename: name, conflict: 'none', existingPath: '' };

  const existingId = await readBangumiId(app, existingPath);
  if (existingId === bangumiId) return { filename: name, conflict: 'same', existingPath };

  // 加年份后缀
  const nameWithYear = `${name} (${year})`;
  const existingWithYear = findMdByName(app, archiveRoot, nameWithYear);
  if (!existingWithYear) return { filename: nameWithYear, conflict: 'none', existingPath: '' };

  const existingYearId = await readBangumiId(app, existingWithYear);
  if (existingYearId === bangumiId) return { filename: nameWithYear, conflict: 'same', existingPath: existingWithYear };

  // 加年份+类型描述
  const desc = subjectTypeDesc || typeLabel;
  const nameWithYearDesc = `${name} (${year} ${desc})`;
  const existingWithYearDesc = findMdByName(app, archiveRoot, nameWithYearDesc);
  if (!existingWithYearDesc) return { filename: nameWithYearDesc, conflict: 'none', existingPath: '' };

  const existingYearDescId = await readBangumiId(app, existingWithYearDesc);
  if (existingYearDescId === bangumiId) return { filename: nameWithYearDesc, conflict: 'same', existingPath: existingWithYearDesc };

  // 保底：加 bangumi_id
  return { filename: `${name} (${year} ${desc} ${bangumiId})`, conflict: 'none', existingPath: '' };
}

export interface PreservedContent {
  watchedEps: string;
  watchUrl: string;
  episodeNotes: string;
  personalSummary: string;
}

export async function extractPreservedContent(app: App, filePath: string): Promise<PreservedContent> {
  const result: PreservedContent = { watchedEps: '', watchUrl: '', episodeNotes: '', personalSummary: '' };
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return result;

  const content = await app.vault.read(file);
  const lines = content.split('\n');

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
  const nextHeading = content.indexOf('\n# ', afterHeading);
  const end = nextHeading === -1 ? content.length : nextHeading;
  return content.slice(afterHeading, end).trim();
}

export function injectPreservedContent(newContent: string, preserved: PreservedContent): string {
  let result = newContent;
  if (preserved.watchedEps) {
    result = result.replace(/\*\*已观看集数\*\*：.*/, `**已观看集数**： ${preserved.watchedEps}`);
  }
  if (preserved.watchUrl) {
    result = result.replace(/\*\*观看网址\*\*：.*/, `**观看网址**： ${preserved.watchUrl}`);
  }
  if (preserved.episodeNotes) {
    result = result.replace(
      /(# 🎞️ 分集随笔\n)([\s\S]*?)(\n# |$)/,
      `$1\n${preserved.episodeNotes}\n$3`
    );
  }
  if (preserved.personalSummary) {
    result = result.replace(/(# 个人总结\n)([\s\S]*?)$/, `$1\n${preserved.personalSummary}`);
  }
  return result;
}

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      await app.vault.createFolder(current);
    } else if (!(existing instanceof TFolder)) {
      throw new Error(`路径 ${current} 已被文件占用`);
    }
  }
}
export async function writeFrontmatter(
  app: App,
  file: TFile,
  detail: any,
  infobox: InfoboxEntry[],
  vars: import('./template').TemplateVars,
  typeKey: SubjectTypeKey,
  coverLocal: string,
): Promise<void> {
  const INFOBOX_EXCLUDE = ['tags', 'Tags', '标签', 'tag', '中文名', '日文名'];

  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    // 固定字段
    fm['中文名']   = vars.title;
    fm['日文名']   = vars.original_title;
    fm['cover']    = coverLocal;
    fm['BGM链接']  = vars.bangumi_url;
    fm['BGM评分']  = vars.score;
    fm['bangumi_id'] = vars.bangumi_id;
    fm['记录日期'] = vars.today;

    // 分类专属
    if (typeKey === 'anime') {
      fm['改编类型'] = vars.adaptation;
      fm['总集数']   = vars.eps_count;
      fm['开播年份'] = vars.year;
      fm['开播季度'] = vars.season;
      if (vars.related_series) fm['所属系列'] = `[[${vars.related_series}]]`;
    }
    if (typeKey === 'book') {
      if (vars.author)    fm['作者']   = vars.author;
      if (vars.publisher) fm['出版社'] = vars.publisher;
      if (vars.volumes)   fm['册数']   = vars.volumes;
    }
    if (typeKey === 'game') {
      if (vars.developer) fm['开发商'] = vars.developer;
      if (vars.platform)  fm['平台']   = vars.platform;
    }
    if (typeKey === 'music') {
      if (vars.artist)      fm['艺术家'] = vars.artist;
      if (vars.track_count) fm['曲目数'] = vars.track_count;
    }

    // infobox 所有字段（Obsidian 自动处理转义）
    for (const entry of infobox) {
      if (!INFOBOX_EXCLUDE.includes(entry.key)) {
        fm[entry.key] = entry.value;
      }
    }

    // tags
    const tags: string[] = ['bangumi'];
    for (const t of (detail.tags ?? [])) {
      tags.push(`bgm/${String(t.name)}`);
    }
    const existing: string[] = Array.isArray(fm['tags'])
      ? (fm['tags'] as string[])
      : [];
    fm['tags'] = Array.from(new Set([...existing, ...tags]));
  });
}
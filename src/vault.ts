import { App, TFile, requestUrl, Platform } from 'obsidian';
import { SubjectTypeKey } from './types';
import { TemplateVars } from './template';
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
    console.warn(`[Bangumi] 封面下载失败，降级使用网络外链: ${imageUrl}`);
    return imageUrl;
  }
}

export async function createLocalVideoDir(app: App, rootDir: string, animeName: string): Promise<void> {
  if (!rootDir) return;
  if (!Platform.isDesktop) {
    return;
  }

  try {
    const safeName = animeName.replace(/[\\/:*?"<>|]/g, '_');
    const nodePath = require('path') as typeof import('path');
    const nodeFs = require('fs') as typeof import('fs');
    
    let targetPath = '';
    if (nodePath.isAbsolute(rootDir)) {
      targetPath = nodePath.join(rootDir, safeName);
    } else {
      const adapter = app.vault.adapter as any;
      const basePath = typeof adapter.getBasePath === 'function' ? (adapter.getBasePath() as string) : '';
      targetPath = nodePath.join(basePath, rootDir, safeName);
    }

    if (!nodeFs.existsSync(targetPath)) {
      nodeFs.mkdirSync(targetPath, { recursive: true });
    }
  } catch {
    console.error('[Bangumi] 本地物理目录创建失败');
  }
}

export async function ensureFolder(app: App, path: string): Promise<void> {
  if (!path) return;
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const p of parts) {
    current = current ? `${current}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

export interface NamingResult {
  filename: string;
  existingPath: string;
  conflict: 'none' | 'same' | 'other';
}

export async function resolveNaming(
  app: App,
  baseTitle: string,
  typeKey: SubjectTypeKey,
  typeLabel: string,
  currentRoot: string,
  otherRoots: string[],
  year: string,
  bangumiId: string,
  subjectTypeDesc: string
): Promise<NamingResult> {
  const files = app.vault.getMarkdownFiles();

  for (const f of files) {
    const cache = app.metadataCache.getFileCache(f);
    const frontmatter = cache?.frontmatter;
    if (frontmatter && String(frontmatter.bangumi_id) === String(bangumiId)) {
      if (f.path.startsWith(currentRoot + '/')) {
        return { filename: f.basename, existingPath: f.path, conflict: 'same' };
      }
      for (const r of otherRoots) {
        if (f.path.startsWith(r + '/')) {
          return { filename: f.basename, existingPath: f.path, conflict: 'other' };
        }
      }
    }
  }

  return { filename: baseTitle, existingPath: '', conflict: 'none' };
}

export async function extractPreservedContent(app: App, filePath: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return '';
  const text = await app.vault.read(file);
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? (match[1]?.trim() ?? '') : text.trim();
}

export function injectPreservedContent(newContent: string, preserved: string): string {
  if (!preserved) return newContent;
  const sections = ['# 个人总结', '# 随笔', '# 吐槽', '# 笔记'];
  for (const sec of sections) {
    if (preserved.includes(sec) && newContent.includes(sec)) {
      const pMatch = preserved.match(new RegExp(`${sec}\\r?\\n([\\s\\S]*?)(?=$|\\r?\\n# )`));
      if (pMatch) {
        const captured = pMatch[1];
        if (captured && captured.trim()) {
          newContent = newContent.replace(
            sec,
            `${sec}\n${captured.trim()}`
          );
        }
      }
    }
  }
  return newContent;
}

export async function writeFrontmatter(
  app: App,
  file: TFile,
  detail: any,
  infobox: InfoboxEntry[],
  vars: TemplateVars,
  typeKey: SubjectTypeKey,
  coverLocal: string
): Promise<void> {
  const INFOBOX_EXCLUDE = ['tags', 'Tags', '标签', 'tag', '中文名', '日文名'];

  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    fm['中文名'] = vars.title;
    fm['日文名'] = vars.original_title;
    fm['cover'] = coverLocal;
    fm['BGM链接'] = vars.bangumi_url;
    fm['BGM评分'] = vars.score;
    fm['bangumi_id'] = vars.bangumi_id;
    fm['记录日期'] = vars.today;
    
    if (vars.my_status) fm['个人状态'] = vars.my_status;
    if (vars.my_rating) fm['个人评分'] = Number(vars.my_rating) || vars.my_rating;
    if (vars.my_comment) fm['即时短评'] = vars.my_comment;

    if (typeKey === 'anime') {
      fm['改编类型'] = vars.adaptation;
      fm['总集数'] = vars.eps_count;
      fm['开播年份'] = vars.year;
      fm['开播季度'] = vars.season;
      if (vars.related_series) fm['所属系列'] = `[[${vars.related_series}]]`;
    }
    if (typeKey === 'book') {
      if (vars.author) fm['作者'] = vars.author;
      if (vars.publisher) fm['出版社'] = vars.publisher;
      if (vars.volumes) fm['册数'] = vars.volumes;
    }
    if (typeKey === 'game') {
      if (vars.developer) fm['开发商'] = vars.developer;
      if (vars.platform) fm['平台'] = vars.platform;
    }
    if (typeKey === 'music') {
      if (vars.artist) fm['艺术家'] = vars.artist;
      if (vars.track_count) fm['曲目数'] = vars.track_count;
    }

    const existingTags = Array.isArray(fm['tags']) ? fm['tags'].map(String) : [];
    const bgmTags = ((detail.tags as any[]) || []).map((t: any) => String(t.name)).slice(0, 8);
    const mergedTags = Array.from(new Set([...existingTags, ...bgmTags]));
    if (mergedTags.length > 0) fm['tags'] = mergedTags;

    infobox.forEach(item => {
      if (!INFOBOX_EXCLUDE.includes(item.key) && item.value) {
        const safeKey = item.key.replace(/[:\s]/g, '_');
        if (fm[safeKey] === undefined) {
          fm[safeKey] = item.value;
        }
      }
    });
  });
}
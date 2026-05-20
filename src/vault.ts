import { App, Notice, TFile, TFolder, requestUrl, Platform } from 'obsidian';
import { SubjectTypeKey, BookSubtype, GamePlatform, BOOK_SUBTYPE_DIR } from './types';
import type { InfoboxEntry } from './api';
import type { TemplateVars } from './template';

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

// ── 本地视频/下载文件夹 ─────────────────────────────────────────

export async function createLocalVideoDir(
  app: App,
  rootDir: string,
  name: string
): Promise<void> {
  if (!rootDir || !Platform.isDesktop) return;
  try {
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
    const nodePath = require('path') as typeof import('path');
    const nodeFs   = require('fs')   as typeof import('fs');
    const fullPath = nodePath.isAbsolute(rootDir)
      ? nodePath.join(rootDir, safeName)
      : nodePath.join(
          (app.vault.adapter as any).getBasePath?.() ?? '',
          rootDir,
          safeName
        );
    if (!nodeFs.existsSync(fullPath)) {
      nodeFs.mkdirSync(fullPath, { recursive: true });
    }
  } catch {
    new Notice('⚠️ 本地文件夹创建失败');
  }
}

// ── 防撞命名 ────────────────────────────────────────────────────

export interface NamingResult {
  filename:     string;
  existingPath: string;
  conflict:     'none' | 'same' | 'other';
}

export async function resolveNaming(
  app: App,
  baseTitle: string,
  typeKey: SubjectTypeKey,
  typeLabel: string,
  currentRoot: string,
  otherRoots: string[],
  bangumiId: string,
): Promise<NamingResult> {
  const files = app.vault.getMarkdownFiles();

  // 优先用 bangumi_id 精确匹配
  for (const f of files) {
    const cache = app.metadataCache.getFileCache(f);
    const fm = cache?.frontmatter;
    if (!fm) continue;
    if (String(fm['bangumi_id']) !== String(bangumiId)) continue;

    // ID 匹配 → 同一作品
    if (f.path.startsWith(currentRoot + '/') || f.path.startsWith(currentRoot)) {
      return { filename: f.basename, existingPath: f.path, conflict: 'same' };
    }
    for (const r of otherRoots) {
      if (f.path.startsWith(r + '/') || f.path.startsWith(r)) {
        return { filename: f.basename, existingPath: f.path, conflict: 'other' };
      }
    }
  }

  // 没有 ID 匹配 → 检查同名文件（跨媒介防撞）
  for (const r of otherRoots) {
    const stems = collectMdStems(app, r);
    if (stems.has(baseTitle)) {
      // 跨媒介同名 → 加类型后缀
      return {
        filename:     `${baseTitle} (${typeLabel})`,
        existingPath: '',
        conflict:     'none',
      };
    }
  }

  return { filename: baseTitle, existingPath: '', conflict: 'none' };
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

// ── 手写内容提取与注入 ──────────────────────────────────────────

export interface PreservedContent {
  // 动画/三次元
  watchedEps:      string;
  watchUrl:        string;
  episodeNotes:    string;
  // 书籍
  readProgress:    string;
  bookLogs:        string;
  // 游戏
  gameHours:       string;
  gameProgress:    string;
  gameLogs:        string;
  // 通用
  personalSummary: string;
}

export async function extractPreservedContent(
  app: App,
  filePath: string,
  typeKey: SubjectTypeKey,
): Promise<PreservedContent> {
  const empty: PreservedContent = {
    watchedEps: '', watchUrl: '', episodeNotes: '',
    readProgress: '', bookLogs: '',
    gameHours: '', gameProgress: '', gameLogs: '',
    personalSummary: '',
  };

  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return empty;

  const content = await app.vault.read(file);
  const lines   = content.split('\n');

  const result = { ...empty };

  if (typeKey === 'anime' || typeKey === 'real') {
    const epsLine = lines.find(l => l.startsWith('**已观看集数**'));
    if (epsLine) result.watchedEps = epsLine.replace(/^\*\*已观看集数\*\*：\s*/, '').trim();
    const urlLine = lines.find(l => l.startsWith('**观看网址**'));
    if (urlLine) result.watchUrl = urlLine.replace(/^\*\*观看网址\*\*：\s*/, '').trim();
    result.episodeNotes = extractSection(content, '# 🎞️ 分集随笔');
  }

  if (typeKey === 'book') {
    const progLine = lines.find(l => l.startsWith('**阅读进度**'));
    if (progLine) result.readProgress = progLine.replace(/^\*\*阅读进度\*\*：\s*/, '').trim();
    result.bookLogs = extractSection(content, '# 📝 读书随笔');
  }

  if (typeKey === 'game') {
    const hoursLine = lines.find(l => l.startsWith('**游玩时长**'));
    if (hoursLine) {
      result.gameHours = hoursLine
        .replace(/^\*\*游玩时长\*\*：\s*/, '')
        .replace(/\s*小时.*/, '')
        .trim();
    }
    const progLine = lines.find(l => l.startsWith('**当前进度**'));
    if (progLine) result.gameProgress = progLine.replace(/^\*\*当前进度\*\*：\s*/, '').trim();
    result.gameLogs = extractSection(content, '# 📝 游玩随笔');
  }

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
  preserved: PreservedContent,
  typeKey: SubjectTypeKey,
): string {
  let out = newContent;

  if (typeKey === 'anime' || typeKey === 'real') {
    if (preserved.watchedEps) {
      out = out.replace(/^\*\*已观看集数\*\*：.*$/m, `**已观看集数**： ${preserved.watchedEps}`);
    }
    if (preserved.watchUrl) {
      out = out.replace(/^\*\*观看网址\*\*：.*$/m, `**观看网址**： ${preserved.watchUrl}`);
    }
    if (preserved.episodeNotes) {
      out = out.replace(
        /(# 🎞️ 分集随笔\n)([\s\S]*?)(\n# |$)/,
        `$1\n${preserved.episodeNotes}\n$3`
      );
    }
  }

  if (typeKey === 'book' && preserved.bookLogs) {
    out = out.replace(
      /(# 📝 读书随笔\n)([\s\S]*?)(\n# |$)/,
      `$1\n${preserved.bookLogs}\n$3`
    );
  }

  if (typeKey === 'game') {
    if (preserved.gameHours) {
      out = out.replace(/^\*\*游玩时长\*\*：.*$/m, `**游玩时长**： ${preserved.gameHours} 小时`);
    }
    if (preserved.gameLogs) {
      out = out.replace(
        /(# 📝 游玩随笔\n)([\s\S]*?)(\n# |$)/,
        `$1\n${preserved.gameLogs}\n$3`
      );
    }
  }

  if (preserved.personalSummary) {
    out = out.replace(/(# 个人总结\n)([\s\S]*?)$/, `$1\n${preserved.personalSummary}`);
  }

  return out;
}

// ── 书籍/游戏时间线日志追加 ─────────────────────────────────────

export function prependLog(existingLogs: string, newLogLine: string): string {
  if (!existingLogs || existingLogs.includes('暂无记录')) {
    return newLogLine;
  }
  return `${newLogLine}\n${existingLogs}`;
}

// ── Frontmatter 写入（官方 API）────────────────────────────────

const FM_INFOBOX_EXCLUDE = new Set([
  'tags', 'Tags', '标签', 'tag',
  '中文名', '日文名', '别名',
  '官方网站',  // URL 类不写进 frontmatter
]);

export async function writeFrontmatter(
  app: App,
  file: TFile,
  detail: any,
  infobox: InfoboxEntry[],
  vars: TemplateVars,
  typeKey: SubjectTypeKey,
  coverLocal: string,
  subjective: any,
): Promise<void> {
  try {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      // ── 通用固定字段 ──
      fm['中文名']    = vars.title;
      fm['日文名']    = vars.original_title;
      fm['cover']     = coverLocal;
      fm['BGM链接']   = vars.bangumi_url;
      fm['BGM评分']   = vars.score ? Number(vars.score) : '';
      fm['bangumi_id'] = vars.bangumi_id;
      fm['记录日期']  = vars.today;

      if (vars.my_status)  fm['个人状态'] = vars.my_status;
      if (vars.my_rating)  fm['个人评分'] = Number(vars.my_rating) || vars.my_rating;
      if (vars.my_comment) fm['即时短评'] = vars.my_comment;

      // ── 分类专属 ──
      if (typeKey === 'anime') {
        fm['改编类型'] = vars.adaptation;
        fm['总集数']   = vars.eps_count ? Number(vars.eps_count) : '';
        fm['开播年份'] = vars.year;
        fm['开播季度'] = vars.season;
        if (vars.sequel)  fm['续集'] = `[[${vars.sequel}]]`;
        if (vars.prequel) fm['前传'] = `[[${vars.prequel}]]`;
        if (vars.related_series) fm['所属系列'] = vars.related_series;
      }

      if (typeKey === 'real') {
        fm['总集数']   = vars.eps_count ? Number(vars.eps_count) : '';
        fm['开播年份'] = vars.year;
        fm['开播季度'] = vars.season;
      }

      if (typeKey === 'book') {
        fm['阅读状态'] = vars.my_status;
        fm['阅读进度'] = vars.my_read_progress;
        fm['阅读渠道'] = vars.my_channel;
        fm['翻译版本'] = vars.my_version;
        if (vars.author)    fm['作者']   = vars.author;
        if (vars.publisher) fm['出版社'] = vars.publisher;
        if (vars.volumes)   fm['册数']   = vars.volumes;
        if (vars.isbn)      fm['ISBN']   = vars.isbn;
      }

      if (typeKey === 'game') {
        fm['游玩状态'] = vars.my_status;
        fm['游玩平台'] = vars.my_platform;
        fm['游玩时长'] = Number(vars.my_hours) || 0;
        fm['当前进度'] = vars.my_game_progress;
        if (vars.developer) fm['开发商'] = vars.developer;
        if (vars.platform)  fm['平台']   = vars.platform;
      }

      if (typeKey === 'music') {
        fm['收听状态'] = vars.my_status;
        fm['收听平台'] = vars.my_music_source;
        if (vars.artist)      fm['艺术家'] = vars.artist;
        if (vars.track_count) fm['曲目数'] = vars.track_count;
      }

      // ── infobox 剩余字段（自动，不覆盖上面已写的）──
      for (const entry of infobox) {
        if (FM_INFOBOX_EXCLUDE.has(entry.key)) continue;
        const safeKey = entry.key.replace(/\s+/g, '_');
        if (fm[safeKey] !== undefined) continue; // 不覆盖已有字段
        fm[safeKey] = entry.value;
      }

      // ── tags ──
      const bgmTags = ((detail.tags ?? []) as any[])
        .map((t: any) => `bgm/${String(t.name)}`)
        .slice(0, 15);
      const existing = Array.isArray(fm['tags'])
        ? (fm['tags'] as string[]).map(String)
        : [];
      fm['tags'] = Array.from(new Set(['bangumi', ...existing, ...bgmTags]));
    });
  } catch (e) {
    new Notice('⚠️ 写入属性时出错，请检查笔记');
    console.error('[Bangumi] processFrontMatter error:', e);
  }
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
    } else if (!(existing instanceof TFolder)) {
      throw new Error(`路径 ${current} 已被文件占用`);
    }
  }
}
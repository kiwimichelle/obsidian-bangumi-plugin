import { App, normalizePath, TFolder } from 'obsidian';
import type { SubjectData, BangumiSettings } from '../types';
import { parseYearSeason } from '../note/NoteBuilder';

export class VaultHelper {
  /**
   * 根据条目类型和设置，推导出其应当归档的目录（库内相对路径）
   */
  static buildSubjectDir(settings: BangumiSettings, data: SubjectData): string {
    const config = settings.subjectTypes[data.typeKey];
    const root   = config.archiveRoot;
    let subDir   = '';

    if (data.typeKey === 'anime' || data.typeKey === 'real') {
      const { year, season } = parseYearSeason(data.date);
      if (config.archiveMode === 'season') {
        subDir = `${year}/${season}`;
      } else if (config.archiveMode === 'year') {
        subDir = `${year}`;
      }
    } else if (data.typeKey === 'book') {
      const subtypeLabel = data.platform === '漫画' ? '漫画' : '小说';
      subDir = subtypeLabel;
    }

    const fullPath = subDir ? `${root}/${subDir}` : root;
    return normalizePath(fullPath);
  }

  /**
   * 确保目录存在，不存在则逐级创建。
   *
   * 修复：原实现依赖 e.message.contains('already exists')，
   * 但 Obsidian 不同版本/平台的错误消息不统一。
   * 改为先用 getAbstractFileByPath 检查，再尝试创建，
   * 捕获任何创建失败的情况并安全跳过（因为并发创建同一目录是正常的）。
   */
  static async ensureFolder(app: App, path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parts      = normalized.split('/');
    let current      = '';

    for (const part of parts) {
      if (!part) continue;
      current = current ? `${current}/${part}` : part;

      // 已存在（文件夹或文件）则跳过
      const existing = app.vault.getAbstractFileByPath(current);
      if (existing) {
        if (existing instanceof TFolder) continue;
        // 路径已被文件占用，抛出明确错误
        throw new Error(`[bangumi] 路径 "${current}" 已被文件占用，无法创建目录`);
      }

      try {
        await app.vault.createFolder(current);
      } catch (err) {
        // 并发创建同一目录时，第二个请求会失败，但目录已存在，安全跳过
        const existing2 = app.vault.getAbstractFileByPath(current);
        if (existing2 instanceof TFolder) continue;
        // 真正的错误，向上抛
        throw err;
      }
    }
  }
}
import { App, normalizePath } from 'obsidian';
import type { SubjectData, BangumiSettings } from '../types';
import { parseYearSeason } from '../note/NoteBuilder';

export class VaultHelper {
  /**
   * 根据条目类型和设置，推导出其应当归档的目录（库内相对路径）
   */
  static buildSubjectDir(settings: BangumiSettings, data: SubjectData): string {
    const config = settings.subjectTypes[data.typeKey];
    const root = config.archiveRoot;
    let subDir = '';

    if (data.typeKey === 'anime' || data.typeKey === 'real') {
      const { year, season } = parseYearSeason(data.date);
      if (config.archiveMode === 'season') {
        subDir = `${year}/${season}`;
      } else if (config.archiveMode === 'year') {
        subDir = `${year}`;
      }
    } else if (data.typeKey === 'book') {
      // 书籍使用子类别分流 (漫画 / 小说)
      const subtypeLabel = data.platform === '漫画' ? '漫画' : '小说';
      subDir = subtypeLabel;
    }

    const fullPath = subDir ? `${root}/${subDir}` : root;
    return normalizePath(fullPath);
  }

  /**
   * 确保目录存在，不存在则逐级创建
   */
  static async ensureFolder(app: App, path: string): Promise<void> {
  const parts = path.split('/');
  let current = '';

  for (const part of parts) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;

    // 内存缓存检查（快速路径）
    if (app.vault.getAbstractFileByPath(current)) continue;

    try {
      await app.vault.createFolder(current);
    } catch (e) {
      // ✅ 修复：文件夹已存在时忽略（并发调用或缓存滞后的情况）
      if (e instanceof Error && e.message.contains('already exists')) {
        continue;
      }
      throw e;
    }
  }
}
}
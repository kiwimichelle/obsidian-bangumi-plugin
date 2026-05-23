import { App, normalizePath, requestUrl } from 'obsidian';
import type { BangumiSettings, SubjectTypeKey } from '../types';
import { VaultHelper } from './VaultHelper';

export class CoverDownloader {
  /**
   * 下载封面并保存到本地。
   * 如果下载失败，退级返回原在线 URL。
   * @returns 本地路径 (如 'Bangumi/Covers/xxxx.jpg') 或在线 URL
   */
  static async download(
    app: App,
    url: string,
    settings: BangumiSettings,
    typeKey: SubjectTypeKey,
    baseName: string
  ): Promise<string> {
    if (!url) return '';

    const config = settings.subjectTypes[typeKey];
    // 如果没有单独配置封面路径，默认放入对应的 Covers 子文件夹
    const coverDir = config.coverPath || `${config.archiveRoot}/Covers`;
    
    await VaultHelper.ensureFolder(app, coverDir);

    // 提取扩展名或默认为 jpg
    const extMatch = url.match(/\.([a-zA-Z0-9]+)(?:[\?#]|$)/);
    const ext = extMatch ? extMatch[1] : 'jpg';
    
    const fileName = `${baseName}.${ext}`;
    const localPath = normalizePath(`${coverDir}/${fileName}`);

    // 如果已经下载过了，直接使用本地图片
    const existingFile = app.vault.getAbstractFileByPath(localPath);
    if (existingFile) {
      return localPath;
    }

    try {
      const resp = await requestUrl({ url, method: 'GET' });
      if (resp.status !== 200) return url;
      
      await app.vault.createBinary(localPath, resp.arrayBuffer);
      return localPath;
    } catch (err) {
      console.warn(`[bangumi] 封面下载失败: ${url}`, err);
      // 网络故障时，退级为直接使用 URL
      return url; 
    }
  }
}
import { App, normalizePath, requestUrl, TFile } from 'obsidian';
import type { BangumiSettings, SubjectTypeKey } from '../types';
import { VaultHelper } from './VaultHelper';

/**
 * 封面下载器
 *
 * 修复历史：
 * 1. createBinary 对已存在文件抛 File already exists 异常，
 *    被 catch 吞掉后错误返回远程 URL 而非本地路径
 * 2. getAbstractFileByPath 预检因 Vault 索引延迟而漏判
 * 3. VaultHelper.ensureFolder 错误判断不够健壮
 */
export class CoverDownloader {
  static async download(
    app:      App,
    url:      string,
    settings: BangumiSettings,
    typeKey:  SubjectTypeKey,
    baseName: string,
  ): Promise<string> {
    if (!url || !url.startsWith('http')) return '';

    const config   = settings.subjectTypes[typeKey];
    // coverPath 为空时，默认放在各分类归档目录下的 Covers 子文件夹
    const coverDir = config.coverPath?.trim()
      ? config.coverPath.trim()
      : `${config.archiveRoot}/Covers`;

    // 提取扩展名，默认 jpg
    const ext      = extractExt(url);
    // sanitize 文件名，移除 Obsidian 不允许的字符
    const safeName = sanitizeFilename(baseName);
    const fileName = `${safeName}.${ext}`;
    const localPath = normalizePath(`${coverDir}/${fileName}`);

    // 修复：优先用 getFileByPath（只返回 TFile，不返回 TFolder），
    // 确保文件真实存在于 Vault 里才跳过下载
    const existing = app.vault.getFileByPath(localPath);
    if (existing instanceof TFile) {
      return localPath;
    }

    // 确保目录存在
    try {
      await VaultHelper.ensureFolder(app, coverDir);
    } catch (err) {
      console.warn('[bangumi] 封面目录创建失败，退级为远程 URL', err);
      return url;
    }

    // 下载封面
    let arrayBuffer: ArrayBuffer;
    try {
      const resp = await requestUrl({ url, method: 'GET', throw: false });
      if (resp.status !== 200) {
        console.warn(`[bangumi] 封面请求返回 ${resp.status}：${url}`);
        return url;
      }
      arrayBuffer = resp.arrayBuffer;
    } catch (err) {
      console.warn(`[bangumi] 封面下载网络失败：${url}`, err);
      return url;
    }

    // 写入 Vault
    // 修复：用 try/catch 分别处理「文件已存在」和「其他错误」两种情况
    try {
      await app.vault.createBinary(localPath, arrayBuffer);
      return localPath;
    } catch (err) {
      // 「文件已存在」：可能是 Vault 索引延迟导致 getFileByPath 漏判，
      // 说明文件实际已经在磁盘上，直接返回本地路径
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('already exists') || msg.includes('file exists')) {
        return localPath;
      }
      console.warn(`[bangumi] 封面写入 Vault 失败：${localPath}`, err);
      return url;
    }
  }
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 从 URL 提取文件扩展名。
 * 处理带查询参数（?r=xxx）和无扩展名的情况。
 */
function extractExt(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    return match && match[1] ? match[1].toLowerCase() : 'jpg';
  } catch {
    const match = url.match(/\.([a-zA-Z0-9]{2,5})(?:[?#]|$)/);
    return match && match[1] ? match[1].toLowerCase() : 'jpg';
  }
}

/**
 * 移除 Obsidian/文件系统不允许的字符。
 * Windows 禁止：\ / : * ? " < > |
 * Obsidian 额外禁止：#
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|#]/g, '').trim() || 'cover';
}
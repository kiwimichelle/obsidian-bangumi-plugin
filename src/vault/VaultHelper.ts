import { App, TFile, TFolder, normalizePath, Notice } from 'obsidian';

/**
 * Vault 文件/文件夹操作封装
 * @see https://docs.obsidian.md/Reference/TypeScript+API/Vault
 */
export class VaultHelper {
  constructor(private app: App) {}

  async ensureFolder(path: string): Promise<TFolder | null> {
    const normalized = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) return existing;
    const parentPath = normalized.split('/').slice(0, -1).join('/');
    if (parentPath && parentPath !== normalized) await this.ensureFolder(parentPath);
    try {
      return await this.app.vault.createFolder(normalized);
    } catch (err) {
      console.error(`[VaultHelper] 创建文件夹失败: ${normalized}`, err);
      new Notice(`创建文件夹失败: ${normalized}`);
      return null;
    }
  }

  async writeFile(path: string, content: string): Promise<TFile | null> {
    const normalized = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      try {
        await this.app.vault.modify(existing, content);
        return existing;
      } catch (err) {
        console.error(`[VaultHelper] 修改文件失败: ${normalized}`, err);
        new Notice(`修改文件失败: ${normalized}`);
        return null;
      }
    } else {
      const folderPath = normalized.split('/').slice(0, -1).join('/');
      if (folderPath) await this.ensureFolder(folderPath);
      try {
        return await this.app.vault.create(normalized, content);
      } catch (err) {
        console.error(`[VaultHelper] 创建文件失败: ${normalized}`, err);
        new Notice(`创建文件失败: ${normalized}`);
        return null;
      }
    }
  }

  async readFile(path: string): Promise<string | null> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) return null;
    try {
      return await this.app.vault.read(file);
    } catch (err) {
      console.error(`[VaultHelper] 读取文件失败: ${normalized}`, err);
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    return file instanceof TFile;
  }

  async folderExists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    const folder = this.app.vault.getAbstractFileByPath(normalized);
    return folder instanceof TFolder;
  }

  async getUniqueFilePath(basePath: string, extension: string): Promise<string> {
    let candidate = `${basePath}.${extension}`;
    let counter = 1;
    while (await this.exists(candidate)) {
      candidate = `${basePath} (${counter}).${extension}`;
      counter++;
    }
    return candidate;
  }

  async deleteFile(path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  const file = this.app.vault.getAbstractFileByPath(normalized);
  if (!(file instanceof TFile)) return false;
  try {
    await this.app.fileManager.trashFile(file);
    return true;
  } catch (err) {
    console.error(`[VaultHelper] 删除文件失败: ${normalized}`, err);
    return false;
  }
}
}
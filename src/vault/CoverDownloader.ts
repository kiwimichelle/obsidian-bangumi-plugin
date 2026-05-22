import { App, requestUrl, Notice } from 'obsidian';
import { VaultHelper } from './VaultHelper';

export class CoverDownloader {
  private helper: VaultHelper;
  private static ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  constructor(app: App) {
    this.helper = new VaultHelper(app);
  }

  async downloadCover(url: string, subjectId: number, coverDir: string): Promise<string | null> {
    if (!url) return null;

    const ext = this.extractExtension(url);
    const filename = `${subjectId}.${ext}`;
    const localPath = `${coverDir}/${filename}`;

    if (await this.helper.exists(localPath)) return localPath;

    await this.helper.ensureFolder(coverDir);

    try {
      const response = await requestUrl({ url, method: 'GET' });
      if (response.status !== 200) {
        console.warn(`[CoverDownloader] 下载失败 HTTP ${response.status}: ${url}`);
        return null;
      }
      const buffer = response.arrayBuffer;
      if (!buffer) return null;
      const uint8Array = new Uint8Array(buffer);
      await this.writeBinaryFile(localPath, uint8Array);
      return localPath;
    } catch (err) {
      console.error(`[CoverDownloader] 下载异常: ${url}`, err);
      new Notice(`封面下载失败: ${subjectId}`);
      return null;
    }
  }

  async downloadCovers(urls: Map<number, string>, coverDir: string, onProgress?: (current: number, total: number) => void): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    let completed = 0;
    const total = urls.size;
    for (const [id, url] of urls) {
      const localPath = await this.downloadCover(url, id, coverDir);
      if (localPath) result.set(id, localPath);
      completed++;
      onProgress?.(completed, total);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return result;
  }

  private extractExtension(url: string): string {
    const match = url.match(/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i);
    if (match && match[1]) {
      const ext = match[1].toLowerCase();
      if (CoverDownloader.ALLOWED_EXTENSIONS.includes(ext)) return ext;
    }
    return 'jpg';
  }

  private async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    await (this.helper as any).app.vault.adapter.writeBinary(path, data);
  }
}
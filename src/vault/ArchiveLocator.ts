import type { App } from 'obsidian';
import * as fs   from 'fs';
import * as path from 'path';
import { ARCHIVE_LATEST_URL } from '../constants';
import type { BangumiSettings } from '../types';

const MIN_FILE_SIZE           = 1_000_000; // 1 MB
const UPDATE_CHECK_TIMEOUT_MS = 10_000;

export interface UpdateInfo {
  updateAvailable: boolean;
  latestDate:      string;
  localMtime:      Date;
}

/**
 * 离线数据包路径管理器
 *
 * 职责：
 * - 解析 settings.offlineDbPaths.subject（优先）或旧版 offlineDbPath 为系统绝对路径
 * - 提供 resolveCustom() 供多路径配置使用（episodes / persons 等）
 * - 验证文件存在性与合理性（size ≥ 1 MB）
 * - 对比本地文件 mtime 与 ARCHIVE_LATEST_URL 检测是否有新版本
 * - 维护同步可读的 cachedPath
 */
export class ArchiveLocator {
  private readonly app:        App;
  private readonly getSettings: () => BangumiSettings;
  private cachedPath: string | null = null;

  constructor(app: App, getSettings: () => BangumiSettings) {
    this.app         = app;
    this.getSettings = getSettings;
  }

  // ── 公开接口 ──────────────────────────────────

  /**
   * 返回上次 resolve() 缓存的绝对路径；无效时返回 null。
   */
  getCachedPath(): string | null {
    return this.cachedPath;
  }

  /**
   * 解析主条目数据包路径（subject.jsonlines）。
   * 优先读取新版 offlineDbPaths.subject，兜底读旧版 offlineDbPath。
   */
  async resolve(): Promise<string | null> {
  const settings = this.getSettings();
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const raw = (settings.offlineDbPaths?.subject || settings.offlineDbPath || '').trim();

  if (!raw) {
    this.cachedPath = null;
    return null;
  }
  const absPath   = this.toAbsolute(raw);
  this.cachedPath = (await this.isValid(absPath)) ? absPath : null;
  return this.cachedPath;
}

  /**
   * 解析并验证任意路径（供多路径配置使用）。
   * 空字符串直接返回 null，不抛出异常。
   *
   * @param rawPath 用户配置的原始路径（相对或绝对）
   */
  async resolveCustom(rawPath: string): Promise<string | null> {
    const raw = rawPath?.trim() ?? '';
    if (!raw) return null;
    const absPath = this.toAbsolute(raw);
    return (await this.isValid(absPath)) ? absPath : null;
  }

  /**
   * 拉取 ARCHIVE_LATEST_URL 对比本地文件 mtime，检测是否有更新。
   * 须先调 resolve()；网络失败 / 解析异常 → 返回 null，不抛出。
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    const localPath = this.cachedPath;
    if (!localPath) return null;

    let localMtime: Date;
    try {
      localMtime = (await fs.promises.stat(localPath)).mtime;
    } catch {
      return null;
    }

    let latestDate: string;
    try {
      const json = await withTimeout(
        fetch(ARCHIVE_LATEST_URL).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<Record<string, unknown>>;
        }),
        UPDATE_CHECK_TIMEOUT_MS,
      );

      const dateVal = json['date'] ?? json['latest'];
      if (dateVal === null || dateVal === undefined) {
        latestDate = '';
      } else if (typeof dateVal === 'string') {
        latestDate = dateVal;
      } else if (typeof dateVal === 'number' || typeof dateVal === 'boolean') {
        latestDate = String(dateVal);
      } else {
        const obj      = dateVal as Record<string, unknown>;
        const maybeDate = obj['date'] ?? obj['published'] ?? obj['updated'];
        latestDate     = typeof maybeDate === 'string' ? maybeDate : '';
      }
    } catch {
      return null;
    }

    const latestTime = new Date(latestDate).getTime();
    if (isNaN(latestTime)) return null;

    return {
      updateAvailable: latestTime > localMtime.getTime(),
      latestDate,
      localMtime,
    };
  }

  // ── 私有辅助 ──────────────────────────────────

  private toAbsolute(raw: string): string {
    if (path.isAbsolute(raw)) return raw;
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const basePath = adapter.basePath ?? '';
    return path.resolve(basePath, raw);
  }

  private async isValid(absPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(absPath);
      return stat.isFile() && stat.size >= MIN_FILE_SIZE;
    } catch {
      return false;
    }
  }
}

// ── 工具函数 ──────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}
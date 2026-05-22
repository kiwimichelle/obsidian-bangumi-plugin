import type { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { ARCHIVE_LATEST_URL } from '../constants';
import type { BangumiSettings } from '../types';

const MIN_FILE_SIZE = 1_000_000; // 1 MB
const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** 版本检查结果 */
export interface UpdateInfo {
  updateAvailable: boolean;
  /** Archive 仓库最新版本日期（来自 latest.json） */
  latestDate: string;
  /** 本地文件最后修改时间 */
  localMtime: Date;
}

/**
 * 离线数据包路径管理器
 *
 * 职责：
 * - 将 `settings.offlineDbPath`（相对 / 绝对路径）解析为系统绝对路径
 * - 验证文件存在性与合理性（size ≥ 1 MB）
 * - 对比本地文件 mtime 与 `ARCHIVE_LATEST_URL` 检测是否有新版本
 * - 维护同步可读的 `cachedPath`，供 `DataManager.getJsonlPath` 回调使用
 *
 * 典型用法（main.ts）：
 * ```ts
 * const locator = new ArchiveLocator(app, () => this.settings);
 * await locator.resolve();
 * getJsonlPath: () => locator.getCachedPath()
 * ```
 */
export class ArchiveLocator {
  private readonly app: App;
  private readonly getSettings: () => BangumiSettings;
  private cachedPath: string | null = null;

  constructor(app: App, getSettings: () => BangumiSettings) {
    this.app = app;
    this.getSettings = getSettings;
  }

  // ── 公开接口 ──────────────────────────────────

  /**
   * 返回上次 `resolve()` 缓存的绝对路径；路径无效或从未调用时返回 null。
   * 同步，适合注入给 `DataManager` 的 `getJsonlPath` 回调。
   */
  getCachedPath(): string | null {
    return this.cachedPath;
  }

  /**
   * 解析并验证 `settings.offlineDbPath`，刷新内部缓存，返回结果路径。
   * - 空字符串 → null
   * - 相对路径 → 以 vault 根目录为基准解析为绝对路径
   * - 绝对路径 → 直接使用
   * - 文件不存在 / 大小 < 1 MB → null
   */
  async resolve(): Promise<string | null> {
    const raw = this.getSettings().offlineDbPath?.trim() ?? '';
    if (!raw) {
      this.cachedPath = null;
      return null;
    }
    const absPath = this.toAbsolute(raw);
    this.cachedPath = (await this.isValid(absPath)) ? absPath : null;
    return this.cachedPath;
  }

  /**
   * 拉取 `ARCHIVE_LATEST_URL` 对比本地文件 mtime，检测是否有更新。
   * 须先调 `resolve()`；网络失败 / 解析异常 → 返回 null，不抛出。
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
    // 安全转换为字符串，避免对象被 String() 转成 "[object Object]"
    if (dateVal === null || dateVal === undefined) {
      latestDate = '';
    } else if (typeof dateVal === 'string') {
      latestDate = dateVal;
    } else if (typeof dateVal === 'number' || typeof dateVal === 'boolean') {
      latestDate = String(dateVal);
    } else {
      // 如果是对象，尝试提取其中的日期字符串
      const obj = dateVal as Record<string, unknown>;
      const maybeDate = obj['date'] ?? obj['published'] ?? obj['updated'];
      if (typeof maybeDate === 'string') {
        latestDate = maybeDate;
      } else {
        latestDate = '';
      }
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

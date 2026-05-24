import { App, Modal, Notice, Platform } from 'obsidian';
import type { BangumiSettings } from '../types';
import { ArchiveLocator } from '../vault/ArchiveLocator';
import type { DataManager } from '../core/DataManager';   // ✅ 补上 import
import { IndexProgressModal } from './IndexProgressModal';
import { DEFAULT_OFFLINE_DB_PATHS } from '../constants';

export interface OnboardingResult {
  mode: 'offline' | 'online';
  offlineDbPath?: string;
}

/**
 * 首次启动引导弹窗
 */
export class OnboardingModal extends Modal {
  private settled = false;                                 // ✅ 声明在类体内

  private constructor(
    app: App,
    private readonly getSettings:  () => BangumiSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly dataManager:  DataManager,
    private readonly resolve:      (result: OnboardingResult | null) => void,
  ) {
    super(app);
  }

  static prompt(
    app:          App,
    getSettings:  () => BangumiSettings,
    saveSettings: () => Promise<void>,
    dataManager:  DataManager,
  ): Promise<OnboardingResult | null> {
    return new Promise(resolve => {
      const modal = new OnboardingModal(
        app, getSettings, saveSettings, dataManager, resolve,
      );
      modal.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle('欢迎使用 Bangumi 离线数据库');
    contentEl.createEl('p', { text: '配置离线数据包可实现毫秒级搜索。', cls: 'bgm-onboarding-desc' });

    // 下载链接
    const downloadBox = contentEl.createEl('div', { cls: 'bgm-onboarding-card' });
    downloadBox.createEl('h4', { text: '步骤1：下载离线数据包' });
    const link = downloadBox.createEl('a', {
      text: '📦 前往 GitHub Releases 下载 subject.jsonlines',
      href: 'https://github.com/bangumi/Archive/releases/latest',
      cls:  'bgm-onboarding-link',
    });
    link.setAttr('target', '_blank');

    // 文件选择
    const fileBox = contentEl.createEl('div', { cls: 'bgm-onboarding-card' });
    fileBox.createEl('h4', { text: '步骤2：选择已下载的文件' });
    const fileRow   = fileBox.createEl('div', { cls: 'bgm-input-row' });
    const pathInput = fileRow.createEl('input', {
      type:  'text',
      cls:   'bgm-path-input',
      placeholder: '/Users/you/Downloads/subject.jsonlines',
    });

    if (Platform.isDesktop) {
      const browseBtn = fileRow.createEl('button', { text: '📂 浏览…', cls: 'bgm-browse-btn' });
      browseBtn.addEventListener('click', () => {
        try {
          const { remote } = (window as any).require('electron');
          const paths = remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), {
            title: '选择 Bangumi 离线数据包',
            filters: [
              { name: 'JSONL 数据包', extensions: ['jsonl', 'jsonlines', 'json'] },
              { name: '所有文件',     extensions: ['*'] },
            ],
            properties: ['openFile'],
          });
          if (paths && paths.length > 0) {
            pathInput.value = paths[0]!;
            pathInput.dispatchEvent(new Event('input'));
          }
        } catch {
          new Notice('⚠️ 文件选择器不可用，请手动粘贴完整路径。');
        }
      });
    }

    const confirmBtn = fileBox.createEl('button', {
      text: '✅ 验证并启用离线模式',
      cls:  'bgm-full-width-btn',
    });
    confirmBtn.disabled = true;
    let selectedPath    = '';

    pathInput.addEventListener('input', () => {
      selectedPath        = pathInput.value.trim();
      confirmBtn.disabled = !selectedPath;
    });

    confirmBtn.addEventListener('click', () => void this.applyOfflineMode(selectedPath));

    contentEl.createEl('hr');
    const skipBox = contentEl.createEl('div', { cls: 'bgm-onboarding-card bgm-skip-card' });
    skipBox.createEl('h4', { text: '选项B：我只在有网时使用' });
    const skipBtn = skipBox.createEl('button', { text: '⏭️ 跳过，仅使用在线 API' });
    skipBtn.addEventListener('click', () => void this.applyOnlineMode());
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
    this.contentEl.empty();
  }

 private async applyOfflineMode(rawPath: string): Promise<void> {
  const settings = this.getSettings();

  if (!settings.offlineDbPaths) {
    settings.offlineDbPaths = { ...DEFAULT_OFFLINE_DB_PATHS };
  }

  settings.offlineDbPaths.subject = rawPath;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  settings.offlineDbPath          = rawPath;  // 保留旧字段兼容

  const locator  = new ArchiveLocator(this.app, this.getSettings);
  const resolved = await locator.resolve();
  if (!resolved) {
    new Notice('❌ 文件无效或体积过小，请确保选择了完整的数据包。');
    return;
  }

  settings.offlineMode            = true;
  settings.offlineDbPaths.subject = resolved;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  settings.offlineDbPath          = resolved;
  await this.saveSettings();

  this.settled = true;
  this.resolve({ mode: 'offline', offlineDbPath: resolved });
  this.close();

  IndexProgressModal.buildAll(this.app, resolved, this.dataManager);
}
private async applyOnlineMode(): Promise<void> {
  const settings       = this.getSettings();
  settings.offlineMode = false;
  await this.saveSettings();
  new Notice('🌐 已切换为纯在线模式');
  this.settled = true;
  this.resolve({ mode: 'online' });
  this.close();
}
}
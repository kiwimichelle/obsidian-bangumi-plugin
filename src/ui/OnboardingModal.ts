import { App, Modal, Setting, Notice } from 'obsidian';
import type { BangumiSettings } from '../types';

/**
 * 首次启动引导弹窗
 * @see https://docs.obsidian.md/Plugins/User+interface/Modals
 */
export class OnboardingModal extends Modal {
  private settings: BangumiSettings;
  private onComplete: (newSettings: BangumiSettings) => void;
  private offlinePathInput: HTMLInputElement | null = null;

  constructor(app: App, settings: BangumiSettings, onComplete: (newSettings: BangumiSettings) => void) {
    super(app);
    this.settings = { ...settings };
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bgm-plugin', 'bgm-onboarding-modal');

    contentEl.createEl('h2', { text: '欢迎使用 Bangumi 插件' });
    contentEl.createEl('p', { text: '为了提供更好的离线体验，推荐下载 Bangumi 官方离线数据包。', cls: 'bgm-onboarding-desc' });

    // 选项1：下载
    new Setting(contentEl)
      .setName('下载离线数据包')
      .setDesc('从 Bangumi/Archive 仓库获取最新的 subject.jsonl')
      .addButton(btn => btn.setButtonText('前往下载').setCta().onClick(() => {
        window.open('https://github.com/bangumi/Archive/releases', '_blank');
        new Notice('请下载 subject.jsonl 文件');
      }));

    // 选项2：选择已有文件
    const pathSetting = new Setting(contentEl)
      .setName('选择离线包路径')
      .setDesc('支持绝对路径或库内相对路径（相对于 vault 根目录）');
    this.offlinePathInput = pathSetting.controlEl.createEl('input', { type: 'text', placeholder: '例如：/path/to/subject.jsonl 或 bangumi-data/subject.jsonl' });
    const browseBtn = pathSetting.controlEl.createEl('button', { text: '浏览' });
    browseBtn.addEventListener('click', () => new Notice('请手动输入路径，支持绝对路径或 vault 内相对路径'));
    pathSetting.addButton(btn => btn.setButtonText('确认使用此路径').onClick(async () => {
      const rawPath = this.offlinePathInput?.value.trim();
      if (!rawPath) { new Notice('请输入路径'); return; }
      this.settings.offlineDbPath = rawPath;
      this.settings.offlineMode = true;
      new Notice('已设置离线包路径，下次启动将构建索引');
      this.complete();
    }));

    // 选项3：跳过
    new Setting(contentEl)
      .setName('跳过离线设置')
      .setDesc('始终使用 Bangumi API 在线搜索（较慢，依赖网络）')
      .addButton(btn => btn.setButtonText('仅使用在线搜索').onClick(() => {
        this.settings.offlineDbPath = '';
        this.settings.offlineMode = false;
        new Notice('已设置为仅使用在线搜索，可随时在设置中修改');
        this.complete();
      }));

    contentEl.createEl('hr');
    contentEl.createEl('p', { text: '提示：您随时可以在插件设置中修改离线包路径或切换模式。', cls: 'bgm-onboarding-hint' });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private complete() {
    this.close();
    this.onComplete(this.settings);
  }
}
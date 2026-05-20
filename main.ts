import { Plugin, addIcon } from 'obsidian';
import { BangumiSettings } from './src/types';
import { DEFAULT_SETTINGS } from './src/defaults';
import { BangumiSearchModal } from './src/modal';
import { BangumiSettingTab } from './src/settings';

// 自定义 Bangumi 图标（简化版 bgm.tv logo 风格）
const BANGUMI_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <path d="M8 12 Q12 6 16 12 Q12 18 8 12"/>
  <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
</svg>`;

export default class BangumiPlugin extends Plugin {
  settings: BangumiSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    // 注册自定义图标
    addIcon('bangumi', BANGUMI_ICON);

    // Ribbon 快捷按钮
    this.addRibbonIcon('bangumi', '搜索 Bangumi 条目', () => {
      new BangumiSearchModal(this.app, this.settings).open();
    });

    // 命令面板
    this.addCommand({
      id:   'search-bangumi',
      name: '搜索条目',
      callback: () => new BangumiSearchModal(this.app, this.settings).open(),
    });
    this.addSettingTab(new BangumiSettingTab(this.app, this));
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<BangumiSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
    for (const key of Object.keys(DEFAULT_SETTINGS.subjectTypes) as Array<keyof BangumiSettings['subjectTypes']>) {
      this.settings.subjectTypes[key] = Object.assign(
        {},
        DEFAULT_SETTINGS.subjectTypes[key],
        saved?.subjectTypes?.[key] ?? {},
      );
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
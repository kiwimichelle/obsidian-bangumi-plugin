import { Plugin } from 'obsidian';
import { BangumiSettings } from './src/types';
import { DEFAULT_SETTINGS } from './src/defaults';
import { BangumiSearchModal } from './src/modal';
import { BangumiSettingTab } from './src/settings';

export default class BangumiPlugin extends Plugin {
  settings: BangumiSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'search-bangumi',
      name: '搜索条目',
      callback: () => new BangumiSearchModal(this.app, this.settings).open(),
    });

    this.addSettingTab(new BangumiSettingTab(this.app, this));
  }

  async loadSettings() {
    const saved = await this.loadData() as Partial<BangumiSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    for (const key of Object.keys(DEFAULT_SETTINGS.subjectTypes) as Array<keyof BangumiSettings['subjectTypes']>) {
      this.settings.subjectTypes[key] = Object.assign(
        {},
        DEFAULT_SETTINGS.subjectTypes[key],
        saved?.subjectTypes?.[key] ?? {}
      );
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
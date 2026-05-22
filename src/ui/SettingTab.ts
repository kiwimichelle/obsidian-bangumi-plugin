import { App, PluginSettingTab, Setting, Platform } from 'obsidian';
import type BangumiPlugin from '../main';
import type { SubjectTypeKey, ArchiveMode, OverwriteMode, TemplateSource } from '../types';
import { TYPE_KEYS, SUBJECT_TYPE_LABEL } from '../constants';

/**
 * 插件设置选项卡
 * @see https://docs.obsidian.md/Reference/TypeScript+API/PluginSettingTab
 */
export class SettingTab extends PluginSettingTab {
  plugin: BangumiPlugin;

  constructor(app: App, plugin: BangumiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('bgm-plugin', 'bgm-settings-tab');

    // 认证
    new Setting(containerEl)
      .setName('Bangumi Access Token')
      .setDesc('用于同步收藏、评分等个人数据。获取方式：登录 bgm.tv → 个人设置 → API')
      .addText(text => text
        .setPlaceholder('输入 Access Token')
        .setValue(this.plugin.settings.token)
        .onChange(async (value) => {
          this.plugin.settings.token = value;
          await this.plugin.saveSettings();
        }));

    // 离线数据包
    containerEl.createEl('h3', { text: '离线数据包' });
    new Setting(containerEl)
      .setName('离线数据库路径')
      .setDesc('指向 bangumi.jsonl 文件的绝对路径或库内相对路径')
      .addText(text => text
        .setPlaceholder('例如：/data/bangumi.jsonl 或 bangumi-data/subject.jsonl')
        .setValue(this.plugin.settings.offlineDbPath)
        .onChange(async (value) => {
          this.plugin.settings.offlineDbPath = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName('优先使用离线模式')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.offlineMode)
        .onChange(async (value) => {
          this.plugin.settings.offlineMode = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h4', { text: '索引管理' });
    const indexStatusDiv = containerEl.createDiv({ cls: 'bgm-index-status' });
    this.renderIndexStatus(indexStatusDiv);
    new Setting(containerEl)
      .addButton(btn => btn.setButtonText('重建行号索引').setCta().onClick(async () => this.plugin.rebuildIndex()))
      .addButton(btn => btn.setButtonText('重建搜索索引').onClick(async () => this.plugin.rebuildSearchIndex()));

    // 本地视频（仅桌面端）
    if (Platform.isDesktop) {
      containerEl.createEl('h3', { text: '本地视频集成（桌面端）' });
      new Setting(containerEl)
        .setName('本地视频根目录')
        .addText(text => text
          .setPlaceholder('例如：D:/Videos/Anime')
          .setValue(this.plugin.settings.videoRootDir)
          .onChange(async (value) => {
            this.plugin.settings.videoRootDir = value;
            await this.plugin.saveSettings();
          }));
      new Setting(containerEl)
        .setName('创建笔记时同步创建本地视频文件夹')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.createVideoDir)
          .onChange(async (value) => {
            this.plugin.settings.createVideoDir = value;
            await this.plugin.saveSettings();
          }));
    }

    // 分类配置
    containerEl.createEl('h3', { text: '分类配置' });
    for (const typeKey of TYPE_KEYS) {
      this.renderTypeConfig(typeKey, containerEl);
    }
  }

  private renderIndexStatus(container: HTMLElement): void {
    const state = this.plugin.getState();
    container.empty();
    container.createSpan({
      text: `行号索引: ${state.indexReady ? '✓ 已就绪' : '✗ 未就绪'}  |  `,
      cls: state.indexReady ? 'bgm-status-ok' : 'bgm-status-missing',
    });
    container.createSpan({
      text: `搜索索引: ${state.searchIndexReady ? '✓ 已就绪' : '✗ 未就绪'}`,
      cls: state.searchIndexReady ? 'bgm-status-ok' : 'bgm-status-missing',
    });
    if (this.plugin.settings.indexBuiltAt > 0) {
      const date = new Date(this.plugin.settings.indexBuiltAt).toLocaleString();
      container.createEl('br');
      container.createSpan({ text: `行号索引构建时间: ${date}` });
    }
    if (this.plugin.settings.searchIndexBuiltAt > 0) {
      const date = new Date(this.plugin.settings.searchIndexBuiltAt).toLocaleString();
      container.createEl('br');
      container.createSpan({ text: `搜索索引构建时间: ${date}` });
    }
  }

  private renderTypeConfig(typeKey: SubjectTypeKey, container: HTMLElement): void {
    const config = this.plugin.settings.subjectTypes[typeKey];
    if (!config) return;

    const details = container.createEl('details');
    details.createEl('summary').setText(SUBJECT_TYPE_LABEL[typeKey]);

    new Setting(details)
      .setName('归档根目录')
      .addText(text => text
        .setPlaceholder(`例如：ACG/${SUBJECT_TYPE_LABEL[typeKey]}`)
        .setValue(config.archiveRoot)
        .onChange(async (value) => {
          config.archiveRoot = value;
          await this.plugin.saveSettings();
        }));

    if (typeKey === 'anime' || typeKey === 'real') {
      new Setting(details)
        .setName('归档层级模式')
        .addDropdown(dropdown => {
          dropdown.addOption('season', '按季度 (年份/季度)');
          dropdown.addOption('year', '按年份 (年份/)');
          dropdown.addOption('flat', '平铺 (根目录)');
          dropdown.setValue(config.archiveMode);
          dropdown.onChange(async (value) => {
            config.archiveMode = value as ArchiveMode;
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(details)
      .setName('封面图片路径')
      .addText(text => text
        .setPlaceholder('例如：assets/covers')
        .setValue(config.coverPath)
        .onChange(async (value) => {
          config.coverPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(details)
      .setName('模板来源')
      .addDropdown(dropdown => {
        dropdown.addOption('default', '使用内置默认模板');
        dropdown.addOption('file', '使用自定义模板文件');
        dropdown.setValue(config.templateSource);
        dropdown.onChange(async (value) => {
          config.templateSource = value as TemplateSource;
          await this.plugin.saveSettings();
        });
      });

    if (config.templateSource === 'file') {
      new Setting(details)
        .setName('模板文件路径')
        .addText(text => text
          .setPlaceholder('templates/anime.md')
          .setValue(config.templateFile)
          .onChange(async (value) => {
            config.templateFile = value;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(details)
      .setName('笔记已存在时的覆盖策略')
      .addDropdown(dropdown => {
        dropdown.addOption('ask', '每次询问');
        dropdown.addOption('always', '总是覆盖');
        dropdown.addOption('never', '从不覆盖（跳过）');
        dropdown.setValue(config.overwriteMode);
        dropdown.onChange(async (value) => {
          config.overwriteMode = value as OverwriteMode;
          await this.plugin.saveSettings();
        });
      });
  }

  refreshIndexStatus(): void {
    const statusDiv = this.containerEl.querySelector('.bgm-index-status');
    if (statusDiv) this.renderIndexStatus(statusDiv as HTMLElement);
  }
}
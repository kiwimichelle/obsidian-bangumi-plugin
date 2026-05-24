import { App, Plugin, PluginSettingTab, Setting, Platform, Notice } from 'obsidian';
import type { BangumiSettings, SubjectTypeKey, ArchiveMode, TemplateSource, OverwriteMode } from '../types';
import { SUBJECT_TYPE_LABEL, DEFAULT_TEMPLATES } from '../constants';
import { IndexProgressModal } from './IndexProgressModal';
import { renderTemplate, buildPreviewVars } from '../note/TemplateEngine';
import type { DataManager } from '../core/DataManager';   // ✅ 改为引用 DataManager
import type { OfflineDbPaths } from '../types';
import { DEFAULT_OFFLINE_DB_PATHS } from '../constants';

export class BangumiSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly getSettings:  () => BangumiSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly dataManager:  DataManager,           // ✅ 替换
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.getSettings();
    containerEl.empty();
    containerEl.addClass('bgm-settings-container');

    containerEl.createEl('h2', { text: 'Bangumi 插件设置', cls: 'bgm-settings-title' });

    this.renderCoreSettings(containerEl, settings);
    this.renderDatabaseDashboard(containerEl, settings);
    this.renderCategorySettings(containerEl, settings);
  }

  private renderCoreSettings(container: HTMLElement, settings: BangumiSettings) {
    container.createEl('h3', { text: '🌐 核心配置' });
    new Setting(container)
      .setName('Bangumi API Token')
      .setDesc('用于访问用户私密信息或突破频率限制。可在 bgm.tv 设置页生成。')
      .addText(text => text
        .setPlaceholder('输入 Access Token')
        .setValue(settings.token)
        .onChange(async (value) => {
          settings.token = value.trim();
          await this.saveSettings();
        })
      );

    new Setting(container)
      .setName('优先使用离线模式')
      .setDesc('开启后，搜索将优先从本地检索；关闭则直接请求在线 API。')
      .addToggle(toggle => toggle
        .setValue(settings.offlineMode)
        .onChange(async (value) => {
          settings.offlineMode = value;
          await this.saveSettings();
          this.display(); // 刷新以展示/隐藏警告
        })
      );
  }

  private renderDatabaseDashboard(container: HTMLElement, settings: BangumiSettings) {
  container.createEl('h3', { text: '📦 离线数据包配置' });
  const dashboard = container.createEl('div', { cls: 'bgm-dashboard-card' });

  // 确保结构完整
  if (!settings.offlineDbPaths) {
    settings.offlineDbPaths = { ...DEFAULT_OFFLINE_DB_PATHS };
  }

  const pathConfigs: Array<{
    key:      keyof OfflineDbPaths;
    label:    string;
    desc:     string;
    required: boolean;
  }> = [
    { key: 'subject',        label: '主条目',     desc: 'subject.jsonlines（必须，约 300MB+）',              required: true  },
    { key: 'episodes',       label: '分集信息',   desc: 'episodes.jsonlines（可选，启用分集 checkbox）',      required: false },
    { key: 'persons',        label: '人物信息',   desc: 'persons.jsonlines（可选，与条目人员配套使用）',      required: false },
    { key: 'subjectPersons', label: '条目人员',   desc: 'subject-persons.jsonlines（可选，与人物信息配套）', required: false },
    { key: 'relations',      label: '条目关联',   desc: 'subject-relations.jsonlines（可选，启用关联索引）', required: false },
  ];

  for (const cfg of pathConfigs) {
    const s = new Setting(dashboard)
      .setName(`${cfg.required ? '🔴' : '🔵'} ${cfg.label}`)
      .setDesc(cfg.desc)
      .addText(text => {
        text.setPlaceholder('/path/to/' + cfg.desc.split('（')[0])
            .setValue(settings.offlineDbPaths[cfg.key])
            .onChange(async (val) => {
              settings.offlineDbPaths[cfg.key] = val.trim();
              await this.saveSettings();
            });
        text.inputEl.style.width = '100%';
      });

    if (Platform.isDesktop) {
      s.addButton(btn => btn
        .setButtonText('📂')
        .setTooltip('浏览文件')
        .onClick(() => {
          try {
            const { remote } = (window as any).require('electron');
            const paths = remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), {
              title:   `选择 ${cfg.label} 数据包`,
              filters: [
                { name: 'JSONL 数据包', extensions: ['jsonl', 'jsonlines', 'json'] },
                { name: '所有文件',     extensions: ['*'] },
              ],
              properties: ['openFile'],
            });
            if (paths && paths.length > 0) {
              settings.offlineDbPaths[cfg.key] = paths[0]!;
              void this.saveSettings().then(() => this.display());
            }
          } catch {
            new Notice('⚠️ 文件选择器不可用，请手动粘贴路径。');
          }
        })
      );
    }
  }

  // 状态行
  const isReady   = !!settings.offlineDbPaths.subject && settings.searchIndexBuiltAt > 0;
  const indexDate = settings.indexBuiltAt
    ? new Date(settings.indexBuiltAt).toLocaleString()
    : '尚未构建';
  const statusRow = dashboard.createEl('div', { cls: 'bgm-dashboard-status' });
  statusRow.createEl('div', {
    text: `📊 索引状态：${isReady ? '✅ 已就绪' : '⚠️ 未完成'}`,
    cls:  'bgm-status-item',
  });
  statusRow.createEl('div', {
    text: `⏱️ 最后构建：${indexDate}`,
    cls:  'bgm-status-item bgm-text-muted',
  });

  new Setting(dashboard)
    .setName('重建检索索引')
    .setDesc('替换数据包后需要重建。已配置的数据包会全部参与构建，未配置的自动跳过。')
    .addButton(btn => btn
      .setButtonText('🔄 立即构建')
      .setCta()
      .setDisabled(!settings.offlineDbPaths.subject)
      .onClick(() => {
        IndexProgressModal.buildAll(
          this.app,
          settings.offlineDbPaths.subject,
          this.dataManager,
          () => {
            settings.indexBuiltAt       = Date.now();
            settings.searchIndexBuiltAt = Date.now();
            void this.saveSettings().then(() => this.display());
          },
        );
      })
    );
}

  private renderCategorySettings(container: HTMLElement, settings: BangumiSettings) {
    container.createEl('h3', { text: '📂 分类归档与模板' });
    const categories: SubjectTypeKey[] = ['anime', 'book', 'game', 'music', 'real'];
    for (const type of categories) {
      const config = settings.subjectTypes[type];
      const details = container.createEl('details', { cls: 'bgm-category-details' });
      details.createEl('summary', { text: `🏷️ ${SUBJECT_TYPE_LABEL[type]} 设置`, cls: 'bgm-category-summary' });

      new Setting(details)
        .setName('归档根目录')
        .addText(text => text
          .setValue(config.archiveRoot)
          .onChange(async (val) => {
            config.archiveRoot = val.trim();
            await this.saveSettings();
          })
        );

      if (['anime', 'real'].includes(type)) {
        new Setting(details)
          .setName('归档层级策略')
          .addDropdown(drop => drop
            .addOptions({ season: '年份/季度新番', year: '仅年份', flat: '无子目录' })
            .setValue(config.archiveMode)
            .onChange(async (val: string) => {
              config.archiveMode = val as ArchiveMode;
              await this.saveSettings();
            })
          );
      }

      new Setting(details)
        .setName('模板来源')
        .addDropdown(drop => drop
          .addOptions({ default: '默认模板', file: '自定义模板文件' })
          .setValue(config.templateSource)
          .onChange(async (val: string) => {
            config.templateSource = val as TemplateSource;
            await this.saveSettings();
            this.display();
          })
        );

      if (config.templateSource === 'file') {
        new Setting(details)
          .setName('自定义模板路径')
          .addText(text => text
            .setValue(config.templateFile)
            .onChange(async (val) => {
              config.templateFile = val.trim();
              await this.saveSettings();
            })
          );
      }

      new Setting(details)
        .setName('同名冲突策略')
        .addDropdown(drop => drop
          .addOptions({ ask: '每次询问', always: '自动覆盖更新', never: '跳过不处理' })
          .setValue(config.overwriteMode)
          .onChange(async (val: string) => {
            config.overwriteMode = val as OverwriteMode;
            await this.saveSettings();
          })
        );

      const previewBtn = details.createEl('button', { text: '👁️ 预览当前模板渲染效果', cls: 'bgm-preview-btn' });
      const previewArea = details.createEl('pre', { cls: 'bgm-template-preview' });
      previewArea.style.display = 'none';
      previewBtn.addEventListener('click', async () => {
        if (previewArea.style.display === 'none') {
          const rawTemplate = config.templateSource === 'default' 
            ? DEFAULT_TEMPLATES[type] 
            : '（自定义模板需确保文件存在）\n\n' + DEFAULT_TEMPLATES[type];
          previewArea.textContent = renderTemplate(rawTemplate, buildPreviewVars());
          previewArea.style.display = 'block';
          previewBtn.setText('收起预览');
        } else {
          previewArea.style.display = 'none';
          previewBtn.setText('👁️ 预览当前模板渲染效果');
        }
      });
    }
  }
}
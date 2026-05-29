import { App, Plugin, PluginSettingTab, Setting, Platform, Notice } from 'obsidian';
import type {
  BangumiSettings, SubjectTypeKey,
  ArchiveMode, TemplateSource, OverwriteMode,
} from '../types';
import {
  SUBJECT_TYPE_LABEL, DEFAULT_TEMPLATES,
  DEFAULT_OFFLINE_DB_PATHS,
} from '../constants';
import { IndexProgressModal } from './IndexProgressModal';
import { renderTemplate, buildPreviewVars } from '../note/TemplateEngine';
import type { DataManager } from '../core/DataManager';
import type { OfflineDbPaths } from '../types';

export class BangumiSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly getSettings:  () => BangumiSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly dataManager:  DataManager,
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

  // ─────────────────────────────────────────────
  // 核心配置
  // ─────────────────────────────────────────────

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
      .setDesc('开启后，搜索将优先从本地索引检索；关闭则直接请求在线 API。')
      .addToggle(toggle => toggle
        .setValue(settings.offlineMode)
        .onChange(async (value) => {
          settings.offlineMode = value;
          await this.saveSettings();
          this.display();
        })
      );
  }

  // ─────────────────────────────────────────────
  // 离线数据库配置面板
  // ─────────────────────────────────────────────

  private renderDatabaseDashboard(container: HTMLElement, settings: BangumiSettings) {
    container.createEl('h3', { text: '📦 离线数据包配置' });
    const dashboard = container.createEl('div', { cls: 'bgm-dashboard-card' });

    if (!settings.offlineDbPaths) {
      settings.offlineDbPaths = { ...DEFAULT_OFFLINE_DB_PATHS };
    }

    // ── 路径配置项 ──────────────────────────────

    const pathConfigs: Array<{
      key:      keyof OfflineDbPaths;
      label:    string;
      desc:     string;
      required: boolean;
    }> = [
      {
        key:      'subject',
        label:    '主条目',
        desc:     'subject.jsonlines（必须，约 300MB+，提供基础搜索和建档）',
        required: true,
      },
      {
        key:      'episodes',
        label:    '分集信息',
        desc:     'episodes.jsonlines（可选，启用带集名和日期的分集 checkbox）',
        required: false,
      },
      {
        key:      'persons',
        label:    '人物信息',
        // 修复：说明 persons 和 subjectPersons 必须配套
        desc:     'persons.jsonlines（可选，须与「条目人员」配套才能显示离线制作人员）',
        required: false,
      },
      {
        key:      'subjectPersons',
        label:    '条目人员',
        desc:     'subject-persons.jsonlines（可选，须与「人物信息」配套使用）',
        required: false,
      },
      {
        key:      'relations',
        label:    '条目关联',
        desc:     'subject-relations.jsonlines（可选，启用离线续集/前传/系列关联）',
        required: false,
      },
    ];

    for (const cfg of pathConfigs) {
      const s = new Setting(dashboard)
        .setName(`${cfg.required ? '🔴' : '🔵'} ${cfg.label}`)
        .setDesc(cfg.desc)
        .addText(text => {
          text
            .setPlaceholder('/path/to/' + cfg.key + '.jsonlines')
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
                title:      `选择 ${cfg.label} 数据包`,
                filters:    [
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

    // ── 索引状态面板（修复：显示全部 5 个索引的就绪状态）──

    const dm = this.dataManager as any;
    const subjectReady  = !!(dm.index?.isReady?.());
    const searchReady   = !!(dm.searchIndex?.isReady?.());
    const episodeReady  = !!(dm.episodeIndex?.isReady?.());
    const personReady   = !!(dm.personIndex?.isReady?.());
    const relationReady = !!(dm.relationIndex?.isReady?.());

    const hasEpisodePath  = !!settings.offlineDbPaths.episodes;
    const hasPersonPath   = !!settings.offlineDbPaths.persons && !!settings.offlineDbPaths.subjectPersons;
    const hasRelationPath = !!settings.offlineDbPaths.relations;

    const indexDate = settings.indexBuiltAt
      ? new Date(settings.indexBuiltAt).toLocaleString()
      : '尚未构建';

    const statusCard = dashboard.createEl('div', { cls: 'bgm-dashboard-status' });

    // 主索引状态：区分「未配置路径」「已配置未构建」「已就绪」
    const mainStatus = !settings.offlineDbPaths.subject
      ? '—（未配置路径）'
      : subjectReady && searchReady
        ? '✅ 已就绪'
        : '⚠️ 未构建';
    statusCard.createEl('div', {
      text: `📊 主索引：${mainStatus}`,
      cls:  'bgm-status-item',
    });
    statusCard.createEl('div', {
      text: `⏱️ 构建时间：${indexDate}`,
      cls:  'bgm-status-item bgm-text-muted',
    });

    // 修复：搜索数据缓存缺失时单独提示（方案A新增文件）
    if (subjectReady && !searchReady) {
      statusCard.createEl('div', {
        text: '⚠️ 搜索缓存文件缺失，请重建索引以启用高速离线搜索',
        cls:  'bgm-status-item bgm-text-warning',
      });
    }

    // 扩展索引状态
    const extStatusEl = dashboard.createEl('div', { cls: 'bgm-index-ext-status' });

    const extItems: Array<{ label: string; ready: boolean; hasPath: boolean }> = [
      { label: '分集',   ready: episodeReady,  hasPath: hasEpisodePath  },
      { label: '制作人员', ready: personReady,   hasPath: hasPersonPath   },
      { label: '关联',   ready: relationReady, hasPath: hasRelationPath },
    ];

    for (const item of extItems) {
      let statusText: string;
      if (!item.hasPath) {
        statusText = '—（未配置路径）';
      } else if (item.ready) {
        statusText = '✅ 已就绪';
      } else {
        statusText = '⚠️ 未构建';
      }
      extStatusEl.createEl('div', {
        text: `${item.label}索引：${statusText}`,
        cls:  'bgm-text-muted bgm-index-ext-item',
      });
    }

    // ── 构建按钮 ──

    new Setting(dashboard)
      .setName('重建检索索引')
      .setDesc(
        '替换数据包后需要重建。' +
        '已配置路径的数据包全部参与构建，未配置的自动跳过。' +
        '首次构建主条目（300MB+）约需数分钟。'
      )
      .addButton(btn => btn
        .setButtonText('🔄 立即构建')
        .setCta()
        // 修复：只要有主条目路径就可以构建
        .setDisabled(!settings.offlineDbPaths.subject)
        .onClick(() => {
          IndexProgressModal.buildAll(
            this.app,
            settings.offlineDbPaths.subject,
            this.dataManager,
            () => {
              // 修复：同时更新两个时间戳
              settings.indexBuiltAt       = Date.now();
              settings.searchIndexBuiltAt = Date.now();
              void this.saveSettings().then(() => this.display());
            },
          );
        })
      );

    // ── persons/subjectPersons 配套校验提示 ──

    const hasOnlyOne =
      (!!settings.offlineDbPaths.persons) !== (!!settings.offlineDbPaths.subjectPersons);
    if (hasOnlyOne) {
      dashboard.createEl('div', {
        text: '⚠️ 「人物信息」和「条目人员」需要同时配置才能生效，当前只配置了其中一个。',
        cls:  'bgm-warning-hint',
      });
    }
  }

  // ─────────────────────────────────────────────
  // 分类归档与模板
  // ─────────────────────────────────────────────

  private renderCategorySettings(container: HTMLElement, settings: BangumiSettings) {
    container.createEl('h3', { text: '📂 分类归档与模板' });

    const categories: SubjectTypeKey[] = ['anime', 'book', 'game', 'music', 'real'];

    for (const type of categories) {
      const config  = settings.subjectTypes[type];
      const details = container.createEl('details', { cls: 'bgm-category-details' });
      details.createEl('summary', {
        text: `🏷️ ${SUBJECT_TYPE_LABEL[type]} 设置`,
        cls:  'bgm-category-summary',
      });

      new Setting(details)
        .setName('归档根目录')
        .addText(text => text
          .setValue(config.archiveRoot)
          .onChange(async (val) => {
            config.archiveRoot = val.trim();
            await this.saveSettings();
          })
        );

      new Setting(details)
        .setName('封面保存路径')
        .setDesc('封面图片的保存目录（Vault 内相对路径）。留空则自动存入「归档根目录/Covers」子文件夹，与笔记放在一起。')
        .addText(text => {
          text
            .setPlaceholder('留空 = 自动跟随归档根目录')
            .setValue(config.coverPath ?? '')
            .onChange(async (val) => {
              config.coverPath = val.trim();
              await this.saveSettings();
            });
          text.inputEl.style.width = '100%';
        });

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
          .setName('自定义模板文件路径')
          .setDesc('填写 vault 内的相对路径，例如：Templates/bangumi-anime.md')
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
        .setDesc('建档时遇到同名文件的处理方式')
        .addDropdown(drop => drop
          .addOptions({
            ask:    '每次询问（弹窗让你决定文件名）',
            always: '自动覆盖更新',
            never:  '跳过不处理',
          })
          .setValue(config.overwriteMode)
          .onChange(async (val: string) => {
            config.overwriteMode = val as OverwriteMode;
            await this.saveSettings();
          })
        );

      // 模板预览
      const previewBtn  = details.createEl('button', {
        text: '👁️ 预览当前模板渲染效果',
        cls:  'bgm-preview-btn',
      });
      const previewArea = details.createEl('pre', { cls: 'bgm-template-preview' });
      previewArea.style.display = 'none';

      previewBtn.addEventListener('click', async () => {
        if (previewArea.style.display === 'none') {
          let rawTemplate: string;
          if (config.templateSource === 'file' && config.templateFile) {
            const file = this.app.vault.getAbstractFileByPath(config.templateFile);
            if (file) {
              rawTemplate = await this.app.vault.read(file as import('obsidian').TFile);
            } else {
              rawTemplate = `（找不到模板文件：${config.templateFile}）\n\n` + DEFAULT_TEMPLATES[type];
            }
          } else {
            rawTemplate = DEFAULT_TEMPLATES[type];
          }
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
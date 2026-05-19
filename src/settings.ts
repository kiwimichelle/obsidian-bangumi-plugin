import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { SubjectTypeKey } from './types';
import { SUBJECT_TYPE_LABEL, TYPE_KEYS } from './constants';
import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS } from './defaults';
import BangumiPlugin from '../main';

const PLACEHOLDER_GROUPS: {
  label: string;
  types: SubjectTypeKey[] | 'all';
  items: { key: string; desc: string; example: string }[];
}[] = [
  {
    label: '通用字段',
    types: 'all',
    items: [
      { key: '{{title}}',               desc: '中文名',                                    example: '游戏人生' },
      { key: '{{original_title}}',      desc: '原名（日文名）',                            example: 'ノーゲーム・ノーライフ' },
      { key: '{{cover_local}}',         desc: '封面本地路径',                              example: 'ACG/Anime/_covers/游戏人生.jpg' },
      { key: '{{today}}',               desc: '记录日期（今天）',                          example: '2026-05-19' },
      { key: '{{score}}',               desc: 'BGM 评分',                                 example: '8.1' },
      { key: '{{rank}}',                desc: 'BGM 排名',                                 example: '42' },
      { key: '{{bangumi_url}}',         desc: 'BGM 链接',                                 example: 'https://bgm.tv/subject/39452' },
      { key: '{{bangumi_id}}',          desc: 'BGM 条目 ID',                             example: '39452' },
      { key: '{{summary}}',             desc: '简介',                                     example: '在梦想与希望…' },
      { key: '{{tags_yaml}}',           desc: 'tags 列表（YAML 格式，放在 tags: 下面）',  example: '  - bangumi\n  - bgm/科幻' },
      { key: '{{related_series}}',      desc: '所属系列名称',                             example: '游戏人生' },
      { key: '{{related_series_link}}', desc: '所属系列 Wiki 内链',                       example: '[[游戏人生]]' },
      { key: '{{netaba_iframe}}',       desc: 'Netaba 评分趋势嵌入 iframe',               example: '<iframe ...>' },
      { key: '{{infobox_frontmatter}}', desc: 'infobox 全部字段展开为 YAML（放 --- 里）', example: '导演: いしづかあつこ' },
      { key: '{{infobox_table_rows}}',  desc: 'infobox 全部字段展开为表格行',             example: '| 导演 | いしづかあつこ |' },
    ],
  },
  {
    label: '动画专属',
    types: ['anime'],
    items: [
      { key: '{{adaptation}}',     desc: '改编类型（智能判定，模糊时弹窗询问）', example: '小说改编' },
      { key: '{{eps_count}}',      desc: '总集数',                              example: '12' },
      { key: '{{year}}',           desc: '开播年份',                            example: '2014' },
      { key: '{{season}}',         desc: '开播季度',                            example: '04月' },
      { key: '{{eps_checkboxes}}', desc: '分集 checkbox 列表（按总集数生成）',  example: '- [ ] **EP 01** ｜ ' },
    ],
  },
  {
    label: '书籍专属',
    types: ['book'],
    items: [
      { key: '{{author}}',    desc: '作者（从 infobox 提取）',   example: '榎宫祐' },
      { key: '{{publisher}}', desc: '出版社（从 infobox 提取）', example: 'KADOKAWA' },
      { key: '{{volumes}}',   desc: '册数（从 infobox 提取）',   example: '10' },
    ],
  },
  {
    label: '游戏专属',
    types: ['game'],
    items: [
      { key: '{{developer}}', desc: '开发商（从 infobox 提取）', example: 'MAGES.' },
      { key: '{{platform}}',  desc: '平台（从 infobox 提取）',   example: 'PC、PS4' },
    ],
  },
  {
    label: '音乐专属',
    types: ['music'],
    items: [
      { key: '{{artist}}',      desc: '艺术家（从 infobox 提取）', example: 'RADWIMPS' },
      { key: '{{track_count}}', desc: '曲目数（从 infobox 提取）', example: '12' },
    ],
  },
];

export class BangumiSettingTab extends PluginSettingTab {
  plugin: BangumiPlugin;
  activeTab: SubjectTypeKey = 'anime';

  constructor(app: App, plugin: BangumiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Bangumi 插件设置' });

    // Token
    new Setting(containerEl)
      .setName('Bangumi Access Token')
      .setDesc('在 bgm.tv → 开发者设置 中生成，不填也能搜索')
      .addText(t => t
        .setPlaceholder('粘贴 token')
        .setValue(this.plugin.settings.token)
        .onChange(async v => {
          this.plugin.settings.token = v;
          await this.plugin.saveSettings();
        }));

    // 视频根目录
    let inputEl: HTMLInputElement | null = null;

    new Setting(containerEl)
      .setName('本地视频根目录')
      .setDesc('开启后，创建笔记时同步在此目录下建立同名文件夹')
      .addToggle(tog => tog
        .setValue(this.plugin.settings.createVideoDir)
        .onChange(async v => {
          this.plugin.settings.createVideoDir = v;
          await this.plugin.saveSettings();
          if (inputEl) inputEl.style.display = v ? 'inline-block' : 'none';
        }))
      .addText(t => {
        t.setPlaceholder('D:/Videos/Anime')
          .setValue(this.plugin.settings.videoRootDir)
          .onChange(async v => {
            this.plugin.settings.videoRootDir = v;
            await this.plugin.saveSettings();
          });
        inputEl = t.inputEl;
        inputEl.style.display = this.plugin.settings.createVideoDir ? 'inline-block' : 'none';
      });

    containerEl.createEl('h3', { text: '分类设置' });

    // Tab 栏
    const tabBar = containerEl.createEl('div', { cls: 'bangumi-tab-bar' });
    const tabBtns = {} as Record<SubjectTypeKey, HTMLButtonElement>;
    const contentArea = containerEl.createEl('div');

    TYPE_KEYS.forEach(key => {
      const btn = tabBar.createEl('button', { text: SUBJECT_TYPE_LABEL[key], cls: 'bangumi-tab-btn' });
      btn.addEventListener('click', () => {
        this.activeTab = key;
        TYPE_KEYS.forEach(k => tabBtns[k].classList.toggle('active', k === key));
        this.renderTabContent(contentArea, key);
      });
      tabBtns[key] = btn;
    });

    tabBtns[this.activeTab].classList.add('active');
    this.renderTabContent(contentArea, this.activeTab);
  }

  private renderTabContent(container: HTMLElement, key: SubjectTypeKey) {
    container.empty();
    const config = this.plugin.settings.subjectTypes[key];

    new Setting(container)
      .setName('归档根路径')
      .setDesc('笔记存放的根文件夹')
      .addText(t => t
        .setPlaceholder(DEFAULT_SETTINGS.subjectTypes[key].archiveRoot)
        .setValue(config.archiveRoot)
        .onChange(async v => {
          config.archiveRoot = v || DEFAULT_SETTINGS.subjectTypes[key].archiveRoot;
          await this.plugin.saveSettings();
        }));

    new Setting(container)
      .setName('归档方式')
      .setDesc('按季度：.../2026/01月新番/　按年份：.../2026/　不归档：直接放根路径')
      .addDropdown(d => d
        .addOption('season', '按年份季度')
        .addOption('year',   '按年份')
        .addOption('flat',   '不归档')
        .setValue(config.archiveMode)
        .onChange(async v => {
          config.archiveMode = v as any;
          await this.plugin.saveSettings();
        }));

    new Setting(container)
      .setName('封面保存路径')
      .setDesc('封面图片在库中的存放路径')
      .addText(t => t
        .setPlaceholder(DEFAULT_SETTINGS.subjectTypes[key].coverPath)
        .setValue(config.coverPath)
        .onChange(async v => {
          config.coverPath = v || DEFAULT_SETTINGS.subjectTypes[key].coverPath;
          await this.plugin.saveSettings();
        }));

    new Setting(container)
      .setName('覆盖策略')
      .setDesc('笔记已存在时的处理方式')
      .addDropdown(d => d
        .addOption('ask',    '每次询问')
        .addOption('always', '总是覆盖')
        .addOption('never',  '总是跳过')
        .setValue(config.overwriteMode)
        .onChange(async v => {
          config.overwriteMode = v as any;
          await this.plugin.saveSettings();
        }));

    new Setting(container)
      .setName('模板来源')
      .addDropdown(d => d
        .addOption('default', '使用默认模板')
        .addOption('file',    '使用库中的模板文件')
        .setValue(config.templateSource)
        .onChange(async v => {
          config.templateSource = v as any;
          await this.plugin.saveSettings();
          this.renderTabContent(container, key);
        }));

    if (config.templateSource === 'file') {
      new Setting(container)
        .setName('模板文件路径')
        .setDesc('库中模板文件的路径，如 Templates/Bangumi动画.md')
        .addText(t => t
          .setPlaceholder('Templates/Bangumi动画.md')
          .setValue(config.templateFile)
          .onChange(async v => {
            config.templateFile = v;
            await this.plugin.saveSettings();
          }))
        .addButton(btn => btn
          .setButtonText('复制默认模板')
          .setTooltip('复制到剪贴板，粘贴到模板文件中修改')
          .onClick(() => {
            navigator.clipboard.writeText(DEFAULT_TEMPLATES[key]);
            new Notice('✅ 默认模板已复制');
          }));
    }

    // 占位符参考
    container.createEl('h4', { text: '占位符参考' });
    const table = container.createEl('div', { cls: 'bangumi-placeholder-table' });

    const relevantGroups = PLACEHOLDER_GROUPS.filter(g =>
      g.types === 'all' || (g.types as SubjectTypeKey[]).includes(key)
    );

    let rowIndex = 0;
    relevantGroups.forEach((group, gi) => {
      const header = table.createEl('div', { text: group.label, cls: 'bangumi-placeholder-group-header' });
      if (gi === 0) header.style.borderTop = 'none';

      group.items.forEach(p => {
        const row = table.createEl('div', { cls: `bangumi-placeholder-row ${rowIndex % 2 === 0 ? 'even' : 'odd'}` });
        rowIndex++;

        const left = row.createEl('div', { cls: 'bangumi-placeholder-left' });
        const code = left.createEl('code', { text: p.key, cls: 'bangumi-placeholder-code' });
        code.title = '点击复制';
        code.addEventListener('click', () => {
          navigator.clipboard.writeText(p.key);
          code.classList.add('copied');
          code.setText('已复制！');
          setTimeout(() => {
            code.classList.remove('copied');
            code.setText(p.key);
          }, 1200);
        });

        const right = row.createEl('div');
        right.createEl('div', { text: p.desc, cls: 'bangumi-placeholder-desc' });
        right.createEl('div', { text: `示例：${p.example}`, cls: 'bangumi-placeholder-example' });
      });
    });

    // 默认模板预览
    const previewHeader = container.createEl('div', { cls: 'bangumi-template-header' });
    previewHeader.createEl('h4', { text: '默认模板' });
    const copyBtn = previewHeader.createEl('button', { text: '📋 复制模板', cls: 'bangumi-copy-btn' });
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(DEFAULT_TEMPLATES[key]);
      new Notice('✅ 已复制到剪贴板');
    });

    const textarea = container.createEl('textarea', { cls: 'bangumi-template-textarea' });
    textarea.value = DEFAULT_TEMPLATES[key];
    textarea.readOnly = true;

    container.createEl('p', {
      text: '如需自定义：选择「使用库中的模板文件」→ 复制默认模板 → 粘贴到模板文件中修改。',
      cls: 'bangumi-template-hint',
    });
  }
}
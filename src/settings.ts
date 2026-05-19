import { App, Notice, PluginSettingTab, Setting, TFile, Modal } from 'obsidian';
import { BangumiSettings, SubjectTypeKey } from './types';
import { SUBJECT_TYPE_LABEL, TYPE_KEYS } from './constants';
import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS } from './defaults';
import BangumiPlugin from '../main';

// 替换原来的 PLACEHOLDER_DOCS 常量
const PLACEHOLDER_GROUPS: {
  label: string;
  types: SubjectTypeKey[] | 'all';
  items: { key: string; desc: string; example: string }[];
}[] = [
  {
    label: '通用字段',
    types: 'all',
    items: [
      { key: '{{title}}',               desc: '中文名',             example: '游戏人生' },
      { key: '{{original_title}}',      desc: '原名（日文名）',     example: 'ノーゲーム・ノーライフ' },
      { key: '{{cover_local}}',         desc: '封面本地路径',       example: 'ACG/Anime/_covers/游戏人生.jpg' },
      { key: '{{today}}',               desc: '记录日期（今天）',   example: '2026-05-19' },
      { key: '{{score}}',               desc: 'BGM 评分',          example: '8.1' },
      { key: '{{rank}}',                desc: 'BGM 排名',          example: '42' },
      { key: '{{bangumi_url}}',         desc: 'BGM 链接',          example: 'https://bgm.tv/subject/39452' },
      { key: '{{bangumi_id}}',          desc: 'BGM 条目 ID',      example: '39452' },
      { key: '{{summary}}',             desc: '简介',              example: '在梦想与希望…' },
      { key: '{{tags_yaml}}',           desc: 'tags 列表（YAML）', example: '  - bangumi\n  - bgm/科幻' },
      { key: '{{related_series}}',      desc: '所属系列名称',      example: '游戏人生' },
      { key: '{{related_series_link}}', desc: '所属系列 Wiki 内链', example: '[[游戏人生]]' },
      { key: '{{netaba_iframe}}',       desc: 'Netaba 评分趋势 iframe（动画最有用）', example: '<iframe ...>' },
      { key: '{{infobox_frontmatter}}', desc: 'infobox 所有字段（放在 --- frontmatter 里）', example: '导演: いしづかあつこ' },
      { key: '{{infobox_table_rows}}',  desc: 'infobox 所有字段（放在 Markdown 表格里）', example: '| 导演 | いしづかあつこ |' },
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
      { key: '{{author}}',    desc: '作者（从 infobox 提取）',  example: '榎宫祐' },
      { key: '{{publisher}}', desc: '出版社（从 infobox 提取）', example: 'KADOKAWA' },
      { key: '{{volumes}}',   desc: '册数（从 infobox 提取）',  example: '10' },
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

    // ── 通用设置 ──────────────────────────────────────────────
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

    // 视频根目录 + toggle 联动
    let videoDirText: any;
    const videoSetting = new Setting(containerEl)
      .setName('本地视频根目录')
      .setDesc('开启后，创建笔记时同步在此目录下建立同名文件夹')
      .addToggle(tog => tog
        .setValue(this.plugin.settings.createVideoDir)
        .onChange(async v => {
          this.plugin.settings.createVideoDir = v;
          await this.plugin.saveSettings();
          if (videoDirText) {
            videoDirText.inputEl.closest('.setting-item-control').style.display = v ? '' : 'none';
          }
        }))
      .addText(t => {
        videoDirText = t;
        t.setPlaceholder('D:/Videos/Anime')
          .setValue(this.plugin.settings.videoRootDir)
          .onChange(async v => {
            this.plugin.settings.videoRootDir = v;
            await this.plugin.saveSettings();
          });
        // 初始状态联动
        setTimeout(() => {
          const ctrl = t.inputEl.parentElement;
          if (ctrl) ctrl.style.display = this.plugin.settings.createVideoDir ? '' : 'none';
        }, 0);
        return t;
      });

    containerEl.createEl('h3', { text: '分类设置' });

    // ── Tab 栏 ────────────────────────────────────────────────
    const tabBar = containerEl.createEl('div');
    tabBar.style.cssText = 'display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--background-modifier-border);padding-bottom:8px;flex-wrap:wrap;';

    const tabBtns = {} as Record<SubjectTypeKey, HTMLButtonElement>;
    const contentArea = containerEl.createEl('div');

    TYPE_KEYS.forEach(key => {
      const btn = tabBar.createEl('button', { text: SUBJECT_TYPE_LABEL[key] });
      btn.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:13px;';
      btn.addEventListener('click', () => {
        this.activeTab = key;
        TYPE_KEYS.forEach(k => this.styleTabBtn(tabBtns[k], k === key));
        this.renderTabContent(contentArea, key);
      });
      tabBtns[key] = btn;
    });

    TYPE_KEYS.forEach(k => this.styleTabBtn(tabBtns[k], k === this.activeTab));
    this.renderTabContent(contentArea, this.activeTab);
  }

  styleTabBtn(btn: HTMLButtonElement, active: boolean) {
    btn.style.backgroundColor = active ? 'var(--interactive-accent)' : 'var(--background-secondary)';
    btn.style.color = active ? 'var(--text-on-accent)' : '';
  }

  renderTabContent(container: HTMLElement, key: SubjectTypeKey) {
    container.empty();
    const config = this.plugin.settings.subjectTypes[key];

    // 归档根路径
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

    // 归档方式
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

    // 封面路径
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

    // 覆盖策略
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

    // 模板来源
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

    // 模板文件路径（仅在选了 file 时显示）
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
          .setButtonText('📋 复制默认模板')
          .setTooltip('将默认模板内容复制到剪贴板，粘贴到你的模板文件中')
          .onClick(() => {
            navigator.clipboard.writeText(DEFAULT_TEMPLATES[key]);
            new Notice('✅ 默认模板已复制到剪贴板');
          }));
    }

    // 占位符参考（按分组，只显示当前类型相关的）
container.createEl('h4', { text: '占位符参考' }).style.marginTop = '20px';

const refWrap = container.createEl('div');
refWrap.style.cssText = 'border:1px solid var(--background-modifier-border);border-radius:8px;overflow:hidden;margin-bottom:16px;';

const relevantGroups = PLACEHOLDER_GROUPS.filter(g =>
  g.types === 'all' || (g.types as SubjectTypeKey[]).includes(key)
);

let rowIndex = 0;
relevantGroups.forEach((group, gi) => {
  // 分组标题
  const groupHeader = refWrap.createEl('div');
  groupHeader.style.cssText = `
    padding:6px 12px;
    font-size:11px;
    font-weight:600;
    letter-spacing:0.05em;
    text-transform:uppercase;
    color:var(--text-muted);
    background:var(--background-modifier-border);
    border-top:${gi === 0 ? 'none' : '1px solid var(--background-modifier-border)'};
  `;
  groupHeader.setText(group.label);

  group.items.forEach(p => {
    const row = refWrap.createEl('div');
    row.style.cssText = `
      display:grid;
      grid-template-columns:200px 1fr;
      padding:7px 12px;
      font-size:12px;
      line-height:1.5;
      border-top:1px solid var(--background-modifier-border);
      background:${rowIndex % 2 === 0 ? 'var(--background-primary)' : 'var(--background-secondary)'};
    `;
    rowIndex++;

    // 左列：点击复制的 code tag
    const left = row.createEl('div');
    left.style.cssText = 'display:flex;align-items:flex-start;padding-top:2px;';
    const code = left.createEl('code', { text: p.key });
    code.style.cssText = 'font-size:11px;background:var(--background-modifier-border);padding:2px 6px;border-radius:3px;cursor:pointer;white-space:nowrap;user-select:none;';
    code.title = '点击复制';
    code.addEventListener('click', () => {
      navigator.clipboard.writeText(p.key);
      code.style.background = 'var(--interactive-accent)';
      code.style.color = 'var(--text-on-accent)';
      code.setText('已复制！');
      setTimeout(() => {
        code.style.background = 'var(--background-modifier-border)';
        code.style.color = '';
        code.setText(p.key);
      }, 1200);
    });

    // 右列：说明 + 示例
    const right = row.createEl('div');
    right.createEl('div', { text: p.desc });
    right.createEl('div', { text: `示例：${p.example}` })
      .style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:1px;white-space:pre-wrap;word-break:break-all;';
  });
});

    // ── 默认模板预览（只读）──────────────────────────────────
    const previewHeader = container.createEl('div');
    previewHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    previewHeader.createEl('h4', { text: '默认模板' }).style.margin = '0';

    const copyBtn = previewHeader.createEl('button', { text: '📋 复制模板' });
    copyBtn.style.cssText = 'padding:4px 10px;border-radius:4px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:12px;';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(DEFAULT_TEMPLATES[key]);
      new Notice('✅ 默认模板已复制到剪贴板');
    });

    const textarea = container.createEl('textarea');
    textarea.value = DEFAULT_TEMPLATES[key];
    textarea.readOnly = true;
    textarea.style.cssText = 'width:100%;height:260px;font-family:monospace;font-size:11px;padding:8px;box-sizing:border-box;resize:vertical;opacity:0.75;';

    container.createEl('p', {
      text: '如需自定义：选择「使用库中的模板文件」→ 复制默认模板 → 粘贴到模板文件中修改。',
    }).style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:6px;';
  }
}
import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { SubjectTypeKey } from './types';
import { SUBJECT_TYPE_LABEL, TYPE_KEYS } from './constants';
import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS } from './defaults';
import BangumiPlugin from '../main';

// ── 占位符分组数据 ──────────────────────────────────────────────

const PLACEHOLDER_GROUPS: {
  label: string;
  types: SubjectTypeKey[] | 'all';
  items: { key: string; desc: string; example: string }[];
}[] = [
  {
    label: '通用字段',
    types: 'all',
    items: [
      { key: '{{title}}',               desc: '中文名',                          example: '葬送的芙莉莲' },
      { key: '{{original_title}}',      desc: '原名（日文名）',                  example: '葬送のフリーレン' },
      { key: '{{cover_local}}',         desc: '封面本地路径',                    example: 'ACG/Anime/_covers/葬送的芙莉莲.jpg' },
      { key: '{{today}}',               desc: '记录日期（今天）',                example: '2026-05-20' },
      { key: '{{score}}',               desc: 'BGM 评分',                       example: '8.5' },
      { key: '{{rank}}',                desc: 'BGM 排名',                       example: '40' },
      { key: '{{bangumi_url}}',         desc: 'BGM 链接',                       example: 'https://bgm.tv/subject/400602' },
      { key: '{{bangumi_id}}',          desc: 'BGM 条目 ID',                   example: '400602' },
      { key: '{{summary}}',             desc: '简介',                           example: '魔法使芙莉莲和勇者...' },
      { key: '{{tags_yaml}}',           desc: 'tags 列表（放在 tags: 下面）',   example: '  - bangumi\n  - bgm/治愈' },
      { key: '{{infobox_table_rows}}',  desc: 'infobox 全部字段（表格行）',     example: '| 导演 | 斎藤圭一郎 |' },
      { key: '{{related_series}}',      desc: '系列作品名称',                   example: '葬送的芙莉莲 第二季' },
      { key: '{{related_series_link}}', desc: '系列作品 Wiki 内链',             example: '[[葬送的芙莉莲 第二季]]' },
      { key: '{{sequel}}',              desc: '续集名称',                       example: '葬送的芙莉莲 第二季' },
      { key: '{{sequel_link}}',         desc: '续集 Wiki 内链',                 example: '[[葬送的芙莉莲 第二季]]' },
      { key: '{{prequel}}',             desc: '前传名称',                       example: '' },
      { key: '{{prequel_link}}',        desc: '前传 Wiki 内链',                 example: '' },
      { key: '{{my_status}}',           desc: '个人状态（想看/在看/看过...）',  example: '在看' },
      { key: '{{my_rating}}',           desc: '个人评分',                       example: '9' },
      { key: '{{my_comment}}',          desc: '即时短评',                       example: '意外的好看' },
    ],
  },
  {
    label: '动画专属',
    types: ['anime'],
    items: [
      { key: '{{adaptation}}',    desc: '改编类型（智能判定）',              example: '漫画改编' },
      { key: '{{eps_count}}',     desc: '总集数',                           example: '28' },
      { key: '{{year}}',          desc: '开播年份',                         example: '2023' },
      { key: '{{season}}',        desc: '开播季度',                         example: '10月' },
      { key: '{{eps_checkboxes}}',desc: '分集 checkbox（按集数自动生成）',  example: '- [ ] **EP 01** ｜ ' },
      { key: '{{my_progress}}',   desc: '已观看集数',                       example: '12' },
      { key: '{{my_source}}',     desc: '观看网址',                         example: 'https://www.bilibili.com/...' },
      { key: '{{netaba_iframe}}', desc: 'Netaba 评分趋势 iframe',           example: '<iframe ...>' },
    ],
  },
  {
    label: '书籍专属',
    types: ['book'],
    items: [
      { key: '{{author}}',          desc: '作者（从 infobox 提取）',   example: '山田鐘人' },
      { key: '{{publisher}}',       desc: '出版社（从 infobox 提取）', example: '小学館' },
      { key: '{{volumes}}',         desc: '册数（从 infobox 提取）',   example: '12' },
      { key: '{{isbn}}',            desc: 'ISBN（从 infobox 提取）',   example: '978-4-09-...' },
      { key: '{{my_status}}',       desc: '阅读状态',                  example: '在读' },
      { key: '{{my_read_progress}}',desc: '阅读进度',                  example: '第 02 卷 ｜ 第 015 话' },
      { key: '{{my_channel}}',      desc: '阅读渠道',                  example: '哔哩哔哩漫画' },
      { key: '{{my_version}}',      desc: '翻译版本',                  example: '官方正版汉化' },
    ],
  },
  {
    label: '游戏专属',
    types: ['game'],
    items: [
      { key: '{{developer}}',       desc: '开发商（从 infobox 提取）', example: 'MADHOUSE' },
      { key: '{{platform}}',        desc: '平台（从 infobox 提取）',   example: 'PC、PS4' },
      { key: '{{my_status}}',       desc: '游玩状态',                  example: '在玩' },
      { key: '{{my_platform}}',     desc: '游玩平台（用户选择）',      example: 'Steam' },
      { key: '{{my_hours}}',        desc: '游玩时长（小时）',          example: '12.5' },
      { key: '{{my_game_progress}}',desc: '当前进度',                  example: '第一章' },
    ],
  },
  {
    label: '音乐专属',
    types: ['music'],
    items: [
      { key: '{{artist}}',          desc: '艺术家（从 infobox 提取）', example: 'YOASOBI' },
      { key: '{{track_count}}',     desc: '曲目数',                    example: '5' },
      { key: '{{my_status}}',       desc: '收听状态',                  example: '在听' },
      { key: '{{my_music_source}}', desc: '收听平台',                  example: 'Spotify' },
    ],
  },
  {
    label: '三次元专属',
    types: ['real'],
    items: [
      { key: '{{eps_count}}',     desc: '总集数',           example: '10' },
      { key: '{{year}}',          desc: '年份',             example: '2024' },
      { key: '{{eps_checkboxes}}',desc: '分集 checkbox',   example: '- [ ] **EP 01** ｜ ' },
      { key: '{{my_progress}}',   desc: '已观看集数',       example: '3' },
      { key: '{{my_source}}',     desc: '观看网址',         example: 'https://...' },
    ],
  },
];

// ── 设置页 ─────────────────────────────────────────────────────

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

    // ── 通用设置 ──
    containerEl.createEl('h2', { text: 'Bangumi 插件设置' });

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

    // 本地视频根目录（Toggle + 输入框联动）
    let videoInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName('本地视频根目录')
      .setDesc('开启后，创建动画笔记时同步在此目录下建立同名文件夹')
      .addToggle(tog => tog
        .setValue(this.plugin.settings.createVideoDir)
        .onChange(async v => {
          this.plugin.settings.createVideoDir = v;
          await this.plugin.saveSettings();
          if (videoInput) videoInput.style.display = v ? 'inline-block' : 'none';
        }))
      .addText(t => {
        t.setPlaceholder('D:/Videos/Anime')
          .setValue(this.plugin.settings.videoRootDir)
          .onChange(async v => {
            this.plugin.settings.videoRootDir = v;
            await this.plugin.saveSettings();
          });
        videoInput = t.inputEl;
        videoInput.style.display = this.plugin.settings.createVideoDir ? 'inline-block' : 'none';
      });

    // ── 分类设置 Tab ──
    containerEl.createEl('h3', { text: '分类设置' });

    const tabBar     = containerEl.createEl('div', { cls: 'bangumi-tab-bar' });
    const tabBtns    = {} as Record<SubjectTypeKey, HTMLButtonElement>;
    const contentArea = containerEl.createEl('div');

    TYPE_KEYS.forEach(key => {
      const btn = tabBar.createEl('button', {
        text: SUBJECT_TYPE_LABEL[key],
        cls: 'bangumi-tab-btn',
      });
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
    const config  = this.plugin.settings.subjectTypes[key];
    const defaults = DEFAULT_SETTINGS.subjectTypes[key];

    // 归档根路径
    new Setting(container)
      .setName('归档根路径')
      .setDesc(this.getArchiveDesc(key))
      .addText(t => t
        .setPlaceholder(defaults.archiveRoot)
        .setValue(config.archiveRoot)
        .onChange(async v => {
          config.archiveRoot = v || defaults.archiveRoot;
          await this.plugin.saveSettings();
        }));

    // 归档方式（仅动画/三次元显示）
    if (key === 'anime' || key === 'real') {
      new Setting(container)
        .setName('归档方式')
        .setDesc('按季度：.../2023/10月新番/　按年份：.../2023/　不归档：直接放根路径')
        .addDropdown(d => d
          .addOption('season', '按年份季度')
          .addOption('year',   '按年份')
          .addOption('flat',   '不归档')
          .setValue(config.archiveMode)
          .onChange(async v => {
            config.archiveMode = v as any;
            await this.plugin.saveSettings();
          }));
    }

    // 封面保存路径
    new Setting(container)
      .setName('封面保存路径')
      .setDesc('封面图片在库中的存放路径')
      .addText(t => t
        .setPlaceholder(defaults.coverPath)
        .setValue(config.coverPath)
        .onChange(async v => {
          config.coverPath = v || defaults.coverPath;
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

    // 模板文件路径（仅 file 模式显示）
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
          .setTooltip('复制到剪贴板后粘贴到模板文件里修改')
          .onClick(() => {
            navigator.clipboard.writeText(DEFAULT_TEMPLATES[key]);
            new Notice('✅ 默认模板已复制到剪贴板');
          }));
    }

    // ── 占位符参考表 ──
    container.createEl('h4', { text: '占位符参考' });

    const table = container.createEl('div', { cls: 'bangumi-placeholder-table' });
    const relevantGroups = PLACEHOLDER_GROUPS.filter(g =>
      g.types === 'all' || (g.types as SubjectTypeKey[]).includes(key)
    );

    let rowIndex = 0;
    relevantGroups.forEach((group, gi) => {
      const header = table.createEl('div', {
        text: group.label,
        cls: 'bangumi-placeholder-group-header',
      });
      if (gi === 0) header.style.borderTop = 'none';

      group.items.forEach(p => {
        const row = table.createEl('div', {
          cls: `bangumi-placeholder-row ${rowIndex % 2 === 0 ? 'even' : 'odd'}`,
        });
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
        if (p.example) {
          right.createEl('div', {
            text: `示例：${p.example}`,
            cls: 'bangumi-placeholder-example',
          });
        }
      });
    });

    // ── 默认模板预览（只读）──
    const previewHeader = container.createEl('div', { cls: 'bangumi-template-header' });
    previewHeader.createEl('h4', { text: '默认模板' });
    const copyBtn = previewHeader.createEl('button', {
      text: '📋 复制模板',
      cls: 'bangumi-copy-btn',
    });
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

  private getArchiveDesc(key: SubjectTypeKey): string {
    switch (key) {
      case 'anime':
      case 'real':
        return '笔记存放的根文件夹，实际路径会根据归档方式追加年份/季度子目录';
      case 'book':
        return '书籍根文件夹，实际路径会自动追加书籍类型子目录（漫画/轻小说/小说）';
      case 'game':
        return '游戏根文件夹，实际路径会自动追加游玩平台子目录（Steam/PS5 等）';
      default:
        return '笔记存放的根文件夹';
    }
  }
}

import { App, Modal, Notice, TFile } from 'obsidian';
import { searchSubjects, fetchSubject, fetchSubjectRelations, parseInfobox, getInfoboxValue } from './api';
import { BangumiSettings, SubjectTypeKey } from './types';
import { SUBJECT_TYPE_MAP, SUBJECT_TYPE_LABEL, TYPE_FILTERS } from './constants';
import { buildTemplateVars, resolveTemplate, renderTemplate, resolveArchivePath } from './template';
import { resolveNaming, downloadCover, createLocalVideoDir, extractPreservedContent, injectPreservedContent, ensureFolder, writeFrontmatter } from './vault';

export class BangumiSearchModal extends Modal {
  private settings: BangumiSettings;
  private currentType = 0;
  private isLoading = false;

  constructor(app: App, settings: BangumiSettings) {
    super(app);
    this.settings = settings;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: '搜索 Bangumi 条目' });

    const filterBar = contentEl.createEl('div', { cls: 'bangumi-modal-filter-bar' });
    const buttons: HTMLButtonElement[] = [];

    TYPE_FILTERS.forEach(f => {
      const btn = filterBar.createEl('button', { text: f.label, cls: 'bangumi-filter-btn' });
      if (f.value === this.currentType) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.currentType = f.value;
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        triggerSearch();
      });
      buttons.push(btn);
    });

    const input = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入关键字并回车搜索...',
      cls: 'bangumi-search-input'
    });
    input.focus();

    const statusEl = contentEl.createEl('div', { cls: 'bangumi-status', text: '请输入关键词开始搜索' });
    const resultsContainer = contentEl.createEl('div');

    const triggerSearch = async () => {
      const kw = input.value.trim();
      if (!kw) return;
      if (this.isLoading) return;

      this.isLoading = true;
      statusEl.setText('🔍 正在拼命检索中...');
      resultsContainer.empty();

      try {
        const list = await searchSubjects(kw, this.currentType, this.settings.token);
        this.isLoading = false;
        if (!list || list.length === 0) {
          statusEl.setText('❌ 未找到匹配结果');
          return;
        }
        statusEl.setText(`✅ 成功为您找到 ${list.length} 个相关条目`);
        list.forEach((item: any) => {
          const row = resultsContainer.createEl('div', { cls: 'bangumi-result-row' });
          const img = row.createEl('img', { cls: 'bangumi-result-cover' });
          img.src = item.images?.common || item.images?.medium || item.images?.small || '';

          const info = row.createEl('div', { cls: 'bangumi-result-info' });
          info.createEl('div', { cls: 'bangumi-result-title', text: item.name_cn || item.name });
          
          const label = SUBJECT_TYPE_LABEL[SUBJECT_TYPE_MAP[Number(item.type)] ?? 'anime'] || '其它';
          const airDate = item.air_date ? ` | 开播/出版: ${item.air_date}` : '';
          info.createEl('div', { cls: 'bangumi-result-meta', text: `[${label}] ${item.name}${airDate}` });

          row.addEventListener('click', () => {
            void this.handleSelect(item, statusEl);
          });
        });
      } catch {
        this.isLoading = false;
        statusEl.setText('❌ 检索网络异常，请确认网络环境或 Token 设置');
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') triggerSearch();
    });
  }

  private async handleSelect(item: any, statusEl: HTMLElement) {
    if (this.isLoading) return;
    this.isLoading = true;
    statusEl.setText('⏳ 正在获取该条目的详细数据...');
    
    try {
      const [detail, relations] = await Promise.all([
        fetchSubject(Number(item.id), this.settings.token),
        fetchSubjectRelations(Number(item.id), this.settings.token),
      ]);
      this.isLoading = false;
      this.close();
      await this.createNote(detail, relations);
    } catch {
      this.isLoading = false;
      statusEl.setText('❌ 拉取详情失败，请检查网络重试');
    }
  }

  private async createNote(detail: any, relations: any[]) {
    const typeKey: SubjectTypeKey = SUBJECT_TYPE_MAP[Number(detail.type)] ?? 'anime';
    const config = this.settings.subjectTypes[typeKey];
    const typeLabel = SUBJECT_TYPE_LABEL[typeKey];
    const infobox = parseInfobox(detail.infobox ?? []);

    const baseTitle = String(detail.name_cn || detail.name).replace(/[\\/:*?"<>|]/g, '_');
    const coverLocal = await downloadCover(
      this.app, String(detail.images?.large || ''), config.coverPath, baseTitle
    );

    const subjective = await new Promise<{ status: string; rating: string; comment: string }>(resolve => {
      new SubjectiveInputModal(this.app, baseTitle, resolve).open();
    });

    const vars = buildTemplateVars(detail, relations, infobox, coverLocal, subjective);

    if (typeKey === 'anime' && !vars.adaptation) {
      vars.adaptation = await new Promise<string>(resolve => {
        new AdaptationModal(this.app, vars.title, resolve).open();
      });
    }

    const subjectTypeDesc = getInfoboxValue(infobox, ['放送类型', '话数']).replace(/\d+/g, '').trim();
    const archivePath = resolveArchivePath(config.archiveRoot, config.archiveMode, vars.year, vars.season);

    const otherArchiveRoots = (Object.keys(this.settings.subjectTypes) as SubjectTypeKey[])
      .filter(k => k !== typeKey)
      .map(k => this.settings.subjectTypes[k].archiveRoot);

    const naming = await resolveNaming(
      this.app, baseTitle, typeKey, typeLabel,
      config.archiveRoot, otherArchiveRoots, vars.year, vars.bangumi_id, subjectTypeDesc
    );

    const filename = naming.filename;
    const filePath = `${archivePath}/${filename}.md`;

    if (naming.conflict === 'other') {
      new Notice(`⚠️ 警告：检测到当前条目已在其他分类归档：${naming.existingPath}，操作已终止。`);
      return;
    }

    if (naming.conflict === 'same') {
      const action = await this.resolveOverwrite(config.overwriteMode, filename);
      if (action === 'skip') {
        return;
      }
    }

    const template = await resolveTemplate(this.app, typeKey, this.settings);
    vars.title = filename;
    let content = renderTemplate(template, vars);

    if (naming.conflict === 'same') {
      const preserved = await extractPreservedContent(this.app, naming.existingPath);
      content = injectPreservedContent(content, preserved);
    }

    await ensureFolder(this.app, archivePath);

    let file: TFile;
    if (naming.conflict === 'same') {
      const existingFile = this.app.vault.getAbstractFileByPath(naming.existingPath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, content);
        file = existingFile;
      } else {
        new Notice('❌ 无法定位既有文件实例进行改写');
        return;
      }
    } else {
      file = await this.app.vault.create(filePath, content);
    }

    await writeFrontmatter(this.app, file, detail, infobox, vars, typeKey, coverLocal);

    if (typeKey === 'anime' && this.settings.createVideoDir && this.settings.videoRootDir) {
      await createLocalVideoDir(this.app, this.settings.videoRootDir, filename);
    }

    new Notice(`✅ ${naming.conflict === 'same' ? '基础属性已覆写更新' : '结构化笔记已成功建立'}：${filename}`);
  }

  private async resolveOverwrite(mode: string, filename: string): Promise<'overwrite' | 'skip'> {
    if (mode === 'always') return 'overwrite';
    if (mode === 'never') return 'skip';
    return new Promise(resolve => {
      new ConfirmModal(
        this.app,
        `笔记文件已存在：${filename}`,
        '是否执行覆盖更新？原有标记的“个人总结”区域手写笔记将会被智能提取保留。',
        () => resolve('overwrite'),
        () => resolve('skip')
      ).open();
    });
  }

  onClose() { this.contentEl.empty(); }
}

class SubjectiveInputModal extends Modal {
  private status = '在看';
  private rating = '';
  private comment = '';

  constructor(
    app: App,
    private itemTitle: string,
    private resolve: (res: { status: string; rating: string; comment: string }) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: `记录随笔评价 -> ${this.itemTitle}` });

    const statusRow = contentEl.createEl('div', { cls: 'bangumi-input-row' });
    statusRow.createEl('label', { text: '观看/收藏状态' });
    const statusSelect = statusRow.createEl('select');
    ['在看', '想看', '看过', '搁置', '抛弃'].forEach(opt => {
      const el = statusSelect.createEl('option', { text: opt, value: opt });
      if (opt === '在看') el.selected = true;
    });
    statusSelect.addEventListener('change', () => this.status = statusSelect.value);

    const ratingRow = contentEl.createEl('div', { cls: 'bangumi-input-row' });
    ratingRow.createEl('label', { text: '个人评分 (可选 1-10)' });
    const ratingInput = ratingRow.createEl('input', { type: 'number' });
    ratingInput.min = '1';
    ratingInput.max = '10';
    ratingInput.placeholder = '不打分';
    ratingInput.addEventListener('input', () => this.rating = ratingInput.value);

    const commentRow = contentEl.createEl('div', { cls: 'bangumi-input-row' });
    commentRow.createEl('label', { text: '此时此刻的即时吐槽/短评 (随笔)' });
    const commentArea = commentRow.createEl('textarea');
    commentArea.placeholder = '写下你的第一印象或观后感，会自动填入模板占位符和元数据里...';
    commentArea.addEventListener('input', () => this.comment = commentArea.value);

    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });
    const submitBtn = btnRow.createEl('button', { text: '保存并继续构建笔记', cls: 'bangumi-confirm-ok' });
    
    submitBtn.addEventListener('click', () => {
      this.close();
      this.resolve({ status: this.status, rating: this.rating, comment: this.comment });
    });
  }

  onClose() { this.contentEl.empty(); }
}


class ConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private desc: string,
    private onConfirm: () => void,
    private onCancel: () => void
  ) { super(app); }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    contentEl.createEl('p', { text: this.desc });
    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });
    
    const cancelBtn = btnRow.createEl('button', { text: '跳过' });
    cancelBtn.addEventListener('click', () => { this.close(); this.onCancel(); });
    
    const confirmBtn = btnRow.createEl('button', { text: '确认覆盖', cls: 'bangumi-confirm-ok' });
    confirmBtn.addEventListener('click', () => { this.close(); this.onConfirm(); });
  }

  onClose() { this.contentEl.empty(); }
}

class AdaptationModal extends Modal {
  private readonly options = ['原创', '漫画改编', '小说改编', '游戏改编', '其他'];

  constructor(app: App, private title: string, private resolve: (val: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    contentEl.createEl('p', { text: '无法从 Bangumi 特征数据中自动推断出该动画的改编类型，请手动选择：' });
    
    // 抽离样式至外部，追加专属控制类名：bangumi-adaptation-wrapper
    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns bangumi-adaptation-wrapper' });
    
    this.options.forEach(opt => {
      const btn = btnRow.createEl('button', { text: opt });
      btn.addEventListener('click', () => {
        this.close();
        this.resolve(opt);
      });
    });
  }

  onClose() { this.contentEl.empty(); }
}
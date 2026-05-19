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
        buttons.forEach((b, j) => {
          const filter = TYPE_FILTERS[j];
          if (filter) b.classList.toggle('active', filter.value === this.currentType);
        });
        if (inputEl.value.trim()) void triggerSearch();
      });
      buttons.push(btn);
    });

    const inputEl = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入名称后按 Enter 搜索...',
      cls: 'bangumi-search-input',
    });

    const statusEl = contentEl.createEl('div', { cls: 'bangumi-status' });
    const resultsEl = contentEl.createEl('div');

    const triggerSearch = async () => {
      const kw = inputEl.value.trim();
      if (!kw || this.isLoading) return;
      this.isLoading = true;
      resultsEl.empty();
      statusEl.setText('🔍 搜索中...');
      try {
        const results = await searchSubjects(kw, this.currentType, this.settings.token);
        statusEl.setText(results.length ? '' : '没有找到结果');
        this.renderResults(resultsEl, results);
      } catch {
        statusEl.setText('搜索失败，请检查网络');
      } finally {
        this.isLoading = false;
      }
    };

    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') void triggerSearch();
    });
    inputEl.focus();
  }

  private renderResults(container: HTMLElement, results: any[]) {
    container.empty();
    if (!results?.length) return;

    results.forEach(item => {
      const row = container.createEl('div', { cls: 'bangumi-result-row' });

      if (item.images?.common) {
        const img = row.createEl('img', { cls: 'bangumi-result-cover' });
        img.src = String(item.images.common);
      }

      const info = row.createEl('div', { cls: 'bangumi-result-info' });
      info.createEl('div', {
        text: String(item.name_cn || item.name),
        cls: 'bangumi-result-title',
      });
      if (item.name_cn && item.name !== item.name_cn) {
        info.createEl('div', { text: String(item.name), cls: 'bangumi-result-subtitle' });
      }

      const meta = info.createEl('div', { cls: 'bangumi-result-meta' });
      const typeKey = SUBJECT_TYPE_MAP[item.type];
      const score = item.rating?.score ? `⭐ ${String(item.rating.score)}` : '';
      const date = String(item.air_date ?? '').substring(0, 4);
      meta.setText([typeKey ? SUBJECT_TYPE_LABEL[typeKey] : '未知', date, score].filter(Boolean).join(' · '));

      row.addEventListener('click', () => { void this.handleSelect(item); });
    });
  }

  private async handleSelect(item: any) {
    this.close();
    const notice = new Notice('⏳ 正在获取详情...', 0);
    try {
      const [detail, relations] = await Promise.all([
        fetchSubject(Number(item.id), this.settings.token),
        fetchSubjectRelations(Number(item.id), this.settings.token),
      ]);
      notice.hide();
      await this.createNote(detail, relations);
    } catch {
      notice.hide();
      new Notice('❌ 获取详情失败，请检查网络');
    }
  }

  private async createNote(detail: any, relations: any[]) {
    const typeKey: SubjectTypeKey = SUBJECT_TYPE_MAP[Number(detail.type)] ?? 'anime';
    const config    = this.settings.subjectTypes[typeKey];
    const typeLabel = SUBJECT_TYPE_LABEL[typeKey];
    const infobox   = parseInfobox(detail.infobox ?? []);

    const baseTitle  = String(detail.name_cn || detail.name).replace(/[\\/:*?"<>|]/g, '_');
    const coverLocal = await downloadCover(
      this.app, String(detail.images?.large ?? ''), config.coverPath, baseTitle
    );

    const vars = buildTemplateVars(detail, relations, infobox, coverLocal);

    if (!vars.adaptation) {
      vars.adaptation = await new Promise<string>(resolve => {
        new AdaptationModal(this.app, vars.title, resolve).open();
      });
    }

    const subjectTypeDesc = getInfoboxValue(infobox, ['放送类型', '话数'])
      .replace(/\d+/g, '').trim();

    const archivePath = resolveArchivePath(
      config.archiveRoot, config.archiveMode, vars.year, vars.season
    );

    const otherArchiveRoots = (Object.keys(this.settings.subjectTypes) as SubjectTypeKey[])
      .filter(k => k !== typeKey)
      .map(k => this.settings.subjectTypes[k].archiveRoot);

    const naming = await resolveNaming(
      this.app, baseTitle, typeKey, typeLabel,
      config.archiveRoot, otherArchiveRoots,
      vars.year, vars.bangumi_id, subjectTypeDesc,
    );

    const filename = naming.filename;
    const filePath = `${archivePath}/${filename}.md`;

    if (naming.conflict === 'same') {
      const action = await this.resolveOverwrite(config.overwriteMode, filename);
      if (action === 'skip') {
        new Notice(`📝 已跳过：${filename}`);
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

    // 写文件
    await ensureFolder(this.app, archivePath);

    let file: TFile;
    if (naming.conflict === 'same') {
      const existingFile = this.app.vault.getAbstractFileByPath(naming.existingPath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, content);
        file = existingFile;
      } else return;
    } else {
      file = await this.app.vault.create(filePath, content);
    }

    // 用官方 API 写 frontmatter，绕过手动 YAML 转义问题
    await writeFrontmatter(this.app, file, detail, infobox, vars, typeKey, coverLocal);


    if (naming.conflict === 'same') {
      const existingFile = this.app.vault.getAbstractFileByPath(naming.existingPath);
      if (existingFile instanceof TFile) await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    if (this.settings.createVideoDir && this.settings.videoRootDir) {
      await createLocalVideoDir(this.settings.videoRootDir, filename);
    }

    new Notice(`✅ ${naming.conflict === 'same' ? '已更新' : '已创建'}：${filename}`);
  }

  private async resolveOverwrite(mode: string, filename: string): Promise<'overwrite' | 'skip'> {
    if (mode === 'always') return 'overwrite';
    if (mode === 'never')  return 'skip';
    return new Promise(resolve => {
      new ConfirmModal(
        this.app,
        `笔记已存在：${filename}`,
        '是否覆盖更新？已写内容将自动保留。',
        () => resolve('overwrite'),
        () => resolve('skip'),
      ).open();
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
    private onCancel: () => void,
  ) { super(app); }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    contentEl.createEl('p', { text: this.desc });
    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });
    const cancelBtn = btnRow.createEl('button', { text: '跳过' });
    cancelBtn.addEventListener('click', () => { this.close(); this.onCancel(); });
    const confirmBtn = btnRow.createEl('button', { text: '覆盖更新', cls: 'bangumi-confirm-ok' });
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
    contentEl.createEl('p', {
      text: '无法自动判断改编类型，请手动选择：',
      cls: 'bangumi-adaptation-desc',
    });
    const grid = contentEl.createEl('div', { cls: 'bangumi-adaptation-grid' });
    this.options.forEach(opt => {
      const btn = grid.createEl('button', { text: opt, cls: 'bangumi-adaptation-btn' });
      btn.addEventListener('click', () => { this.close(); this.resolve(opt); });
    });
  }

  onClose() { this.contentEl.empty(); }
}
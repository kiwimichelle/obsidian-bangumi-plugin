import { App, FuzzySuggestModal, Modal, Notice, TFile } from 'obsidian';
import {
  searchSubjects, fetchSubject, fetchSubjectRelations,
  parseInfobox, getInfoboxValue,
} from './api';
import {
  BangumiSettings, SubjectTypeKey,
  AnimeSubjective, BookSubjective, GameSubjective,
  MusicSubjective, RealSubjective,
  BookSubtype, GamePlatform, GAME_PLATFORMS,
} from './types';
import {
  SUBJECT_TYPE_MAP, SUBJECT_TYPE_LABEL, TYPE_FILTERS,
  STATUS_OPTIONS, BOOK_CHANNELS, BOOK_VERSIONS, MUSIC_SOURCES,
} from './constants';
import {
  buildTemplateVars, resolveTemplate, renderTemplate,
  resolveArchivePath, resolveBookArchivePath,
  resolveGameArchivePath, detectBookSubtype, detectAdaptation,
} from './template';
import {
  resolveNaming, downloadCover, createLocalVideoDir,
  extractPreservedContent, injectPreservedContent,
  prependLog, writeFrontmatter, ensureFolder,
} from './vault';

// ── 通用 FuzzySuggest 工具 ──────────────────────────────────────

class OptionSuggestModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private options: string[],
    private onChoose: (val: string) => void,
    placeholder = '选择...',
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems()                { return this.options; }
  getItemText(item: string) { return item; }
  onChooseItem(item: string) { this.onChoose(item); }
}

function fuzzySelect(app: App, options: string[], placeholder?: string): Promise<string> {
  return new Promise(resolve => {
    new OptionSuggestModal(app, options, resolve, placeholder).open();
  });
}

// ── 搜索主弹窗 ─────────────────────────────────────────────────

export class BangumiSearchModal extends Modal {
  private settings: BangumiSettings;
  private currentType = 0;
  private isLoading   = false;
  private currentPage = 1;
  private totalItems  = 0;
  private lastKeyword = '';

  constructor(app: App, settings: BangumiSettings) {
    super(app);
    this.settings = settings;
  }

  onOpen() {
    const { contentEl } = this;
    this.setTitle('Bangumi 搜索');

    // 类型筛选
    const filterBar = contentEl.createEl('div', { cls: 'bangumi-modal-filter-bar' });
    const buttons: HTMLButtonElement[] = [];
    TYPE_FILTERS.forEach(f => {
      const btn = filterBar.createEl('button', { text: f.label, cls: 'bangumi-filter-btn' });
      if (f.value === this.currentType) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.currentType = f.value;
        this.currentPage = 1;
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (inputEl.value.trim()) void triggerSearch(true);
      });
      buttons.push(btn);
    });

    // 搜索框
    const inputEl = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入名称后按 Enter 搜索...',
      cls: 'bangumi-search-input',
    });

    const statusEl    = contentEl.createEl('div', { cls: 'bangumi-status' });
    const resultsEl   = contentEl.createEl('div', { cls: 'bangumi-results' });
    const paginationEl = contentEl.createEl('div', { cls: 'bangumi-pagination' });

    const triggerSearch = async (reset = false) => {
      const kw = inputEl.value.trim();
      if (!kw || this.isLoading) return;
      if (reset) this.currentPage = 1;
      this.lastKeyword = kw;
      this.isLoading   = true;
      resultsEl.empty();
      paginationEl.empty();
      statusEl.setText('🔍 搜索中...');

      try {
        const { list, total } = await searchSubjects(
          kw, this.currentType, this.settings.token,
          this.currentPage, 12
        );
        this.totalItems = total;
        this.isLoading  = false;

        if (!list.length) {
          statusEl.setText('没有找到结果');
          return;
        }
        statusEl.setText(`找到 ${total} 个结果`);
        this.renderResults(resultsEl, list, statusEl);
        this.renderPagination(paginationEl, triggerSearch);
      } catch {
        this.isLoading = false;
        statusEl.setText('❌ 搜索失败，请检查网络');
      }
    };

    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') void triggerSearch(true);
    });
    inputEl.focus();
  }

  private renderResults(container: HTMLElement, list: any[], statusEl: HTMLElement) {
    container.empty();
    list.forEach(item => {
      const row = container.createEl('div', { cls: 'bangumi-result-row' });

      const img = row.createEl('img', { cls: 'bangumi-result-cover' });
      img.src = String(item.images?.common || item.images?.medium || '');

      const info = row.createEl('div', { cls: 'bangumi-result-info' });
      info.createEl('div', {
        text: String(item.name_cn || item.name),
        cls: 'bangumi-result-title',
      });
      if (item.name_cn && item.name !== item.name_cn) {
        info.createEl('div', { text: String(item.name), cls: 'bangumi-result-subtitle' });
      }
      const typeKey = SUBJECT_TYPE_MAP[Number(item.type)];
      const label   = typeKey ? SUBJECT_TYPE_LABEL[typeKey] : '未知';
      const score   = item.score  ? `⭐ ${item.score}`  : '';
      const date    = item.date   ? String(item.date).substring(0, 4) : '';
      info.createEl('div', {
        text: [label, date, score].filter(Boolean).join(' · '),
        cls: 'bangumi-result-meta',
      });

      row.addEventListener('click', () => {
        statusEl.setText('⏳ 正在获取详情...');
        void this.handleSelect(item, statusEl);
      });
    });
  }

  private renderPagination(container: HTMLElement, triggerSearch: (reset?: boolean) => Promise<void>) {
    const totalPages = Math.ceil(this.totalItems / 12);
    if (totalPages <= 1) return;

    const wrap = container.createEl('div', { cls: 'bangumi-pagination-wrap' });

    if (this.currentPage > 1) {
      const prev = wrap.createEl('button', { text: '← 上一页', cls: 'bangumi-page-btn' });
      prev.addEventListener('click', () => {
        this.currentPage--;
        void triggerSearch();
      });
    }

    wrap.createEl('span', {
      text: `第 ${this.currentPage} / ${totalPages} 页`,
      cls: 'bangumi-page-info',
    });

    if (this.currentPage < totalPages) {
      const next = wrap.createEl('button', { text: '下一页 →', cls: 'bangumi-page-btn' });
      next.addEventListener('click', () => {
        this.currentPage++;
        void triggerSearch();
      });
    }
  }

  private async handleSelect(item: any, statusEl: HTMLElement) {
    if (this.isLoading) return;
    this.isLoading = true;
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
      statusEl.setText('❌ 获取详情失败，请重试');
    }
  }

  private async createNote(detail: any, relations: any[]) {
    const typeKey   = SUBJECT_TYPE_MAP[Number(detail.type)] ?? 'anime';
    const config    = this.settings.subjectTypes[typeKey];
    const typeLabel = SUBJECT_TYPE_LABEL[typeKey];
    const infobox   = parseInfobox(detail.infobox ?? []);

    const baseTitle  = String(detail.name_cn || detail.name || '')
      .replace(/[\\/:*?"<>|]/g, '_').trim();

    // 封面下载
    const coverLocal = await downloadCover(
      this.app, String(detail.images?.large ?? ''), config.coverPath, baseTitle
    );

    // 主观输入弹窗
    const subjective = await this.getSubjectiveInput(typeKey, detail, infobox);
    if (!subjective) return; // 用户取消

    // 改编类型（动画）
    if (typeKey === 'anime') {
      const s = subjective as AnimeSubjective & { adaptation?: string };
      if (!s.adaptation) {
        const detected = detectAdaptation(infobox);
        s.adaptation = detected || await new Promise<string>(resolve => {
          new AdaptationModal(this.app, baseTitle, resolve).open();
        });
      }
    }

    // 构建模板变量
    const vars = buildTemplateVars(detail, relations, infobox, coverLocal, subjective, typeKey);

    // 动画改编类型注入
    if (typeKey === 'anime') {
      const s = subjective as any;
      if (s.adaptation) vars.adaptation = s.adaptation;
    }

    // 确定归档路径
    let archivePath = '';
    if (typeKey === 'anime' || typeKey === 'real') {
      archivePath = resolveArchivePath(config.archiveRoot, config.archiveMode, vars.year, vars.season);
    } else if (typeKey === 'book') {
      const s = subjective as BookSubjective;
      archivePath = resolveBookArchivePath(config.archiveRoot, s.subtype);
    } else if (typeKey === 'game') {
      const s = subjective as GameSubjective;
      archivePath = resolveGameArchivePath(config.archiveRoot, s.platform);
    } else {
      archivePath = config.archiveRoot;
    }

    // 其他类型归档根路径（防撞用）
    const otherRoots = (Object.keys(this.settings.subjectTypes) as SubjectTypeKey[])
      .filter(k => k !== typeKey)
      .map(k => this.settings.subjectTypes[k].archiveRoot);

    // 防撞命名
    const naming = await resolveNaming(
      this.app, baseTitle, typeKey, typeLabel,
      config.archiveRoot, otherRoots, vars.bangumi_id,
    );

    if (naming.conflict === 'other') {
      new Notice(`⚠️ 该条目已在其他分类存在：${naming.existingPath}`);
      return;
    }

    const filename = naming.filename;
    const filePath = `${archivePath}/${filename}.md`;

    // 覆盖策略
    if (naming.conflict === 'same') {
      const action = await this.resolveOverwrite(config.overwriteMode, filename);
      if (action === 'skip') {
        new Notice(`📝 已跳过：${filename}`);
        return;
      }
    }

    // 渲染模板
    const template = await resolveTemplate(this.app, typeKey, this.settings);
    vars.title = filename;
    let content = renderTemplate(template, vars);

    // 书籍/游戏：时间线日志追加
    if (naming.conflict === 'same') {
      const preserved = await extractPreservedContent(this.app, naming.existingPath, typeKey);

      // 游戏时长累加
      if (typeKey === 'game') {
        const s = subjective as GameSubjective;
        const oldHours = parseFloat(preserved.gameHours) || 0;
        const addHours = parseFloat(s.hours) || 0;
        s.hours = String((oldHours + addHours).toFixed(1));
        vars.my_hours = s.hours;
        content = renderTemplate(template, vars);
      }

      // 构建新日志行
      const today = vars.today;
      let newLog = '';
      if (typeKey === 'book') {
        const s = subjective as BookSubjective;
        newLog = `- **${today}** ｜ 状态 \`${s.status}\` ｜ 进度 \`${vars.my_read_progress}\``;
        if (s.comment) newLog += `\n  > ${s.comment}`;
        content = content.replace(
          /(# 📝 读书随笔\n)([\s\S]*?)(\n# |$)/,
          `$1\n${prependLog(preserved.bookLogs, newLog)}\n$3`
        );
      } else if (typeKey === 'game') {
        const s = subjective as GameSubjective;
        newLog = `- **${today}** ｜ 状态 \`${s.status}\` ｜ 时长累计 \`${s.hours} 小时\``;
        if (s.progress) newLog += ` ｜ 进度 \`${s.progress}\``;
        if (s.comment) newLog += `\n  > ${s.comment}`;
        content = content.replace(
          /(# 📝 游玩随笔\n)([\s\S]*?)(\n# |$)/,
          `$1\n${prependLog(preserved.gameLogs, newLog)}\n$3`
        );
      } else {
        content = injectPreservedContent(content, preserved, typeKey);
      }
    }

    // 写文件
    await ensureFolder(this.app, archivePath);
    let file: TFile;
    if (naming.conflict === 'same') {
      const existing = this.app.vault.getAbstractFileByPath(naming.existingPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
        file = existing;
      } else return;
    } else {
      file = await this.app.vault.create(filePath, content);
    }

    // 写 frontmatter
    await writeFrontmatter(this.app, file, detail, infobox, vars, typeKey, coverLocal, subjective);

    // 本地视频文件夹（仅动画）
    if (typeKey === 'anime' && this.settings.createVideoDir && this.settings.videoRootDir) {
      await createLocalVideoDir(this.app, this.settings.videoRootDir, filename);
    }

    new Notice(`✅ ${naming.conflict === 'same' ? '已更新' : '已创建'}：${filename}`);
  }

  // ── 主观输入弹窗（按类型动态化）──────────────────────────────

  private getSubjectiveInput(
    typeKey: SubjectTypeKey,
    detail: any,
    infobox: any[],
  ): Promise<AnimeSubjective | BookSubjective | GameSubjective | MusicSubjective | RealSubjective | null> {
    return new Promise(resolve => {
      new SubjectiveInputModal(this.app, typeKey, detail, infobox, resolve).open();
    });
  }

  private async resolveOverwrite(mode: string, filename: string): Promise<'overwrite' | 'skip'> {
    if (mode === 'always') return 'overwrite';
    if (mode === 'never')  return 'skip';
    return new Promise(resolve => {
      new ConfirmModal(
        this.app,
        `笔记已存在：${filename}`,
        '是否覆盖更新？手写内容将自动保留。',
        () => resolve('overwrite'),
        () => resolve('skip'),
      ).open();
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ── 主观输入弹窗 ────────────────────────────────────────────────

class SubjectiveInputModal extends Modal {
  constructor(
    app: App,
    private typeKey: SubjectTypeKey,
    private detail: any,
    private infobox: any[],
    private resolve: (val: any) => void,
  ) { super(app); }

  onOpen() {
    const { contentEl } = this;
    const title = String(this.detail.name_cn || this.detail.name || '');
    this.setTitle(title);

    if (this.typeKey === 'anime') this.buildAnimeForm(contentEl);
    else if (this.typeKey === 'book') this.buildBookForm(contentEl);
    else if (this.typeKey === 'game') this.buildGameForm(contentEl);
    else if (this.typeKey === 'music') this.buildMusicForm(contentEl);
    else this.buildRealForm(contentEl);
  }

  private addRow(container: HTMLElement, label: string): HTMLElement {
    const row = container.createEl('div', { cls: 'bangumi-input-row' });
    row.createEl('label', { text: label });
    return row;
  }

  private addSelect(row: HTMLElement, options: string[], defaultVal = ''): HTMLSelectElement {
    const sel = row.createEl('select');
    options.forEach(opt => {
      const el = sel.createEl('option', { text: opt, value: opt });
      if (opt === defaultVal) el.selected = true;
    });
    return sel;
  }

  private addInput(row: HTMLElement, placeholder = '', defaultVal = '', type = 'text'): HTMLInputElement {
    const inp = row.createEl('input', { type });
    inp.placeholder = placeholder;
    inp.value = defaultVal;
    if (type === 'number') { inp.min = '0'; }
    return inp;
  }

  private addTextarea(row: HTMLElement, placeholder = ''): HTMLTextAreaElement {
    const ta = row.createEl('textarea');
    ta.placeholder = placeholder;
    return ta;
  }

  private addSubmitBtn(container: HTMLElement, onClick: () => void) {
    const btnRow = container.createEl('div', { cls: 'bangumi-confirm-btns' });
    const cancelBtn = btnRow.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => { this.close(); this.resolve(null); });
    const submitBtn = btnRow.createEl('button', { text: '保存并建档', cls: 'bangumi-confirm-ok' });
    submitBtn.addEventListener('click', () => { this.close(); onClick(); });
  }

  private buildAnimeForm(el: HTMLElement) {
    const statusSel = this.addSelect(this.addRow(el, '观看状态'), STATUS_OPTIONS.anime, '想看');
    const progressInp = this.addInput(this.addRow(el, '已观看集数'), '0', '0', 'number');
    const sourceInp = this.addInput(this.addRow(el, '观看网址'), 'https://...');
    const ratingInp = this.addInput(this.addRow(el, '个人评分（1-10）'), '不评分', '', 'number');
    const commentTa = this.addTextarea(this.addRow(el, '即时短评'), '写下此刻的感受...');

    this.addSubmitBtn(el, () => {
      this.resolve({
        status:   statusSel.value,
        progress: progressInp.value,
        source:   sourceInp.value,
        rating:   ratingInp.value,
        comment:  commentTa.value,
      } as AnimeSubjective);
    });
  }

  private buildBookForm(el: HTMLElement) {
    // 自动判断书籍类型
    const platform = String(this.detail.platform ?? '');
    const detectedSubtype = detectBookSubtype(platform, parseInfobox(this.infobox));
    const subtypeOptions = ['漫画', '轻小说', '小说'];
    const subtypeMap: Record<string, BookSubtype> = {
      '漫画': 'manga', '轻小说': 'lightnovel', '小说': 'novel',
    };
    const subtypeDefault = detectedSubtype === 'manga' ? '漫画'
      : detectedSubtype === 'lightnovel' ? '轻小说' : '小说';

    const subtypeSel  = this.addSelect(this.addRow(el, '书籍类型'), subtypeOptions, subtypeDefault);
    const statusSel   = this.addSelect(this.addRow(el, '阅读状态'), STATUS_OPTIONS.book, '想读');
    const volInp      = this.addInput(this.addRow(el, '当前卷数'), '0', '0', 'number');
    const unitInp     = this.addInput(this.addRow(el, '当前话/章数'), '0', '0', 'number');
    const channelSel  = this.addSelect(this.addRow(el, '阅读渠道'), BOOK_CHANNELS, BOOK_CHANNELS[0]);
    const versionSel  = this.addSelect(this.addRow(el, '翻译版本'), BOOK_VERSIONS, BOOK_VERSIONS[0]);
    const ratingInp   = this.addInput(this.addRow(el, '个人评分（1-10）'), '不评分', '', 'number');
    const commentTa   = this.addTextarea(this.addRow(el, '即时短评'), '写下第一印象...');

    this.addSubmitBtn(el, () => {
      this.resolve({
        status:  statusSel.value,
        subtype: subtypeMap[subtypeSel.value] ?? 'novel',
        volNum:  volInp.value,
        unitNum: unitInp.value,
        channel: channelSel.value,
        version: versionSel.value,
        rating:  ratingInp.value,
        comment: commentTa.value,
      } as BookSubjective);
    });
  }

  private buildGameForm(el: HTMLElement) {
    const statusSel   = this.addSelect(this.addRow(el, '游玩状态'), STATUS_OPTIONS.game, '想玩');
    const platformSel = this.addSelect(this.addRow(el, '游玩平台'), GAME_PLATFORMS, 'Steam');
    const hoursInp    = this.addInput(this.addRow(el, '游玩时长（小时）'), '0', '0', 'number');
    const progressInp = this.addInput(this.addRow(el, '当前进度'), '例：第一章');
    const ratingInp   = this.addInput(this.addRow(el, '个人评分（1-10）'), '不评分', '', 'number');
    const commentTa   = this.addTextarea(this.addRow(el, '即时短评'), '写下游玩感受...');

    this.addSubmitBtn(el, () => {
      this.resolve({
        status:   statusSel.value,
        platform: platformSel.value as GamePlatform,
        hours:    hoursInp.value,
        progress: progressInp.value,
        rating:   ratingInp.value,
        comment:  commentTa.value,
      } as GameSubjective);
    });
  }

  private buildMusicForm(el: HTMLElement) {
    const statusSel = this.addSelect(this.addRow(el, '收听状态'), STATUS_OPTIONS.music, '想听');
    const sourceSel = this.addSelect(this.addRow(el, '收听平台'), MUSIC_SOURCES, MUSIC_SOURCES[0]);
    const ratingInp = this.addInput(this.addRow(el, '个人评分（1-10）'), '不评分', '', 'number');
    const commentTa = this.addTextarea(this.addRow(el, '即时短评'), '写下收听感受...');

    this.addSubmitBtn(el, () => {
      this.resolve({
        status:  statusSel.value,
        source:  sourceSel.value,
        rating:  ratingInp.value,
        comment: commentTa.value,
      } as MusicSubjective);
    });
  }

  private buildRealForm(el: HTMLElement) {
    const statusSel   = this.addSelect(this.addRow(el, '观看状态'), STATUS_OPTIONS.real, '想看');
    const progressInp = this.addInput(this.addRow(el, '已观看集数'), '0', '0', 'number');
    const sourceInp   = this.addInput(this.addRow(el, '观看网址'), 'https://...');
    const ratingInp   = this.addInput(this.addRow(el, '个人评分（1-10）'), '不评分', '', 'number');
    const commentTa   = this.addTextarea(this.addRow(el, '即时短评'), '写下感受...');

    this.addSubmitBtn(el, () => {
      this.resolve({
        status:   statusSel.value,
        progress: progressInp.value,
        source:   sourceInp.value,
        rating:   ratingInp.value,
        comment:  commentTa.value,
      } as RealSubjective);
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ── 改编类型弹窗 ────────────────────────────────────────────────

class AdaptationModal extends Modal {
  private readonly options = ['原创', '漫画改编', '小说改编', '轻小说改编', '游戏改编', '其他'];

  constructor(app: App, private title: string, private resolve: (val: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.setTitle(this.title);
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

// ── 确认弹窗 ────────────────────────────────────────────────────

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private desc: string,
    private onConfirm: () => void,
    private onCancel:  () => void,
  ) { super(app); }

  onOpen() {
    const { contentEl } = this;
    this.setTitle(this.title);
    contentEl.createEl('p', { text: this.desc });
    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });
    btnRow.createEl('button', { text: '跳过' })
      .addEventListener('click', () => { this.close(); this.onCancel(); });
    const ok = btnRow.createEl('button', { text: '覆盖更新', cls: 'bangumi-confirm-ok' });
    ok.addEventListener('click', () => { this.close(); this.onConfirm(); });
  }

  onClose() { this.contentEl.empty(); }
}
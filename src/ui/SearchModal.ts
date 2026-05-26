import { App, Modal } from 'obsidian';
import type {
  BangumiSettings,
  SearchQuery,
  SearchResponse,
  SearchResultItem,
  SubjectData,
  Subjective,
} from '../types';
import { TYPE_FILTERS, SUBJECT_TYPE_LABEL, DEFAULT_PAGE_SIZE } from '../constants';
import type { DataManager }   from '../core/DataManager';
import { ProgressNotice }     from './ProgressNotice';
import { SubjectiveModal }    from './SubjectiveModal';

/** SearchModal.prompt 的返回值 */
export interface SearchResult {
  data:       SubjectData;
  subjective: Subjective;
}

export class SearchModal extends Modal {
  private readonly dataManager: DataManager;
  private readonly getSettings: () => BangumiSettings;
  private readonly resolve:     (val: SearchResult | null) => void;

  // 修复：用 settled 标记 resolve 是否已被调用，防止多次触发
  private settled = false;

  private currentMode: 'offline' | 'online' = 'online';
  private currentType = 0;
  private currentPage = 1;
  private totalItems  = 0;
  private isLoading   = false;
  private lastKeyword = '';

  private inputEl!:      HTMLInputElement;
  private statusEl!:     HTMLElement;
  private resultsEl!:    HTMLElement;
  private paginationEl!: HTMLElement;
  private filterBtns:    HTMLButtonElement[] = [];

  private constructor(
    app:          App,
    dataManager:  DataManager,
    getSettings:  () => BangumiSettings,
    resolve:      (val: SearchResult | null) => void,
  ) {
    super(app);
    this.dataManager = dataManager;
    this.getSettings = getSettings;
    this.resolve     = resolve;
  }

  static prompt(
    app:         App,
    dataManager: DataManager,
    getSettings: () => BangumiSettings,
  ): Promise<SearchResult | null> {
    return new Promise(resolve => {
      new SearchModal(app, dataManager, getSettings, resolve).open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle('Bangumi 搜索');

    // 模式切换器
    const modeBar    = contentEl.createEl('div', { cls: 'bangumi-mode-switcher' });
    const offlineBtn = modeBar.createEl('button', { text: '📴 离线模式', cls: 'bangumi-mode-btn' });
    const onlineBtn  = modeBar.createEl('button', { text: '🌐 在线模式', cls: 'bangumi-mode-btn' });

    this.currentMode = this.getSettings().offlineMode ? 'offline' : 'online';
    if (this.currentMode === 'offline') offlineBtn.classList.add('active');
    else                                onlineBtn.classList.add('active');

    offlineBtn.addEventListener('click', () => {
      this.currentMode = 'offline';
      offlineBtn.classList.add('active');
      onlineBtn.classList.remove('active');
      if (this.lastKeyword) void this.doSearch(true);
    });

    onlineBtn.addEventListener('click', () => {
      this.currentMode = 'online';
      onlineBtn.classList.add('active');
      offlineBtn.classList.remove('active');
      if (this.lastKeyword) void this.doSearch(true);
    });

    // 类型筛选栏
    const filterBar   = contentEl.createEl('div', { cls: 'bangumi-modal-filter-bar' });
    this.filterBtns   = TYPE_FILTERS.map(f => {
      const btn = filterBar.createEl('button', { text: f.label, cls: 'bangumi-filter-btn' });
      if (f.value === this.currentType) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.currentType = f.value;
        this.currentPage = 1;
        this.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.lastKeyword) void this.doSearch(true);
      });
      return btn;
    });

    // 搜索输入框
    this.inputEl = contentEl.createEl('input', {
      type:        'text',
      placeholder: '输入名称后按 Enter 搜索...',
      cls:         'bangumi-search-input',
    });
    this.inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') void this.doSearch(true);
    });

    this.statusEl     = contentEl.createEl('div', { cls: 'bangumi-status' });
    this.resultsEl    = contentEl.createEl('div', { cls: 'bangumi-results' });
    this.paginationEl = contentEl.createEl('div', { cls: 'bangumi-pagination' });

    this.inputEl.focus();
  }

  onClose(): void {
    // 修复：只在 settled=false 时才 resolve(null)，防止选完条目后关弹窗再次触发
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
    this.contentEl.empty();
  }

  // ─────────────────────────────────────────────
  // 搜索
  // ─────────────────────────────────────────────

  private async doSearch(reset = false): Promise<void> {
    const kw = this.inputEl.value.trim();
    if (!kw || this.isLoading) return;
    if (reset) this.currentPage = 1;
    this.lastKeyword = kw;

    this.isLoading = true;
    this.resultsEl.empty();
    this.paginationEl.empty();
    this.statusEl.setText('🔍 搜索中...');

    const query: SearchQuery = {
      keyword:    kw,
      typeFilter: this.currentType,
      page:       this.currentPage,
      limit:      DEFAULT_PAGE_SIZE,
      mode:       this.currentMode,
    };

    let resp: SearchResponse;
    try {
      resp = await this.dataManager.search(query);
    } catch (err) {
      this.isLoading = false;
      this.statusEl.setText('❌ 搜索失败，请检查网络或稍后重试');
      console.error('[bangumi] search error', err);
      return;
    }

    this.isLoading  = false;
    this.totalItems = resp.total;

    if (resp.list.length === 0) {
      this.statusEl.setText('没有找到结果');
      return;
    }

    const sourceTag  = resp.fromOffline ? '（离线）' : '（在线）';
    const settings   = this.getSettings();
    const nsfwCount  = resp.list.filter(i => i.nsfw).length;
    let statusText   = `找到 ${resp.total} 个结果 ${sourceTag}`;
    if (nsfwCount > 0 && !settings.hideNsfw) {
      statusText += `，其中 ${nsfwCount} 个含 NSFW 内容`;
    }
    this.statusEl.setText(statusText);

    this.renderResults(resp.list);
    this.renderPagination();
  }

  // ─────────────────────────────────────────────
  // 渲染结果
  // ─────────────────────────────────────────────

  private renderResults(list: SearchResultItem[]): void {
    this.resultsEl.empty();
    for (const item of list) {
      const row = this.resultsEl.createEl('div', {
        cls: item.nsfw
          ? 'bangumi-result-row bangumi-result-row--nsfw'
          : 'bangumi-result-row',
      });

      if (item.coverUrl) {
        const img = row.createEl('img', { cls: 'bangumi-result-cover' });
        img.src = item.coverUrl;
        img.alt = item.name;
      } else {
        row.createEl('div', { cls: 'bangumi-result-cover bangumi-result-cover--empty' });
      }

      const info     = row.createEl('div', { cls: 'bangumi-result-info' });
      const titleRow = info.createEl('div', { cls: 'bangumi-result-title-row' });
      titleRow.createEl('span', { text: item.name, cls: 'bangumi-result-title' });

      if (item.nsfw) {
        titleRow.createEl('span', {
          text: '🔞',
          cls:  'bangumi-result-nsfw-badge',
          attr: { title: '此条目含有成人内容（NSFW）' },
        });
      }

      if (item.nameOriginal && item.nameOriginal !== item.name) {
        info.createEl('div', { text: item.nameOriginal, cls: 'bangumi-result-subtitle' });
      }

      const metaParts: string[] = [SUBJECT_TYPE_LABEL[item.typeKey]];
      if (item.year)    metaParts.push(item.year);
      if (item.score > 0) metaParts.push(`⭐ ${item.score}`);
      info.createEl('div', { text: metaParts.join(' · '), cls: 'bangumi-result-meta' });

      row.addEventListener('click', () => void this.handleSelect(item));
    }
  }

  // ─────────────────────────────────────────────
  // 分页
  // ─────────────────────────────────────────────

  private renderPagination(): void {
    this.paginationEl.empty();
    const totalPages = Math.ceil(this.totalItems / DEFAULT_PAGE_SIZE);
    if (totalPages <= 1) return;

    const wrap = this.paginationEl.createEl('div', { cls: 'bangumi-pagination-wrap' });

    if (this.currentPage > 1) {
      const prev = wrap.createEl('button', { text: '← 上一页', cls: 'bangumi-page-btn' });
      prev.addEventListener('click', () => { this.currentPage--; void this.doSearch(); });
    }

    wrap.createEl('span', {
      text: `第 ${this.currentPage} / ${totalPages} 页`,
      cls:  'bangumi-page-info',
    });

    if (this.currentPage < totalPages) {
      const next = wrap.createEl('button', { text: '下一页 →', cls: 'bangumi-page-btn' });
      next.addEventListener('click', () => { this.currentPage++; void this.doSearch(); });
    }
  }

  // ─────────────────────────────────────────────
  // 选中条目
  // ─────────────────────────────────────────────

  private async handleSelect(item: SearchResultItem): Promise<void> {
    if (this.isLoading || this.settled) return;
    this.isLoading = true;

    const notice = new ProgressNotice(`⏳ 正在获取「${item.name}」详情...`);

    let data: SubjectData;
    try {
      data = await this.dataManager.getSubject(item.id);
    } catch (err) {
      this.isLoading = false;
      notice.error('❌ 获取详情失败，请重试');
      console.error('[bangumi] getSubject error', err);
      return;
    }

    notice.update('⏳ 请填写主观信息...');

    const subjective = await SubjectiveModal.prompt(this.app, data);

    this.isLoading = false;

    if (!subjective) {
      // 用户在 SubjectiveModal 取消，回到搜索结果
      notice.hide();
      return;
    }

    notice.done(`✅ 正在为「${data.name}」建档...`);

    // 修复：先标记 settled，再 resolve，再 close
    // 防止 close 触发 onClose 时再次 resolve(null)
    this.settled = true;
    this.resolve({ data, subjective });
    this.close();
  }
}
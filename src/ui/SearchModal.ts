import { App, Modal, Notice, Setting } from 'obsidian';
import type {
  BangumiSettings,
  SearchQuery,
  SearchResultItem,
  SubjectData,
  Subjective,
} from '../types';
import { TYPE_FILTERS, SUBJECT_TYPE_LABEL, DEFAULT_PAGE_SIZE } from '../constants';
import type { DataManager } from '../core/DataManager';
import { ProgressNotice } from './ProgressNotice';
import { SubjectiveModal } from './SubjectiveModal';

export interface SearchResult {
  data: SubjectData;
  subjective: Subjective;
}

export class SearchModal extends Modal {
  private currentType = 0;
  private keyword = '';
  private currentPage = 1;
  private isLoading = false;
  private results: SearchResultItem[] = [];
  private totalResults = 0;
  
  // ── 模式切换状态 ──
  private currentMode: 'offline' | 'online';
  private offlineBtn!: HTMLButtonElement;
  private onlineBtn!: HTMLButtonElement;

  // ── DOM 节点 ──
  private resultsContainer!: HTMLElement;
  private paginationContainer!: HTMLElement;

  constructor(
    app: App,
    private readonly dataManager: DataManager,
    private readonly getSettings: () => BangumiSettings,
    private readonly resolve: (val: SearchResult | null) => void,
  ) {
    super(app);
    // 初始化模式：优先尊重 settings 配置，但如果离线索引未就绪，强制降级为在线模式
    const settings = this.getSettings();
    const isOfflineReady = settings.offlineDbPath && settings.searchIndexBuiltAt > 0;
    this.currentMode = (settings.offlineMode && isOfflineReady) ? 'offline' : 'online';
  }

  static prompt(
    app: App,
    dataManager: DataManager,
    getSettings: () => BangumiSettings,
  ): Promise<SearchResult | null> {
    return new Promise((resolve) => {
      new SearchModal(app, dataManager, getSettings, resolve).open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bangumi-search-modal');

    this.renderModeSwitcher(contentEl);
    this.renderSearchBar(contentEl);
    
    this.resultsContainer = contentEl.createEl('div', { cls: 'bangumi-search-results' });
    this.paginationContainer = contentEl.createEl('div', { cls: 'bangumi-search-pagination' });

    this.renderResults();
  }

  onClose() {
    this.contentEl.empty();
    if (this.results.length === 0 && !this.isLoading) {
      this.resolve(null);
    }
  }

  // ─────────────────────────────────────────────
  // 模式切换器
  // ─────────────────────────────────────────────

  private renderModeSwitcher(container: HTMLElement) {
    const switcher = container.createEl('div', { cls: 'bangumi-mode-switcher' });
    switcher.style.display = 'flex';
    switcher.style.gap = '8px';
    switcher.style.marginBottom = '16px';
    switcher.style.justifyContent = 'center';

    this.offlineBtn = switcher.createEl('button', { text: '📴 离线模式' });
    this.onlineBtn = switcher.createEl('button', { text: '🌐 在线模式' });

    this.updateSwitcherUI();

    this.offlineBtn.addEventListener('click', () => this.switchMode('offline'));
    this.onlineBtn.addEventListener('click', () => this.switchMode('online'));
  }

  private switchMode(mode: 'offline' | 'online') {
    if (mode === this.currentMode) return;

    if (mode === 'offline') {
      const settings = this.getSettings();
      // 必须有数据包路径且【倒排索引】已构建完成
      if (!settings.offlineDbPath || settings.searchIndexBuiltAt === 0) {
        new Notice('❌ 离线索引未就绪，请先在设置中导入数据并构建索引');
        return; // 拦截，不切换状态
      }
    }

    this.currentMode = mode;
    this.updateSwitcherUI();

    // 切换模式后：强制清空当前结果，避免离线与在线结果混淆
    this.results = [];
    this.totalResults = 0;
    this.currentPage = 1;
    this.renderResults();

    // 若搜索框内已有关键词，自动触发新模式的搜索
    if (this.keyword.trim()) {
      void this.doSearch();
    }
  }

  private updateSwitcherUI() {
    // 利用 Obsidian 的 mod-cta (Call to Action) 样式高亮当前选中项
    if (this.currentMode === 'offline') {
      this.offlineBtn.addClass('mod-cta');
      this.onlineBtn.removeClass('mod-cta');
    } else {
      this.onlineBtn.addClass('mod-cta');
      this.offlineBtn.removeClass('mod-cta');
    }
  }

  // ─────────────────────────────────────────────
  // 搜索主逻辑
  // ─────────────────────────────────────────────

  private renderSearchBar(container: HTMLElement) {
    const searchBar = container.createEl('div', { cls: 'bangumi-search-bar' });
    searchBar.style.display = 'flex';
    searchBar.style.gap = '8px';
    searchBar.style.marginBottom = '16px';

    const typeSelect = searchBar.createEl('select');
    for (const filter of TYPE_FILTERS) {
      typeSelect.createEl('option', { text: filter.label, value: String(filter.value) });
    }
    typeSelect.addEventListener('change', () => {
      this.currentType = Number(typeSelect.value);
      this.currentPage = 1;
      if (this.keyword.trim()) void this.doSearch();
    });

    const input = searchBar.createEl('input', {
      type: 'text',
      placeholder: '输入条目名称或关键词...',
    });
    input.style.flex = '1';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.keyword = input.value;
        this.currentPage = 1;
        void this.doSearch();
      }
    });

    const searchBtn = searchBar.createEl('button', { text: '搜索', cls: 'mod-cta' });
    searchBtn.addEventListener('click', () => {
      this.keyword = input.value;
      this.currentPage = 1;
      void this.doSearch();
    });
  }

  private async doSearch() {
    const kw = this.keyword.trim();
    if (!kw || this.isLoading) return;

    this.isLoading = true;
    this.renderResults(); // 渲染 Loading 状态

    try {
      const query: SearchQuery = {
        keyword: kw,
        typeFilter: this.currentType,
        page: this.currentPage,
        limit: DEFAULT_PAGE_SIZE,
      };

      // 显式传入 currentMode 控制数据源
      const resp = await this.dataManager.search(query, this.currentMode);
      
      this.results = resp.list;
      this.totalResults = resp.total;
    } catch (err) {
      console.error('[bangumi] Search error:', err);
      new Notice(`❌ 搜索失败: ${err instanceof Error ? err.message : String(err)}`);
      this.results = [];
      this.totalResults = 0;
    } finally {
      this.isLoading = false;
      this.renderResults();
    }
  }

  // ─────────────────────────────────────────────
  // 渲染结果与分页 (省略繁琐 DOM 创建以突出核心)
  // ─────────────────────────────────────────────

  private renderResults() {
    this.resultsContainer.empty();
    this.paginationContainer.empty();

    if (this.isLoading) {
      this.resultsContainer.createEl('div', { text: '⏳ 搜索中...', cls: 'bangumi-loading' });
      return;
    }

    if (this.results.length === 0 && this.keyword) {
      this.resultsContainer.createEl('div', { 
        text: `没有找到相关结果 (${this.currentMode === 'offline' ? '离线库' : '在线 API'})`, 
        cls: 'bangumi-empty' 
      });
      return;
    }

    for (const item of this.results) {
      const row = this.resultsContainer.createEl('div', { cls: 'bangumi-result-row' });
      row.createEl('span', { text: `[${SUBJECT_TYPE_LABEL[item.typeKey]}] `, cls: 'bangumi-result-type' });
      row.createEl('strong', { text: item.name });
      if (item.year) row.createEl('span', { text: ` (${item.year})`, cls: 'bangumi-result-year' });
      
      row.addEventListener('click', () => this.handleSelect(item));
    }

    this.renderPagination();
  }

  private renderPagination() {
    if (this.totalResults <= DEFAULT_PAGE_SIZE) return;
    
    // 上下页按钮逻辑...
    const maxPage = Math.ceil(this.totalResults / DEFAULT_PAGE_SIZE);
    
    if (this.currentPage > 1) {
      const prev = this.paginationContainer.createEl('button', { text: '← 上一页' });
      prev.addEventListener('click', () => { this.currentPage--; void this.doSearch(); });
    }
    
    this.paginationContainer.createEl('span', { text: ` ${this.currentPage} / ${maxPage} ` });
    
    if (this.currentPage < maxPage) {
      const next = this.paginationContainer.createEl('button', { text: '下一页 →' });
      next.addEventListener('click', () => { this.currentPage++; void this.doSearch(); });
    }
  }

  // ─────────────────────────────────────────────
  // 详情拉取与回填
  // ─────────────────────────────────────────────

  private async handleSelect(item: SearchResultItem): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    const notice = new ProgressNotice(`⏳ 正在获取「${item.name}」详情...`);

    try {
      const data = await this.dataManager.getSubject(item.id);
      notice.update('⏳ 请填写主观信息...');
      
      const subjective = await SubjectiveModal.prompt(this.app, data);
      
      if (!subjective) {
        notice.hide();
        return;
      }
      
      notice.done(`✅ 正在为「${data.name}」建档...`);
      this.resolve({ data, subjective });
      this.close();
    } catch (err) {
      notice.error('❌ 获取详情失败');
      console.error(err);
    } finally {
      this.isLoading = false;
    }
  }
}
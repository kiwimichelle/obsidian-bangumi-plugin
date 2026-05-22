import { App, Modal, Setting, TextComponent, debounce } from 'obsidian';
import type { DataManager } from '../core/DataManager';
import type { SearchQuery, SearchResultItem } from '../types';
import { TYPE_FILTERS, DEFAULT_PAGE_SIZE, SUBJECT_TYPE_LABEL } from '../constants';

/**
 * 搜索弹窗（基于 Obsidian Modal API）
 * @see https://docs.obsidian.md/Plugins/User+interface/Modals
 */
export class SearchModal extends Modal {
  private dataManager: DataManager;
  private onSelect: (item: SearchResultItem) => void;

  private keyword = '';
  private typeFilter = 0;
  private currentPage = 1;
  private totalPages = 0;
  private totalResults = 0;
  private currentResults: SearchResultItem[] = [];

  private searchInput!: TextComponent;
  private typeSelect!: HTMLSelectElement;
  private resultContainer!: HTMLElement;
  private paginationContainer!: HTMLElement;
  private statusEl!: HTMLElement;

  private debouncedSearch: () => void;

  constructor(app: App, dataManager: DataManager, onSelect: (item: SearchResultItem) => void) {
    super(app);
    this.dataManager = dataManager;
    this.onSelect = onSelect;
    this.debouncedSearch = debounce(this.performSearch.bind(this), 300, true);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bgm-plugin', 'bgm-search-modal');

    contentEl.createEl('h2', { text: '搜索 Bangumi 条目' });

    // 搜索输入行
    new Setting(contentEl)
      .setClass('bgm-search-input-setting')
      .addText(text => {
        this.searchInput = text;
        text.setPlaceholder('输入关键词...')
            .setValue(this.keyword)
            .onChange(value => {
              this.keyword = value;
              this.currentPage = 1;
              this.debouncedSearch();
            });
      });

    // 类型筛选
    const typeRow = contentEl.createDiv({ cls: 'bgm-type-row' });
    typeRow.createEl('label', { text: '类型：' });
    this.typeSelect = typeRow.createEl('select');
    for (const filter of TYPE_FILTERS) {
      const option = this.typeSelect.createEl('option', { value: String(filter.value), text: filter.label });
      if (filter.value === this.typeFilter) option.selected = true;
    }
    this.typeSelect.addEventListener('change', () => {
      this.typeFilter = parseInt(this.typeSelect.value, 10);
      this.currentPage = 1;
      this.performSearch();
    });

    // 状态栏
    this.statusEl = contentEl.createDiv({ cls: 'bgm-search-status' });
    this.statusEl.setText('请输入关键词搜索');

    // 结果列表容器
    this.resultContainer = contentEl.createDiv({ cls: 'bgm-search-results' });

    // 分页容器
    this.paginationContainer = contentEl.createDiv({ cls: 'bgm-search-pagination' });

    if (this.keyword) this.performSearch();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async performSearch() {
    if (!this.keyword.trim()) {
      this.statusEl.setText('请输入关键词');
      this.resultContainer.empty();
      this.paginationContainer.empty();
      return;
    }

    this.statusEl.setText('搜索中...');
    this.resultContainer.empty();
    this.paginationContainer.empty();

    const query: SearchQuery = {
      keyword: this.keyword,
      typeFilter: this.typeFilter,
      page: this.currentPage,
      limit: DEFAULT_PAGE_SIZE,
    };

    try {
      const response = await this.dataManager.search(query);
      this.currentResults = response.list;
      this.totalResults = response.total;
      this.totalPages = Math.ceil(this.totalResults / DEFAULT_PAGE_SIZE);

      const sourceLabel = response.fromOffline ? '📀 离线索引' : '🌐 在线 API';
      this.statusEl.setText(`找到 ${this.totalResults} 个结果 (${sourceLabel})`);

      this.renderResults();
      this.renderPagination();
    } catch (err) {
      console.error('[SearchModal] 搜索失败', err);
      this.statusEl.setText('搜索失败，请检查网络或离线索引');
    }
  }

  private renderResults() {
    this.resultContainer.empty();
    if (this.currentResults.length === 0) {
      this.resultContainer.createDiv({ text: '没有找到相关条目', cls: 'bgm-search-empty' });
      return;
    }

    for (const item of this.currentResults) {
      const resultEl = this.resultContainer.createDiv({ cls: 'bgm-search-result-item' });
      if (item.coverUrl) {
        const img = resultEl.createEl('img', { cls: 'bgm-result-cover' });
        img.src = item.coverUrl;
      } else {
        resultEl.createDiv({ cls: 'bgm-result-cover-placeholder', text: 'No cover' });
      }

      const infoEl = resultEl.createDiv({ cls: 'bgm-result-info' });
      infoEl.createEl('div', { cls: 'bgm-result-title', text: `${item.name} (${item.nameOriginal})` });
      const meta = `${SUBJECT_TYPE_LABEL[item.typeKey]} · ${item.year} · 评分 ${item.score || '暂无'}`;
      infoEl.createEl('div', { cls: 'bgm-result-meta', text: meta });

      resultEl.addEventListener('click', () => {
        this.close();
        this.onSelect(item);
      });
    }
  }

  private renderPagination() {
    this.paginationContainer.empty();
    if (this.totalPages <= 1) return;

    const prevBtn = this.paginationContainer.createEl('button', { text: '上一页', cls: 'bgm-pagination-btn' });
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.performSearch();
      }
    });

    this.paginationContainer.createSpan({ text: `第 ${this.currentPage} / ${this.totalPages} 页`, cls: 'bgm-page-info' });

    const nextBtn = this.paginationContainer.createEl('button', { text: '下一页', cls: 'bgm-pagination-btn' });
    nextBtn.disabled = this.currentPage === this.totalPages;
    nextBtn.addEventListener('click', () => {
      if (this.currentPage < this.totalPages) {
        this.currentPage++;
        this.performSearch();
      }
    });
  }
}
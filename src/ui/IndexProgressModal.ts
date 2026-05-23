import { App, Modal, Notice } from 'obsidian';
import type { IndexBuilder } from '../core/IndexBuilder';
import type { SearchIndexBuilder } from '../core/SearchIndexBuilder';

/**
 * 索引构建进度弹窗
 *
 * 职责：
 * - 统一调度 `IndexBuilder` 和 `SearchIndexBuilder` 的流式构建
 * - 接收并展示两者的进度（`onProgress` 回调）
 * - 安全防悬挂：用户关闭弹窗后，拦截 DOM 更新，允许后台任务安全完成
 */
export class IndexProgressModal extends Modal {
  private statusEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private closeBtn!: HTMLButtonElement;

  /** 弹窗是否已被关闭（用于拦截后台任务的 UI 更新，防 DOM 崩溃） */
  private isClosed = false;

  private constructor(
    app: App,
    private readonly jsonlPath: string,
    private readonly indexBuilder: IndexBuilder,
    private readonly searchIndexBuilder: SearchIndexBuilder,
    private readonly onComplete?: () => void
  ) {
    super(app);
  }

  /**
   * 启动构建并打开进度弹窗
   * 注意：此方法为 fire-and-forget（发后即忘）同步调用。
   * 实际的构建任务在后台通过 Promise 独立运行，不会阻塞调用方。
   * * @param onComplete 可选回调，在所有索引构建成功后执行
   */
  static buildAll(
    app: App,
    jsonlPath: string,
    indexBuilder: IndexBuilder,
    searchIndexBuilder: SearchIndexBuilder,
    onComplete?: () => void
  ): void {
    const modal = new IndexProgressModal(app, jsonlPath, indexBuilder, searchIndexBuilder, onComplete);
    modal.open();
    // Fire-and-forget: 启动后台流式构建，UI 自行处理生命周期
    void modal.run();
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle('构建离线检索索引');

    contentEl.createEl('p', {
      text: '正在扫描本地 Bangumi 数据包（支持 .jsonl / .jsonlines）以构建高速检索缓存。',
      cls: 'bangumi-progress-desc',
    });
    contentEl.createEl('p', {
      text: '首次构建可能需要几十秒。此操作在后台分批执行，主动让出主线程，不会阻塞 Obsidian。',
      cls: 'bangumi-progress-hint',
    });

    this.statusEl = contentEl.createEl('h3', { text: '⏳ 准备就绪...' });
    this.progressEl = contentEl.createEl('div', { cls: 'bangumi-progress-count', text: '已扫描: 0 行' });

    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });
    this.closeBtn = btnRow.createEl('button', { text: '在后台继续' });
    
    // 用户点击时仅关闭弹窗，不会中止后台构建任务的 Promise
    this.closeBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.isClosed = true;
    this.contentEl.empty();
  }

  private async run(): Promise<void> {
    try {
      // ── 阶段 1：行号精确定位索引 ──
      this.updateStatus('⏳ [1/2] 正在构建行号索引...');
      await this.indexBuilder.build(this.jsonlPath, (lines) => {
        this.updateProgress(`行号索引已扫描: ${lines.toLocaleString()} 行`);
      });

      // ── 阶段 2：关键词倒排搜索索引 ──
      this.updateStatus('⏳ [2/2] 正在构建关键词倒排索引...');
      this.updateProgress('倒排索引已扫描: 0 行');
      await this.searchIndexBuilder.build(this.jsonlPath, (lines) => {
        this.updateProgress(`倒排索引已扫描: ${lines.toLocaleString()} 行`);
      });

      // ── 成功完成 ──
      this.updateStatus('✅ 索引构建完成！');
      this.updateProgress('所有的索引已成功持久化到本地磁盘，搜索功能现已全速可用。');
      
      if (!this.isClosed) {
        this.closeBtn.setText('完成');
        this.closeBtn.addClass('bangumi-confirm-ok');
      } else {
        // 如果用户已经在后台，通过系统通知告诉他们完成了
        new Notice('✅ Bangumi 离线索引后台构建完成');
      }

      // 执行外部传入的完成回调（如刷新 UI 状态）
      this.onComplete?.();

    } catch (err) {
      // ── 异常处理 ──
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[bangumi] 索引构建失败', err);
      
      this.updateStatus('❌ 构建失败');
      this.updateProgress(`错误信息: ${errMsg}`);
      
      if (!this.isClosed) {
        this.closeBtn.setText('关闭');
      } else {
        new Notice(`❌ Bangumi 索引构建失败: ${errMsg}`);
      }
    }
  }

  /** 安全的 DOM 更新辅助函数 */
  private updateStatus(text: string): void {
    if (this.isClosed) return;
    this.statusEl.setText(text);
  }

  private updateProgress(text: string): void {
    if (this.isClosed) return;
    this.progressEl.setText(text);
  }
}
import { App, Modal, Notice } from 'obsidian';
import type { DataManager } from '../core/DataManager';

/**
 * 索引构建进度弹窗（重构版）
 *
 * 职责：
 * - 调用 DataManager.buildAllOfflineIndices() 完成全部 5 个索引的构建
 * - 动态展示每个阶段的名称与行数进度
 * - 安全防悬挂：用户关闭后拦截 DOM 更新，后台任务可安全完成
 */
export class IndexProgressModal extends Modal {
  private statusEl!:   HTMLElement;
  private progressEl!: HTMLElement;
  private closeBtn!:   HTMLButtonElement;

  /** 弹窗是否已被关闭 */
  private isClosed = false;

  private constructor(
    app: App,
    private readonly jsonlPath:    string,
    private readonly dataManager:  DataManager,
    private readonly onComplete?:  () => void,
  ) {
    super(app);
  }

  /**
   * 启动全量索引构建并打开进度弹窗。
   * Fire-and-forget：不会阻塞调用方。
   */
  static buildAll(
    app:          App,
    jsonlPath:    string,
    dataManager:  DataManager,
    onComplete?:  () => void,
  ): void {
    const modal = new IndexProgressModal(app, jsonlPath, dataManager, onComplete);
    modal.open();
    void modal.run();
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle('构建离线检索索引');

    contentEl.createEl('p', {
      text: '正在扫描本地 Bangumi 数据包，构建全量离线索引（主条目 / 搜索 / 分集 / 制作人员 / 关联）。',
      cls:  'bangumi-progress-desc',
    });
    contentEl.createEl('p', {
      text: '首次构建可能需要数分钟。任务在后台分批执行，不会阻塞 Obsidian。',
      cls:  'bangumi-progress-hint',
    });

    this.statusEl   = contentEl.createEl('h3', { text: '⏳ 准备就绪...' });
    this.progressEl = contentEl.createEl('div', {
      cls:  'bangumi-progress-count',
      text: '等待开始',
    });

    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });
    this.closeBtn = btnRow.createEl('button', { text: '在后台继续' });
    this.closeBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.isClosed = true;
    this.contentEl.empty();
  }

  private async run(): Promise<void> {
    try {
      await this.dataManager.buildAllOfflineIndices((stage, lines) => {
        this.updateStatus(`⏳ 正在构建：${stage}`);
        this.updateProgress(`已扫描：${lines.toLocaleString()} 行`);
      });

      // 全部完成
      this.updateStatus('✅ 全部索引构建完成！');
      this.updateProgress('主条目 / 搜索 / 分集 / 制作人员 / 关联索引均已持久化，搜索功能现已全速可用。');

      if (!this.isClosed) {
        this.closeBtn.setText('完成');
        this.closeBtn.addClass('bangumi-confirm-ok');
      } else {
        new Notice('✅ Bangumi 全量离线索引后台构建完成');
      }

      this.onComplete?.();

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[bangumi] 索引构建失败', err);

      this.updateStatus('❌ 构建失败');
      this.updateProgress(`错误信息：${errMsg}`);

      if (!this.isClosed) {
        this.closeBtn.setText('关闭');
      } else {
        new Notice(`❌ Bangumi 索引构建失败：${errMsg}`);
      }
    }
  }

  private updateStatus(text: string): void {
    if (this.isClosed) return;
    this.statusEl.setText(text);
  }

  private updateProgress(text: string): void {
    if (this.isClosed) return;
    this.progressEl.setText(text);
  }
}
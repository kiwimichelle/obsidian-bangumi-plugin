import { App, Modal, Notice } from 'obsidian';

/**
 * 索引构建进度弹窗
 * @see https://docs.obsidian.md/Plugins/User+interface/Modals
 */
export class IndexProgressModal extends Modal {
  private title: string;
  private totalLines: number;
  private onCancel?: () => void;
  private onComplete?: () => void;

  private progressBar!: HTMLProgressElement;
  private statusText!: HTMLSpanElement;
  private cancelButton!: HTMLButtonElement;
  private isCancelled = false;

  constructor(
    app: App,
    title: string,
    totalLines: number,
    onCancel?: () => void,
    onComplete?: () => void
  ) {
    super(app);
    this.title = title;
    this.totalLines = totalLines;
    this.onCancel = onCancel;
    this.onComplete = onComplete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bgm-plugin', 'bgm-index-progress-modal');

    contentEl.createEl('h2', { text: this.title });

    this.progressBar = contentEl.createEl('progress', { cls: 'bgm-progress-bar' });
    if (this.totalLines > 0) {
      this.progressBar.max = this.totalLines;
      this.progressBar.value = 0;
    } else {
      this.progressBar.removeAttribute('value');
    }

    this.statusText = contentEl.createEl('span', { cls: 'bgm-progress-status', text: '准备中...' });

    const buttonDiv = contentEl.createDiv({ cls: 'bgm-modal-buttons' });
    this.cancelButton = buttonDiv.createEl('button', { text: '取消' });
    this.cancelButton.addEventListener('click', () => {
      this.isCancelled = true;
      new Notice('索引构建已取消');
      this.close();
      if (this.onCancel) this.onCancel();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  updateProgress(processed: number): void {
    if (this.isCancelled) return;
    if (this.totalLines > 0) {
      this.progressBar.value = processed;
      const percent = Math.floor((processed / this.totalLines) * 100);
      this.statusText.textContent = `已处理 ${processed} / ${this.totalLines} 行 (${percent}%)`;
    } else {
      this.statusText.textContent = `已处理 ${processed} 行...`;
    }
  }

  complete(finalMessage: string, delayMs = 2000): void {
    if (this.isCancelled) return;
    this.statusText.textContent = finalMessage;
    this.cancelButton.disabled = true;
    setTimeout(() => {
      this.close();
      if (this.onComplete) this.onComplete();
    }, delayMs);
  }

  fail(errorMessage: string): void {
    if (this.isCancelled) return;
    this.statusText.textContent = `失败：${errorMessage}`;
    this.statusText.style.color = 'var(--text-error)';
    this.cancelButton.disabled = true;
  }

  get cancelled(): boolean {
    return this.isCancelled;
  }
}
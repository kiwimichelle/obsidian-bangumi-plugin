import { Notice } from 'obsidian';

/**
 * 基于 Obsidian Notice API 的进度通知组件
 *
 * 官方文档要点：
 * - `new Notice(message, timeout)` 创建通知，timeout=0 表示持久显示
 * - `Notice.hide()` 方法可手动关闭通知（Obsidian 0.15+ 支持）
 *
 * 设计：
 * - 初始通知持久显示（timeout=0）
 * - 每次更新时先 `hide()` 旧通知再创建新通知（保持屏幕整洁）
 * - `done()` / `error()` 显示最终消息并在指定延时后自动消失
 *
 * 使用示例：
 * ```ts
 * const progress = new ProgressNotice('正在构建索引...');
 * for await (const chunk of process) {
 *   progress.update(`已处理 ${processed}/${total} 行`);
 * }
 * progress.done('索引构建完成');
 * ```
 */
export class ProgressNotice {
  private notice: Notice | null = null;
  private baseMessage: string;
  private hideTimeoutMs: number;

  /**
   * @param initialMessage 初始消息（持久显示）
   * @param hideTimeoutMs 完成/失败后自动隐藏的延时（毫秒），默认 3000
   */
  constructor(initialMessage: string, hideTimeoutMs = 3000) {
    this.baseMessage = initialMessage;
    this.hideTimeoutMs = hideTimeoutMs;
    // 持久显示，timeout=0 表示不自动消失
    this.notice = new Notice(initialMessage, 0);
  }

  /**
   * 更新通知内容（替换当前显示的消息）
   * @param message 新消息
   */
  update(message: string): void {
    if (this.notice) {
      this.notice.hide(); // 立即关闭旧通知
    }
    this.notice = new Notice(message, 0); // 创建新的持久通知
  }

  /**
   * 标记操作成功，显示完成消息并延时关闭
   * @param message 完成消息（可选，默认使用初始消息 + "完成"）
   */
  done(message?: string): void {
    if (this.notice) {
      this.notice.hide();
      this.notice = null;
    }
    const finalMsg = message ?? `${this.baseMessage} 完成`;
    // 显示最终消息，指定超时后自动消失
    new Notice(finalMsg, this.hideTimeoutMs);
  }

  /**
   * 标记操作失败，显示错误消息并延时关闭
   * @param message 错误消息（可选，默认使用初始消息 + "失败"）
   */
  error(message?: string): void {
    if (this.notice) {
      this.notice.hide();
      this.notice = null;
    }
    const finalMsg = message ?? `${this.baseMessage} 失败`;
    new Notice(finalMsg, this.hideTimeoutMs);
  }

  /**
   * 立即关闭通知（不显示完成/失败消息）
   */
  close(): void {
    if (this.notice) {
      this.notice.hide();
      this.notice = null;
    }
  }
}
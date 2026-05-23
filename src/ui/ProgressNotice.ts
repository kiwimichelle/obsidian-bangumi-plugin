import { Notice } from 'obsidian';

/** 通知自动消失的延迟（毫秒） */
const DONE_TIMEOUT_MS  = 4000;
const ERROR_TIMEOUT_MS = 8000;

/**
 * 轻量进度通知组件。
 *
 * 用法示例：
 * ```ts
 * const notice = new ProgressNotice('⏳ 正在下载封面...');
 * notice.update('⏳ 正在写入笔记...');
 * notice.done('✅ 已创建：葬送的芙莉莲');
 * ```
 *
 * 设计约束：
 * - 不持有任何业务逻辑模块的引用，纯 UI 工具
 * - 同一个实例只存在一个 Notice，调用 update/done/error 会替换文本
 * - done/error 调用后实例自动进入 finished 状态，后续调用静默忽略
 */
export class ProgressNotice {
	/** 当前 Obsidian Notice 实例 */
	private notice: Notice;

	/** 通知主容器的文字节点（用于原地更新） */
	private textNode: Text;

	/** 是否已结束（done/error 调用后为 true） */
	private finished = false;

	/**
	 * 创建并立即显示一条进度通知。
	 *
	 * @param initialMessage 初始消息文本，例如 '⏳ 正在下载封面...'
	 * @param timeoutMs      自动消失时间（毫秒），默认 0 = 不自动消失，
	 *                       由 done/error 触发消失
	 */
	constructor(initialMessage: string, timeoutMs = 0) {
		// Notice 第二参数为 0 时不自动消失，方便我们手动控制
		this.notice = new Notice('', timeoutMs);

		// messageEl 是 Notice 暴露的 HTMLElement
		const el = this.notice.messageEl;
		this.textNode = document.createTextNode(initialMessage);
		el.appendChild(this.textNode);
	}

	/**
	 * 更新通知文本（进行中状态）。
	 * 若通知已结束（done/error），此方法静默忽略。
	 */
	update(message: string): this {
		if (this.finished) return this;
		this.textNode.nodeValue = message;
		return this;
	}

	/**
	 * 标记操作成功完成，显示成功消息后自动消失。
	 * 调用后实例进入 finished 状态，后续 update/done/error 均被忽略。
	 *
	 * @param message 成功消息，例如 '✅ 已创建：葬送的芙莉莲'
	 */
	done(message: string): void {
		if (this.finished) return;
		this.finished = true;
		this.textNode.nodeValue = message;
		// 替换为有超时的新 Notice（原 Notice 手动 hide）
		this.notice.hide();
		new Notice(message, DONE_TIMEOUT_MS);
	}

	/**
	 * 标记操作失败，显示错误消息后自动消失（停留时间比成功更长）。
	 * 调用后实例进入 finished 状态。
	 *
	 * @param message 错误消息，例如 '❌ 封面下载失败，已跳过'
	 */
	error(message: string): void {
		if (this.finished) return;
		this.finished = true;
		this.textNode.nodeValue = message;
		this.notice.hide();
		new Notice(message, ERROR_TIMEOUT_MS);
	}

	/**
	 * 立即隐藏通知（无论当前状态）。
	 * 适用于用户取消操作等需要提前关闭的场景。
	 */
	hide(): void {
		this.finished = true;
		this.notice.hide();
	}

	/** 是否已结束（done/error/hide 后为 true） */
	get isFinished(): boolean {
		return this.finished;
	}
}
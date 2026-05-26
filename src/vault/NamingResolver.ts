import { App, Modal, TFile } from 'obsidian';
import type { BangumiSettings, NamingResult, SubjectData } from '../types';
import { TYPE_KEYS } from '../constants';
import { parseYearSeason } from '../note/NoteBuilder';

const ILLEGAL_CHARS = /[\\/:*?"<>|#]/g;

function sanitize(name: string): string {
  return name.replace(ILLEGAL_CHARS, '').trim();
}

// ─────────────────────────────────────────────
// NamingResolver
// ─────────────────────────────────────────────

/**
 * 修复：resolve() 只做冲突检测，不再自动改名。
 * 所有冲突场景都返回冲突信息，由 ConflictModal 让用户决定最终文件名。
 */
export class NamingResolver {
  constructor(
    private readonly app:      App,
    private readonly settings: BangumiSettings,
  ) {}

  resolve(data: SubjectData): NamingResult {
    const baseName  = sanitize(data.name || data.nameOriginal);
    const { typeKey } = data;
    const archiveRoot = this.settings.subjectTypes[typeKey].archiveRoot;

    // 跨媒介检测
    for (const key of TYPE_KEYS) {
      if (key === typeKey) continue;
      const otherRoot = this.settings.subjectTypes[key].archiveRoot;
      const hit = this.app.vault.getAbstractFileByPath(`${otherRoot}/${baseName}.md`);
      if (hit instanceof TFile) {
        return { filename: baseName, existingPath: hit.path, conflict: 'other' };
      }
    }

    // 同类检测
    const existing = this.app.vault.getAbstractFileByPath(`${archiveRoot}/${baseName}.md`);
    if (!(existing instanceof TFile)) {
      return { filename: baseName, existingPath: '', conflict: 'none' };
    }

    const cached     = this.app.metadataCache.getFileCache(existing);
    const existingId = cached?.frontmatter?.['bangumi_id'] as number | undefined;

    if (existingId === data.id) {
      // 同 ID 更新：文件名不变，existingPath 供调用方定位
      return { filename: baseName, existingPath: existing.path, conflict: 'none' };
    }

    // 不同 ID：有冲突，返回建议文件名（含年份），用户可在弹窗里修改
    const { year } = parseYearSeason(data.date);
    return {
      filename:     `${baseName} (${year})`,
      existingPath: existing.path,
      conflict:     'same',
    };
  }

  /**
   * 验证给定文件名在目标目录下是否已存在。
   * 供 ConflictModal 实时校验用户输入。
   */
  checkFilenameAvailable(filename: string, targetDir: string): boolean {
    const path = `${targetDir}/${filename}.md`;
    return !(this.app.vault.getAbstractFileByPath(path) instanceof TFile);
  }
}

// ─────────────────────────────────────────────
// ConflictModal：文件名冲突解决弹窗
// ─────────────────────────────────────────────

export interface ConflictResolution {
  /** 用户最终确认的文件名（不含 .md） */
  filename:  string;
  /** true = 覆盖已有文件，false = 新建此名称 */
  overwrite: boolean;
}

/**
 * 修复：所有冲突场景（same / other）统一走此弹窗，让用户自己决定：
 * - 修改文件名（可编辑输入框，实时校验是否可用）
 * - 选择覆盖已有文件 或 新建为当前文件名
 */
export class ConflictModal extends Modal {
  private settled  = false;
  private inputEl!: HTMLInputElement;
  private hintEl!:  HTMLElement;
  private overwriteBtn!: HTMLButtonElement;
  private newfileBtn!:   HTMLButtonElement;

  private constructor(
    app: App,
    private readonly conflictType:  'same' | 'other',
    private readonly existingPath:  string,
    private readonly suggestedName: string,
    private readonly targetDir:     string,
    private readonly resolver:      NamingResolver,
    private readonly resolve: (val: ConflictResolution | null) => void,
  ) {
    super(app);
  }

  static prompt(
    app:           App,
    conflictType:  'same' | 'other',
    existingPath:  string,
    suggestedName: string,
    targetDir:     string,
    resolver:      NamingResolver,
  ): Promise<ConflictResolution | null> {
    return new Promise(resolve => {
      new ConflictModal(
        app, conflictType, existingPath, suggestedName, targetDir, resolver, resolve,
      ).open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle('文件名冲突');

    const conflictDesc = this.conflictType === 'same'
      ? `同目录下已存在同名但不同 ID 的笔记：`
      : `其他分类目录下已存在同名笔记：`;

    contentEl.createEl('p', { text: conflictDesc });
    contentEl.createEl('code', { text: this.existingPath, cls: 'bgm-conflict-path' });
    contentEl.createEl('p', { text: '请修改文件名，或选择覆盖已有文件：', cls: 'bgm-conflict-hint' });

    // 文件名输入框
    const inputRow = contentEl.createEl('div', { cls: 'bangumi-input-row' });
    inputRow.createEl('label', { text: '文件名' });
    this.inputEl = inputRow.createEl('input', { type: 'text' });
    this.inputEl.value = this.suggestedName;
    this.inputEl.style.flex = '1';

    // 实时校验提示
    this.hintEl = contentEl.createEl('div', { cls: 'bgm-conflict-availability' });
    this.validateInput();

    this.inputEl.addEventListener('input', () => this.validateInput());

    // 按钮行
    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });

    const cancelBtn = btnRow.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => {
      this.settled = true;
      this.resolve(null);
      this.close();
    });

    this.overwriteBtn = btnRow.createEl('button', { text: '覆盖已有文件' });
    this.overwriteBtn.addEventListener('click', () => {
      this.settled = true;
      this.resolve({ filename: this.inputEl.value.trim(), overwrite: true });
      this.close();
    });

    this.newfileBtn = btnRow.createEl('button', {
      text: '新建为此名称',
      cls:  'bangumi-confirm-ok',
    });
    this.newfileBtn.addEventListener('click', () => {
      if (!this.isCurrentNameAvailable()) return;
      this.settled = true;
      this.resolve({ filename: this.inputEl.value.trim(), overwrite: false });
      this.close();
    });
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
    this.contentEl.empty();
  }

  private isCurrentNameAvailable(): boolean {
    const name = this.inputEl.value.trim();
    if (!name) return false;
    return this.resolver.checkFilenameAvailable(name, this.targetDir);
  }

  private validateInput(): void {
    const name = this.inputEl.value.trim();
    if (!name) {
      this.hintEl.setText('⚠️ 文件名不能为空');
      this.hintEl.style.color = 'var(--text-error)';
      this.newfileBtn.disabled = true;
      return;
    }
    const available = this.resolver.checkFilenameAvailable(name, this.targetDir);
    if (available) {
      this.hintEl.setText('✅ 此名称可用');
      this.hintEl.style.color = 'var(--text-success)';
      this.newfileBtn.disabled = false;
    } else {
      this.hintEl.setText('⚠️ 此名称已被占用，请修改或选择覆盖');
      this.hintEl.style.color = 'var(--text-warning)';
      this.newfileBtn.disabled = true;
    }
  }
}
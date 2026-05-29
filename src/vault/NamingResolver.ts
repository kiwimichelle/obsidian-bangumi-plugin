import { App, Modal, TFile } from 'obsidian';
import type { BangumiSettings, NamingResult, SubjectData } from '../types';
import { SUBJECT_TYPE_LABEL, TYPE_KEYS } from '../constants';
import { parseYearSeason } from '../note/NoteBuilder';

const ILLEGAL_CHARS = /[\\/:*?"<>|#]/g;

function sanitize(name: string): string {
  return name.replace(ILLEGAL_CHARS, '').trim();
}

// ─────────────────────────────────────────────
// NamingResolver
// ─────────────────────────────────────────────

export class NamingResolver {
  constructor(
    private readonly app:      App,
    private readonly settings: BangumiSettings,
  ) {}

  /**
   * 修复：不再按路径猜测文件位置。
   *
   * 旧实现只查 archiveRoot/baseName.md，但动画/三次元按季度归档后
   * 实际路径是 archiveRoot/2014/01月/baseName.md，永远查不到。
   *
   * 新实现：
   * 1. 先用 MetadataCache 全库扫描 bangumi_id，找到已存在的同 ID 文件
   * 2. 再检测同目标目录下是否有同名异 ID 文件（same 冲突）
   * 3. 最后检测跨媒介同名冲突（other 冲突）
   */
  resolve(data: SubjectData, targetDir: string): NamingResult {
    const baseName = sanitize(data.name || data.nameOriginal);

    // ── 1. 全库查找同 bangumi_id 的已存在文件 ──────────────────
    const existingById = this.findByBangumiId(data.id);
    if (existingById) {
      return {
        filename:     baseName,
        existingPath: existingById.path,
        conflict:     'none',   // 同 ID 更新场景
      };
    }

    // ── 2. 目标路径同名检测 ─────────────────────────────────────
    const targetPath = `${targetDir}/${baseName}.md`;
    const existing   = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      // 同路径同名但不同 ID（same 冲突），建议加年份消歧
      const { year } = parseYearSeason(data.date);
      return {
        filename:     `${baseName} (${year})`,
        existingPath: existing.path,
        conflict:     'same',
      };
    }

    // ── 3. 跨媒介同名检测 ──────────────────────────────────────
    for (const key of TYPE_KEYS) {
      if (key === data.typeKey) continue;
      const otherRoot = this.settings.subjectTypes[key].archiveRoot;
      // 跨媒介只检测根目录，不递归（避免性能问题）
      const hit = this.app.vault.getAbstractFileByPath(`${otherRoot}/${baseName}.md`);
      if (hit instanceof TFile) {
        return {
          filename:     `${baseName} (${SUBJECT_TYPE_LABEL[data.typeKey]})`,
          existingPath: hit.path,
          conflict:     'other',
        };
      }
    }

    return { filename: baseName, existingPath: '', conflict: 'none' };
  }

  /**
   * 验证给定文件名在目标目录下是否已存在。
   * 供 ConflictModal 实时校验用户输入。
   */
  checkFilenameAvailable(filename: string, targetDir: string): boolean {
    const path = `${targetDir}/${filename}.md`;
    return !(this.app.vault.getAbstractFileByPath(path) instanceof TFile);
  }

  // ─────────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────────

  /**
   * 通过 MetadataCache 全库搜索指定 bangumi_id 的文件。
   * 利用 resolvedLinks / 遍历 getMarkdownFiles 的 frontmatter 缓存。
   * 时间复杂度 O(n)，n 为 vault 内 Markdown 文件数量，可接受。
   */
  private findByBangumiId(id: number): TFile | null {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fmId  = cache?.frontmatter?.['bangumi_id'];
      // frontmatter 里的数字可能被解析为 number 或 string，都要兼容
      if (fmId === id || fmId === String(id)) {
        return file;
      }
    }
    return null;
  }
}

// ─────────────────────────────────────────────
// ConflictModal
// ─────────────────────────────────────────────

export interface ConflictResolution {
  filename:  string;
  overwrite: boolean;
}

export class ConflictModal extends Modal {
  private settled  = false;
  private inputEl!: HTMLInputElement;
  private hintEl!:  HTMLElement;
  private newfileBtn!: HTMLButtonElement;

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
      ? '同目录下已存在同名但不同 ID 的笔记：'
      : '其他分类目录下已存在同名笔记：';

    contentEl.createEl('p', { text: conflictDesc });
    contentEl.createEl('code', { text: this.existingPath, cls: 'bgm-conflict-path' });
    contentEl.createEl('p', { text: '请修改文件名，或选择覆盖已有文件：', cls: 'bgm-conflict-hint' });

    const inputRow = contentEl.createEl('div', { cls: 'bangumi-input-row' });
    inputRow.createEl('label', { text: '文件名' });
    this.inputEl = inputRow.createEl('input', { type: 'text' });
    this.inputEl.value = this.suggestedName;
    this.inputEl.style.flex = '1';

    this.hintEl = contentEl.createEl('div', { cls: 'bgm-conflict-availability' });
    this.validateInput();

    this.inputEl.addEventListener('input', () => this.validateInput());

    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });

    const cancelBtn = btnRow.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => {
      this.settled = true; this.resolve(null); this.close();
    });

    const overwriteBtn = btnRow.createEl('button', { text: '覆盖已有文件' });
    overwriteBtn.addEventListener('click', () => {
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
    if (!this.settled) { this.settled = true; this.resolve(null); }
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
      if (this.newfileBtn) this.newfileBtn.disabled = true;
      return;
    }
    const available = this.resolver.checkFilenameAvailable(name, this.targetDir);
    if (available) {
      this.hintEl.setText('✅ 此名称可用');
      this.hintEl.style.color = 'var(--text-success)';
      if (this.newfileBtn) this.newfileBtn.disabled = false;
    } else {
      this.hintEl.setText('⚠️ 此名称已被占用，请修改或选择覆盖');
      this.hintEl.style.color = 'var(--text-warning)';
      if (this.newfileBtn) this.newfileBtn.disabled = true;
    }
  }
}
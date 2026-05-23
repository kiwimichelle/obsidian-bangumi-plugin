import { App, Modal } from 'obsidian';
import type {
  AnimeSubjective,
  BookSubjective,
  GameSubjective,
  MusicSubjective,
  RealSubjective,
  Subjective,
  SubjectData,
  SubjectTypeKey,
  BookSubtype,
  GamePlatform,
} from '../types';
import {
  STATUS_OPTIONS,
  BOOK_CHANNELS,
  BOOK_VERSIONS,
  MUSIC_SOURCES,
  GAME_PLATFORMS,
  SUBJECT_TYPE_LABEL,
} from '../constants';

// ─────────────────────────────────────────────
// 书籍子类型判断（避免依赖 template.ts 的业务逻辑）
// ─────────────────────────────────────────────

/** 书籍子类型显示标签 → BookSubtype 映射 */
const SUBTYPE_LABEL_MAP: Record<string, BookSubtype> = {
  '漫画':  'manga',
  '轻小说': 'lightnovel',
  '小说':  'novel',
};

const SUBTYPE_LABELS = Object.keys(SUBTYPE_LABEL_MAP);

/**
 * 根据 SubjectData 推断书籍子类型的显示标签
 * platform='漫画' 直接识别；其余默认小说
 */
function detectSubtypeLabel(data: SubjectData): string {
  if (data.platform === '漫画') return '漫画';
  return '小说';
}

// ─────────────────────────────────────────────
// SubjectiveModal
// ─────────────────────────────────────────────

/**
 * 用户主观输入弹窗
 *
 * 职责：
 * - 根据条目 typeKey 渲染对应表单（动画/书籍/游戏/音乐/三次元）
 * - 用户点击"保存并建档"→ resolve(Subjective)
 * - 用户点击"取消"或直接关闭弹窗 → resolve(null)
 *
 * 使用方式：
 * ```ts
 * const result = await SubjectiveModal.prompt(app, data);
 * if (!result) return; // 用户取消
 * ```
 */
export class SubjectiveModal extends Modal {
  private readonly data: SubjectData;
  private readonly resolve: (val: Subjective | null) => void;

  private constructor(
    app: App,
    data: SubjectData,
    resolve: (val: Subjective | null) => void,
  ) {
    super(app);
    this.data = data;
    this.resolve = resolve;
  }

  /**
   * 打开弹窗并返回 Promise。
   * 用户取消或关闭时 resolve(null)，正常提交时 resolve(Subjective)。
   */
  static prompt(app: App, data: SubjectData): Promise<Subjective | null> {
    return new Promise(resolve => {
      new SubjectiveModal(app, data, resolve).open();
    });
  }

  onOpen(): void {
    const { contentEl, data } = this;
    const typeLabel = SUBJECT_TYPE_LABEL[data.typeKey];
    this.setTitle(`${data.name}（${typeLabel}）`);

    switch (data.typeKey) {
      case 'anime': this.buildAnimeForm(contentEl); break;
      case 'book':  this.buildBookForm(contentEl);  break;
      case 'game':  this.buildGameForm(contentEl);  break;
      case 'music': this.buildMusicForm(contentEl); break;
      case 'real':  this.buildRealForm(contentEl);  break;
    }
  }

  onClose(): void {
    // 若 resolve 尚未被调用（直接关闭弹窗），视作取消
    this.resolve(null);
    this.contentEl.empty();
  }

  // ─────────────────────────────────────────────
  // 各分类表单
  // ─────────────────────────────────────────────

  private buildAnimeForm(el: HTMLElement): void {
    const statusSel   = this.row(el, '观看状态').select(STATUS_OPTIONS.anime, '想看');
    const progressInp = this.row(el, '已观看集数').number('0');
    const sourceInp   = this.row(el, '观看网址').text('https://...');
    const ratingInp   = this.row(el, '个人评分（1–10）').number('');
    const commentTa   = this.row(el, '即时短评').textarea('写下此刻的感受...');

    this.submitRow(el, () => {
      const result: AnimeSubjective = {
        status:   statusSel.value,
        progress: progressInp.value,
        source:   sourceInp.value.trim(),
        rating:   ratingInp.value,
        comment:  commentTa.value.trim(),
      };
      this.resolve(result);
      this.close();
    });
  }

  private buildBookForm(el: HTMLElement): void {
    const subtypeLabel   = detectSubtypeLabel(this.data);
    const subtypeSel     = this.row(el, '书籍类型').select(SUBTYPE_LABELS, subtypeLabel);
    const statusSel      = this.row(el, '阅读状态').select(STATUS_OPTIONS.book, '想读');
    const volInp         = this.row(el, '当前卷数').number('0');
    const unitInp        = this.row(el, '当前话/章数').number('0');
    const channelSel     = this.row(el, '阅读渠道').select(BOOK_CHANNELS, BOOK_CHANNELS[0] ?? '');
    const versionSel     = this.row(el, '翻译版本').select(BOOK_VERSIONS, BOOK_VERSIONS[0] ?? '');
    const ratingInp      = this.row(el, '个人评分（1–10）').number('');
    const commentTa      = this.row(el, '即时短评').textarea('写下第一印象...');

    this.submitRow(el, () => {
      const result: BookSubjective = {
        status:  statusSel.value,
        subtype: SUBTYPE_LABEL_MAP[subtypeSel.value] ?? 'novel',
        volNum:  volInp.value,
        unitNum: unitInp.value,
        channel: channelSel.value,
        version: versionSel.value,
        rating:  ratingInp.value,
        comment: commentTa.value.trim(),
      };
      this.resolve(result);
      this.close();
    });
  }

  private buildGameForm(el: HTMLElement): void {
    const statusSel   = this.row(el, '游玩状态').select(STATUS_OPTIONS.game, '想玩');
    const platformSel = this.row(el, '游玩平台').select(GAME_PLATFORMS, 'Steam');
    const hoursInp    = this.row(el, '游玩时长（小时）').number('0');
    const progressInp = this.row(el, '当前进度').text('例：第一章');
    const ratingInp   = this.row(el, '个人评分（1–10）').number('');
    const commentTa   = this.row(el, '即时短评').textarea('写下游玩感受...');

    this.submitRow(el, () => {
      const result: GameSubjective = {
        status:   statusSel.value,
        platform: platformSel.value as GamePlatform,
        hours:    hoursInp.value,
        progress: progressInp.value.trim(),
        rating:   ratingInp.value,
        comment:  commentTa.value.trim(),
      };
      this.resolve(result);
      this.close();
    });
  }

  private buildMusicForm(el: HTMLElement): void {
    const statusSel = this.row(el, '收听状态').select(STATUS_OPTIONS.music, '想听');
    const sourceSel = this.row(el, '收听平台').select(MUSIC_SOURCES, MUSIC_SOURCES[0] ?? '');
    const ratingInp = this.row(el, '个人评分（1–10）').number('');
    const commentTa = this.row(el, '即时短评').textarea('写下收听感受...');

    this.submitRow(el, () => {
      const result: MusicSubjective = {
        status:  statusSel.value,
        source:  sourceSel.value,
        rating:  ratingInp.value,
        comment: commentTa.value.trim(),
      };
      this.resolve(result);
      this.close();
    });
  }

  private buildRealForm(el: HTMLElement): void {
    const statusSel   = this.row(el, '观看状态').select(STATUS_OPTIONS.real, '想看');
    const progressInp = this.row(el, '已观看集数').number('0');
    const sourceInp   = this.row(el, '观看网址').text('https://...');
    const ratingInp   = this.row(el, '个人评分（1–10）').number('');
    const commentTa   = this.row(el, '即时短评').textarea('写下感受...');

    this.submitRow(el, () => {
      const result: RealSubjective = {
        status:   statusSel.value,
        progress: progressInp.value,
        source:   sourceInp.value.trim(),
        rating:   ratingInp.value,
        comment:  commentTa.value.trim(),
      };
      this.resolve(result);
      this.close();
    });
  }

  // ─────────────────────────────────────────────
  // DOM 构建工具（流式调用）
  // ─────────────────────────────────────────────

  /**
   * 创建一行 label + 控件的包装行，返回控件构建器
   */
  private row(container: HTMLElement, label: string): RowBuilder {
    const row = container.createEl('div', { cls: 'bangumi-input-row' });
    row.createEl('label', { text: label });
    return new RowBuilder(row);
  }

  /**
   * 创建确认/取消按钮行
   */
  private submitRow(container: HTMLElement, onSubmit: () => void): void {
    const btnRow = container.createEl('div', { cls: 'bangumi-confirm-btns' });

    const cancelBtn = btnRow.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => {
      this.resolve(null);
      this.close();
    });

    const submitBtn = btnRow.createEl('button', {
      text: '保存并建档',
      cls: 'bangumi-confirm-ok',
    });
    submitBtn.addEventListener('click', onSubmit);
  }
}

// ─────────────────────────────────────────────
// 内部：行构建器（链式 DOM 辅助）
// ─────────────────────────────────────────────

class RowBuilder {
  constructor(private readonly row: HTMLElement) {}

  /** 创建 <select> 并返回元素本身 */
  select(options: readonly string[], defaultVal: string): HTMLSelectElement {
    const sel = this.row.createEl('select');
    for (const opt of options) {
      const el = sel.createEl('option', { text: opt, value: opt });
      if (opt === defaultVal) el.selected = true;
    }
    return sel;
  }

  /** 创建 type="number" 的 <input> */
  number(defaultVal: string): HTMLInputElement {
    const inp = this.row.createEl('input', { type: 'number' });
    inp.min = '0';
    inp.value = defaultVal;
    return inp;
  }

  /** 创建 type="text" 的 <input> */
  text(placeholder: string): HTMLInputElement {
    const inp = this.row.createEl('input', { type: 'text' });
    inp.placeholder = placeholder;
    return inp;
  }

  /** 创建 <textarea> */
  textarea(placeholder: string): HTMLTextAreaElement {
    const ta = this.row.createEl('textarea');
    ta.placeholder = placeholder;
    return ta;
  }
}
import { App, Modal, Setting, Notice } from 'obsidian';
import type {
  SubjectData,
  Subjective,
  BookSubtype,
  GamePlatform,
} from '../types';
import {
  STATUS_OPTIONS,
  BOOK_CHANNELS,
  BOOK_VERSIONS,
  MUSIC_SOURCES,
  GAME_PLATFORMS,
} from '../constants';

export class SubjectiveModal extends Modal {
  private subjectData: SubjectData;
  private onSubmit: (subjective: Subjective) => void;
  private formValues: Record<string, string> = {};

  constructor(app: App, subjectData: SubjectData, onSubmit: (subjective: Subjective) => void) {
    super(app);
    this.subjectData = subjectData;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl, subjectData } = this;
    contentEl.empty();
    contentEl.addClass('bgm-plugin', 'bgm-subjective-modal');

    contentEl.createEl('h2', { text: `添加「${subjectData.name}」的主观信息` });
    contentEl.createEl('p', { text: `类型：${this.getTypeLabel(subjectData.typeKey)}`, cls: 'bgm-subjective-type-hint' });

    this.addStatusField(subjectData.typeKey);

    switch (subjectData.typeKey) {
      case 'anime':
        this.addAnimeFields();
        break;
      case 'book':
        this.addBookFields();
        break;
      case 'game':
        this.addGameFields();
        break;
      case 'music':
        this.addMusicFields();
        break;
      case 'real':
        this.addRealFields();
        break;
    }

    this.addRatingField();
    this.addCommentField();

    const buttonDiv = contentEl.createDiv({ cls: 'bgm-modal-buttons' });
    const cancelBtn = buttonDiv.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => this.close());

    const submitBtn = buttonDiv.createEl('button', { text: '确定', cls: 'mod-cta' });
    submitBtn.addEventListener('click', () => this.handleSubmit());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private addStatusField(typeKey: SubjectData['typeKey']) {
    const statusOptions = STATUS_OPTIONS[typeKey];
    if (!statusOptions?.length) return;

    new Setting(this.contentEl)
      .setName('状态')
      .setDesc('必选')
      .addDropdown(dropdown => {
        dropdown.addOption('', '请选择');
        for (const opt of statusOptions) dropdown.addOption(opt, opt);
        dropdown.onChange(value => (this.formValues.status = value));
      });
  }

  private addAnimeFields() {
    new Setting(this.contentEl)
      .setName('已观看集数')
      .addText(text => text.setPlaceholder('集数').onChange(v => (this.formValues.progress = v)));
    new Setting(this.contentEl)
      .setName('观看网址')
      .addText(text => text.setPlaceholder('https://...').onChange(v => (this.formValues.source = v)));
  }

  private addBookFields() {
    new Setting(this.contentEl)
      .setName('书籍类型')
      .addDropdown(dropdown => {
        dropdown.addOption('manga', '漫画');
        dropdown.addOption('lightnovel', '轻小说');
        dropdown.addOption('novel', '小说');
        dropdown.onChange(v => (this.formValues.subtype = v));
      });
    new Setting(this.contentEl)
      .setName('当前卷数')
      .addText(text => text.setPlaceholder('卷数').onChange(v => (this.formValues.volNum = v)));
    new Setting(this.contentEl)
      .setName('当前话数/章节')
      .addText(text => text.setPlaceholder('话数').onChange(v => (this.formValues.unitNum = v)));
    new Setting(this.contentEl)
      .setName('阅读渠道')
      .addDropdown(dropdown => {
        dropdown.addOption('', '请选择');
        for (const ch of BOOK_CHANNELS) dropdown.addOption(ch, ch);
        dropdown.onChange(v => (this.formValues.channel = v));
      });
    new Setting(this.contentEl)
      .setName('翻译版本')
      .addDropdown(dropdown => {
        dropdown.addOption('', '请选择');
        for (const ver of BOOK_VERSIONS) dropdown.addOption(ver, ver);
        dropdown.onChange(v => (this.formValues.version = v));
      });
  }

  private addGameFields() {
    new Setting(this.contentEl)
      .setName('游玩平台')
      .addDropdown(dropdown => {
        dropdown.addOption('', '请选择');
        for (const plat of GAME_PLATFORMS) dropdown.addOption(plat, plat);
        dropdown.onChange(v => (this.formValues.platform = v));
      });
    new Setting(this.contentEl)
      .setName('游玩时长（小时）')
      .addText(text => text.setPlaceholder('例如 40.5').onChange(v => (this.formValues.hours = v)));
    new Setting(this.contentEl)
      .setName('当前进度')
      .addText(text => text.setPlaceholder('进度描述').onChange(v => (this.formValues.progress = v)));
  }

  private addMusicFields() {
    new Setting(this.contentEl)
      .setName('收听平台')
      .addDropdown(dropdown => {
        dropdown.addOption('', '请选择');
        for (const src of MUSIC_SOURCES) dropdown.addOption(src, src);
        dropdown.onChange(v => (this.formValues.source = v));
      });
  }

  private addRealFields() {
    new Setting(this.contentEl)
      .setName('已观看集数')
      .addText(text => text.setPlaceholder('集数').onChange(v => (this.formValues.progress = v)));
    new Setting(this.contentEl)
      .setName('观看网址')
      .addText(text => text.setPlaceholder('https://...').onChange(v => (this.formValues.source = v)));
  }

  private addRatingField() {
    new Setting(this.contentEl)
      .setName('个人评分')
      .addDropdown(dropdown => {
        dropdown.addOption('', '未评分');
        for (let i = 1; i <= 10; i++) dropdown.addOption(String(i), String(i));
        dropdown.onChange(v => (this.formValues.rating = v));
      });
  }

  private addCommentField() {
    new Setting(this.contentEl)
      .setName('短评')
      .addTextArea(textarea => textarea.setPlaceholder('记录当下的感受...').onChange(v => (this.formValues.comment = v)));
  }

  private handleSubmit() {
    if (!this.formValues.status) {
      new Notice('请选择状态');
      return;
    }
    this.close();
    this.onSubmit(this.buildSubjective());
  }

  private buildSubjective(): Subjective {
    const status = this.formValues.status!; // 已经在 handleSubmit 中确保非空
    const base = {
      status,
      rating: this.formValues.rating || '',
      comment: this.formValues.comment || '',
    };
    const type = this.subjectData.typeKey;
    if (type === 'anime') {
      return { ...base, progress: this.formValues.progress || '', source: this.formValues.source || '' };
    }
    if (type === 'book') {
      return {
        ...base,
        subtype: (this.formValues.subtype as BookSubtype) || 'manga',
        volNum: this.formValues.volNum || '',
        unitNum: this.formValues.unitNum || '',
        channel: this.formValues.channel || '',
        version: this.formValues.version || '',
      };
    }
    if (type === 'game') {
      return {
        ...base,
        platform: (this.formValues.platform as GamePlatform) || 'PC',
        hours: this.formValues.hours || '',
        progress: this.formValues.progress || '',
      };
    }
    if (type === 'music') {
      return { ...base, source: this.formValues.source || '' };
    }
    // real
    return { ...base, progress: this.formValues.progress || '', source: this.formValues.source || '' };
  }

  private getTypeLabel(typeKey: SubjectData['typeKey']): string {
    const labels: Record<SubjectData['typeKey'], string> = { anime: '动画', book: '书籍', game: '游戏', music: '音乐', real: '三次元' };
    return labels[typeKey];
  }
}
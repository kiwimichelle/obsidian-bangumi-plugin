import { App, Modal, Notice, TFile } from 'obsidian';
import { searchSubjects, fetchSubject, fetchSubjectRelations, parseInfobox, getInfoboxValue } from './api';
import { BangumiSettings, SubjectTypeKey } from './types';
import { SUBJECT_TYPE_MAP, SUBJECT_TYPE_LABEL, TYPE_FILTERS } from './constants';
import { buildTemplateVars, resolveTemplate, renderTemplate, resolveArchivePath } from './template';
import { resolveNaming, downloadCover, createLocalVideoDir, extractPreservedContent, injectPreservedContent, ensureFolder } from './vault';



export class BangumiSearchModal extends Modal {
  settings: BangumiSettings;
  currentType = 0;
  isLoading = false;

  constructor(app: App, settings: BangumiSettings) {
    super(app);
    this.settings = settings;
  }
  async resolveOverwrite(mode: string, filename: string): Promise<'overwrite' | 'skip'> {
  if (mode === 'always') return 'overwrite';
  if (mode === 'never')  return 'skip';
  return new Promise(resolve => {
    new ConfirmModal(
      this.app,
      `笔记已存在：${filename}`,
      '是否覆盖更新？已写内容将自动保留。',
      () => resolve('overwrite'),
      () => resolve('skip')
    ).open();
  });
}


  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: '搜索 Bangumi 条目' });

    // ── 类型筛选 ──
    const filterBar = contentEl.createEl('div');
    filterBar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;';
    const buttons: HTMLButtonElement[] = [];

    TYPE_FILTERS.forEach((f, i) => {
      const btn = filterBar.createEl('button', { text: f.label });
      btn.style.cssText = 'padding:4px 12px;border-radius:12px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:13px;';
      this.styleBtn(btn, f.value === this.currentType);
      btn.addEventListener('click', () => {
        this.currentType = f.value;
        buttons.forEach((b, j) => this.styleBtn(b, TYPE_FILTERS[j].value === this.currentType));
        if (inputEl.value.trim()) triggerSearch();
      });
      buttons.push(btn);
    });

    // ── 搜索框 ──
    const inputEl = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入名称后按 Enter 搜索...',
    });
    inputEl.style.cssText = 'width:100%;padding:8px;margin-bottom:8px;font-size:14px;box-sizing:border-box;';

    const statusEl = contentEl.createEl('div');
    statusEl.style.cssText = 'text-align:center;color:var(--text-muted);font-size:13px;min-height:24px;';

    const resultsEl = contentEl.createEl('div');

    const triggerSearch = async () => {
      const kw = inputEl.value.trim();
      if (!kw || this.isLoading) return;
      this.isLoading = true;
      resultsEl.empty();
      statusEl.setText('🔍 搜索中...');
      try {
        const results = await searchSubjects(kw, this.currentType, this.settings.token);
        statusEl.setText(results.length ? '' : '没有找到结果');
        this.renderResults(resultsEl, results);
      } catch {
        statusEl.setText('搜索失败，请检查网络');
      } finally {
        this.isLoading = false;
      }
    };

    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') triggerSearch(); });
    inputEl.focus();
  }

  styleBtn(btn: HTMLButtonElement, active: boolean) {
    btn.style.backgroundColor = active ? 'var(--interactive-accent)' : '';
    btn.style.color = active ? 'var(--text-on-accent)' : '';
  }

  renderResults(container: HTMLElement, results: any[]) {
    container.empty();
    if (!results?.length) return;
    results.forEach(item => {
      const row = container.createEl('div');
      row.style.cssText = 'display:flex;align-items:center;padding:8px;cursor:pointer;border-radius:6px;margin-bottom:4px;gap:10px;';
      row.onmouseenter = () => row.style.backgroundColor = 'var(--background-modifier-hover)';
      row.onmouseleave = () => row.style.backgroundColor = '';

      if (item.images?.common) {
        const img = row.createEl('img');
        img.src = item.images.common;
        img.style.cssText = 'width:40px;height:56px;object-fit:cover;border-radius:2px;flex-shrink:0;';
      }

      const info = row.createEl('div');
      info.style.cssText = 'flex:1;min-width:0;';
      info.createEl('div', { text: item.name_cn || item.name })
        .style.cssText = 'font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      if (item.name_cn && item.name !== item.name_cn) {
        info.createEl('div', { text: item.name })
          .style.cssText = 'font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      }
      const meta = info.createEl('div');
      meta.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:2px;';
      const typeKey = SUBJECT_TYPE_MAP[item.type];
      const score = item.rating?.score ? `⭐ ${item.rating.score}` : '';
      const date  = item.air_date?.substring(0, 4) ?? '';
      meta.setText([typeKey ? SUBJECT_TYPE_LABEL[typeKey] : '未知', date, score].filter(Boolean).join(' · '));

      row.addEventListener('click', () => this.handleSelect(item));
    });
  }

  async handleSelect(item: any) {
    this.close();
    const notice = new Notice('⏳ 正在获取详情...', 0);
    try {
      const [detail, relations] = await Promise.all([
        fetchSubject(item.id, this.settings.token),
        fetchSubjectRelations(item.id, this.settings.token),
      ]);
      notice.hide();
      await this.createNote(detail, relations);
    } catch {
      notice.hide();
      new Notice('❌ 获取详情失败，请检查网络');
    }
  }

 async createNote(detail: any, relations: any[]) {
  const typeKey: SubjectTypeKey = SUBJECT_TYPE_MAP[detail.type] ?? 'anime';
  const config    = this.settings.subjectTypes[typeKey];
  const typeLabel = SUBJECT_TYPE_LABEL[typeKey];
  const infobox   = parseInfobox(detail.infobox ?? []);

  // 封面下载
  const title      = (detail.name_cn || detail.name).replace(/[\\/:*?"<>|]/g, '_');
  const coverLocal = await downloadCover(
    this.app, detail.images?.large ?? '', config.coverPath, title
  );

  // 构建模板变量
  const vars = buildTemplateVars(detail, relations, infobox, coverLocal);

  // 改编类型：为空时弹窗询问
  if (!vars.adaptation) {
    vars.adaptation = await new Promise<string>(resolve => {
      new AdaptationModal(this.app, vars.title, resolve).open();
    });
  }

  // 从 infobox 读取类型描述（TV/剧场版/OVA 等），用于防撞命名
  const subjectTypeDesc = getInfoboxValue(infobox, ['话数', '放送类型'])
    .replace(/\d+/g, '').trim() || '';

  // 归档路径
  const archivePath = resolveArchivePath(
    config.archiveRoot, config.archiveMode, vars.year, vars.season
  );

  // 其他类型的归档根路径
  const otherArchiveRoots = Object.entries(this.settings.subjectTypes)
    .filter(([k]) => k !== typeKey)
    .map(([, c]) => c.archiveRoot);

  // 防撞命名（新逻辑）
  const naming = await resolveNaming(
    this.app,
    title,
    typeKey,
    typeLabel,
    config.archiveRoot,   // 用根路径做全局扫描
    otherArchiveRoots,
    vars.year,
    vars.bangumi_id,
    subjectTypeDesc,
  );

  const filename = naming.filename;
  const filePath = `${archivePath}/${filename}.md`;

  // 覆盖策略
  if (naming.conflict === 'same') {
    const action = await this.resolveOverwrite(config.overwriteMode, filename);
    if (action === 'skip') {
      new Notice(`📝 已跳过：${filename}`);
      return;
    }
  }

  // 渲染模板
  const template = await resolveTemplate(this.app, typeKey, this.settings);
  // 更新 vars.title 为最终文件名
  vars.title = filename;
  let content = renderTemplate(template, vars);

  // 保留手写内容（覆盖时）
  if (naming.conflict === 'same') {
    const preserved = await extractPreservedContent(this.app, naming.existingPath);
    content = injectPreservedContent(content, preserved);
  }

  // 写文件
  await ensureFolder(this.app, archivePath);

  if (naming.conflict === 'same') {
    const existingFile = this.app.vault.getAbstractFileByPath(naming.existingPath);
    if (existingFile) await this.app.vault.modify(existingFile as TFile, content);
  } else {
    await this.app.vault.create(filePath, content);
  }

  // 本地视频文件夹
  if (this.settings.createVideoDir && this.settings.videoRootDir) {
    await createLocalVideoDir(this.settings.videoRootDir, filename);
  }

  new Notice(`✅ ${naming.conflict === 'same' ? '已更新' : '已创建'}：${filename}`);
}

// ── 确认弹窗 ────────────────────────────────────────────────────

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private desc: string,
    private onConfirm: () => void,
    private onCancel: () => void,
  ) { super(app); }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    contentEl.createEl('p',  { text: this.desc });

    const btnRow = contentEl.createEl('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;';

    const cancelBtn = btnRow.createEl('button', { text: '跳过' });
    cancelBtn.addEventListener('click', () => { this.close(); this.onCancel(); });

    const confirmBtn = btnRow.createEl('button', { text: '覆盖更新' });
    confirmBtn.style.cssText = 'background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:6px 16px;border-radius:4px;cursor:pointer;';
    confirmBtn.addEventListener('click', () => { this.close(); this.onConfirm(); });
  }

  onClose() { this.contentEl.empty(); }
}


// modal.ts 末尾加这个类
class AdaptationModal extends Modal {
  private resolve: (val: string) => void;
  private options = ['原创', '漫画改编', '小说改编', '游戏改编', '其他'];

  constructor(app: App, private title: string, resolve: (val: string) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: `${this.title}` });
    contentEl.createEl('p', { text: '无法自动判断改编类型，请手动选择：' })
      .style.cssText = 'color:var(--text-muted);font-size:13px;margin-bottom:12px;';

    const grid = contentEl.createEl('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';

    this.options.forEach(opt => {
      const btn = grid.createEl('button', { text: opt });
      btn.style.cssText = 'padding:8px 18px;border-radius:6px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:14px;';
      btn.onmouseenter = () => btn.style.backgroundColor = 'var(--interactive-accent)', btn.style.color = 'var(--text-on-accent)';
      btn.onmouseleave = () => btn.style.backgroundColor = '', btn.style.color = '';
      btn.addEventListener('click', () => {
        this.close();
        this.resolve(opt);
      });
    });
  }

  onClose() { this.contentEl.empty(); }
}
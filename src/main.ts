import { Plugin, Notice, Modal, TFile } from 'obsidian';  // 修复：补回 Modal import
import { DEFAULT_SETTINGS, DEFAULT_OFFLINE_DB_PATHS } from './constants';
import type { BangumiSettings } from './types';

import { CacheManager }          from './core/CacheManager';
import { IndexBuilder }          from './core/IndexBuilder';
import { SearchIndexBuilder }    from './core/SearchIndexBuilder';
import { JsonlReader }           from './core/JsonlReader';
import { OnlineFetcher }         from './core/OnlineFetcher';
import { BgmScraper }            from './core/BgmScraper';
import { RelationFetcher }       from './core/RelationFetcher';
import { DataManager }           from './core/DataManager';
import { EpisodeIndexBuilder }   from './core/EpisodeindexBuilder';
import { PersonIndexBuilder }    from './core/PersonindexBuilder';
import { RelationIndexBuilder }  from './core/RelationIndexBuilder';

import { ArchiveLocator }        from './vault/ArchiveLocator';
import { NamingResolver, ConflictModal } from './vault/NamingResolver';
import { VaultHelper }           from './vault/VaultHelper';
import { CoverDownloader }       from './vault/CoverDownloader';
import { NoteBuilder }           from './note/NoteBuilder';
import { NoteUpdater }           from './note/NoteUpdater';
import { FrontmatterWriter }     from './note/FrontmatterWriter';

import { BangumiSettingTab }     from './ui/SettingTab';
import { SearchModal }           from './ui/SearchModal';
import type { SearchResult }     from './ui/SearchModal';
import { OnboardingModal }       from './ui/OnboardingModal';

export default class BangumiPlugin extends Plugin {
  settings!: BangumiSettings;
  dataManager!: DataManager;

  episodeIndexBuilder!:  EpisodeIndexBuilder;
  personIndexBuilder!:   PersonIndexBuilder;
  relationIndexBuilder!: RelationIndexBuilder;

  private cacheManager!:       CacheManager;
  private indexBuilder!:       IndexBuilder;
  private searchIndexBuilder!: SearchIndexBuilder;
  private jsonlReader!:        JsonlReader;
  private onlineFetcher!:      OnlineFetcher;
  private bgmScraper!:         BgmScraper;
  private relationFetcher!:    RelationFetcher;
  private archiveLocator!:     ArchiveLocator;

  async onload() {
    await this.loadSettings();
    await this.migrateSettings();

    // 1. 初始化所有模块
    this.cacheManager        = new CacheManager(this.app, this.manifest.dir!);
    this.indexBuilder        = new IndexBuilder(this.app, this.manifest.dir!);
    this.searchIndexBuilder  = new SearchIndexBuilder(this.app, this.manifest.dir!);
    this.jsonlReader         = new JsonlReader();
    this.onlineFetcher       = new OnlineFetcher(() => this.settings);
    this.bgmScraper          = new BgmScraper();
    this.relationFetcher     = new RelationFetcher(this.onlineFetcher);
    this.archiveLocator      = new ArchiveLocator(this.app, () => this.settings);
    this.episodeIndexBuilder  = new EpisodeIndexBuilder(this.app, this.manifest.dir ?? '');
    this.personIndexBuilder   = new PersonIndexBuilder(this.app, this.manifest.dir ?? '');
    this.relationIndexBuilder = new RelationIndexBuilder(this.app, this.manifest.dir ?? '');

    // 2. 并行加载所有索引
    await Promise.all([
      this.cacheManager.load(),
      this.indexBuilder.load(),
      this.searchIndexBuilder.load(),
      this.episodeIndexBuilder.load(),
      this.personIndexBuilder.load(),
      this.relationIndexBuilder.load(),
      this.archiveLocator.resolve(),
    ]);

    void this.checkIndexStaleness();

    // 3. 初始化 DataManager
    this.dataManager = new DataManager({
      cache:          this.cacheManager,
      index:          this.indexBuilder,
      searchIndex:    this.searchIndexBuilder,
      jsonl:          this.jsonlReader,
      fetcher:        this.onlineFetcher,
      scraper:        this.bgmScraper,
      relations:      this.relationFetcher,
      getJsonlPath:   () => this.archiveLocator.getCachedPath(),
      getSettings:    () => this.settings,
      episodeIndex:   this.episodeIndexBuilder,
      personIndex:    this.personIndexBuilder,
      relationIndex:  this.relationIndexBuilder,
      archiveLocator: this.archiveLocator,
    });

    // 4. 注册 UI
    this.addSettingTab(new BangumiSettingTab(
      this.app,
      this,
      () => this.settings,
      () => this.saveSettings(),
      this.dataManager,
    ));

    this.addRibbonIcon('tv', 'Bangumi 搜索', () => this.openSearchModal());

    this.addCommand({
      id:       'search-bangumi',
      name:     '搜索 Bangumi 条目',
      callback: () => this.openSearchModal(),
    });

    // 5. 首次启动引导
    this.app.workspace.onLayoutReady(() => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (!this.settings.offlineDbPath && this.settings.indexBuiltAt === 0) {
        void OnboardingModal.prompt(
          this.app,
          () => this.settings,
          () => this.saveSettings(),
          this.dataManager,
        );
      }
    });
  }

  private async migrateSettings(): Promise<void> {
    const s = this.settings;
    let dirty = false;

    // 旧版单路径 → 新版多路径迁移
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    if (s.offlineDbPath && !s.offlineDbPaths?.subject) {
      s.offlineDbPaths = {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        subject:        s.offlineDbPath,
        episodes:       '',
        persons:        '',
        subjectPersons: '',
        relations:      '',
      };
      dirty = true;
    }
    if (!s.offlineDbPaths) {
      s.offlineDbPaths = { ...DEFAULT_OFFLINE_DB_PATHS };
      dirty = true;
    }

    // 旧版 coverPath 默认值 'assets/covers' → 新版空字符串（跟随归档根目录）
    // 只迁移未被用户手动修改过的默认值
    if (s.subjectTypes) {
      for (const key of Object.keys(s.subjectTypes) as (keyof typeof s.subjectTypes)[]) {
        if (s.subjectTypes[key].coverPath === 'assets/covers') {
          s.subjectTypes[key].coverPath = '';
          dirty = true;
        }
      }
    }

    if (dirty) await this.saveSettings();
  }

  async onunload() {
    if (this.cacheManager) await this.cacheManager.flush();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ─────────────────────────────────────────────
  // 核心建档流程
  // ─────────────────────────────────────────────

  private async openSearchModal() {
    const result = await SearchModal.prompt(this.app, this.dataManager, () => this.settings);
    if (result) await this.createOrUpdateNote(result);
  }

  private async createOrUpdateNote(result: SearchResult): Promise<void> {
    const { data, subjective } = result;
    const config    = this.settings.subjectTypes[data.typeKey];
    const targetDir = VaultHelper.buildSubjectDir(this.settings, data);

    // 1. 命名冲突检测
    const namingResolver = new NamingResolver(this.app, this.settings);
    const naming         = namingResolver.resolve(data, targetDir);

    let finalFilename = naming.filename;
    let doOverwrite   = false;

    // 2. 冲突处理：overwriteMode 对所有冲突场景生效
    if (naming.conflict !== 'none') {
      // same / other 冲突
      if (config.overwriteMode === 'never') {
        new Notice(`已跳过：${naming.filename}（设置为不覆盖）`);
        return;
      }
      if (config.overwriteMode === 'always') {
        finalFilename = naming.filename;
        doOverwrite   = naming.conflict === 'same';
      } else {
        // ask：弹窗让用户决定文件名
        const resolution = await ConflictModal.prompt(
          this.app,
          naming.conflict,
          naming.existingPath,
          naming.filename,
          targetDir,
          namingResolver,
        );
        if (!resolution) { new Notice('已取消'); return; }
        finalFilename = resolution.filename;
        doOverwrite   = resolution.overwrite;
      }
    } else if (naming.existingPath) {
      // conflict === 'none' 且有 existingPath → 同 ID 更新
      if (config.overwriteMode === 'never') {
        new Notice(`已跳过：${naming.filename}（设置为不覆盖）`);
        return;
      }
      if (config.overwriteMode === 'ask') {
        const confirmed = await this.confirmOverwrite(naming.filename);
        if (!confirmed) { new Notice('已取消'); return; }
      }
      doOverwrite = true;
    }

    // 3. 目录和封面
    await VaultHelper.ensureFolder(this.app, targetDir);
    let coverLocalPath = '';
    if (data.coverUrl) {
      coverLocalPath = await CoverDownloader.download(
        this.app, data.coverUrl, this.settings, data.typeKey, finalFilename,
      );
    }

    // 4. 构建正文
    const builder     = new NoteBuilder(this.app, () => this.settings, this.dataManager);
    const buildResult = await builder.build(data, subjective, coverLocalPath);
    let finalContent  = buildResult.content;

    // 5. 写入文件
    const vault = this.app.vault;
    let file: TFile;

    if (doOverwrite && naming.existingPath) {
      file = vault.getAbstractFileByPath(naming.existingPath) as TFile;
      const updater   = new NoteUpdater(this.app);
      const preserved = await updater.extract(file, data.typeKey);
      finalContent    = updater.inject(finalContent, preserved, data.typeKey);
      await vault.modify(file, finalContent);
    } else {
      const filePath = `${targetDir}/${finalFilename}.md`;
      file = await vault.create(filePath, finalContent);
    }

    // 6. Frontmatter
    const fmWriter = new FrontmatterWriter(this.app);
    await fmWriter.writeBangumiFields(file, data, coverLocalPath);
    if (!doOverwrite) {
      await fmWriter.writeSubjectiveFields(file, data.typeKey, subjective);
    }

    new Notice(`✅ 成功建档：${finalFilename}`);
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  // ─────────────────────────────────────────────
  // 辅助
  // ─────────────────────────────────────────────

  private async checkIndexStaleness(): Promise<void> {
    const jsonlPath = this.archiveLocator.getCachedPath();
    if (!jsonlPath) return;
    const stale =
      await this.indexBuilder.isStale(jsonlPath) ||
      await this.searchIndexBuilder.isStale(jsonlPath);
    if (stale) {
      new Notice('⚠️ Bangumi 离线索引已过期，请前往设置页重建索引', 8000);
    }
  }

  /** 同 ID 更新场景的简单确认弹窗 */
  private confirmOverwrite(filename: string): Promise<boolean> {
    return new Promise(resolve => {
      new ConfirmModal(
        this.app,
        `笔记「${filename}」已存在，是否覆盖更新？`,
        resolve,
      ).open();
    });
  }
}

// ─────────────────────────────────────────────
// 同 ID 更新确认弹窗（简单版，冲突场景用 ConflictModal）
// ─────────────────────────────────────────────

class ConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: import('obsidian').App,
    private readonly message: string,
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle('确认操作');
    contentEl.createEl('p', { text: this.message });

    const btnRow = contentEl.createEl('div', { cls: 'bangumi-confirm-btns' });

    const cancelBtn = btnRow.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => {
      this.settled = true; this.resolve(false); this.close();
    });

    const confirmBtn = btnRow.createEl('button', {
      text: '覆盖更新',
      cls:  'bangumi-confirm-ok',
    });
    confirmBtn.addEventListener('click', () => {
      this.settled = true; this.resolve(true); this.close();
    });
  }

  onClose(): void {
    if (!this.settled) { this.settled = true; this.resolve(false); }
    this.contentEl.empty();
  }
}
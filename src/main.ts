import { Plugin, Notice, TFile } from 'obsidian';
import type { BangumiSettings, SubjectData, Subjective } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { DataManager, SubjectNotFoundError } from './core/DataManager';
import { CacheManager } from './core/CacheManager';
import { IndexBuilder } from './core/IndexBuilder';
import { SearchIndexBuilder } from './core/SearchIndexBuilder';
import { JsonlReader } from './core/JsonlReader';
import { OnlineFetcher } from './core/OnlineFetcher';
import { BgmScraper } from './core/BgmScraper';
import { RelationFetcher } from './core/RelationFetcher';
import { ArchiveLocator } from './vault/ArchiveLocator';
import { VaultHelper } from './vault/VaultHelper';
import { CoverDownloader } from './vault/CoverDownloader';
import { NamingResolver } from './vault/NamingResolver';
import { NoteBuilder } from './note/NoteBuilder';
import { FrontmatterWriter } from './note/FrontmatterWriter';
import { NoteUpdater } from './note/NoteUpdater';
import { SettingTab } from './ui/SettingTab';
import { SearchModal } from './ui/SearchModal';
import { SubjectiveModal } from './ui/SubjectiveModal';
import { OnboardingModal } from './ui/OnboardingModal';
import { IndexProgressModal } from './ui/IndexProgressModal';
import { ProgressNotice } from './ui/ProgressNotice';

export default class BangumiPlugin extends Plugin {
  settings!: BangumiSettings;
  private dataManager!: DataManager;
  private vaultHelper!: VaultHelper;
  private coverDownloader!: CoverDownloader;
  private namingResolver!: NamingResolver;
  private noteBuilder!: NoteBuilder;
  private frontmatterWriter!: FrontmatterWriter;
  private noteUpdater!: NoteUpdater;
  private archiveLocator!: ArchiveLocator;
  private cacheManager!: CacheManager;
  private indexBuilder!: IndexBuilder;
  private searchIndexBuilder!: SearchIndexBuilder;
  private jsonlReader!: JsonlReader;
  private onlineFetcher!: OnlineFetcher;
  private bgmScraper!: BgmScraper;
  private relationFetcher!: RelationFetcher;
  private settingTab: SettingTab | null = null;

  private state = {
    offlineAvailable: false,
    indexReady: false,
    searchIndexReady: false,
    cacheLoaded: false,
  };

  async onload() {
    await this.loadSettings();
    await this.initializeModules();

    this.settingTab = new SettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.addCommand({
      id: 'search-bangumi',
      name: '搜索 Bangumi 条目',
      callback: () => this.openSearchModal(),
    });
    this.addCommand({
      id: 'rebuild-index',
      name: '重建行号索引',
      callback: () => this.rebuildIndex(),
    });
    this.addCommand({
      id: 'rebuild-search-index',
      name: '重建搜索索引',
      callback: () => this.rebuildSearchIndex(),
    });

    if (!this.settings.offlineDbPath && !this.settings.offlineMode) {
      new OnboardingModal(this.app, this.settings, async (newSettings) => {
        this.settings = newSettings;
        await this.saveSettings();
        if (this.settings.offlineDbPath) {
          await this.resolveOfflinePath();
          if (this.state.offlineAvailable) {
            await this.rebuildIndex();
            await this.rebuildSearchIndex();
          }
        }
      }).open();
    } else {
      await this.resolveOfflinePath();
      if (this.state.offlineAvailable && !this.state.indexReady) {
        new Notice('离线包可用，正在构建索引...');
        await this.rebuildIndex();
        await this.rebuildSearchIndex();
      }
    }
  }

  async onunload() {
    await this.cacheManager?.flush();
  }

  private async initializeModules() {
    this.vaultHelper = new VaultHelper(this.app);
    this.coverDownloader = new CoverDownloader(this.app);
    this.namingResolver = new NamingResolver(this.app, this.settings);
    this.noteBuilder = new NoteBuilder(this.app, () => this.settings);
    this.frontmatterWriter = new FrontmatterWriter(this.app);
    this.noteUpdater = new NoteUpdater(this.app);

    this.cacheManager = new CacheManager(this.app, (this as any).manifest.dir ?? '');
    this.indexBuilder = new IndexBuilder(this.app, (this as any).manifest.dir ?? '');
    this.searchIndexBuilder = new SearchIndexBuilder(this.app, (this as any).manifest.dir ?? '');
    this.jsonlReader = new JsonlReader();
    this.onlineFetcher = new OnlineFetcher(() => this.settings);
    this.bgmScraper = new BgmScraper();
    this.relationFetcher = new RelationFetcher(this.onlineFetcher);
    this.archiveLocator = new ArchiveLocator(this.app, () => this.settings);

    this.dataManager = new DataManager({
      cache: this.cacheManager,
      index: this.indexBuilder,
      searchIndex: this.searchIndexBuilder,
      jsonl: this.jsonlReader,
      fetcher: this.onlineFetcher,
      scraper: this.bgmScraper,
      relations: this.relationFetcher,
      getJsonlPath: () => this.archiveLocator.getCachedPath(),
      getSettings: () => this.settings,
    });

    await this.cacheManager.load();
    this.state.cacheLoaded = true;
  }

  private async resolveOfflinePath() {
    const path = await this.archiveLocator.resolve();
    this.state.offlineAvailable = !!path;
    if (path) {
      await this.indexBuilder.load();
      await this.searchIndexBuilder.load();
      this.state.indexReady = this.indexBuilder.isReady();
      this.state.searchIndexReady = this.searchIndexBuilder.isReady();
      if (!this.state.indexReady || !this.state.searchIndexReady) {
        new Notice('离线包路径已更新，请手动重建索引（命令面板）');
      }
    }
  }

  async rebuildIndex(): Promise<void> {
    const jsonlPath = this.archiveLocator.getCachedPath();
    if (!jsonlPath) {
      new Notice('离线包路径未设置或无效');
      return;
    }
    let stale = true;
    try { stale = await this.indexBuilder.isStale(jsonlPath); } catch { /* ignore */ }
    if (!stale && this.indexBuilder.isReady()) {
      new Notice('行号索引已是最新');
      return;
    }

    let totalLines = 0;
    const modal = new IndexProgressModal(this.app, '构建行号索引', 0);
    modal.open();
    try {
      await this.indexBuilder.build(jsonlPath, (lines) => {
        totalLines = lines;
        modal.updateProgress(lines);
      });
      modal.complete(`行号索引构建完成，共 ${totalLines} 行`);
      this.state.indexReady = true;
      this.settings.indexBuiltAt = Date.now();
      await this.saveSettings();
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      modal.fail(errorMessage);
      this.state.indexReady = false;
    }
  }

  async rebuildSearchIndex(): Promise<void> {
    const jsonlPath = this.archiveLocator.getCachedPath();
    if (!jsonlPath) {
      new Notice('离线包路径未设置或无效');
      return;
    }
    let stale = true;
    try { stale = await this.searchIndexBuilder.isStale(jsonlPath); } catch { /* ignore */ }
    if (!stale && this.searchIndexBuilder.isReady()) {
      new Notice('搜索索引已是最新');
      return;
    }

    let totalLines = 0;
    const modal = new IndexProgressModal(this.app, '构建搜索索引', 0);
    modal.open();
    try {
      await this.searchIndexBuilder.build(jsonlPath, (lines) => {
        totalLines = lines;
        modal.updateProgress(lines);
      });
      modal.complete(`搜索索引构建完成，共 ${totalLines} 行`);
      this.state.searchIndexReady = true;
      this.settings.searchIndexBuiltAt = Date.now();
      await this.saveSettings();
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      modal.fail(errorMessage);
      this.state.searchIndexReady = false;
    }
  }

  async openSearchModal() {
    new SearchModal(this.app, this.dataManager, async (item) => {
      try {
        const subjectData = await this.dataManager.getSubject(item.id);
        new SubjectiveModal(this.app, subjectData, async (subjective) => {
          await this.createOrUpdateNote(subjectData, subjective);
        }).open();
      } catch (err) {
        if (err instanceof SubjectNotFoundError) {
          new Notice(`条目 #${item.id} 不存在于任何数据源`);
        } else {
          const errorMessage = err instanceof Error ? err.message : String(err);
          new Notice(`获取条目失败: ${errorMessage}`);
        }
      }
    }).open();
  }

  private async createOrUpdateNote(subjectData: SubjectData, subjective: Subjective) {
    const typeConfig = this.settings.subjectTypes[subjectData.typeKey];
    const namingResult = this.namingResolver.resolve(subjectData);
    const finalPath = `${typeConfig.archiveRoot}/${namingResult.filename}.md`;

    let targetFile: TFile | null = null;
    if (namingResult.existingPath) {
      const existing = this.app.vault.getAbstractFileByPath(namingResult.existingPath);
      if (existing instanceof TFile) targetFile = existing;
    }

    let coverLocalPath = '';
    if (subjectData.coverUrl && typeConfig.coverPath) {
      const progress = new ProgressNotice('下载封面');
      const local = await this.coverDownloader.downloadCover(
        subjectData.coverUrl,
        subjectData.id,
        typeConfig.coverPath,
      );
      if (local) coverLocalPath = local;
      progress.done();
    }

    const buildResult = await this.noteBuilder.build(subjectData, subjective, coverLocalPath);
    let finalContent = buildResult.content;
    if (targetFile) {
      const preserved = await this.noteUpdater.extract(targetFile, subjectData.typeKey);
      finalContent = this.noteUpdater.inject(finalContent, preserved, subjectData.typeKey);
    }

    const file = await this.vaultHelper.writeFile(finalPath, finalContent);
    if (!file) {
      new Notice('笔记创建失败');
      return;
    }

    await this.frontmatterWriter.writeBangumiFields(file, subjectData, coverLocalPath);
    if (!targetFile) {
      await this.frontmatterWriter.writeSubjectiveFields(file, subjectData.typeKey, subjective);
    }

    new Notice(targetFile ? `笔记已更新：${finalPath}` : `笔记已创建：${finalPath}`);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.settingTab?.display();
  }

  getState() {
    return { ...this.state };
  }
}
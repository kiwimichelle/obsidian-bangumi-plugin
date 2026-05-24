import { Plugin, Notice, Modal, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from './constants';
import type { BangumiSettings } from './types';
import { DEFAULT_OFFLINE_DB_PATHS } from './constants';


// ── 核心调度 ──
import { CacheManager } from './core/CacheManager';
import { IndexBuilder } from './core/IndexBuilder';
import { SearchIndexBuilder } from './core/SearchIndexBuilder';
import { JsonlReader } from './core/JsonlReader';
import { OnlineFetcher } from './core/OnlineFetcher';
import { BgmScraper } from './core/BgmScraper';
import { RelationFetcher } from './core/RelationFetcher';
import { DataManager } from './core/DataManager';
import { EpisodeIndexBuilder } from './core/EpisodeindexBuilder'; // 检查你本地文件名大小写
import { PersonIndexBuilder } from './core/PersonindexBuilder';   // 检查你本地文件名大小写
import { RelationIndexBuilder } from './core/RelationIndexBuilder';

// ── 笔记与归档 ──
import { ArchiveLocator } from './vault/ArchiveLocator';
import { NamingResolver } from './vault/NamingResolver';
import { VaultHelper } from './vault/VaultHelper';
import { CoverDownloader } from './vault/CoverDownloader';
import { NoteBuilder } from './note/NoteBuilder';
import { NoteUpdater } from './note/NoteUpdater';
import { FrontmatterWriter } from './note/FrontmatterWriter';

// ── 用户界面 ──
import { BangumiSettingTab } from './ui/SettingTab';
import { SearchModal } from './ui/SearchModal';
import type { SearchResult } from './ui/SearchModal';
import { OnboardingModal } from './ui/OnboardingModal';

export default class BangumiPlugin extends Plugin {
  settings!: BangumiSettings;
  dataManager!: DataManager;
  
  // 👉 声明新增的构建器属性
  episodeIndexBuilder!: EpisodeIndexBuilder;
  personIndexBuilder!: PersonIndexBuilder;
  relationIndexBuilder!: RelationIndexBuilder;

  // ── 核心单例 ──
  private cacheManager!: CacheManager;
  private indexBuilder!: IndexBuilder;
  private searchIndexBuilder!: SearchIndexBuilder;
  private jsonlReader!: JsonlReader;
  private onlineFetcher!: OnlineFetcher;
  private bgmScraper!: BgmScraper;
  private relationFetcher!: RelationFetcher;
  private archiveLocator!: ArchiveLocator;

  async onload() {
    await this.loadSettings();
    await this.migrateSettings();

    // 1. 初始化核心基础设施
    this.cacheManager = new CacheManager(this.app, this.manifest.dir!);
    this.indexBuilder = new IndexBuilder(this.app, this.manifest.dir!);
    this.searchIndexBuilder = new SearchIndexBuilder(this.app, this.manifest.dir!);
    this.jsonlReader = new JsonlReader();
    this.onlineFetcher = new OnlineFetcher(() => this.settings);
    this.bgmScraper = new BgmScraper();
    this.relationFetcher = new RelationFetcher(this.onlineFetcher);
    this.archiveLocator = new ArchiveLocator(this.app, () => this.settings);
    // 👉 补齐第二个参数 this.manifest.dir
    // 💡 修复：加上 ?? '' 确保类型绝对是 string
    this.episodeIndexBuilder = new EpisodeIndexBuilder(this.app, this.manifest.dir ?? '');
    this.personIndexBuilder = new PersonIndexBuilder(this.app, this.manifest.dir ?? '');
    this.relationIndexBuilder = new RelationIndexBuilder(this.app, this.manifest.dir ?? '');

    // 预加载缓存和解析本地路径
    await this.cacheManager.load();
    await this.indexBuilder.load();
    await this.searchIndexBuilder.load();
    await this.archiveLocator.resolve();

    // 检测离线索引是否已过期（数据包被替换但未重建索引）
    void this.checkIndexStaleness();

    // 2. 初始化数据总阀门 DataManager
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
      episodeIndex: this.episodeIndexBuilder,
      personIndex: this.personIndexBuilder,
      relationIndex: this.relationIndexBuilder,
      archiveLocator: this.archiveLocator
    });

    // 3. 注册 UI 及交互
    // 👉 恢复为标准的 6 个参数，并补齐类成员的 this. 前缀
 // src/main.ts — addSettingTab 调用处
    this.addSettingTab(new BangumiSettingTab(
     this.app,
     this,
    () => this.settings,
    () => this.saveSettings(),
    this.dataManager,          // ✅ 只传 dataManager，不再传两个 builder
    ));

    this.addRibbonIcon('tv', 'Bangumi 搜索', () => this.openSearchModal());

    this.addCommand({
      id: 'search-bangumi',
      name: '搜索 Bangumi 条目',
      callback: () => this.openSearchModal(),
    });

    // 4. 首次启动引导 (如果既没配置路径，也没跳过构建)
    this.app.workspace.onLayoutReady(() => {
       // eslint-disable-next-line @typescript-eslint/no-deprecated
      if (!this.settings.offlineDbPath && this.settings.indexBuiltAt === 0) {
        void OnboardingModal.prompt(
  this.app,
  () => this.settings,
  () => this.saveSettings(),
  this.dataManager,            // ✅ 传 dataManager
);
      }
    });
  }

  /** 旧版单路径 → 新版多路径结构迁移 */
/* eslint-disable @typescript-eslint/no-deprecated */
private async migrateSettings(): Promise<void> {
  const s = this.settings;
  if (s.offlineDbPath && !s.offlineDbPaths?.subject) {
    s.offlineDbPaths = {
      subject:        s.offlineDbPath,
      episodes:       '',
      persons:        '',
      subjectPersons: '',
      relations:      '',
    };
    await this.saveSettings();
    console.log('[bangumi] 已自动迁移旧版路径配置');
  }
  if (!s.offlineDbPaths) {
    s.offlineDbPaths = { ...DEFAULT_OFFLINE_DB_PATHS };
    await this.saveSettings();
  }
}
/* eslint-enable @typescript-eslint/no-deprecated */

  async onunload() {
    // 确保任何在内存中的用户修改安全落盘
    if (this.cacheManager) {
      await this.cacheManager.flush();
    }
  }

  // ─────────────────────────────────────────────
  // 配置持久化
  // ─────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ─────────────────────────────────────────────
  // 核心建档流程
  // ─────────────────────────────────────────────

  /**
   * 打开搜索面板，等待用户操作
   */
  private async openSearchModal() {
    const result = await SearchModal.prompt(this.app, this.dataManager, () => this.settings);
    if (result) {
      await this.createOrUpdateNote(result);
    }
  }

  /**
   * 将搜索结果与用户主观输入转化为 Obsidian 实体笔记
   */
  private async createOrUpdateNote(result: SearchResult): Promise<void> {
    const { data, subjective } = result;
    const config = this.settings.subjectTypes[data.typeKey];

    // 1. 决议防撞命名
    const namingResolver = new NamingResolver(this.app, this.settings);
    const naming = namingResolver.resolve(data);

    if (naming.existingPath) {
      if (config.overwriteMode === 'never') {
        new Notice(`已跳过：${naming.filename}（依据设置中的不覆盖策略）`);
        const existing = this.app.vault.getAbstractFileByPath(naming.existingPath);
        if (existing instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(existing);
        return;
      }
      if (config.overwriteMode === 'ask' && naming.conflict === 'none') {
        // 同 ID 更新场景才询问；跨媒介防撞（conflict='same'/'other'）直接新建不询问
        const confirmed = await this.confirmOverwrite(naming.filename);
        if (!confirmed) {
          new Notice('已取消');
          return;
        }
      }
    }

    // 2. 准备层级目录
    const targetDir = VaultHelper.buildSubjectDir(this.settings, data);
    await VaultHelper.ensureFolder(this.app, targetDir);

    // 3. 下载封面
    let coverLocalPath = '';
    if (data.coverUrl) {
      coverLocalPath = await CoverDownloader.download(this.app, data.coverUrl, this.settings, data.typeKey, naming.filename);
    }

    // 4. 构建渲染正文
    const builder = new NoteBuilder(this.app, () => this.settings, this.dataManager);
    const buildResult = await builder.build(data, subjective, coverLocalPath);
    let finalContent = buildResult.content;

    let file: TFile;
    const vault = this.app.vault;

    // 5. 写入或合并文件
    if (naming.existingPath && naming.conflict === 'none') {
      // 场景：同 ID 文件已存在，执行安全更新注入
      file = vault.getAbstractFileByPath(naming.existingPath) as TFile;
      const updater = new NoteUpdater(this.app);
      const preserved = await updater.extract(file, data.typeKey);
      finalContent = updater.inject(finalContent, preserved, data.typeKey);
      await vault.modify(file, finalContent);
    } else {
      // 场景：全新创建 (含跨媒介防撞生成的新文件)
      const filePath = `${targetDir}/${naming.filename}.md`;
      file = await vault.create(filePath, finalContent);
    }

    // 6. 覆写 Frontmatter
    const fmWriter = new FrontmatterWriter(this.app);
    await fmWriter.writeBangumiFields(file, data, coverLocalPath);
    
    // （仅对新创建的笔记写入主观属性，避免抹去旧笔记的用户手改记录）
    if (!naming.existingPath || naming.conflict !== 'none') {
      await fmWriter.writeSubjectiveFields(file, data.typeKey, subjective);
    }

    // 7. 收尾：在当前标签页打开它
    new Notice(`✅ 成功建档：${naming.filename}`);
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  // ─────────────────────────────────────────────
  // 辅助：索引过期检测
  // ─────────────────────────────────────────────

  /**
   * 检查离线索引是否相对当前数据包已过期，若是则弹出 Notice 提示用户重建。
   * fire-and-forget，不阻塞启动流程。
   */
  private async checkIndexStaleness(): Promise<void> {
    const jsonlPath = this.archiveLocator.getCachedPath();
    if (!jsonlPath) return;
    // 任意一个索引过期即提示（两个索引同源，通常同时过期）
    const stale = await this.indexBuilder.isStale(jsonlPath)
      || await this.searchIndexBuilder.isStale(jsonlPath);
    if (stale) {
      new Notice(
        '⚠️ Bangumi 离线索引已过期，请前往设置页重建索引',
        8000,
      );
    }
  }

  // ─────────────────────────────────────────────
  // 辅助：覆盖确认对话框
  // ─────────────────────────────────────────────

  /**
   * 弹出确认对话框，询问是否覆盖已存在的笔记。
   * 返回 true 表示用户确认覆盖，false 表示取消。
   */
  private confirmOverwrite(filename: string): Promise<boolean> {
    return new Promise(resolve => {
      const modal = new ConfirmModal(
        this.app,
        `笔记「${filename}」已存在，是否覆盖更新？`,
        resolve,
      );
      modal.open();
    });
  }
}

// ─────────────────────────────────────────────
// 内部：通用确认对话框
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
      this.settled = true;
      this.resolve(false);
      this.close();
    });

    const confirmBtn = btnRow.createEl('button', {
      text: '覆盖更新',
      cls: 'bangumi-confirm-ok',
    });
    confirmBtn.addEventListener('click', () => {
      this.settled = true;
      this.resolve(true);
      this.close();
    });
  }

  onClose(): void {
    // 用户通过 ESC / × 关闭视为取消；按钮点击后 settled=true 跳过
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
    this.contentEl.empty();
  }
}
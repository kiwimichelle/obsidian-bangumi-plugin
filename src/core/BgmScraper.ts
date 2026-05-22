import { requestUrl } from 'obsidian';
import type { InfoboxEntry } from '../types';
import { BGM_UA, BGM_WEB_BASE } from '../constants';

// ─────────────────────────────────────────────
// 配置常量
// ─────────────────────────────────────────────

/** 抓取网页超时（ms）。补全任务次要，给得比 API 更短 */
const SCRAPE_TIMEOUT_MS = 10_000;

/**
 * 同一实例相邻两次请求之间的最短间隔（ms）。
 * 防止短时间高频抓取触发 bgm.tv 反爬封禁。
 * 与 OnlineFetcher 不共享配额：网页主站和 API 走不同子域、不同限流桶。
 */
const MIN_REQUEST_INTERVAL_MS = 1_000;

// ─────────────────────────────────────────────
// BgmScraper
// ─────────────────────────────────────────────

/**
 * bgm.tv 网页侧边栏补全器
 *
 * 定位（设计决策 #5）：
 * - 仅作为 API 字段缺失时的**可选补全**，不在四级级联查询主路径上
 *   典型场景：API 没返回 `platform`、制作公司、发行商等冷门字段时回填
 * - 失败（网络 / 超时 / 反爬 / 解析）一律静默返回 `[]`，绝不抛错
 * - 独立模块，bgm.tv 站点结构改版时只需维护此文件，不波及其它模块
 *
 * 输出格式与 `WikiParser` / `DataAdapter` 对齐为 `InfoboxEntry[]`，
 * 调用方（DataManager）合并到已有 `SubjectData.infobox` 时只补"键不存在"的项，
 * 不覆盖已有值（合并策略由调用方决定，本模块只产出增量数据）。
 */
export class BgmScraper {
  private lastRequestAt = 0;

  /**
   * 抓取条目网页（`/subject/:id`），解析侧边栏 `#infobox`。
   *
   * - 命中 → 返回 `InfoboxEntry[]`
   * - 网络失败 / HTTP 非 200 / 无 `#infobox` 节点 / DOM 解析异常 → 返回 `[]`
   * - 不抛错：补全任务次要，绝不打断主流程
   */
  async scrapeInfobox(id: number): Promise<InfoboxEntry[]> {
    const html = await this.fetchHtml(id);
    if (!html) return [];
    return parseInfoboxHtml(html);
  }

  // ─────────────────────────────────────────────
  // 内部：HTTP 层
  // ─────────────────────────────────────────────

  private async fetchHtml(id: number): Promise<string | null> {
    await this.throttle();

    const url = `${BGM_WEB_BASE}/subject/${id}`;
    try {
      const resp = await withTimeout(
        requestUrl({
          url,
          method: 'GET',
          headers: {
            'User-Agent': BGM_UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8',
          },
          throw: false,
        }),
        SCRAPE_TIMEOUT_MS,
      );

      if (resp.status !== 200) return null;
      return resp.text;
    } catch (err) {
      console.warn(`[bangumi] 网页补全请求失败 #${id}`, err);
      return null;
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await delay(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = Date.now();
  }
}

// ─────────────────────────────────────────────
// HTML 解析（文件内私有函数，方便单测时直接 mock 字符串）
// ─────────────────────────────────────────────

/**
 * 从条目网页 HTML 中提取侧边栏 infobox。
 *
 * bgm.tv 典型 DOM 结构：
 * ```html
 * <ul id="infobox">
 *   <li><span class="tip">导演: </span>斎藤圭一郎</li>
 *   <li><span class="tip">原作: </span><a href="...">山田鐘人</a></li>
 *   <li><span class="tip">制作: </span><a href="...">公司A</a>、<a href="...">公司B</a></li>
 * </ul>
 * ```
 *
 * 提取策略：
 * - 键 = `span.tip` 的 textContent（剥离结尾冒号）
 * - 值 = `li.textContent` 去掉 tipText 前缀后的剩余文本
 *
 * 整体外层 try/catch 兜底；每个 li 独立 try/catch，单条失败不影响其它条目。
 */
function parseInfoboxHtml(html: string): InfoboxEntry[] {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const infoboxEl = doc.querySelector('#infobox');
    if (!infoboxEl) return [];

    const entries: InfoboxEntry[] = [];
    const items = infoboxEl.querySelectorAll('li');

    items.forEach(li => {
      try {
        const keyEl = li.querySelector('span.tip');
        if (!keyEl) return;

        const tipText = keyEl.textContent ?? '';
        const key = tipText.trim().replace(/[：:]\s*$/, '');
        if (!key) return;

        // li.textContent 必然以 tipText 开头，slice 后即为值
        const fullText = li.textContent ?? '';
        const value = normalizeValue(fullText.slice(tipText.length));
        if (!value) return;

        entries.push({ key, value });
      } catch {
        // 单个 li 解析失败：跳过即可，不污染整体结果
      }
    });

    return entries;
  } catch (err) {
    console.warn('[bangumi] 网页 infobox 解析异常', err);
    return [];
  }
}

/**
 * 清洗 infobox 值文本：
 * - 折叠连续空白为单个空格
 * - 去前后空白
 */
function normalizeValue(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`scrape timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

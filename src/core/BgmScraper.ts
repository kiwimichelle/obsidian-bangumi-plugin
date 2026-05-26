import { requestUrl } from 'obsidian';
import type { InfoboxEntry } from '../types';
import { BGM_UA, BGM_WEB_BASE } from '../constants';

const SCRAPE_TIMEOUT_MS      = 10_000;
const MIN_REQUEST_INTERVAL_MS = 1_000;

/**
 * bgm.tv 网页侧边栏补全器
 *
 * 修复：节流改用串行队列而非简单时间戳比较。
 * 原实现中多个 scheduleEnrich 并发触发时，所有协程会同时通过节流检查，
 * 导致并发请求。现改为：所有请求排入同一个 Promise 队列串行执行，
 * 相邻请求之间强制等待 MIN_REQUEST_INTERVAL_MS。
 */
export class BgmScraper {
  /** 串行化队列：所有请求追加在此 Promise 之后 */
  private queue: Promise<void> = Promise.resolve();

  async scrapeInfobox(id: number): Promise<InfoboxEntry[]> {
    // 将本次请求追加到队列末尾，保证串行执行
    return new Promise<InfoboxEntry[]>((resolve) => {
      this.queue = this.queue.then(async () => {
        const result = await this.fetchAndParse(id);
        resolve(result);
        // 每次请求后等待最小间隔，保护下一次请求
        await delay(MIN_REQUEST_INTERVAL_MS);
      }).catch(() => {
        resolve([]);
      });
    });
  }

  private async fetchAndParse(id: number): Promise<InfoboxEntry[]> {
    const html = await this.fetchHtml(id);
    if (!html) return [];
    return parseInfoboxHtml(html);
  }

  private async fetchHtml(id: number): Promise<string | null> {
    const url = `${BGM_WEB_BASE}/subject/${id}`;
    try {
      const resp = await withTimeout(
        requestUrl({
          url,
          method:  'GET',
          headers: {
            'User-Agent':      BGM_UA,
            Accept:            'text/html,application/xhtml+xml',
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
}

// ─────────────────────────────────────────────
// HTML 解析
// ─────────────────────────────────────────────

function parseInfoboxHtml(html: string): InfoboxEntry[] {
  try {
    const doc        = new DOMParser().parseFromString(html, 'text/html');
    const infoboxEl  = doc.querySelector('#infobox');
    if (!infoboxEl) return [];

    const entries: InfoboxEntry[] = [];
    const items = infoboxEl.querySelectorAll('li');

    items.forEach(li => {
      try {
        const keyEl = li.querySelector('span.tip');
        if (!keyEl) return;

        const tipText = keyEl.textContent ?? '';
        const key     = tipText.trim().replace(/[：:]\s*$/, '');
        if (!key) return;

        const fullText = li.textContent ?? '';
        const value    = normalizeValue(fullText.slice(tipText.length));
        if (!value) return;

        entries.push({ key, value });
      } catch {
        // 单个 li 解析失败：跳过
      }
    });

    return entries;
  } catch (err) {
    console.warn('[bangumi] 网页 infobox 解析异常', err);
    return [];
  }
}

function normalizeValue(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

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
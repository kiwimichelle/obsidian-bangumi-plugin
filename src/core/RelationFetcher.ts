import type { SubjectData } from '../types';
import type { OnlineFetcher } from './OnlineFetcher';
import { FetchError } from './OnlineFetcher';

/**
 * 关联条目异步补全器
 *
 * 设计决策 #2：离线数据源（`source='archive'`）不含 relations，
 * `SubjectData.relationsLoaded=false`。本模块检测该标志，
 * 在合适时机（典型为笔记已渲染、用户已能看见结果之后）
 * 异步调 OnlineFetcher 拉取 `/v0/subjects/:id/subjects` 写回原 data。
 *
 * 红线：
 * - **不阻塞调用者**：调用方可 fire-and-forget（不 await），失败也不影响主流程
 * - **失败保持 relationsLoaded=false**：不能因为请求失败就错误地置 true，
 *   否则下次再也不会重试
 * - **共享 OnlineFetcher 的 API 配额**：复用其内部的超时/重试/限流处理，
 *   不在本模块再加一层节流，避免请求叠加打满 bgm.tv 的速率上限
 *
 * 反哺到 user_added.json 的时机由 DataManager 编排，本模块只直接 mutate
 * 传入的 `SubjectData` —— 调用方持有同一引用，写回与缓存编排两不耽误。
 */
export class RelationFetcher {
  constructor(private readonly fetcher: OnlineFetcher) {}

  /**
   * 是否需要补全关联条目。
   * 仅在 `relationsLoaded=false` 时才返回 true。
   * 调用方据此决定是否触发 `enrich`，避免无用 API 调用。
   */
  needsEnrich(data: SubjectData): boolean {
    return !data.relationsLoaded;
  }

  /**
   * 补全关联条目（直接 mutate 传入对象）。
   *
   * - 已加载（`relationsLoaded=true`）→ 立即返回，不发请求
   * - 请求成功 → 写入 `data.relations`，置 `data.relationsLoaded=true`
   * - 请求失败 → 保持 `relationsLoaded=false`，吞掉错误（仅 console.warn），
   *   留待下次重试；调用方无需 try/catch
   *
   * 返回值：是否成功补全。供 DataManager 判断要不要反哺缓存。
   */
  async enrich(data: SubjectData): Promise<boolean> {
    if (data.relationsLoaded) return false;

    try {
      const relations = await this.fetcher.fetchRelations(data.id);
      data.relations = relations;
      data.relationsLoaded = true;
      return true;
    } catch (err) {
      // 失败保持 relationsLoaded=false，留待下次触发时重试
      // 网络层错误降级到 debug 级别，避免在离线场景下刷屏
      const isNetwork = err instanceof FetchError && err.isNetworkError;
      const log = isNetwork ? console.debug : console.warn;
      log(`[bangumi] #${data.id} 关联条目补全失败，保持未加载状态`, err);
      return false;
    }
  }
}

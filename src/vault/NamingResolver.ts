import { App, TFile } from 'obsidian';
import type { BangumiSettings, NamingResult, SubjectData } from '../types';
import { SUBJECT_TYPE_LABEL, TYPE_KEYS } from '../constants';
import { parseYearSeason } from '../note/NoteBuilder';

// Obsidian 在 Windows/macOS/Linux 上均不允许文件名包含这些字符
const ILLEGAL_CHARS = /[\\/:*?"<>|#]/g;

function sanitize(name: string): string {
  return name.replace(ILLEGAL_CHARS, '').trim();
}

export class NamingResolver {
  constructor(
    private readonly app: App,
    private readonly settings: BangumiSettings
  ) {}

  /**
   * 根据 SubjectData 生成最终笔记文件名，并检测同名冲突。
   * 返回值中 conflict='none' 时，existingPath 非空表示同 ID 更新场景。
   */
  resolve(data: SubjectData): NamingResult {
    const baseName   = sanitize(data.name || data.nameOriginal);
    const { typeKey } = data;
    const archiveRoot = this.settings.subjectTypes[typeKey].archiveRoot;
    const typeLabel   = SUBJECT_TYPE_LABEL[typeKey];

    // ── 1. 跨媒介防撞 ───────────────────────────────────────────
    for (const key of TYPE_KEYS) {
      if (key === typeKey) continue;
      const otherRoot = this.settings.subjectTypes[key].archiveRoot;
      const hit = this.app.vault.getAbstractFileByPath(`${otherRoot}/${baseName}.md`);
      if (hit instanceof TFile) {
        return {
          filename:     `${baseName} (${typeLabel})`,
          existingPath: hit.path,
          conflict:     'other',
        };
      }
    }

    // ── 2. 同类防撞 ─────────────────────────────────────────────
    const existing = this.app.vault.getAbstractFileByPath(`${archiveRoot}/${baseName}.md`);
    if (!(existing instanceof TFile)) {
      return { filename: baseName, existingPath: '', conflict: 'none' };
    }

    const cached     = this.app.metadataCache.getFileCache(existing);
    const existingId = cached?.frontmatter?.['bangumi_id'] as number | undefined;

    if (existingId === data.id) {
      // 同 ID → 更新场景，文件名不变，existingPath 供调用方定位旧文件
      return { filename: baseName, existingPath: existing.path, conflict: 'none' };
    }

    // 不同 ID → 在文件名后补年份消歧
    const { year } = parseYearSeason(data.date);
    return {
      filename:     `${baseName} (${year})`,
      existingPath: existing.path,
      conflict:     'same',
    };
  }
}

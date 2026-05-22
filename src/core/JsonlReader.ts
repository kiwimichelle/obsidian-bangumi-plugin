import * as fs from 'fs';
import * as readline from 'readline';

import type { RawArchiveSubject } from '../types';

/**
 * JSONL 跳读器
 *
 * 职责：
 * - 配合 IndexBuilder.getLine(id) 拿到的行号，在 bangumi.jsonl 上精确读取单行
 * - 用 Node fs.createReadStream + readline 流式读；读到目标行立即 stream.destroy()
 * - 返回 RawArchiveSubject，由下游 DataAdapter.fromArchive() 转成 SubjectData
 *
 * 性能约束：
 * - 禁用所有 *Sync IO
 * - 读完目标行立即销毁流，绝不整文件 parse
 */
export class JsonlReader {
  /**
   * 读取 jsonlPath 中第 lineNum 行（0-indexed）。
   *
   * - 行号越界（文件比索引短）→ null
   * - 目标行为空或 JSON 损坏 → null
   *
   * 找到目标行后立即销毁流，后续内容不再读取。
   */
  async readLine(jsonlPath: string, lineNum: number): Promise<RawArchiveSubject | null> {
    if (!Number.isFinite(lineNum) || lineNum < 0) return null;

    return new Promise<RawArchiveSubject | null>((resolve) => {
      let currentLine = 0;
      let resolved = false;

      const done = (result: RawArchiveSubject | null) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        if (resolved) return;
        if (currentLine === lineNum) {
          const trimmed = line.trim();
          try {
            done(trimmed ? (JSON.parse(trimmed) as RawArchiveSubject) : null);
          } catch {
            done(null);
          }
          rl.close();
          stream.destroy();
        }
        currentLine++;
      });

      rl.on('close', () => done(null));
      stream.on('error', () => done(null));
    });
  }

  /**
   * 批量读取多行（0-indexed 行号），单次流扫描完成所有目标。
   *
   * - 找到全部目标行后立即销毁流
   * - 越界或 JSON 损坏的行返回 null
   * - 返回顺序与传入 lineNums 一致
   */
  async readLines(
    jsonlPath: string,
    lineNums: number[],
  ): Promise<(RawArchiveSubject | null)[]> {
    if (lineNums.length === 0) return [];

    const validNums = lineNums.filter((n) => Number.isFinite(n) && n >= 0);
    if (validNums.length === 0) return lineNums.map(() => null);

    const sortedTargets = [...new Set(validNums)].sort((a, b) => a - b);
    const resultMap = new Map<number, RawArchiveSubject | null>();

    await new Promise<void>((resolve) => {
      let currentLine = 0;
      let targetIdx = 0;

      const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        if (targetIdx >= sortedTargets.length) return;

        if (currentLine === sortedTargets[targetIdx]) {
          const trimmed = line.trim();
          let result: RawArchiveSubject | null = null;
          if (trimmed) {
            try {
              result = JSON.parse(trimmed) as RawArchiveSubject;
            } catch { /* null */ }
          }
          resultMap.set(currentLine, result);

          // advance past all targets at this line number (deduplicated but sorted)
          while (targetIdx < sortedTargets.length && sortedTargets[targetIdx] === currentLine) {
            targetIdx++;
          }

          if (targetIdx >= sortedTargets.length) {
            rl.close();
            stream.destroy();
          }
        }

        currentLine++;
      });

      rl.on('close', () => resolve());
      stream.on('error', () => resolve());
    });

    return lineNums.map((n) => resultMap.get(n) ?? null);
  }
}

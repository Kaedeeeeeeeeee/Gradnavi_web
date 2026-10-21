// 文书版本历史（纯函数）。
// 不是每次保存都存一版，而是按「一轮编辑」合并：停手 30 分钟、一轮 AI 审阅处理完、导出 PDF / 复制套磁信时各存一版。
// 两版之间做过的事记在 pendingChanges 里（如「编辑了「研究方法」」「接受 AI 修改：改写研究背景」），存版时合成一句说明，不额外调 AI。

import DiffMatchPatch from "diff-match-patch";
import { sectionBodies } from "./documents";

export const IDLE_MS = 30 * 60 * 1000;

export type VersionTrigger = "idle" | "review" | "export" | "copy" | "manual" | "restore" | "tailor" | "outline";

export const VERSION_TRIGGER_LABELS: Record<VersionTrigger, string> = {
  idle: "自动保存",
  review: "审阅改完",
  export: "导出 PDF",
  copy: "复制套磁信",
  manual: "手动保存",
  restore: "恢复",
  tailor: "复制定制版",
  outline: "确定提纲",
};

export type DiffPart = [op: -1 | 0 | 1, text: string];

/** 文字差异（按字比较后做语义合并，日文、中文也能读） */
export function diffText(before: string, after: string): DiffPart[] {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => [op as -1 | 0 | 1, text]);
}

export function diffStats(parts: DiffPart[]) {
  let added = 0;
  let removed = 0;
  for (const [op, text] of parts) {
    if (op === 1) added += text.length;
    if (op === -1) removed += text.length;
  }
  return { added, removed };
}

/** 用户自己编辑了哪些节 → 一句记录；没变化时返回 null */
export function describeEdit(before: string, after: string, actor = "编辑了"): string | null {
  if (before.trim() === after.trim()) return null;
  const a = sectionBodies(before);
  const b = sectionBodies(after);
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((h) => (a.get(h) ?? null) !== (b.get(h) ?? null));
  if (!changed.length) return `${actor}正文`;
  const names = changed.slice(0, 3).map((h) => `「${h}」`).join("");
  return `${actor}${names}${changed.length > 3 ? `等 ${changed.length} 节` : ""}`;
}

/** 追加一条记录（连续重复的不记） */
export function pushChange(log: string[], entry: string | null): string[] {
  if (!entry) return log;
  if (log.at(-1) === entry) return log;
  return [...log, entry].slice(-30);
}

/** 把两版之间的记录合成一句版本说明 */
export function summarizeChanges(log: string[], fallback = "编辑"): string {
  const unique = [...new Set(log)];
  if (!unique.length) return fallback;
  const text = unique.join("；");
  return text.length > 80 ? `${text.slice(0, 78)}…` : text;
}

/** 距离上次编辑已经停手够久：上一轮编辑该存成一版了 */
export function idleRoundEnded(lastEditedAt: Date | null, now: Date, pending: string[]): boolean {
  return pending.length > 0 && !!lastEditedAt && now.getTime() - lastEditedAt.getTime() >= IDLE_MS;
}

// AI 对文书的修改建议（纯函数）。AI 不直接改正文：每次修改存成一条建议，用户在编辑器里接受后才写进去。

import { replaceTextOnce } from "./documents";
import { upsertSection } from "./md-sections";
import { sectionBodies } from "./documents";

export type DocOp =
  /** 把一段原文换成新文本。nth：原文出现多次时替换第几处（从 0 起，选区菜单用） */
  | { type: "replace"; find: string; replace: string; nth?: number }
  /** 写一节（“## 标题”），replace 替换整节正文，append 追加 */
  | { type: "section"; heading: string; content: string; mode: "replace" | "append" }
  /** 整篇替换 */
  | { type: "full"; markdown: string };

export type SuggestionSource = "chat" | "selection" | "comment";
export type SuggestionStatus = "pending" | "accepted" | "rejected";

export const SUGGESTION_SOURCE_LABELS: Record<SuggestionSource, string> = {
  chat: "AI 对话",
  selection: "选中改写",
  comment: "按批注修改",
};

/** 替换第 nth 处 find（nth 省略时要求唯一） */
export function replaceNth(md: string, find: string, replace: string, nth?: number): string {
  if (nth === undefined) return replaceTextOnce(md, find, replace);
  if (!find) throw new Error("原文片段不能为空");
  let at = -1;
  for (let i = 0; i <= nth; i++) {
    at = md.indexOf(find, at + 1);
    if (at === -1) throw new Error("文档里找不到这段原文（可能已经改过了）");
  }
  return md.slice(0, at) + replace + md.slice(at + find.length);
}

export function applyOp(md: string, op: DocOp): string {
  switch (op.type) {
    case "replace":
      return replaceNth(md, op.find, op.replace, op.nth);
    case "section":
      return upsertSection(md, op.heading, op.content, op.mode);
    case "full":
      return op.markdown.endsWith("\n") ? op.markdown : `${op.markdown}\n`;
  }
}

/** 建议里 AI 新写的日文（中文对照对应的就是这部分） */
export function opNewText(op: DocOp): string {
  return op.type === "replace" ? op.replace : op.type === "section" ? op.content : op.markdown;
}

/** 修改前后的对照文本，用于在建议卡片上显示差异 */
export function opBeforeAfter(md: string, op: DocOp): { before: string; after: string; where: string | null } {
  if (op.type === "replace") return { before: op.find, after: op.replace, where: null };
  if (op.type === "full") return { before: md.trim(), after: op.markdown.trim(), where: "全文" };
  const old = sectionBodies(md).get(op.heading.trim()) ?? "";
  const after = op.mode === "append" && old ? `${old}\n\n${op.content.trim()}` : op.content.trim();
  return { before: old, after, where: op.heading.trim() };
}

/** 这条修改落在哪一节（用于版本说明），找不到时为 null */
export function opSection(md: string, op: DocOp): string | null {
  if (op.type === "section") return op.heading.trim();
  if (op.type === "full") return null;
  const at = md.indexOf(op.find);
  if (at === -1) return null;
  const heading = [...md.slice(0, at).matchAll(/^##\s+(.+?)\s*$/gm)].at(-1);
  return heading?.[1] ?? null;
}

/** 能不能应用到当前正文（原文已被改掉时不能） */
export function canApply(md: string, op: DocOp): boolean {
  try {
    applyOp(md, op);
    return true;
  } catch {
    return false;
  }
}

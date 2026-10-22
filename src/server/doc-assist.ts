import "server-only";
import { generateText } from "ai";
import { getChatModel, isDemoMode } from "@/lib/ai/model";
import { UsageMeter } from "@/lib/credits";
import {
  applyCommentPrompt,
  demoApplyComment,
  demoReview,
  demoSelection,
  demoTranslation,
  demoWrite,
  isRewrite,
  MAX_TRANSLATE_BLOCKS,
  parseApplyComment,
  parseReview,
  parseRewrite,
  parseTranslations,
  reviewPrompt,
  selectionPrompt,
  SELECTION_ACTION_LABELS,
  translatePrompt,
  type SelectionAction,
  writePrompt,
} from "@/lib/doc-assist";
import { alignZh, blockKey, isHeadingBlock, splitBlocks, withZh } from "@/lib/doc-zh";
import { assertCanSpend, recordUsageSafe } from "./credits";
import { addReviewComments, createSuggestion, getComment, getDocument, setCommentStatus, updateDocument } from "./documents";

// 编辑器里的一次性 AI 操作（不进聊天，结果直接落在编辑器里）。每次按用量扣 credit；演示模式用固定结果。

async function run(userId: string, refId: string, prompt: string) {
  await assertCanSpend(userId);
  const meter = new UsageMeter();
  try {
    const { text, totalUsage } = await generateText({ model: getChatModel(), prompt });
    meter.addTokens(totalUsage);
    return text;
  } finally {
    await recordUsageSafe({ userId, feature: "doc_assist", meter, refId });
  }
}

async function docOrThrow(userId: string, id: string) {
  const doc = await getDocument(userId, id);
  if (!doc) throw new Error("找不到这份文书");
  return doc;
}

export type SelectionResult = { kind: "suggestion"; id: string } | { kind: "text"; text: string };

/** 选中文字后的小菜单。改写类生成修改建议（nth：选中的是原文里第几处相同文字），解释/翻译只返回文字 */
export async function assistSelection(userId: string, id: string, action: SelectionAction, text: string, nth: number, instruction = ""): Promise<SelectionResult> {
  const doc = await docOrThrow(userId, id);
  let result: { ja: string; zh: string } | string;
  if (isDemoMode()) result = demoSelection(action, text);
  else {
    const reply = await run(userId, id, selectionPrompt(action, text, doc.title, doc.markdown, instruction));
    result = isRewrite(action) ? parseRewrite(reply) : reply.trim();
  }
  if (typeof result === "string") return { kind: "text", text: result };
  try {
    const s = await createSuggestion(userId, id, {
      op: { type: "replace", find: text, replace: result.ja, nth },
      zh: [result.zh],
      summary: action === "custom" ? instruction.slice(0, 60) : SELECTION_ACTION_LABELS[action],
      source: "selection",
    });
    return { kind: "suggestion", id: s.id };
  } catch {
    throw new Error("选中的内容带格式（如加粗、列表），没法直接定位。可以在右边对话里让 AI 改这段。");
  }
}

/** 光标处让 AI 写一段：只返回文字，用户在编辑器里看过后点「插入」才写进正文 */
export async function writeAtCursor(userId: string, id: string, p: { instruction: string; before: string; after: string; heading: string }) {
  const doc = await docOrThrow(userId, id);
  if (isDemoMode()) return demoWrite(p.instruction);
  return parseRewrite(await run(userId, id, writePrompt(p, doc.title)));
}

/** 重新翻译中文对照里缺失或「待更新」的段落（keys 指定只翻这几段） */
export async function translateParagraphs(userId: string, id: string, keys?: string[]) {
  const doc = await docOrThrow(userId, id);
  const blocks = splitBlocks(doc.markdown).filter((b) => !isHeadingBlock(b) && blockKey(b));
  const cells = alignZh(blocks.map(blockKey), doc.zh);
  const todo = blocks
    .filter((b, i) => (!cells[i] || cells[i]!.stale) && (!keys || keys.includes(blockKey(b))))
    .slice(0, MAX_TRANSLATE_BLOCKS);
  if (!todo.length) return 0;
  const zh = isDemoMode() ? todo.map(demoTranslation) : parseTranslations(await run(userId, id, translatePrompt(todo)), todo.length);
  const fresh = todo.map((b, i) => ({ key: blockKey(b), zh: zh[i] }));
  const result = await updateDocument(userId, id, { zh: withZh(doc.markdown, doc.zh, fresh) }, doc.version);
  if (!result.ok) throw new Error("文书刚被修改过，请再点一次");
  return todo.length;
}

/** 让 AI 当教授审一遍：只写页边批注，不改原文。定制版按对应教授的视角审 */
export async function reviewAsProfessor(userId: string, id: string) {
  const doc = await docOrThrow(userId, id);
  if (!doc.markdown.trim()) throw new Error("文书还是空的，写一些内容再让 AI 审阅");
  const comments = isDemoMode() ? demoReview(doc.markdown) : parseReview(await run(userId, id, reviewPrompt(doc.title, doc.markdown, doc.targetProfessor)));
  return addReviewComments(userId, id, comments);
}

/** 按这条批注改：生成一条修改建议，用户接受或拒绝 */
export async function applyComment(userId: string, id: string, commentId: string) {
  const doc = await docOrThrow(userId, id);
  const c = await getComment(userId, id, commentId);
  const edit = isDemoMode() ? demoApplyComment(c.quote) : parseApplyComment(await run(userId, id, applyCommentPrompt(doc.title, doc.markdown, c)));
  try {
    const s = await createSuggestion(userId, id, {
      op: { type: "replace", find: edit.find, replace: edit.replace },
      zh: edit.zh,
      summary: edit.summary,
      source: "comment",
      commentId,
    });
    await setCommentStatus(userId, id, commentId, "suggested");
    return s;
  } catch {
    throw new Error("AI 没能在原文里定位要改的地方，可以在右边对话里让 AI 按这条批注改。");
  }
}

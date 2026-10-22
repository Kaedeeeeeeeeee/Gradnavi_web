"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { docTemplate, MAX_DOC_LENGTH } from "@/lib/documents";
import { requireUser } from "@/lib/session";
import {
  acceptSuggestion,
  approveOutline,
  createDocument,
  createTailoredCopy,
  deleteDocument,
  reorderDocuments,
  restoreDocument,
  getDocument,
  listPendingSuggestions,
  listVersions,
  rejectSuggestion,
  renameVersion,
  restoreVersion,
  setAttachment,
  setCommentStatus,
  setWriteMode,
  settleIdleRound,
  snapshotVersion,
  updateDocument,
} from "@/server/documents";
import { applyComment, assistSelection, reviewAsProfessor, translateParagraphs, type SelectionResult } from "@/server/doc-assist";
import { SELECTION_ACTIONS } from "@/lib/doc-assist";
import { professorToTarget } from "@/lib/professors";
import { answerField } from "@/lib/onboarding";
import { getProfile } from "@/server/profile";
import { getSavedProfessor, updateSavedProfessor } from "@/server/professors";

// 文书页面上的用户操作。与 AI 工具调用同一套 src/server/documents 函数。
// 编辑器在三栏外壳的文稿栏里（由 layout 渲染），改完要刷新整个外壳，所以 revalidate 根 layout。

const kindSchema = z.enum(["plan", "letter", "intro", "other"]);
const fieldSchema = z.enum(["humanities", "sciences"]);

export async function createDocumentAction(kind: string, field?: string) {
  const user = await requireUser();
  const k = kindSchema.parse(kind);
  const f = fieldSchema.optional().parse(field) ?? answerField((await getProfile(user.id))?.onboarding);
  const template = docTemplate(k, f);
  const doc = await createDocument(user.id, { kind: k, ...template });
  redirect(`/documents/${doc.id}`);
}

/** 保存正文。版本对不上（AI 刚改过）时不覆盖，返回最新内容让用户决定 */
export async function saveDocumentAction(id: string, markdown: string, baseVersion: number) {
  const user = await requireUser();
  const md = z.string().max(MAX_DOC_LENGTH).parse(markdown);
  const result = await updateDocument(user.id, id, { markdown: md }, baseVersion);
  return { ok: result.ok, version: result.doc.version, markdown: result.doc.markdown };
}

export async function renameDocumentAction(id: string, title: string) {
  const user = await requireUser();
  await updateDocument(user.id, id, { title: z.string().max(100).parse(title) });
  revalidatePath("/", "layout");
}

const professorSchema = z.object({
  name: z.string().trim().max(100),
  affiliation: z.string().trim().max(200),
  research: z.string().trim().max(3000),
});

export async function setTargetProfessorAction(id: string, input: z.infer<typeof professorSchema>) {
  const user = await requireUser();
  const p = professorSchema.parse(input);
  const targetProfessor = p.name ? { name: p.name, affiliation: p.affiliation || undefined, research: p.research || undefined } : null;
  await updateDocument(user.id, id, { targetProfessor });
  revalidatePath("/", "layout");
}

/** 从教授清单选目标教授 */
export async function linkProfessorAction(id: string, professorId: string) {
  const user = await requireUser();
  const p = await getSavedProfessor(user.id, professorId);
  if (!p) throw new Error("教授清单里没有这位教授");
  await updateDocument(user.id, id, { targetProfessor: professorToTarget(p) });
  revalidatePath("/", "layout");
}

/** 套磁信发出后，把关联教授的联系状态改成“已发信” */
export async function markLetterSentAction(id: string, professorId: string) {
  const user = await requireUser();
  await updateSavedProfessor(user.id, professorId, { status: "contacted" });
  revalidatePath("/", "layout");
}

export async function deleteDocumentAction(id: string) {
  const user = await requireUser();
  await deleteDocument(user.id, id);
  revalidatePath("/", "layout");
}

/** 撤销删除 */
export async function restoreDocumentAction(id: string) {
  const user = await requireUser();
  await restoreDocument(user.id, id);
  revalidatePath("/", "layout");
}

/** 文书列表拖动排序后保存顺序 */
export async function reorderDocumentsAction(ids: string[]) {
  const user = await requireUser();
  await reorderDocuments(user.id, z.array(z.string().max(100)).max(500).parse(ids));
  revalidatePath("/", "layout");
}

// ---------- AI 修改建议、批注、中文对照、版本历史（文书改版） ----------

type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

/** AI 相关的操作失败时把原因带回编辑器显示（生产环境 server action 抛出的错误信息会被隐藏） */
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    console.error("[documents]", error);
    return { ok: false, error: error instanceof Error ? error.message : "操作失败，请稍后再试" };
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function acceptSuggestionAction(suggestionId: string) {
  const user = await requireUser();
  return attempt(() => acceptSuggestion(user.id, suggestionId));
}

export async function rejectSuggestionAction(suggestionId: string) {
  const user = await requireUser();
  return attempt(() => rejectSuggestion(user.id, suggestionId));
}

/** 全部接受：按出现顺序逐条应用，前一条改掉了后一条的原文时，后一条留下给用户看 */
export async function acceptAllSuggestionsAction(docId: string) {
  const user = await requireUser();
  return attempt(async () => {
    if (!(await getDocument(user.id, docId))) throw new Error("找不到这份文书");
    let failed = 0;
    for (const s of await listPendingSuggestions(docId)) {
      try {
        await acceptSuggestion(user.id, s.id);
      } catch {
        failed++;
      }
    }
    return failed;
  });
}

const selectionSchema = z.object({ action: z.enum(SELECTION_ACTIONS), text: z.string().trim().min(1).max(5000), nth: z.number().int().min(0).max(1000) });

export async function assistSelectionAction(docId: string, input: z.infer<typeof selectionSchema>) {
  const user = await requireUser();
  const p = selectionSchema.parse(input);
  return attempt<SelectionResult>(() => assistSelection(user.id, docId, p.action, p.text, p.nth));
}

export async function translateAction(docId: string, keys?: string[]) {
  const user = await requireUser();
  return attempt(() => translateParagraphs(user.id, docId, keys && z.array(z.string().max(20000)).max(100).parse(keys)));
}

export async function reviewAction(docId: string) {
  const user = await requireUser();
  return attempt(async () => (await reviewAsProfessor(user.id, docId)).length);
}

export async function applyCommentAction(docId: string, commentId: string) {
  const user = await requireUser();
  return attempt(async () => (await applyComment(user.id, docId, commentId)).id);
}

export async function ignoreCommentAction(docId: string, commentId: string) {
  const user = await requireUser();
  return attempt(() => setCommentStatus(user.id, docId, commentId, "ignored"));
}

export async function approveOutlineAction(docId: string) {
  const user = await requireUser();
  return attempt(async () => void (await approveOutline(user.id, docId)));
}

export async function setWriteModeAction(docId: string, mode: "together" | "self" | null) {
  const user = await requireUser();
  return attempt(async () => void (await setWriteMode(user.id, docId, mode)));
}

export async function listVersionsAction(docId: string) {
  const user = await requireUser();
  await settleIdleRound(user.id, docId);
  const rows = await listVersions(user.id, docId);
  return rows.map((v) => ({
    number: v.number,
    markdown: v.markdown,
    zh: v.zh,
    summary: v.summary,
    name: v.name,
    trigger: v.trigger,
    createdAt: v.createdAt.toISOString(),
  }));
}

/** 手动存一版（可命名）；导出 PDF、复制套磁信时也存一版 */
export async function snapshotAction(docId: string, trigger: "manual" | "copy" | "export", name?: string) {
  const user = await requireUser();
  return attempt(async () => (await snapshotVersion(user.id, docId, trigger, { name: z.string().trim().max(60).optional().parse(name) || undefined })).number);
}

export async function renameVersionAction(docId: string, number: number, name: string) {
  const user = await requireUser();
  return attempt(() => renameVersion(user.id, docId, z.number().int().parse(number), z.string().max(60).parse(name)));
}

export async function restoreVersionAction(docId: string, number: number) {
  const user = await requireUser();
  return attempt(async () => (await restoreVersion(user.id, docId, z.number().int().parse(number))).version);
}

/** 给一位教授复制定制版计划书，返回新文书（编辑器在文稿栏打开它） */
export async function createTailoredCopyAction(docId: string, professorId: string) {
  const user = await requireUser();
  return attempt(async () => {
    const copy = await createTailoredCopy(user.id, docId, professorId);
    return { id: copy.id, title: copy.title };
  });
}

export async function setAttachmentAction(letterId: string, planId: string | null) {
  const user = await requireUser();
  return attempt(async () => void (await setAttachment(user.id, letterId, planId)));
}

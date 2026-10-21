import "server-only";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { document, documentComment, documentSuggestion, documentVersion } from "@/db/schema";
import { applyOp, canApply, opNewText, opSection, type DocOp, type SuggestionSource } from "@/lib/doc-ops";
import { describeEdit, idleRoundEnded, pushChange, summarizeChanges, VERSION_TRIGGER_LABELS, type VersionTrigger } from "@/lib/doc-history";
import { pairZh, realignZh, withZh, type ZhEntry } from "@/lib/doc-zh";
import { isBlankDoc, MAX_DOC_LENGTH, outlineSkeleton, type CommentCategory, type DocKind, type Outline, type TargetProfessor, type WriteMode } from "@/lib/documents";
import { professorToTarget } from "@/lib/professors";
import { getSavedProfessor } from "./professors";

// 文书的读写。编辑器页面（用户）和 AI 工具都走这里。
// AI 不直接改正文：AI 的修改存成修改建议（document_suggestion），用户接受后才写进去。
// 版本历史按「一轮编辑」存（见 src/lib/doc-history.ts）。

export type DocumentRow = typeof document.$inferSelect;
export type SuggestionRow = typeof documentSuggestion.$inferSelect;
export type CommentRow = typeof documentComment.$inferSelect;
export type VersionRow = typeof documentVersion.$inferSelect;

function checkLength(markdown: string) {
  if (markdown.length > MAX_DOC_LENGTH) throw new Error(`文书不能超过 ${MAX_DOC_LENGTH} 字`);
}

export async function listDocuments(userId: string) {
  return db
    .select({
      id: document.id,
      kind: document.kind,
      title: document.title,
      parentId: document.parentId,
      targetProfessor: document.targetProfessor,
      updatedAt: document.updatedAt,
    })
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(desc(document.updatedAt));
}

export async function getDocument(userId: string, id: string): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.userId, userId)));
  return row ?? null;
}

async function getDocumentOrThrow(userId: string, id: string) {
  const doc = await getDocument(userId, id);
  if (!doc) throw new Error("找不到这份文书");
  return doc;
}

export async function createDocument(
  userId: string,
  input: {
    kind: DocKind;
    title: string;
    markdown: string;
    targetProfessor?: TargetProfessor | null;
    zh?: ZhEntry[];
    outline?: Outline | null;
    writeMode?: WriteMode | null;
    parentId?: string | null;
    parentVersion?: number | null;
    attachmentId?: string | null;
  },
) {
  checkLength(input.markdown);
  const [row] = await db
    .insert(document)
    .values({
      id: crypto.randomUUID(),
      userId,
      ...input,
      title: input.title.trim() || "未命名文书",
      targetProfessor: input.targetProfessor ?? null,
    })
    .returning();
  return row;
}

type Patch = Partial<{
  title: string;
  markdown: string;
  targetProfessor: TargetProfessor | null;
  zh: ZhEntry[];
  outline: Outline | null;
  writeMode: WriteMode | null;
  attachmentId: string | null;
}>;

/**
 * 修改文书。传 baseVersion 时做乐观锁：版本已变（例如用户刚接受了 AI 的修改）则返回 conflict，不覆盖。
 * 改正文时顺带：整理中文对照、记下这次改了什么（change 不传时按改动的节自动生成）、
 * 上一轮编辑已经停手 30 分钟的话先把上一轮存成一版。
 */
export async function updateDocument(userId: string, id: string, patch: Patch, baseVersion?: number, change?: string) {
  if (patch.markdown !== undefined) checkLength(patch.markdown);
  if (patch.title !== undefined) patch.title = patch.title.trim() || "未命名文书";
  const current = await getDocumentOrThrow(userId, id);
  if (baseVersion !== undefined && current.version !== baseVersion) return { ok: false as const, doc: current };

  const extra: Partial<DocumentRow> = {};
  if (patch.markdown !== undefined && patch.markdown !== current.markdown) {
    const now = new Date();
    if (idleRoundEnded(current.lastEditedAt, now, current.pendingChanges)) {
      await snapshotVersion(userId, id, "idle");
      current.pendingChanges = [];
    } else if (!current.lastEditedAt && !(await latestVersion(id))) {
      // 第一次改正文：先把原样（模板或 AI 新建的初稿）存成第 1 版，之后的差异才有参照
      await snapshotVersion(userId, id, "idle", { summary: "新建" });
    }
    extra.pendingChanges = pushChange(current.pendingChanges, change ?? describeEdit(current.markdown, patch.markdown));
    extra.lastEditedAt = now;
    if (patch.zh === undefined) extra.zh = realignZh(patch.markdown, current.zh);
  }

  // 版本号是正文的乐观锁：只有正文变了才 +1（改标题、附件、中文对照等不打断正在编辑的人）
  const bump = extra.lastEditedAt !== undefined;
  const [row] = await db
    .update(document)
    .set({ ...patch, ...extra, version: bump ? sql`${document.version} + 1` : current.version, updatedAt: new Date() })
    .where(and(eq(document.id, id), eq(document.userId, userId), eq(document.version, current.version)))
    .returning();
  if (row) return { ok: true as const, doc: row };
  return { ok: false as const, doc: await getDocumentOrThrow(userId, id) };
}

/** 读-改-写。版本冲突（并发修改）时重试一次 */
async function editDocument(userId: string, id: string, edit: (doc: DocumentRow) => Patch, change?: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = await getDocumentOrThrow(userId, id);
    const result = await updateDocument(userId, id, edit(doc), doc.version, change);
    if (result.ok) return result.doc;
  }
  throw new Error("文书正在被同时修改，请稍后再试");
}

export async function deleteDocument(userId: string, id: string) {
  const rows = await db
    .delete(document)
    .where(and(eq(document.id, id), eq(document.userId, userId)))
    .returning({ id: document.id });
  return rows.length > 0;
}

// ---------- 版本历史 ----------

async function latestVersion(documentId: string) {
  const [row] = await db.select().from(documentVersion).where(eq(documentVersion.documentId, documentId)).orderBy(desc(documentVersion.number)).limit(1);
  return row ?? null;
}

/**
 * 把当前正文存成一版。和上一版内容相同时不重复存（手动命名时给上一版起名）。
 * summary 不传时用两版之间的修改记录合成。
 */
export async function snapshotVersion(userId: string, id: string, trigger: VersionTrigger, opts: { name?: string; summary?: string } = {}) {
  const doc = await getDocumentOrThrow(userId, id);
  const last = await latestVersion(id);
  if (last && last.markdown === doc.markdown) {
    if (opts.name && !last.name) {
      const [named] = await db.update(documentVersion).set({ name: opts.name }).where(eq(documentVersion.id, last.id)).returning();
      return named;
    }
    if (!opts.name) {
      // 内容和上一版一样：这期间的修改互相抵消了，记录清掉
      await db.update(document).set({ pendingChanges: [] }).where(eq(document.id, id));
      return last;
    }
  }
  const summary = opts.summary ?? summarizeChanges(doc.pendingChanges, last ? VERSION_TRIGGER_LABELS[trigger] : "第一版");
  const [row] = await db
    .insert(documentVersion)
    .values({
      id: crypto.randomUUID(),
      documentId: id,
      number: (last?.number ?? 0) + 1,
      markdown: doc.markdown,
      zh: doc.zh,
      summary,
      name: opts.name ?? null,
      trigger,
    })
    .onConflictDoNothing()
    .returning();
  await db.update(document).set({ pendingChanges: [] }).where(eq(document.id, id));
  return row ?? (await latestVersion(id))!;
}

/** 打开历史时：上一轮已经停手够久，先补存一版 */
export async function settleIdleRound(userId: string, id: string) {
  const doc = await getDocumentOrThrow(userId, id);
  if (idleRoundEnded(doc.lastEditedAt, new Date(), doc.pendingChanges)) await snapshotVersion(userId, id, "idle");
}

export async function listVersions(userId: string, id: string) {
  await getDocumentOrThrow(userId, id);
  return db.select().from(documentVersion).where(eq(documentVersion.documentId, id)).orderBy(desc(documentVersion.number)).limit(200);
}

export async function renameVersion(userId: string, id: string, number: number, name: string | null) {
  await getDocumentOrThrow(userId, id);
  await db
    .update(documentVersion)
    .set({ name: name?.trim() || null })
    .where(and(eq(documentVersion.documentId, id), eq(documentVersion.number, number)));
}

/** 恢复到某一版：先把当前内容存一版（不丢东西），再写回旧版并记一版「恢复到第 N 版」 */
export async function restoreVersion(userId: string, id: string, number: number) {
  const [v] = await db
    .select()
    .from(documentVersion)
    .where(and(eq(documentVersion.documentId, id), eq(documentVersion.number, number)));
  if (!v) throw new Error("找不到这一版");
  await snapshotVersion(userId, id, "idle");
  const doc = await editDocument(userId, id, () => ({ markdown: v.markdown, zh: v.zh }), `恢复到第 ${number} 版`);
  await snapshotVersion(userId, id, "restore", { summary: `恢复到第 ${number} 版${v.name ? `（${v.name}）` : ""}` });
  return doc;
}

// ---------- AI 修改建议 ----------

export async function createSuggestion(
  userId: string,
  id: string,
  input: { op: DocOp; zh?: string | string[]; summary: string; source: SuggestionSource; commentId?: string },
) {
  const doc = await getDocumentOrThrow(userId, id);
  // 先试一遍，原文对不上时直接报错给 AI / 用户，不留一条接受不了的建议
  const next = applyOp(doc.markdown, input.op);
  checkLength(next);
  const zh = input.zh === undefined ? [] : pairZh(opNewText(input.op), input.zh).map((e) => e.zh);
  const [row] = await db
    .insert(documentSuggestion)
    .values({
      id: crypto.randomUUID(),
      documentId: id,
      op: input.op,
      zh,
      summary: input.summary.trim().slice(0, 200) || "修改",
      source: input.source,
      commentId: input.commentId ?? null,
    })
    .returning();
  return row;
}

export async function listPendingSuggestions(documentId: string) {
  return db
    .select()
    .from(documentSuggestion)
    .where(and(eq(documentSuggestion.documentId, documentId), eq(documentSuggestion.status, "pending")))
    .orderBy(asc(documentSuggestion.createdAt));
}

async function getSuggestionForUser(userId: string, suggestionId: string) {
  const [row] = await db
    .select({ s: documentSuggestion })
    .from(documentSuggestion)
    .innerJoin(document, eq(document.id, documentSuggestion.documentId))
    .where(and(eq(documentSuggestion.id, suggestionId), eq(document.userId, userId)));
  if (!row) throw new Error("找不到这条修改建议");
  return row.s;
}

/** 接受：把修改写进正文，中文对照一起更新 */
export async function acceptSuggestion(userId: string, suggestionId: string) {
  const s = await getSuggestionForUser(userId, suggestionId);
  if (s.status !== "pending") return;
  const doc = await getDocumentOrThrow(userId, s.documentId);
  const where = opSection(doc.markdown, s.op);
  const change = s.source === "comment" ? `按 AI 批注改了${where ? `「${where}」` : "一处"}` : `接受 AI 修改：${s.summary}`;
  await editDocument(
    userId,
    s.documentId,
    (d) => {
      const markdown = applyOp(d.markdown, s.op);
      return { markdown, zh: withZh(markdown, d.zh, pairZh(opNewText(s.op), s.zh)) };
    },
    change,
  );
  await db.update(documentSuggestion).set({ status: "accepted", resolvedAt: new Date() }).where(eq(documentSuggestion.id, s.id));
  if (s.commentId) await setCommentStatus(userId, s.documentId, s.commentId, "applied");
}

export async function rejectSuggestion(userId: string, suggestionId: string) {
  const s = await getSuggestionForUser(userId, suggestionId);
  if (s.status !== "pending") return;
  await db.update(documentSuggestion).set({ status: "rejected", resolvedAt: new Date() }).where(eq(documentSuggestion.id, s.id));
  // 按批注生成的修改被拒：批注回到待处理，用户可以再忽略或换个说法
  if (s.commentId) await setCommentStatus(userId, s.documentId, s.commentId, "open");
}

/** 原文已经变了、再也接受不了的建议，直接标为拒绝，免得一直挂着 */
export async function dropStaleSuggestions(doc: DocumentRow, pending: SuggestionRow[]) {
  const stale = pending.filter((s) => !canApply(doc.markdown, s.op));
  if (!stale.length) return pending;
  await db
    .update(documentSuggestion)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(inArray(documentSuggestion.id, stale.map((s) => s.id)));
  for (const s of stale) if (s.commentId) await db.update(documentComment).set({ status: "open" }).where(eq(documentComment.id, s.commentId));
  return pending.filter((s) => !stale.includes(s));
}

// ---------- 教授视角审阅的批注 ----------

/** 新一轮审阅：上一轮没处理的批注收起（新一轮会重新看全文） */
export async function addReviewComments(userId: string, id: string, comments: { quote: string; body: string; category: CommentCategory }[]) {
  await getDocumentOrThrow(userId, id);
  const [{ round }] = await db.select({ round: max(documentComment.round) }).from(documentComment).where(eq(documentComment.documentId, id));
  await db
    .update(documentComment)
    .set({ status: "ignored" })
    .where(and(eq(documentComment.documentId, id), eq(documentComment.status, "open")));
  if (!comments.length) return [];
  return db
    .insert(documentComment)
    .values(comments.map((c) => ({ id: crypto.randomUUID(), documentId: id, round: (round ?? 0) + 1, ...c })))
    .returning();
}

export async function listActiveComments(documentId: string) {
  return db
    .select()
    .from(documentComment)
    .where(and(eq(documentComment.documentId, documentId), inArray(documentComment.status, ["open", "suggested"])))
    .orderBy(asc(documentComment.createdAt));
}

export async function getComment(userId: string, id: string, commentId: string) {
  await getDocumentOrThrow(userId, id);
  const [c] = await db
    .select()
    .from(documentComment)
    .where(and(eq(documentComment.id, commentId), eq(documentComment.documentId, id)));
  if (!c) throw new Error("找不到这条批注");
  return c;
}

/** 改批注状态。一轮的批注全部处理完、且按批注改过东西时，存一版「审阅改完」 */
export async function setCommentStatus(userId: string, id: string, commentId: string, status: CommentRow["status"]) {
  const c = await getComment(userId, id, commentId);
  await db.update(documentComment).set({ status }).where(eq(documentComment.id, commentId));
  if (status === "open" || status === "suggested") return;
  const round = await db
    .select({ status: documentComment.status })
    .from(documentComment)
    .where(and(eq(documentComment.documentId, id), eq(documentComment.round, c.round)));
  const finished = round.every((r) => r.status === "applied" || r.status === "ignored");
  if (finished && round.some((r) => r.status === "applied")) await snapshotVersion(userId, id, "review");
}

// ---------- 提纲、写法 ----------

export async function proposeOutline(userId: string, id: string, sections: Outline["sections"]) {
  return editDocument(userId, id, () => ({ outline: { sections, status: "proposed" } }));
}

/** 用户同意提纲：正文还空着的话按提纲生成各节标题 */
export async function approveOutline(userId: string, id: string) {
  return editDocument(
    userId,
    id,
    (d) => {
      if (!d.outline) throw new Error("还没有提纲");
      const outline: Outline = { ...d.outline, status: "approved" };
      if (!isBlankDoc(d.markdown)) return { outline };
      const title = /^#\s+(.+)$/m.exec(d.markdown)?.[1] ?? "研究計画書";
      return { outline, markdown: outlineSkeleton(title, outline) };
    },
    "确定提纲",
  );
}

export async function setWriteMode(userId: string, id: string, writeMode: WriteMode | null) {
  return editDocument(userId, id, () => ({ writeMode }));
}

// ---------- 定制版、套磁信附件 ----------

/** 给某位教授复制一份定制版计划书，记下复制自通用版的第几版 */
export async function createTailoredCopy(userId: string, sourceId: string, professorId: string) {
  const source = await getDocumentOrThrow(userId, sourceId);
  if (source.kind !== "plan") throw new Error("只有研究计划书可以复制定制版");
  const p = await getSavedProfessor(userId, professorId);
  if (!p) throw new Error("教授清单里没有这位教授");
  const v = await snapshotVersion(userId, sourceId, "tailor");
  const baseTitle = source.title.replace(/\s*·\s*[^·]+$/, "");
  const copy = await createDocument(userId, {
    kind: "plan",
    title: `${baseTitle} · ${p.name}`,
    markdown: source.markdown,
    zh: source.zh,
    outline: source.outline,
    writeMode: source.writeMode,
    targetProfessor: professorToTarget(p),
    parentId: source.id,
    parentVersion: v.number,
  });
  await snapshotVersion(userId, copy.id, "tailor", { summary: `复制自「${source.title}」第 ${v.number} 版` });
  return copy;
}

export async function listTailoredCopies(userId: string, parentId: string) {
  return db
    .select({ id: document.id, title: document.title, targetProfessor: document.targetProfessor, parentVersion: document.parentVersion })
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.parentId, parentId)))
    .orderBy(asc(document.createdAt));
}

export async function setAttachment(userId: string, letterId: string, attachmentId: string | null) {
  if (attachmentId) {
    const plan = await getDocumentOrThrow(userId, attachmentId);
    if (plan.kind !== "plan") throw new Error("只能附上研究计划书");
  }
  return editDocument(userId, letterId, () => ({ attachmentId }));
}

/** 编辑器需要的一切：文书、待确认的修改建议、批注、定制版关系、附件、版本数 */
export async function getDocumentBundle(userId: string, id: string) {
  const doc = await getDocument(userId, id);
  if (!doc) return null;
  const [pending, comments, copies, parent, attachment, last] = await Promise.all([
    listPendingSuggestions(id),
    listActiveComments(id),
    doc.kind === "plan" ? listTailoredCopies(userId, id) : Promise.resolve([]),
    doc.parentId ? getDocument(userId, doc.parentId) : Promise.resolve(null),
    doc.attachmentId ? getDocument(userId, doc.attachmentId) : Promise.resolve(null),
    latestVersion(id),
  ]);
  const suggestions = await dropStaleSuggestions(doc, pending);
  return {
    doc,
    suggestions,
    comments,
    copies,
    parent: parent && { id: parent.id, title: parent.title },
    attachment: attachment && { id: attachment.id, title: attachment.title },
    versionCount: last?.number ?? 0,
  };
}

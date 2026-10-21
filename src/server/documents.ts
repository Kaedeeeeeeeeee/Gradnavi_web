import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { document } from "@/db/schema";
import { MAX_DOC_LENGTH, replaceTextOnce, type DocKind, type TargetProfessor } from "@/lib/documents";
import { upsertSection } from "@/lib/md-sections";

// 文书的读写。编辑器页面（用户）和 AI 工具都走这里。

export type DocumentRow = typeof document.$inferSelect;

function checkLength(markdown: string) {
  if (markdown.length > MAX_DOC_LENGTH) throw new Error(`文书不能超过 ${MAX_DOC_LENGTH} 字`);
}

export async function listDocuments(userId: string) {
  return db
    .select({ id: document.id, kind: document.kind, title: document.title, updatedAt: document.updatedAt })
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

export async function createDocument(
  userId: string,
  input: { kind: DocKind; title: string; markdown: string; targetProfessor?: TargetProfessor | null },
) {
  checkLength(input.markdown);
  const [row] = await db
    .insert(document)
    .values({
      id: crypto.randomUUID(),
      userId,
      kind: input.kind,
      title: input.title.trim() || "未命名文书",
      markdown: input.markdown,
      targetProfessor: input.targetProfessor ?? null,
    })
    .returning();
  return row;
}

type Patch = Partial<{ title: string; markdown: string; targetProfessor: TargetProfessor | null }>;

/**
 * 修改文书。传 baseVersion 时做乐观锁：版本已变（例如 AI 刚改过）则返回 conflict，不覆盖。
 */
export async function updateDocument(userId: string, id: string, patch: Patch, baseVersion?: number) {
  if (patch.markdown !== undefined) checkLength(patch.markdown);
  if (patch.title !== undefined) patch.title = patch.title.trim() || "未命名文书";
  const conditions = [eq(document.id, id), eq(document.userId, userId)];
  if (baseVersion !== undefined) conditions.push(eq(document.version, baseVersion));
  const [row] = await db
    .update(document)
    .set({ ...patch, version: sql`${document.version} + 1`, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  if (row) return { ok: true as const, doc: row };
  const current = await getDocument(userId, id);
  if (!current) throw new Error("找不到这份文书");
  return { ok: false as const, doc: current };
}

/** 读-改-写。版本冲突（并发修改）时重试一次 */
async function editMarkdown(userId: string, id: string, edit: (md: string) => string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = await getDocument(userId, id);
    if (!doc) throw new Error("找不到这份文书");
    const result = await updateDocument(userId, id, { markdown: edit(doc.markdown) }, doc.version);
    if (result.ok) return result.doc;
  }
  throw new Error("文书正在被同时修改，请稍后再试");
}

export function updateDocumentSection(userId: string, id: string, heading: string, content: string, mode: "replace" | "append") {
  return editMarkdown(userId, id, (md) => upsertSection(md, heading, content, mode));
}

export function replaceDocumentText(userId: string, id: string, find: string, replace: string) {
  return editMarkdown(userId, id, (md) => replaceTextOnce(md, find, replace));
}

export async function deleteDocument(userId: string, id: string) {
  const rows = await db
    .delete(document)
    .where(and(eq(document.id, id), eq(document.userId, userId)))
    .returning({ id: document.id });
  return rows.length > 0;
}

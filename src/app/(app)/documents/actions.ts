"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { docTemplate, MAX_DOC_LENGTH } from "@/lib/documents";
import { requireUser } from "@/lib/session";
import { createDocument, deleteDocument, updateDocument } from "@/server/documents";
import { getProfile } from "@/server/profile";

// 文书页面上的用户操作。与 AI 工具调用同一套 src/server/documents 函数。

const kindSchema = z.enum(["plan", "letter", "intro", "other"]);
const fieldSchema = z.enum(["humanities", "sciences"]);

export async function createDocumentAction(kind: string, field?: string) {
  const user = await requireUser();
  const k = kindSchema.parse(kind);
  const f = fieldSchema.optional().parse(field) ?? (await getProfile(user.id))?.onboarding?.field;
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
  revalidatePath(`/documents/${id}`);
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
  revalidatePath(`/documents/${id}`);
}

export async function deleteDocumentAction(id: string) {
  const user = await requireUser();
  await deleteDocument(user.id, id);
  redirect("/documents");
}

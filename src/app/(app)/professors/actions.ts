"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { docTemplate } from "@/lib/documents";
import { letterSkeleton, PROFESSOR_STATUSES, professorToTarget } from "@/lib/professors";
import { requireUser } from "@/lib/session";
import { createDocument, listDocuments } from "@/server/documents";
import { answerField } from "@/lib/onboarding";
import { getProfile } from "@/server/profile";
import { deleteSavedProfessor, getSavedProfessor, updateSavedProfessor } from "@/server/professors";

// 志愿里教授的用户操作（志愿列表、志愿详情）。与 AI 工具调用同一套 src/server 函数。
// 志愿详情在文稿栏、跟进日在主页日历上，都由 layout 渲染，所以改完刷新整个 layout。

const refresh = () => revalidatePath("/", "layout");

const patchSchema = z.object({
  status: z.enum(PROFESSOR_STATUSES).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  schoolId: z.string().max(64).nullable().optional(),
});

export async function updateProfessorAction(id: string, patch: z.infer<typeof patchSchema>) {
  const user = await requireUser();
  const p = patchSchema.parse(patch);
  await updateSavedProfessor(user.id, id, { ...p, ...(p.note !== undefined ? { note: p.note || null } : {}) });
  refresh();
}

export async function deleteProfessorAction(id: string) {
  const user = await requireUser();
  await deleteSavedProfessor(user.id, id);
  refresh();
}

async function professorOrThrow(userId: string, id: string) {
  const p = await getSavedProfessor(userId, id);
  if (!p) throw new Error("志愿里没有这位教授");
  return p;
}

/** 给这位教授写套磁信：新建关联教授的套磁信，进入编辑器后让 AI 写初稿 */
export async function createLetterAction(professorId: string) {
  const user = await requireUser();
  const p = await professorOrThrow(user.id, professorId);
  // 已经有给这位教授的计划书（定制版）就直接附上
  const plan = (await listDocuments(user.id)).find((d) => d.kind === "plan" && d.targetProfessor?.professorId === p.id);
  const doc = await createDocument(user.id, {
    kind: "letter",
    title: `套磁信 · ${p.name}`,
    markdown: letterSkeleton(p),
    targetProfessor: professorToTarget(p),
    attachmentId: plan?.id ?? null,
  });
  redirect(`/documents/${doc.id}?ai=letter`);
}

/** 主线 A：以这位教授为目标写计划书 */
export async function createPlanAction(professorId: string) {
  const user = await requireUser();
  const p = await professorOrThrow(user.id, professorId);
  const template = docTemplate("plan", answerField((await getProfile(user.id))?.onboarding));
  const doc = await createDocument(user.id, {
    kind: "plan",
    title: `研究计划书 · ${p.name}`,
    markdown: template.markdown,
    targetProfessor: professorToTarget(p),
  });
  redirect(`/documents/${doc.id}`);
}

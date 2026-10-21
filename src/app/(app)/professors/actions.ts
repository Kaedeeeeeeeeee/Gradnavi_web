"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { UsageMeter } from "@/lib/credits";
import { docTemplate } from "@/lib/documents";
import { letterSkeleton, MAX_SCHOOLS, PROFESSOR_STATUSES, professorToTarget, type ProfessorCandidate } from "@/lib/professors";
import { requireUser } from "@/lib/session";
import { assertCanSpend, recordUsageSafe } from "@/server/credits";
import { createDocument } from "@/server/documents";
import { answerField } from "@/lib/onboarding";
import { getProfile } from "@/server/profile";
import { searchProfessors, type ProfessorSearchResult } from "@/server/professor-search";
import { deleteSavedProfessor, getSavedProfessor, saveProfessor, updateSavedProfessor } from "@/server/professors";

// 找教授页面上的用户操作。与 AI 工具调用同一套 src/server 函数。

const searchSchema = z.object({
  keywords: z.string().trim().min(1, "请填写研究方向").max(200),
  schools: z.array(z.string().trim().min(1).max(50)).max(MAX_SCHOOLS),
  field: z.enum(["humanities", "sciences"]),
});

export async function searchProfessorsAction(
  input: z.infer<typeof searchSchema>,
): Promise<({ ok: true } & ProfessorSearchResult) | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "输入有误" };
  const meter = new UsageMeter();
  try {
    await assertCanSpend(user.id);
    return { ok: true, ...(await searchProfessors(parsed.data, meter)) };
  } catch (error) {
    console.error("[professor-search]", error);
    return { ok: false, error: error instanceof Error ? error.message : "检索失败，请稍后再试" };
  } finally {
    // 检索失败也要结算已经成功的检索调用
    await recordUsageSafe({ userId: user.id, feature: "professor_search", meter, note: parsed.data.keywords.slice(0, 100) });
  }
}

const candidateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  university: z.string().trim().min(1).max(100),
  department: z.string().max(200).optional(),
  lab: z.string().max(200).optional(),
  research: z.string().max(1000),
  papers: z.array(z.string().max(300)).max(5),
  acceptsInternational: z.string().max(200).optional(),
  sources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(500) })).max(10),
}) satisfies z.ZodType<ProfessorCandidate>;

export async function saveProfessorAction(candidate: ProfessorCandidate) {
  const user = await requireUser();
  const row = await saveProfessor(user.id, candidateSchema.parse(candidate));
  revalidatePath("/professors");
  return row.id;
}

const patchSchema = z.object({
  status: z.enum(PROFESSOR_STATUSES).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export async function updateProfessorAction(id: string, patch: z.infer<typeof patchSchema>) {
  const user = await requireUser();
  const p = patchSchema.parse(patch);
  await updateSavedProfessor(user.id, id, { ...p, ...(p.note !== undefined ? { note: p.note || null } : {}) });
  revalidatePath("/professors");
}

export async function deleteProfessorAction(id: string) {
  const user = await requireUser();
  await deleteSavedProfessor(user.id, id);
  revalidatePath("/professors");
}

async function professorOrThrow(userId: string, id: string) {
  const p = await getSavedProfessor(userId, id);
  if (!p) throw new Error("教授清单里没有这位教授");
  return p;
}

/** 给这位教授写套磁信：新建关联教授的套磁信，进入编辑器后让 AI 写初稿 */
export async function createLetterAction(professorId: string) {
  const user = await requireUser();
  const p = await professorOrThrow(user.id, professorId);
  const doc = await createDocument(user.id, {
    kind: "letter",
    title: `套磁信 · ${p.name}`,
    markdown: letterSkeleton(p),
    targetProfessor: professorToTarget(p),
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

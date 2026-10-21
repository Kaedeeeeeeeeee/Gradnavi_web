import "server-only";
import { and, asc, eq, inArray, isNotNull, max } from "drizzle-orm";
import { db } from "@/db";
import { document, savedProfessor, schoolWatch, todo, userProfile } from "@/db/schema";
import { planNextSteps } from "@/lib/next-steps";

/**
 * 按用户当前进度对账流程任务（工作台「下一步」）。纯规则、几条查询，不调用 AI，
 * 所以在工作台加载和 AI 查看 Todo 前直接调用，不用在每个改动点埋钩子。
 * 只动带 stepKey 的任务；用户和 AI 自己加的 Todo 不碰。
 */
export async function syncNextSteps(userId: string) {
  const [[profile], schoolCount, professors, documents, existing] = await Promise.all([
    db.select({ answers: userProfile.onboarding }).from(userProfile).where(eq(userProfile.userId, userId)),
    db.$count(schoolWatch, eq(schoolWatch.userId, userId)),
    db
      .select({ id: savedProfessor.id, name: savedProfessor.name, status: savedProfessor.status, followUpDate: savedProfessor.followUpDate })
      .from(savedProfessor)
      .where(eq(savedProfessor.userId, userId))
      .orderBy(asc(savedProfessor.createdAt)),
    db.select({ id: document.id, kind: document.kind, target: document.targetProfessor }).from(document).where(eq(document.userId, userId)),
    db
      .select({ id: todo.id, stepKey: todo.stepKey, status: todo.status, dismissedAt: todo.dismissedAt, note: todo.note, documentId: todo.documentId })
      .from(todo)
      .where(and(eq(todo.userId, userId), isNotNull(todo.stepKey))),
  ]);
  if (!profile?.answers) return;

  const byKey = new Map(existing.map((t) => [t.stepKey!, t]));
  const plan = planNextSteps({
    answers: profile.answers,
    schoolCount,
    professors,
    documents: documents.map((d) => ({ id: d.id, kind: d.kind, professorId: d.target?.professorId })),
    doneKeys: new Set(existing.filter((t) => t.status === "done").map((t) => t.stepKey!)),
  });

  // 条件达成（如已关注研究科、教授状态改成已发套磁）的任务改成「待你确认」，由用户点完成。只有用户能标完成
  const now = new Date();
  const toReview = plan.done.map((k) => byKey.get(k)).filter((t) => t && (t.status === "todo" || t.status === "doing") && !t.dismissedAt).map((t) => t!.id);
  if (toReview.length) await db.update(todo).set({ status: "review", updatedAt: now }).where(inArray(todo.id, toReview));

  // 条件不再成立的未完成任务（如教授被删除或标成放弃）直接移除
  const wanted = new Set([...plan.open.map((t) => t.key), ...plan.done]);
  const stale = existing.filter((t) => t.status !== "done" && !t.dismissedAt && !wanted.has(t.stepKey!)).map((t) => t.id);
  if (stale.length) await db.delete(todo).where(inArray(todo.id, stale));

  // 未完成的任务跟着最新信息更新跟进日和关联的套磁信；标题和其他备注不动，用户或 AI 可能改过
  for (const t of plan.open) {
    const row = byKey.get(t.key);
    if (!row || row.status === "done" || row.dismissedAt) continue;
    const patch: Partial<typeof todo.$inferInsert> = {};
    if (t.key.endsWith(":followup") && (t.note ?? null) !== row.note) patch.note = t.note ?? null;
    if (t.documentId && t.documentId !== row.documentId) patch.documentId = t.documentId;
    if (Object.keys(patch).length) await db.update(todo).set({ ...patch, updatedAt: now }).where(eq(todo.id, row.id));
  }

  // 已有的（包括做完的、被用户删掉的）不重复添加
  const missing = plan.open.filter((t) => !byKey.has(t.key));
  if (!missing.length) return;
  const [{ last }] = await db.select({ last: max(todo.sortOrder) }).from(todo).where(eq(todo.userId, userId));
  const start = (last ?? -1) + 1;
  await db
    .insert(todo)
    .values(
      missing.map((t, i) => ({
        id: crypto.randomUUID(),
        userId,
        title: t.title,
        note: t.note ?? null,
        professorId: t.professorId ?? null,
        documentId: t.documentId ?? null,
        stepKey: t.key,
        sortOrder: start + i,
        createdBy: "system" as const,
      })),
    )
    .onConflictDoNothing();
}

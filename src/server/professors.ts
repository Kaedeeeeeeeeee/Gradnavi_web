import "server-only";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { graduateSchool, savedProfessor, schoolWatch } from "@/db/schema";
import { matchSchool } from "@/lib/aspirations";
import type { PaperRef, ProfessorCandidate, ProfessorStatus, SourceLink } from "@/lib/professors";

// 志愿里的教授（加入志愿 = 收藏）的读写。志愿页面、找教授结果（用户）和 AI 工具都走这里。

export type SavedProfessorRow = typeof savedProfessor.$inferSelect;

export type ProfessorInput = Omit<ProfessorCandidate, "research" | "papers" | "sources"> & {
  research?: string;
  papers?: string[];
  paperRefs?: PaperRef[];
  sources?: SourceLink[];
  note?: string | null;
};

export async function listSavedProfessors(userId: string) {
  return db
    .select()
    .from(savedProfessor)
    .where(eq(savedProfessor.userId, userId))
    .orderBy(sql`case when ${savedProfessor.status} = 'dropped' then 1 else 0 end`, asc(savedProfessor.createdAt));
}

export async function getSavedProfessor(userId: string, id: string): Promise<SavedProfessorRow | null> {
  const [row] = await db
    .select()
    .from(savedProfessor)
    .where(and(eq(savedProfessor.id, id), eq(savedProfessor.userId, userId)));
  return row ?? null;
}

/**
 * 教授所在的研究科已经有人关注过（系统里有这个研究科）时，自动关联并替用户关注：
 * 入试要点、募集要项日程马上带出来，不花检索费用。对不上的由 AI 查到入试页面后用 watch_school 关联。
 */
export async function linkKnownSchool(userId: string, p: Pick<SavedProfessorRow, "id" | "university" | "department" | "schoolId">) {
  if (p.schoolId || !p.department) return null;
  const candidates = await db.select().from(graduateSchool).where(eq(graduateSchool.university, p.university.trim()));
  const school = matchSchool(p, candidates);
  if (!school) return null;
  await db.insert(schoolWatch).values({ userId, schoolId: school.id }).onConflictDoNothing();
  await db.update(savedProfessor).set({ schoolId: school.id }).where(and(eq(savedProfessor.id, p.id), eq(savedProfessor.userId, userId)));
  return school;
}

/** 加入志愿。同一用户、同名同校视为同一位：更新检索到的信息，保留联系状态、备注和跟进日期 */
export async function saveProfessor(userId: string, input: ProfessorInput) {
  const paperRefs = input.paperRefs ?? [];
  const info = {
    name: input.name.trim(),
    university: input.university.trim(),
    department: input.department?.trim() || null,
    lab: input.lab?.trim() || null,
    research: input.research?.trim() || null,
    papers: input.papers ?? [],
    paperRefs,
    fit: input.fit?.trim() || null,
    acceptsInternational: input.acceptsInternational?.trim() || null,
    sources: input.sources ?? [],
  };
  const [row] = await db
    .insert(savedProfessor)
    .values({ id: crypto.randomUUID(), userId, ...info, note: input.note?.trim() || null })
    .onConflictDoUpdate({
      target: [savedProfessor.userId, savedProfessor.name, savedProfessor.university],
      // 重新加入「放弃」过的教授 = 重新考虑
      set: { ...info, status: sql`case when ${savedProfessor.status} = 'dropped' then 'to_contact' else ${savedProfessor.status} end`, updatedAt: new Date() },
    })
    .returning();
  const school = await linkKnownSchool(userId, row);
  return school ? { ...row, schoolId: school.id } : row;
}

/** 用户看志愿时顺手把还没关联研究科的教授对上已关注的研究科 */
export async function linkProfessorsToSchools(userId: string, rows: SavedProfessorRow[]) {
  const unlinked = rows.filter((p) => !p.schoolId && p.department);
  if (!unlinked.length) return rows;
  const watched = await db
    .select({ id: graduateSchool.id, university: graduateSchool.university, name: graduateSchool.name })
    .from(schoolWatch)
    .innerJoin(graduateSchool, eq(schoolWatch.schoolId, graduateSchool.id))
    .where(eq(schoolWatch.userId, userId));
  const linked = new Map<string, string>();
  for (const p of unlinked) {
    const school = matchSchool(p, watched);
    if (!school) continue;
    await db.update(savedProfessor).set({ schoolId: school.id }).where(eq(savedProfessor.id, p.id));
    linked.set(p.id, school.id);
  }
  return rows.map((p) => (linked.has(p.id) ? { ...p, schoolId: linked.get(p.id)! } : p));
}

export type ProfessorPatch = Partial<{
  status: ProfessorStatus;
  note: string | null;
  followUpDate: string | null;
  department: string | null;
  lab: string | null;
  research: string | null;
  fit: string | null;
  papers: string[];
  acceptsInternational: string | null;
  schoolId: string | null;
}>;

/**
 * 修改志愿里的教授。by = "ai" 时，改跟进日期只记成提议（日历上虚线显示），用户同意后才生效。
 * 关联的研究科必须是用户关注的。
 */
export async function updateSavedProfessor(userId: string, id: string, patch: ProfessorPatch, by: "user" | "ai" = "user") {
  const current = await getSavedProfessor(userId, id);
  if (!current) throw new Error("志愿里没有这位教授");
  if (patch.schoolId && !(await db.$count(schoolWatch, and(eq(schoolWatch.userId, userId), eq(schoolWatch.schoolId, patch.schoolId)))))
    throw new Error("没有关注这个研究科，先用 watch_school 关注");
  const { followUpDate, ...rest } = patch;
  const set: Partial<typeof savedProfessor.$inferInsert> = { ...rest, updatedAt: new Date() };
  if (followUpDate !== undefined && followUpDate !== current.followUpDate) {
    if (by === "ai") set.proposedFollowUp = { date: followUpDate };
    else Object.assign(set, { followUpDate, proposedFollowUp: null });
  }
  const [row] = await db
    .update(savedProfessor)
    .set(set)
    .where(and(eq(savedProfessor.id, id), eq(savedProfessor.userId, userId)))
    .returning();
  return row;
}

/** AI 对跟进日期的提议：同意后生效，拒绝就丢掉 */
export async function resolveFollowUpProposal(userId: string, id: string, accept: boolean) {
  const row = await getSavedProfessor(userId, id);
  if (!row?.proposedFollowUp) return;
  await db
    .update(savedProfessor)
    .set({ proposedFollowUp: null, ...(accept ? { followUpDate: row.proposedFollowUp.date } : {}), updatedAt: new Date() })
    .where(and(eq(savedProfessor.id, id), eq(savedProfessor.userId, userId)));
}

export async function listFollowUpProposals(userId: string) {
  return db
    .select()
    .from(savedProfessor)
    .where(and(eq(savedProfessor.userId, userId), isNotNull(savedProfessor.proposedFollowUp)))
    .orderBy(asc(savedProfessor.createdAt));
}

export async function deleteSavedProfessor(userId: string, id: string) {
  await db.delete(savedProfessor).where(and(eq(savedProfessor.id, id), eq(savedProfessor.userId, userId)));
}

/** 已加入志愿的教授（按 candidateKey 判断检索结果里哪些已加入） */
export async function savedKeys(userId: string, keys: { name: string; university: string }[]) {
  if (!keys.length) return [];
  return db
    .select({ id: savedProfessor.id, name: savedProfessor.name, university: savedProfessor.university, status: savedProfessor.status })
    .from(savedProfessor)
    .where(and(eq(savedProfessor.userId, userId), inArray(savedProfessor.university, [...new Set(keys.map((k) => k.university.trim()))])));
}

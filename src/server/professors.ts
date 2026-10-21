import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { savedProfessor } from "@/db/schema";
import type { ProfessorCandidate, ProfessorStatus, SourceLink } from "@/lib/professors";

// 教授清单（收藏）的读写。找教授页面（用户）和 AI 工具都走这里。

export type SavedProfessorRow = typeof savedProfessor.$inferSelect;

export type ProfessorInput = Omit<ProfessorCandidate, "research" | "papers" | "sources"> & {
  research?: string;
  papers?: string[];
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

/** 收藏教授。同一用户、同名同校视为同一位：更新检索到的信息，保留状态、备注和跟进日期 */
export async function saveProfessor(userId: string, input: ProfessorInput) {
  const info = {
    name: input.name.trim(),
    university: input.university.trim(),
    department: input.department?.trim() || null,
    lab: input.lab?.trim() || null,
    research: input.research?.trim() || null,
    papers: input.papers ?? [],
    acceptsInternational: input.acceptsInternational?.trim() || null,
    sources: input.sources ?? [],
  };
  const [row] = await db
    .insert(savedProfessor)
    .values({ id: crypto.randomUUID(), userId, ...info, note: input.note?.trim() || null })
    .onConflictDoUpdate({
      target: [savedProfessor.userId, savedProfessor.name, savedProfessor.university],
      set: { ...info, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export type ProfessorPatch = Partial<{
  status: ProfessorStatus;
  note: string | null;
  followUpDate: string | null;
  department: string | null;
  lab: string | null;
  research: string | null;
  papers: string[];
  acceptsInternational: string | null;
}>;

export async function updateSavedProfessor(userId: string, id: string, patch: ProfessorPatch) {
  const [row] = await db
    .update(savedProfessor)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(savedProfessor.id, id), eq(savedProfessor.userId, userId)))
    .returning();
  if (!row) throw new Error("教授清单里没有这位教授");
  return row;
}

export async function deleteSavedProfessor(userId: string, id: string) {
  await db.delete(savedProfessor).where(and(eq(savedProfessor.id, id), eq(savedProfessor.userId, userId)));
}

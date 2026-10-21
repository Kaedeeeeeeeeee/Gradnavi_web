import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { admissionGuide, graduateSchool, schoolWatch } from "@/db/schema";
import { assertPublicUrl, projectGuide } from "@/lib/admissions";

// 关注的研究科（募集要项监控）。研究科跨用户共享，关注关系每人一份。
// 页面（用户）和 AI 工具都走这里；真正的检查在 worker（src/server/admission-monitor.ts）。

export type WatchInput = { university: string; name: string; url: string };

export function normalizeSchoolUrl(url: string) {
  const u = assertPublicUrl(url);
  u.hash = "";
  return u.toString();
}

export async function watchSchool(userId: string, input: WatchInput) {
  const university = input.university.trim();
  const name = input.name.trim();
  if (!university || !name) throw new Error("请填写大学和研究科");
  const url = normalizeSchoolUrl(input.url);
  const now = new Date();
  // 研究科已被别人关注时沿用原链接；只有原链接检查出错时才换成新填的
  const [existing] = await db
    .select()
    .from(graduateSchool)
    .where(and(eq(graduateSchool.university, university), eq(graduateSchool.name, name)));
  let school = existing;
  if (!school) {
    [school] = await db
      .insert(graduateSchool)
      .values({ id: crypto.randomUUID(), university, name, url, checkRequestedAt: now })
      .onConflictDoNothing()
      .returning();
    school ??= (await db.select().from(graduateSchool).where(and(eq(graduateSchool.university, university), eq(graduateSchool.name, name))))[0];
  } else if (existing.lastError && existing.url !== url) {
    [school] = await db
      .update(graduateSchool)
      .set({ url, contentHash: null, lastError: null, checkRequestedAt: now })
      .where(eq(graduateSchool.id, existing.id))
      .returning();
  }
  await db.insert(schoolWatch).values({ userId, schoolId: school.id }).onConflictDoNothing();
  return school;
}

export async function unwatchSchool(userId: string, schoolId: string) {
  const rows = await db
    .delete(schoolWatch)
    .where(and(eq(schoolWatch.userId, userId), eq(schoolWatch.schoolId, schoolId)))
    .returning({ id: schoolWatch.schoolId });
  return rows.length > 0;
}

/** 请 worker 尽快检查一次（几分钟内） */
export async function requestSchoolCheck(userId: string, schoolId: string) {
  const [watch] = await db
    .select()
    .from(schoolWatch)
    .where(and(eq(schoolWatch.userId, userId), eq(schoolWatch.schoolId, schoolId)));
  if (!watch) throw new Error("你没有关注这个研究科");
  await db.update(graduateSchool).set({ checkRequestedAt: new Date() }).where(eq(graduateSchool.id, schoolId));
}

export async function latestGuides(schoolIds: string[]) {
  if (!schoolIds.length) return new Map<string, typeof admissionGuide.$inferSelect>();
  const rows = await db
    .select()
    .from(admissionGuide)
    .where(inArray(admissionGuide.schoolId, schoolIds))
    .orderBy(desc(admissionGuide.admissionYear));
  const map = new Map<string, typeof admissionGuide.$inferSelect>();
  for (const r of rows) if (!map.has(r.schoolId)) map.set(r.schoolId, r);
  return map;
}

/** 用户关注的研究科 + 最新要项 + 推算出的日历项（仮 或正式） */
export async function listWatchedSchools(userId: string, today: string) {
  const schools = await db
    .select({ school: graduateSchool, watchedAt: schoolWatch.createdAt })
    .from(schoolWatch)
    .innerJoin(graduateSchool, eq(schoolWatch.schoolId, graduateSchool.id))
    .where(eq(schoolWatch.userId, userId))
    .orderBy(schoolWatch.createdAt);
  const guides = await latestGuides(schools.map((s) => s.school.id));
  return schools.map(({ school }) => {
    const guide = guides.get(school.id) ?? null;
    const projected = guide
      ? projectGuide({ schoolId: school.id, schoolName: `${school.university} ${school.name}`, admissionYear: guide.admissionYear, events: guide.events, sourceUrl: guide.sourceUrl }, today)
      : { tentative: false, items: [] };
    return { school, guide, tentative: projected.tentative, calendar: projected.items };
  });
}

import "server-only";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { admissionGuide, graduateSchool, savedProfessor, schoolWatch } from "@/db/schema";
import { assertPublicUrl, parseRequirements, projectGuide, type AdmissionRequirements, type GuideEvent } from "@/lib/admissions";

// 关注的研究科（志愿的研究科这边：募集要项监控 + 入试要点）。研究科跨用户共享，关注关系每人一份。
// 页面（用户）和 AI 工具都走这里；真正的检查在 worker（src/server/admission-monitor.ts）。

export type WatchInput = { university: string; name: string; url: string };

export function normalizeSchoolUrl(url: string) {
  const u = assertPublicUrl(url);
  u.hash = "";
  return u.toString();
}

/** professorId：同时把这位志愿教授关联到这个研究科（教授 + 研究科 = 一条志愿） */
export async function watchSchool(userId: string, input: WatchInput, professorId?: string) {
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
  if (professorId) {
    const [linked] = await db
      .update(savedProfessor)
      .set({ schoolId: school.id, updatedAt: now })
      .where(and(eq(savedProfessor.id, professorId), eq(savedProfessor.userId, userId)))
      .returning({ id: savedProfessor.id });
    if (!linked) throw new Error("志愿里没有这位教授");
  }
  return school;
}

/**
 * AI 在对话里查到的入试要点（要不要先联系教授、考试科目、语言要求）。研究科跨用户共享：
 * 募集要项监控解析出的要点更可靠，已有时不覆盖；监控之后解析到会覆盖 AI 填的。
 */
export async function updateSchoolRequirements(userId: string, schoolId: string, raw: unknown, sourceUrl: string | null) {
  const [watch] = await db
    .select({ school: graduateSchool })
    .from(schoolWatch)
    .innerJoin(graduateSchool, eq(schoolWatch.schoolId, graduateSchool.id))
    .where(and(eq(schoolWatch.userId, userId), eq(schoolWatch.schoolId, schoolId)));
  if (!watch) throw new Error("没有关注这个研究科");
  if (watch.school.requirements?.source === "monitor") return { saved: false, reason: "已有募集要项监控解析的要点，不覆盖", requirements: watch.school.requirements };
  const parsed = parseRequirements(raw);
  if (!parsed) throw new Error("没有可记录的要点");
  const requirements: AdmissionRequirements = { ...parsed, sourceUrl, source: "ai", updatedAt: new Date().toISOString() };
  await db.update(graduateSchool).set({ requirements }).where(eq(graduateSchool.id, schoolId));
  return { saved: true, requirements };
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

/** 主页提醒：最近公布（或更新）的新募集要项，附公布前日历上的日程，方便对照 */
export type GuideAlert = {
  schoolId: string;
  school: string;
  admissionYear: number;
  announcedAt: string;
  events: GuideEvent[];
  previous: GuideEvent[];
  sourceUrl: string;
};

/** days：公布后多少天内提醒 */
export async function listGuideAlerts(userId: string, days: number): Promise<GuideAlert[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ guide: admissionGuide, school: graduateSchool })
    .from(schoolWatch)
    .innerJoin(graduateSchool, eq(schoolWatch.schoolId, graduateSchool.id))
    .innerJoin(admissionGuide, eq(admissionGuide.schoolId, graduateSchool.id))
    .where(and(eq(schoolWatch.userId, userId), isNotNull(admissionGuide.announcedAt), gte(admissionGuide.announcedAt, since)))
    .orderBy(desc(admissionGuide.announcedAt));
  return rows.map(({ guide, school }) => ({
    schoolId: school.id,
    school: `${school.university} ${school.name}`,
    admissionYear: guide.admissionYear,
    announcedAt: guide.announcedAt!.toISOString(),
    events: guide.events,
    previous: guide.previousEvents ?? [],
    sourceUrl: guide.sourceUrl,
  }));
}

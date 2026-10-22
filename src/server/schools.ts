import "server-only";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { admissionGuide, graduateSchool, savedProfessor, schoolWatch } from "@/db/schema";
import { assertPublicUrl, parseRequirements, projectGuide, type AdmissionRequirements, type GuideEvent } from "@/lib/admissions";

// 关注的研究科（志愿的研究科这边：募集要项监控 + 入试要点）。研究科本身（大学 + 名字）只是个标识；
// 监控按用户各自跑：链接、检查状态、入试要点、要项日程都在用户自己的关注记录里，结果不共用。
// 页面（用户）和 AI 工具都走这里；真正的检查在 worker（src/server/admission-monitor.ts）。

export type WatchInput = { university: string; name: string; url: string };

export function normalizeSchoolUrl(url: string) {
  const u = assertPublicUrl(url);
  u.hash = "";
  return u.toString();
}

/** 用户看到的研究科：标识 + 这个用户自己的监控状态 */
export const watchedSchoolFields = {
  id: graduateSchool.id,
  university: graduateSchool.university,
  name: graduateSchool.name,
  url: schoolWatch.url,
  contentHash: schoolWatch.contentHash,
  checkedAt: schoolWatch.checkedAt,
  changedAt: schoolWatch.changedAt,
  checkRequestedAt: schoolWatch.checkRequestedAt,
  lastError: schoolWatch.lastError,
  pausedAt: schoolWatch.pausedAt,
  requirements: schoolWatch.requirements,
};

const watchOf = (userId: string, schoolId: string) => and(eq(schoolWatch.userId, userId), eq(schoolWatch.schoolId, schoolId));

export async function getWatchedSchool(userId: string, schoolId: string) {
  const [row] = await db
    .select(watchedSchoolFields)
    .from(schoolWatch)
    .innerJoin(graduateSchool, eq(schoolWatch.schoolId, graduateSchool.id))
    .where(watchOf(userId, schoolId));
  return row ?? null;
}

export type WatchedSchoolRow = NonNullable<Awaited<ReturnType<typeof getWatchedSchool>>>;

/** professorId：同时把这位志愿教授关联到这个研究科（教授 + 研究科 = 一条志愿） */
export async function watchSchool(userId: string, input: WatchInput, professorId?: string) {
  const university = input.university.trim();
  const name = input.name.trim();
  if (!university || !name) throw new Error("请填写大学和研究科");
  const url = normalizeSchoolUrl(input.url);
  const now = new Date();
  await db.insert(graduateSchool).values({ id: crypto.randomUUID(), university, name, url }).onConflictDoNothing();
  const [school] = await db.select().from(graduateSchool).where(and(eq(graduateSchool.university, university), eq(graduateSchool.name, name)));
  // 已关注时：链接没变就不动；换了链接（原链接检查出错、或 AI 找到了更准的页面）就重新检查
  const [existing] = await db.select().from(schoolWatch).where(watchOf(userId, school.id));
  if (!existing) await db.insert(schoolWatch).values({ userId, schoolId: school.id, url, checkRequestedAt: now }).onConflictDoNothing();
  else if (existing.url !== url)
    await db.update(schoolWatch).set({ url, contentHash: null, lastError: null, checkRequestedAt: now }).where(watchOf(userId, school.id));
  if (professorId) {
    const [linked] = await db
      .update(savedProfessor)
      .set({ schoolId: school.id, updatedAt: now })
      .where(and(eq(savedProfessor.id, professorId), eq(savedProfessor.userId, userId)))
      .returning({ id: savedProfessor.id });
    if (!linked) throw new Error("志愿里没有这位教授");
  }
  return (await getWatchedSchool(userId, school.id))!;
}

/**
 * AI 在对话里查到的入试要点（要不要先联系教授、考试科目、语言要求）。
 * 募集要项监控解析出的要点更可靠，已有时不覆盖；监控之后解析到会覆盖 AI 填的。
 */
export async function updateSchoolRequirements(userId: string, schoolId: string, raw: unknown, sourceUrl: string | null) {
  const school = await getWatchedSchool(userId, schoolId);
  if (!school) throw new Error("没有关注这个研究科");
  if (school.requirements?.source === "monitor") return { saved: false, reason: "已有募集要项监控解析的要点，不覆盖", requirements: school.requirements };
  const parsed = parseRequirements(raw);
  if (!parsed) throw new Error("没有可记录的要点");
  const requirements: AdmissionRequirements = { ...parsed, sourceUrl, source: "ai", updatedAt: new Date().toISOString() };
  await db.update(schoolWatch).set({ requirements }).where(watchOf(userId, schoolId));
  return { saved: true, requirements };
}

export async function unwatchSchool(userId: string, schoolId: string) {
  const rows = await db.delete(schoolWatch).where(watchOf(userId, schoolId)).returning({ id: schoolWatch.schoolId });
  // 要项日程是这个用户自己的，不再关注就一起删掉
  if (rows.length) await db.delete(admissionGuide).where(and(eq(admissionGuide.userId, userId), eq(admissionGuide.schoolId, schoolId)));
  return rows.length > 0;
}

/** 请 worker 尽快检查一次（几分钟内） */
export async function requestSchoolCheck(userId: string, schoolId: string) {
  const rows = await db.update(schoolWatch).set({ checkRequestedAt: new Date() }).where(watchOf(userId, schoolId)).returning({ id: schoolWatch.schoolId });
  if (!rows.length) throw new Error("你没有关注这个研究科");
}

/** 用户自己的最新要项（每个研究科年度最新的一份） */
export async function latestGuides(userId: string, schoolIds: string[]) {
  if (!schoolIds.length) return new Map<string, typeof admissionGuide.$inferSelect>();
  const rows = await db
    .select()
    .from(admissionGuide)
    .where(and(eq(admissionGuide.userId, userId), inArray(admissionGuide.schoolId, schoolIds)))
    .orderBy(desc(admissionGuide.admissionYear));
  const map = new Map<string, typeof admissionGuide.$inferSelect>();
  for (const r of rows) if (!map.has(r.schoolId)) map.set(r.schoolId, r);
  return map;
}

/** 用户关注的研究科 + 最新要项 + 推算出的日历项（仮 或正式） */
export async function listWatchedSchools(userId: string, today: string) {
  const schools = await db
    .select(watchedSchoolFields)
    .from(schoolWatch)
    .innerJoin(graduateSchool, eq(schoolWatch.schoolId, graduateSchool.id))
    .where(eq(schoolWatch.userId, userId))
    .orderBy(schoolWatch.createdAt);
  const guides = await latestGuides(userId, schools.map((s) => s.id));
  return schools.map((school) => {
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
    .from(admissionGuide)
    .innerJoin(graduateSchool, eq(admissionGuide.schoolId, graduateSchool.id))
    .where(and(eq(admissionGuide.userId, userId), isNotNull(admissionGuide.announcedAt), gte(admissionGuide.announcedAt, since)))
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

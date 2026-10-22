import "server-only";
import { nextDeadline, profileScores, requirementGaps, type AspirationView, type ProfessorView, type Scores, type SchoolView } from "@/lib/aspirations";
import { getProfile } from "./profile";
import { linkProfessorsToSchools, listSavedProfessors, type SavedProfessorRow } from "./professors";
import { listWatchedSchools } from "./schools";

// 志愿列表：每条 = 一位教授 + 教授所在的研究科；也可以只有研究科（关注了、但没关联任何教授）。
// 教授这边看研究方向匹配和联系状态，研究科这边看入试要点、出愿截止和与用户档案的差距。

type WatchedSchool = Awaited<ReturnType<typeof listWatchedSchools>>[number];

/** 用户现在的语言成绩 */
export async function userScores(userId: string): Promise<Scores> {
  const profile = await getProfile(userId);
  return profileScores(profile?.markdown ?? "", profile?.onboarding);
}

export function toProfessorView(p: SavedProfessorRow): ProfessorView {
  return {
    id: p.id,
    name: p.name,
    university: p.university,
    department: p.department,
    lab: p.lab,
    research: p.research,
    fit: p.fit,
    papers: p.papers,
    paperRefs: p.paperRefs,
    acceptsInternational: p.acceptsInternational,
    sources: p.sources,
    details: p.details,
    status: p.status,
    note: p.note,
    followUpDate: p.followUpDate,
    proposedFollowUp: p.proposedFollowUp,
  };
}

function toSchool({ school, guide, tentative, calendar }: WatchedSchool, today: string): SchoolView {
  return {
    id: school.id,
    university: school.university,
    name: school.name,
    url: school.url,
    requirements: school.requirements,
    checkedAt: school.checkedAt?.toISOString() ?? null,
    pending: !school.checkedAt || !!school.checkRequestedAt,
    problem: school.lastError,
    guideYear: guide?.admissionYear ?? null,
    tentative,
    deadline: nextDeadline(calendar, today),
    events: calendar.map((it) => ({ key: it.key, title: it.title, date: it.date, endDate: it.endDate ?? null, kind: it.kind })),
  };
}

export async function listAspirations(userId: string, today: string): Promise<AspirationView[]> {
  const [rows, watched, scores] = await Promise.all([listSavedProfessors(userId), listWatchedSchools(userId, today), userScores(userId)]);
  const professors = await linkProfessorsToSchools(userId, rows);
  const schools = new Map(watched.map((w) => [w.school.id, toSchool(w, today)]));
  const linked = new Set(professors.flatMap((p) => (p.schoolId ? [p.schoolId] : [])));
  const entry = (professor: SavedProfessorRow | null, school: SchoolView | null): AspirationView => ({
    key: professor ? `prof:${professor.id}` : `school:${school!.id}`,
    professor: professor && toProfessorView(professor),
    school,
    gaps: requirementGaps(school?.requirements ?? null, scores),
  });
  const withProfessor = professors.map((p) => entry(p, (p.schoolId && schools.get(p.schoolId)) || null));
  const schoolOnly = [...schools.values()].filter((s) => !linked.has(s.id)).map((s) => entry(null, s));
  // 放弃的教授排最后
  return [...withProfessor.filter((a) => a.professor!.status !== "dropped"), ...schoolOnly, ...withProfessor.filter((a) => a.professor!.status === "dropped")];
}

export async function getSchoolAspiration(userId: string, schoolId: string, today: string) {
  const list = await listAspirations(userId, today);
  return list.find((a) => a.school?.id === schoolId && !a.professor) ?? list.find((a) => a.school?.id === schoolId) ?? null;
}

export async function getAspiration(userId: string, professorId: string, today: string) {
  const list = await listAspirations(userId, today);
  return list.find((a) => a.professor?.id === professorId) ?? null;
}

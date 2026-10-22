import { redirect } from "next/navigation";
import { addDays, monthGrid, parseMonth, todayJst } from "@/lib/calendar";
import { profileScores } from "@/lib/aspirations";
import { decideTrack, PATH_LABELS, suggestPath, TRACK_LABELS } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { agenda, briefing, groupTasks, keyDates } from "@/lib/tasks";
import { listCalendar, listProposedEvents } from "@/server/calendar";
import { listTaskConversationIds } from "@/server/conversations";
import { listDocuments } from "@/server/documents";
import { syncNextSteps } from "@/server/next-steps";
import { getProfile } from "@/server/profile";
import { listSavedProfessors } from "@/server/professors";
import { listGuideAlerts, listWatchedSchools } from "@/server/schools";
import { diffGuideEvents } from "@/lib/admissions";
import { listTodos, toTaskView } from "@/server/todos";
import { Home, type HomeTask } from "./home";

export const metadata = { title: "主页 · GradNavi" };

/** 新募集要项公布后在主页提醒多少天 */
const ALERT_DAYS = 30;

// 主页：今日简报（含关键日期倒计时）| 待办和日程（近 7 天，可展开更远）+ 月历。AI 的提议在最上面，同意后才生效。
export default async function WorkbenchPage({ searchParams }: PageProps<"/workbench">) {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const answers = profile?.onboarding;
  if (!profile?.onboardedAt || !answers) redirect("/onboarding");

  const today = todayJst();
  const m = (await searchParams).m;
  const month = parseMonth(typeof m === "string" ? m : undefined, today);
  const weeks = monthGrid(month);
  const gridFrom = weeks[0][0].date;
  const gridTo = weeks.at(-1)![6].date;
  // 待办和日程展开后、倒计时都看一年
  const horizon = addDays(today, 365);

  await syncNextSteps(user.id);
  const [rows, calendar, proposedEvents, started, professors, documents, schools, guideAlerts] = await Promise.all([
    listTodos(user.id, { includeDone: true }),
    listCalendar(user.id, gridFrom < today ? gridFrom : today, gridTo > horizon ? gridTo : horizon, today),
    listProposedEvents(user.id),
    listTaskConversationIds(user.id),
    listSavedProfessors(user.id),
    listDocuments(user.id),
    listWatchedSchools(user.id, today),
    listGuideAlerts(user.id, ALERT_DAYS),
  ]);

  const professorName = new Map(professors.map((p) => [p.id, p.name]));
  const docTitle = new Map(documents.map((d) => [d.id, d.title]));
  const schoolName = new Map(schools.map(({ school }) => [school.id, `${school.university} ${school.name}`]));
  const tasks = rows.map(toTaskView);
  const toHome = (t: (typeof tasks)[number]): HomeTask => ({
    ...t,
    started: started.has(t.id),
    link: t.professorId
      ? `${professorName.get(t.professorId) ?? ""}教授`
      : t.documentId
        ? docTitle.get(t.documentId) ?? null
        : t.schoolId
          ? schoolName.get(t.schoolId) ?? null
          : null,
  });
  const groups = groupTasks(tasks, today);
  const followUps = professors.filter((p) => p.proposedFollowUp);
  // 新要项提醒：监控同时加了一个「查看新要项」任务，任务完成后提醒就收起
  const alerts = guideAlerts.flatMap((al) => {
    const t = rows.find((r) => r.createdBy === "system" && !r.stepKey && r.schoolId === al.schoolId && r.title.includes("募集要项"));
    if (t?.status === "done") return [];
    return [{ ...al, changes: diffGuideEvents(al.previous, al.events), task: t ? { id: t.id, title: t.title, started: started.has(t.id) } : null }];
  });
  const path = answers.path === "unsure" ? `${PATH_LABELS[suggestPath(answers, profileScores(profile.markdown, answers).jlpt)]}（建议，待确认）` : PATH_LABELS[answers.path];
  const { near, far } = agenda(tasks.map(toHome), calendar, today);

  return (
    <Home
      today={today}
      month={month}
      profileLine={`路径：${path} · 目标入学：${answers.targetEntry} · 路线：${TRACK_LABELS[decideTrack(answers)]}`}
      briefing={briefing(tasks, proposedEvents.length + followUps.length, today)}
      alerts={alerts}
      countdown={keyDates(calendar, today)}
      proposals={{
        tasks: groups.proposals.map(toHome),
        changes: tasks.filter((t) => !t.proposed && t.proposedChange).map(toHome),
        events: proposedEvents.map((e) => ({ id: e.id, title: e.title, date: e.date, endDate: e.endDate, change: e.proposedChange, isNew: e.proposed })),
        followUps: followUps.map((p) => ({ id: p.id, name: p.name, date: p.followUpDate, proposed: p.proposedFollowUp!.date })),
      }}
      near={near}
      far={far.filter((r) => !r.date || r.date <= horizon)}
      done={groups.done.map(toHome)}
      calendar={calendar.filter((it) => it.date <= gridTo && (it.endDate ?? it.date) >= gridFrom)}
    />
  );
}

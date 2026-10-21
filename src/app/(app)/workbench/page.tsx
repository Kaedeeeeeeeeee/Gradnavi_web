import { redirect } from "next/navigation";
import { addDays, monthGrid, parseMonth, todayJst } from "@/lib/calendar";
import { decideTrack, PATH_LABELS, suggestPath, TRACK_LABELS } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { briefing, groupTasks, keyDates, weekEnd } from "@/lib/tasks";
import { listCalendar, listProposedEvents } from "@/server/calendar";
import { listTaskConversationIds } from "@/server/conversations";
import { listDocuments } from "@/server/documents";
import { syncNextSteps } from "@/server/next-steps";
import { getProfile } from "@/server/profile";
import { listSavedProfessors } from "@/server/professors";
import { listWatchedSchools } from "@/server/schools";
import { listTodos, toTaskView } from "@/server/todos";
import { Home, type HomeTask } from "./home";

export const metadata = { title: "主页 · GradNavi" };

// 主页：今日简报（含关键日期倒计时）| 本周 / 之后的任务 + 月历。AI 的提议在最上面，同意后才生效。
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
  // 之后的里程碑和倒计时看一年
  const horizon = addDays(today, 365);

  await syncNextSteps(user.id);
  const [rows, calendar, proposedEvents, started, professors, documents, schools] = await Promise.all([
    listTodos(user.id, { includeDone: true }),
    listCalendar(user.id, gridFrom < today ? gridFrom : today, gridTo > horizon ? gridTo : horizon, today),
    listProposedEvents(user.id),
    listTaskConversationIds(user.id),
    listSavedProfessors(user.id),
    listDocuments(user.id),
    listWatchedSchools(user.id, today),
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
  const path = answers.path === "unsure" ? `${PATH_LABELS[suggestPath(answers)]}（建议，待确认）` : PATH_LABELS[answers.path];
  const end = weekEnd(today);

  return (
    <Home
      today={today}
      month={month}
      profileLine={`路径：${path} · 目标入学：${answers.targetEntry} · 路线：${TRACK_LABELS[decideTrack(answers)]}`}
      briefing={briefing(tasks, proposedEvents.length, today)}
      countdown={keyDates(calendar, today)}
      proposals={{
        tasks: groups.proposals.map(toHome),
        changes: tasks.filter((t) => !t.proposed && t.proposedChange).map(toHome),
        events: proposedEvents.map((e) => ({ id: e.id, title: e.title, date: e.date, endDate: e.endDate, change: e.proposedChange, isNew: e.proposed })),
      }}
      week={groups.week.map(toHome)}
      later={groups.later.map(toHome)}
      done={groups.done.map(toHome)}
      // 之后：本周以后的官方日期（出愿截止、考试），和任务一起按日期列出
      milestones={calendar.filter((it) => it.source === "guide" && it.kind !== "other" && it.date > end && it.date <= horizon)}
      calendar={calendar.filter((it) => it.date <= gridTo && (it.endDate ?? it.date) >= gridFrom)}
      upcoming={calendar.filter((it) => (it.endDate ?? it.date) >= today && it.date <= addDays(today, 30) && !it.done)}
    />
  );
}

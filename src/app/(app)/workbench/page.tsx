import { redirect } from "next/navigation";
import { addDays, monthGrid, parseMonth, todayJst } from "@/lib/calendar";
import { profileScores } from "@/lib/aspirations";
import { decideTrack, PATH_LABELS, suggestPath, TRACK_LABELS } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { Suspense } from "react";
import type { CalendarItem } from "@/lib/calendar";
import { intakeYear as toIntakeYear, type PickProfessor } from "@/lib/next-pick";
import { PROFESSOR_STATUS_LABELS } from "@/lib/professors";
import { agenda, awaitingReview, groupTasks, keyDates, overdueCount, type TaskView } from "@/lib/tasks";
import { getNextPick } from "@/server/next-pick";
import { listCalendar, listProposedEvents } from "@/server/calendar";
import { listTaskConversationIds } from "@/server/conversations";
import { listDocuments } from "@/server/documents";
import { syncNextSteps } from "@/server/next-steps";
import { getProfile } from "@/server/profile";
import { listSavedProfessors } from "@/server/professors";
import { listGuideAlerts, listWatchedSchools } from "@/server/schools";
import { diffGuideEvents } from "@/lib/admissions";
import { listTodos, toTaskView } from "@/server/todos";
import { Home, type GroupNames, type HomeTask } from "./home";
import { NextThing, NextThingLoading, type PickTask } from "./next-thing";

export const metadata = { title: "主页 · GradNavi" };

/** 新募集要项公布后在主页提醒多少天 */
const ALERT_DAYS = 30;

// 主页两块：「今天」（AI 挑的「下一件事」；等你处理 = 待你确认的任务 + AI 的提议，有才出现；最近的一个关键日期）→ 待办和日程 + 月历（全部关键日期）。
export default async function WorkbenchPage({ searchParams }: PageProps<"/workbench">) {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const answers = profile?.onboarding;
  if (!profile?.onboardedAt || !answers) redirect("/onboarding");

  const today = todayJst();
  // 日历一页一个月，默认本月；?m= 换月份
  const { m } = await searchParams;
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
  const intake = toIntakeYear(answers.targetEntry);
  const path = answers.path === "unsure" ? `${PATH_LABELS[suggestPath(answers, profileScores(profile.markdown, answers).jlpt)]}（建议，待确认）` : PATH_LABELS[answers.path];
  const { near, rest, far } = agenda(tasks.map(toHome), calendar, today);
  const groupNames: GroupNames = {
    professors: Object.fromEntries(professors.map((p) => [p.id, { name: p.name, school: [p.university, p.department].filter(Boolean).join(" ") }])),
    schools: Object.fromEntries(schools.map(({ school }) => [school.id, { name: `${school.university} ${school.name}`, url: school.url }])),
  };

  return (
    <Home
      today={today}
      month={month}
      profileLine={`路径：${path} · 目标入学：${answers.targetEntry} · 路线：${TRACK_LABELS[decideTrack(answers)]}`}
      overdue={overdueCount(tasks, today)}
      next={
        // AI 判断要几秒：存着的结果直接显示，要重新判断时先显示占位，主页其余部分不用等
        <Suspense fallback={<NextThingLoading />}>
          <NextThingSlot
            input={{
              userId: user.id,
              today,
              userMd: profile.markdown,
              profileLine: `路径：${path} · 目标入学：${answers.targetEntry}`,
              intakeYear: intake,
              tasks,
              professors: professors.map((p) => ({ id: p.id, name: p.name, status: PROFESSOR_STATUS_LABELS[p.status], followUpDate: p.followUpDate })),
              calendar,
            }}
            tasks={Object.fromEntries(tasks.map(toHome).map((t) => [t.id, { id: t.id, title: t.title, started: t.started, link: t.link }]))}
          />
        </Suspense>
      }
      alerts={alerts}
      pausedMonitors={schools.filter(({ school }) => school.pausedAt).map(({ school }) => `${school.university} ${school.name}`)}
      countdown={keyDates(calendar, today, intake)}
      review={awaitingReview(tasks).map(toHome)}
      proposals={{
        tasks: groups.proposals.map(toHome),
        changes: tasks.filter((t) => !t.proposed && t.proposedChange).map(toHome),
        events: proposedEvents.map((e) => ({ id: e.id, title: e.title, date: e.date, endDate: e.endDate, change: e.proposedChange, isNew: e.proposed })),
        followUps: followUps.map((p) => ({ id: p.id, name: p.name, date: p.followUpDate, proposed: p.proposedFollowUp!.date })),
      }}
      near={near}
      rest={rest}
      groupNames={groupNames}
      far={far.filter((r) => !r.date || r.date <= horizon)}
      done={groups.done.map(toHome)}
      tasks={tasks.map(toHome)}
      calendar={calendar.filter((it) => it.date <= gridTo && (it.endDate ?? it.date) >= gridFrom)}
    />
  );
}

type PickInput = { userId: string; today: string; userMd: string; profileLine: string; intakeYear: number | null; tasks: TaskView[]; professors: PickProfessor[]; calendar: CalendarItem[] };

async function NextThingSlot({ input, tasks }: { input: PickInput; tasks: Record<string, PickTask> }) {
  const pick = await getNextPick(input);
  return pick ? <NextThing pick={pick} tasks={tasks} /> : null;
}

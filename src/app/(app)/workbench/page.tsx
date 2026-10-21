import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, todayJst } from "@/lib/calendar";
import { kickoffFor } from "@/lib/next-steps";
import { decideTrack, PATH_LABELS, suggestPath, TRACK_LABELS } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { listCalendar } from "@/server/calendar";
import { syncNextSteps } from "@/server/next-steps";
import { getProfile } from "@/server/profile";
import { listSavedProfessors } from "@/server/professors";
import { listTodos } from "@/server/todos";
import { TodoList } from "./todo-list";

export const metadata = { title: "工作台 · GradNavi" };

export default async function WorkbenchPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const answers = profile?.onboarding;
  if (!profile?.onboardedAt || !answers) redirect("/onboarding");

  const today = todayJst();
  await syncNextSteps(user.id);
  const [todos, calendar, professors] = await Promise.all([
    listTodos(user.id, { includeDone: true }),
    listCalendar(user.id, today, addDays(today, 13), today),
    listSavedProfessors(user.id),
  ]);
  const professorName = new Map(professors.map((p) => [p.id, p.name]));
  const upcoming = calendar.filter((it) => !it.done).slice(0, 8);
  const path = answers.path === "unsure" ? `${PATH_LABELS[suggestPath(answers)]}（建议，待确认）` : PATH_LABELS[answers.path];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">工作台</h1>
        <p className="text-sm text-zinc-500">
          路径：{path} · 目标入学：{answers.targetEntry} · 路线：{TRACK_LABELS[decideTrack(answers)]}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">下一步</h2>
        <TodoList
          todos={todos.map((t) => ({
            id: t.id,
            title: t.title,
            note: t.note,
            done: t.done,
            dueDate: t.dueDate,
            createdBy: t.createdBy,
            kickoff: kickoffFor(t, t.professorId ? professorName.get(t.professorId) : undefined),
          }))}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-medium">近两周日程</h2>
          <Link href="/calendar" className="text-sm text-zinc-500 hover:text-foreground">
            查看日历
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-500">近两周没有日程。</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {upcoming.map((it) => (
              <li key={it.key} className="flex gap-3">
                <span className="w-24 shrink-0 tabular-nums text-zinc-500">
                  {it.date.slice(5)}
                  {it.endDate && it.endDate !== it.date && `〜${it.endDate.slice(5)}`}
                </span>
                <span>
                  {it.tentative && <span className="mr-1 text-xs text-amber-700">仮</span>}
                  {it.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import { redirect } from "next/navigation";
import { decideTrack, PATH_LABELS, suggestPath, TRACK_LABELS } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { getProfile } from "@/server/profile";
import { listTodos } from "@/server/todos";
import { TodoList } from "./todo-list";

export const metadata = { title: "工作台 · GradNavi" };

export default async function WorkbenchPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const answers = profile?.onboarding;
  if (!profile?.onboardedAt || !answers) redirect("/onboarding");

  const todos = await listTodos(user.id, { includeDone: true });
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
        <TodoList todos={todos.map((t) => ({ id: t.id, title: t.title, note: t.note, done: t.done, createdBy: t.createdBy }))} />
      </section>
    </div>
  );
}

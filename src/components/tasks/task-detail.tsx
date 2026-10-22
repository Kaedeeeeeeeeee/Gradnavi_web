"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteTaskAction, setTaskStatusAction, setTaskStepsAction, updateTaskAction } from "@/app/(app)/workbench/actions";
import { useAiPageContent, useStartTask } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { DateInput } from "@/components/ui/date-input";
import { uuid } from "@/lib/browser";
import type { ReportItem, ReportLink } from "@/lib/task-report";
import { TASK_AREA_LABELS, TASK_AREAS, TASK_STATUS_LABELS, TASK_STATUSES, taskGroup, type TaskArea, type TaskStep, type TaskView } from "@/lib/tasks";
import { btn, formatDay, ProposalButtons, StartButton } from "./task-ui";

// 文稿栏里的任务详情：说明、子步骤、关联的教授 / 文书 / 研究科。AI 栏同时切到这个任务的对话。

type Links = {
  professor: { id: string; name: string; label: string } | null;
  document: { id: string; title: string } | null;
  school: { id: string; name: string; url: string } | null;
};

const field = "input px-2 py-1 text-sm";

export function TaskDetail({ task, links, started, aiText, report }: { task: TaskView; links: Links; started: boolean; aiText: string; report: ReportItem[] | null }) {
  useAiPageContent(aiText, "doc");
  const { closeTab } = useShell();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? "");
  const run = (fn: () => Promise<unknown>) => startTransition(async () => void (await fn()));
  // 没手动设分类时，主页按什么归的组
  const auto = taskGroup({ ...task, area: null });
  const autoArea = auto.kind === "area" ? TASK_AREA_LABELS[auto.area] : "";

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
      {task.proposed && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-sm">
          <span className="flex-1">这是 AI 提议的任务，同意后才会加进你的待办。</span>
          <ProposalButtons kind="task" id={task.id} date={task.dueDate} editable={false} />
        </div>
      )}

      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && run(() => updateTaskAction(task.id, { title }))}
          className="page-title w-full bg-transparent outline-none placeholder:text-faint"
          aria-label="任务标题"
        />
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="状态">
          {TASK_STATUSES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={task.status === s}
              disabled={pending}
              onClick={() => s !== task.status && run(() => setTaskStatusAction(task.id, s))}
              className={`rounded-md px-2 py-0.5 text-xs ${task.status === s ? "bg-subtle-strong font-medium text-foreground" : "text-muted hover:bg-subtle hover:text-foreground"}`}
            >
              {TASK_STATUS_LABELS[s]}
            </button>
          ))}
          <span className="ml-auto">
            <StartButton task={task} started={started} primary />
          </span>
        </div>
      </div>

      {report && <ReviewReport task={task} report={report} document={links.document} />}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">截止</span>
        <DateInput
          value={task.dueDate ?? ""}
          onChange={(v) => run(() => updateTaskAction(task.id, { dueDate: v || null }))}
          placeholder="未定"
          clearable
          className={field}
        />
        {!task.professorId && !task.schoolId && (
          <>
            <span className="ml-3 text-muted">分类</span>
            <select
              aria-label="分类"
              value={task.area ?? ""}
              disabled={pending}
              onChange={(e) => run(() => updateTaskAction(task.id, { area: (e.target.value || null) as TaskArea | null }))}
              className={`${field} cursor-pointer`}
            >
              <option value="">自动（{autoArea}）</option>
              {TASK_AREAS.map((a) => (
                <option key={a} value={a}>
                  {TASK_AREA_LABELS[a]}
                </option>
              ))}
            </select>
          </>
        )}
        {task.proposedChange && (
          <span className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line-strong px-2 py-1 text-xs">
            AI 提议改到 {task.proposedChange.dueDate ? formatDay(task.proposedChange.dueDate) : "不设截止日"}
            <ProposalButtons kind="task" id={task.id} date={task.proposedChange.dueDate} />
          </span>
        )}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (task.note ?? "") && run(() => updateTaskAction(task.id, { note: note || null }))}
        placeholder="说明（可选）"
        rows={2}
        className={`${field} w-full resize-y`}
      />

      <Steps taskId={task.id} steps={task.steps} />

      {(links.professor || links.document || links.school) && (
        <section className="space-y-1 text-sm">
          <h2 className="section-title">关联</h2>
          <ul className="space-y-1">
            {links.professor && (
              <li>
                教授：
                <OpenTabLink tab={{ kind: "professor", id: links.professor.id, title: links.professor.name }} href="/aspirations" className="text-accent hover:underline">
                  {links.professor.label}
                </OpenTabLink>
              </li>
            )}
            {links.document && (
              <li>
                文书：
                <OpenTabLink tab={{ kind: "doc", id: links.document.id, title: links.document.title }} href={`/documents/${links.document.id}`} className="text-accent hover:underline">
                  {links.document.title}
                </OpenTabLink>
              </li>
            )}
            {links.school && (
              <li>
                研究科：
                <OpenTabLink tab={{ kind: "web", url: links.school.url, title: links.school.name }} href={links.school.url} className="text-accent hover:underline">
                  {links.school.name}
                </OpenTabLink>
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="border-t border-line pt-4">
        <button
          disabled={pending}
          onClick={() => {
            if (!confirm("删除这个任务？它的 AI 对话也会一起删除。")) return;
            run(async () => {
              await deleteTaskAction(task.id);
              closeTab(`task:${task.id}`);
            });
          }}
          className="text-xs text-faint hover:text-danger"
        >
          删除任务
        </button>
      </div>
    </div>
  );
}

/** 待你确认：AI 这次做了什么（每条能直接打开）、还没做的子步骤，以及「标完成 / 继续和 AI 改」 */
function ReviewReport({ task, report, document }: { task: TaskView; report: ReportItem[]; document: Links["document"] }) {
  const { expand } = useShell();
  const startTask = useStartTask();
  const [pending, startTransition] = useTransition();
  // 工具记录里没有这份关联文书（比如用户自己建的），也给一条能打开的
  const items: ReportItem[] =
    document && !report.some((r) => r.link?.kind === "doc" && r.link.id === document.id)
      ? [...report, { text: `结果在「${document.title}」`, link: { kind: "doc", id: document.id, title: document.title } }]
      : report;
  const todo = task.steps.filter((s) => !s.done);
  const firstDoc = items.find((r) => r.link?.kind === "doc");
  return (
    <section className="overflow-hidden rounded-xl border border-warn/50">
      <h2 className="bg-warn-soft px-4 py-2 text-sm font-medium text-warn">AI 做完了，等你看一下</h2>
      <ul className="space-y-1.5 px-4 py-3 text-sm">
        {items.length === 0 && todo.length === 0 && <li className="text-muted">这次对话里 AI 没有改动什么，结果在右边的对话里。</li>}
        {items.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ok">✓</span>
            <span className="min-w-0 flex-1">{r.text}</span>
            {r.link && <ReportOpen link={r.link} primary={r === firstDoc} />}
          </li>
        ))}
        {todo.map((s) => (
          <li key={s.id} className="flex gap-2 text-muted">
            <span>○</span>
            <span className="flex-1">{s.title}（还没做）</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
        <button disabled={pending} onClick={() => startTransition(() => setTaskStatusAction(task.id, "done"))} className="btn-primary px-3 py-1 text-sm">
          没问题，标完成
        </button>
        <button
          onClick={() => {
            startTask(task.id, false);
            expand("ai");
          }}
          className="btn-ghost px-3 py-1 text-sm"
        >
          还要改，继续和 AI 聊
        </button>
      </div>
    </section>
  );
}

function ReportOpen({ link, primary }: { link: ReportLink; primary: boolean }) {
  const cls = primary ? "btn-primary px-2 py-0.5 text-xs" : btn;
  if (link.kind === "page")
    return (
      <Link href={link.href} className={cls}>
        打开
      </Link>
    );
  return (
    <OpenTabLink tab={link} href={link.kind === "doc" ? `/documents/${link.id}` : "/aspirations"} className={cls}>
      {link.kind === "doc" ? "打开" : "看看"}
    </OpenTabLink>
  );
}

function Steps({ taskId, steps }: { taskId: string; steps: TaskStep[] }) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const save = (next: TaskStep[]) => startTransition(() => setTaskStepsAction(taskId, next));
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        子步骤 {steps.length > 0 && <span className="font-normal text-muted tabular-nums">{steps.filter((s) => s.done).length}/{steps.length}</span>}
      </h2>
      {steps.length === 0 && <p className="text-sm text-muted">还没有子步骤。可以自己加，也可以让 AI 帮你拆。</p>}
      <ul className="space-y-1">
        {steps.map((s) => (
          <li key={s.id} className="group flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.done}
              disabled={pending}
              onChange={(e) => save(steps.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)))}
              className="mt-1"
            />
            <span className={`flex-1 ${s.done ? "text-faint line-through" : ""}`}>{s.title}</span>
            <button onClick={() => save(steps.filter((x) => x.id !== s.id))} className="text-xs text-faint opacity-0 group-hover:opacity-100 hover:text-danger">
              删除
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          setDraft("");
          save([...steps, { id: uuid(), title: t, done: false }]);
        }}
        className="flex gap-2"
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="加一个子步骤" className={`${field} min-w-0 flex-1`} />
        <button type="submit" className={btn}>
          添加
        </button>
      </form>
    </section>
  );
}

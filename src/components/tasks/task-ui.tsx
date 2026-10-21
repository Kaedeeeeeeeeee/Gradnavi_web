"use client";

import { useState, useTransition } from "react";
import { updateProfessorAction } from "@/app/(app)/professors/actions";
import { acceptProposalAction, rejectProposalAction, rescheduleEventAction, setTaskStatusAction, updateTaskAction } from "@/app/(app)/workbench/actions";
import { useStartTask } from "@/components/ai/page-context";
import { useShell } from "@/components/shell/app-shell";
import { TASK_STATUS_LABELS, type TaskStatus, type TaskView } from "@/lib/tasks";

// 任务卡和任务详情共用的小部件：状态标签、「让 AI 开始」、AI 提议的同意 / 改 / 拒绝。

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  doing: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  review: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

export function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[status]}`}>{TASK_STATUS_LABELS[status]}</span>;
}

export const btn = "shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700";
export const primaryBtn = "shrink-0 rounded-md bg-foreground px-2 py-0.5 text-xs text-background disabled:opacity-50";

/** 「让 AI 开始」：在文稿栏打开任务详情，AI 栏切到这个任务的对话并开工；聊过的显示「继续和 AI 做」 */
export function StartButton({ task, started, primary = false }: { task: Pick<TaskView, "id" | "title">; started: boolean; primary?: boolean }) {
  const startTask = useStartTask();
  const { openTab } = useShell();
  return (
    <button
      onClick={() => {
        // 先登记开始，再开标签：AI 栏看到任务标签时就知道这次要开工，不会只切过去
        startTask(task.id);
        openTab({ kind: "task", id: task.id, title: task.title });
      }}
      className={primary ? primaryBtn : btn}
    >
      {started ? "继续和 AI 做" : "让 AI 开始"}
    </button>
  );
}

export function CompleteButton({ id, label = "完成" }: { id: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button disabled={pending} onClick={() => startTransition(() => setTaskStatusAction(id, "done"))} className={label === "确认完成" ? primaryBtn : btn}>
      {label}
    </button>
  );
}

/** AI 提议的同意 / 改日期 / 拒绝。「改」：用户选一个日期，直接按这个日期同意 */
export function ProposalButtons({
  kind,
  id,
  date,
  editable = true,
}: {
  /** professor = AI 对志愿里教授跟进日的提议 */
  kind: "task" | "event" | "professor";
  id: string;
  /** 提议的日期，用于「改」的默认值 */
  date?: string | null;
  editable?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(date ?? "");
  const run = (fn: () => Promise<void>) => startTransition(fn);

  if (editing)
    return (
      <span className="flex shrink-0 items-center gap-1">
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="rounded border border-zinc-300 bg-transparent px-1 text-xs dark:border-zinc-700" />
        <button
          disabled={pending || !value}
          className={primaryBtn}
          onClick={() =>
            run(async () => {
              // 用户自己改的日期直接生效，再把提议标成同意
              if (kind === "professor") {
                // 用户自己定的跟进日直接生效，同时丢掉 AI 的提议
                await updateProfessorAction(id, { followUpDate: value });
              } else {
                if (kind === "task") await updateTaskAction(id, { dueDate: value });
                else await rescheduleEventAction(id, value);
                await acceptProposalAction({ kind, id });
              }
              setEditing(false);
            })
          }
        >
          确定
        </button>
        <button className={btn} onClick={() => setEditing(false)}>
          取消
        </button>
      </span>
    );

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button disabled={pending} className={primaryBtn} onClick={() => run(() => acceptProposalAction({ kind, id }))}>
        同意
      </button>
      {editable && (
        <button disabled={pending} className={btn} onClick={() => setEditing(true)}>
          改
        </button>
      )}
      <button disabled={pending} className={`${btn} text-zinc-500`} onClick={() => run(() => rejectProposalAction({ kind, id }))}>
        拒绝
      </button>
    </span>
  );
}

export function formatDay(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
}

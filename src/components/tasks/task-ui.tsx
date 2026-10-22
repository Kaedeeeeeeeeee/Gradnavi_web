"use client";

import { useState, useTransition } from "react";
import { updateProfessorAction } from "@/app/(app)/professors/actions";
import { acceptProposalAction, rejectProposalAction, rescheduleEventAction, setTaskStatusAction, updateTaskAction } from "@/app/(app)/workbench/actions";
import { useStartTask } from "@/components/ai/page-context";
import { useShell } from "@/components/shell/app-shell";
import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus, type TaskView } from "@/lib/tasks";

// 任务卡和任务详情共用的小部件：状态标签、「让 AI 开始」、AI 提议的同意 / 改 / 拒绝。

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-subtle text-muted",
  doing: "bg-info-soft text-info",
  review: "bg-warn-soft text-warn",
  done: "bg-ok-soft text-ok",
};

/** 任务状态：点开选未开始 / 进行中 / 待你确认 / 完成（只有用户能标完成，AI 最多设到待你确认） */
export function StatusSelect({ id, status }: { id: string; status: TaskStatus }) {
  const [pending, startTransition] = useTransition();
  return (
    <span className="relative inline-flex shrink-0">
      <select
        aria-label="状态"
        value={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          startTransition(() => setTaskStatusAction(id, next));
        }}
        className={`cursor-pointer appearance-none rounded py-0.5 pr-5 pl-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${STATUS_STYLES[status]}`}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[9px] opacity-60">
        ▼
      </span>
    </span>
  );
}

export const btn = "btn px-2 py-0.5 text-xs";
export const primaryBtn = "btn-primary px-2 py-0.5 text-xs";

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
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="rounded border border-line-strong bg-transparent px-1 text-xs" />
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
      <button disabled={pending} className={`${btn} text-muted`} onClick={() => run(() => rejectProposalAction({ kind, id }))}>
        拒绝
      </button>
    </span>
  );
}

export function formatDay(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
}

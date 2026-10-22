"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateProfessorAction } from "@/app/(app)/professors/actions";
import { acceptProposalAction, rejectProposalAction, rescheduleEventAction, setTaskStatusAction, updateTaskAction } from "@/app/(app)/workbench/actions";
import { useStartTask } from "@/components/ai/page-context";
import { useShell } from "@/components/shell/app-shell";
import { DateInput } from "@/components/ui/date-input";
import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus, type TaskView } from "@/lib/tasks";

// 任务卡和任务详情共用的小部件：状态标签、「让 AI 开始」、AI 提议的同意 / 改 / 拒绝。


const CIRCLE: Record<TaskStatus, string> = {
  todo: "border-faint",
  doing: "border-accent bg-[conic-gradient(var(--accent)_0_50%,transparent_50%_100%)]",
  review: "border-warn bg-[conic-gradient(var(--warn)_0_75%,transparent_75%_100%)]",
  done: "border-ok bg-ok",
};

/** 状态圆圈：空心 = 未开始，半满 = 进行中，四分之三 = 待你确认，打勾 = 完成 */
export function StatusDot({ status, className = "" }: { status: TaskStatus; className?: string }) {
  return (
    <span aria-hidden className={`relative inline-block size-4 shrink-0 rounded-full border-[1.5px] ${CIRCLE[status]} ${className}`}>
      {status === "done" && (
        <svg viewBox="0 0 16 16" className="absolute inset-0 size-full text-surface">
          <path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/**
 * 任务状态（清单左边的小圆圈）：点开选未开始 / 进行中 / 完成，不会一点就完成，防误触。
 * 只有用户能标完成，AI 最多设到待你确认；待你确认只在当前就是这个状态时列出。
 */
export function StatusCircle({ id, status }: { id: string; status: TaskStatus }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`状态：${TASK_STATUS_LABELS[status]}，点击修改`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={TASK_STATUS_LABELS[status]}
        disabled={pending}
        onClick={() => setOpen(!open)}
        className="grid size-5 place-items-center rounded-full hover:bg-subtle-strong focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:opacity-50"
      >
        <StatusDot status={status} className={status === "todo" ? "hover:border-muted" : ""} />
      </button>
      {open && (
        <span role="menu" className="absolute top-full left-0 z-20 mt-1 grid min-w-28 rounded-lg border border-line-strong bg-surface p-1 shadow-lg">
          {TASK_STATUSES.filter((s) => s !== "review" || status === "review").map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={s === status}
              autoFocus={s === status}
              onClick={() => {
                setOpen(false);
                if (s !== status) startTransition(() => setTaskStatusAction(id, s));
              }}
              className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none ${s === status ? "font-medium" : ""}`}
            >
              <StatusDot status={s} />
              {TASK_STATUS_LABELS[s]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export const btn = "btn px-2 py-0.5 text-xs";
export const primaryBtn = "btn-primary px-2 py-0.5 text-xs";

/**
 * 「让 AI 开始」：在文稿栏打开任务详情，AI 栏切到这个任务的对话并开工；聊过的显示「继续和 AI 做」。
 * quiet：清单里的轻按钮（✦ + 文字，没有边框），窄的时候只剩 ✦
 */
export function StartButton({ task, started, primary = false, quiet = false }: { task: Pick<TaskView, "id" | "title">; started: boolean; primary?: boolean; quiet?: boolean }) {
  const startTask = useStartTask();
  const { openTab } = useShell();
  return (
    <button
      onClick={() => {
        // 先登记开始，再开标签：AI 栏看到任务标签时就知道这次要开工，不会只切过去
        startTask(task.id);
        openTab({ kind: "task", id: task.id, title: task.title });
      }}
      title={quiet ? (started ? "继续和 AI 做" : "让 AI 开始") : undefined}
      className={quiet ? "row-ai" : primary ? primaryBtn : btn}
    >
      {quiet && <span aria-hidden>✦</span>}
      <span className={quiet ? "row-ai-label" : ""}>{started ? "继续和 AI 做" : "让 AI 开始"}</span>
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
        <DateInput value={value} onChange={setValue} className="rounded border border-line-strong px-1 text-xs" />
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

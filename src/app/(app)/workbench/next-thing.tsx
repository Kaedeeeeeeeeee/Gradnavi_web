"use client";

import { useState, useTransition } from "react";
import { useStartTask } from "@/components/ai/page-context";
import { useShell } from "@/components/shell/app-shell";
import { btn } from "@/components/tasks/task-ui";
import type { NextPick } from "@/lib/next-pick";
import { setTaskStatusAction } from "./actions";

export type PickTask = { id: string; title: string; started: boolean; link: string | null };

/** 打开任务详情，AI 栏切到这个任务的对话并开工（和每行的「让 AI 开始」一样） */
function useStart() {
  const startTask = useStartTask();
  const { openTab } = useShell();
  return (t: PickTask) => {
    startTask(t.id);
    openTab({ kind: "task", id: t.id, title: t.title });
  };
}

/**
 * 「今天」里的「下一件事」：AI 从手上的任务里挑的一件 + 为什么，点一下和 AI 开始。
 * 「换一件」展开 AI 排的后几件、15 分钟能做完的一件，以及「这件已经做完了」。
 */
export function NextThing({ pick, tasks }: { pick: NextPick; tasks: Record<string, PickTask> }) {
  const start = useStart();
  const [swapping, setSwapping] = useState(false);
  const [pending, startTransition] = useTransition();
  const task = tasks[pick.taskId];
  if (!task) return null;
  const after = pick.alternatives[0] && tasks[pick.alternatives[0].taskId];
  const quick = pick.quickId && pick.quickId !== pick.taskId ? tasks[pick.quickId] : undefined;

  return (
    <div className="space-y-2.5 rounded-lg border border-line-strong bg-surface px-4 py-3">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-semibold tracking-wide text-accent">✦ 下一件事</span>
        {pick.source === "rule" && <span className="text-faint">按日期排的，AI 暂时没判断</span>}
      </div>
      <div className="space-y-1">
        <p className="font-semibold leading-6">
          {task.title}
          {task.link && !task.title.includes(task.link.replace(/教授$/, "")) && <span className="ml-2 text-xs font-normal text-faint">{task.link}</span>}
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {pick.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {after && (
          <p className="text-xs text-muted">
            做完之后：{after.title}（{pick.alternatives[0].reason}）
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => start(task)} className="btn-primary px-3 py-1 text-sm">
          ✦ {task.started ? "继续和 AI 做" : "和 AI 开始"}
        </button>
        <button onClick={() => setSwapping(!swapping)} aria-expanded={swapping} className="btn px-3 py-1 text-sm">
          {swapping ? "收起" : "换一件"}
        </button>
      </div>

      {swapping && (
        <div className="space-y-1.5 border-t border-line pt-2.5">
          {pick.alternatives.map((a) => {
            const t = tasks[a.taskId];
            return t ? <Choice key={a.taskId} task={t} reason={a.reason} onStart={start} /> : null;
          })}
          {quick && <Choice task={quick} reason="只有 15 分钟左右？这件马上能做完" onStart={start} />}
          <button
            disabled={pending}
            onClick={() => startTransition(() => setTaskStatusAction(task.id, "done"))}
            className="px-1 text-xs text-muted hover:text-foreground hover:underline"
          >
            「{task.title.length > 16 ? `${task.title.slice(0, 16)}…` : task.title}」已经做完了，标成完成
          </button>
        </div>
      )}
    </div>
  );
}

function Choice({ task, reason, onStart }: { task: PickTask; reason: string; onStart: (t: PickTask) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-line px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-5">{task.title}</p>
        <p className="text-xs text-muted">{reason}</p>
      </div>
      <button onClick={() => onStart(task)} className={`${btn} shrink-0`}>
        ✦ {task.started ? "继续" : "开始"}
      </button>
    </div>
  );
}

/** AI 正在判断时的占位（结果存着的话不会出现） */
export function NextThingLoading() {
  return (
    <div className="rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm">
      <span className="text-xs font-semibold tracking-wide text-accent">✦ 下一件事</span>
      <p className="mt-1 flex items-center gap-2 text-muted">
        AI 正在看你的任务、日程和教授进度，挑现在最该做的一件
        <span className="chip-dots shrink-0" aria-label="进行中">
          <span />
          <span />
          <span />
        </span>
      </p>
    </div>
  );
}

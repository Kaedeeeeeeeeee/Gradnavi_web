"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useStartTask } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { btn, CompleteButton, formatDay, ProposalButtons, StartButton, StatusChip } from "@/components/tasks/task-ui";
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS, itemsOn, monthGrid, shiftMonth, type CalendarItem, type CalendarKind } from "@/lib/calendar";
import type { Countdown, TaskView } from "@/lib/tasks";
import { acceptAllProposalsAction, addEventAction, addTaskAction, deleteEventAction } from "./actions";

export type HomeTask = TaskView & {
  /** 这个任务已经有对话（按钮显示「继续和 AI 做」） */
  started: boolean;
  /** 关联对象的名字（教授 / 文书 / 研究科） */
  link: string | null;
};

type ProposedEvent = { id: string; title: string; date: string; endDate: string | null; change: { date: string; endDate: string | null } | null; isNew: boolean };

type Props = {
  today: string;
  month: string;
  profileLine: string;
  briefing: string[];
  countdown: Countdown[];
  proposals: { tasks: HomeTask[]; changes: HomeTask[]; events: ProposedEvent[] };
  week: HomeTask[];
  later: HomeTask[];
  done: HomeTask[];
  milestones: CalendarItem[];
  calendar: CalendarItem[];
  upcoming: CalendarItem[];
};

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function formatToday(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 周${WEEKDAY_NAMES[d.getUTCDay()]}`;
}

export function Home(p: Props) {
  const proposalCount = p.proposals.tasks.length + p.proposals.changes.length + p.proposals.events.length;
  return (
    <div className="@container mx-auto max-w-5xl space-y-6">
      <Briefing today={p.today} lines={p.briefing} countdown={p.countdown} profileLine={p.profileLine} />
      {proposalCount > 0 && <Proposals {...p.proposals} count={proposalCount} />}

      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="font-medium">本周</h2>
            {p.week.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">这周没有待办了。可以在右边问 AI 接下来做什么。</p>
            ) : (
              <ul className="space-y-2">
                {p.week.map((t) => (
                  <TaskCard key={t.id} task={t} today={p.today} />
                ))}
              </ul>
            )}
            <AddTaskForm />
          </section>

          <Later tasks={p.later} milestones={p.milestones} />

          {p.done.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-500">已完成 {p.done.length} 项</summary>
              <ul className="mt-2 space-y-1">
                {p.done.map((t) => (
                  <li key={t.id}>
                    <TaskTitle task={t} className="text-zinc-400 line-through hover:text-foreground" />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <MonthCalendar today={p.today} month={p.month} items={p.calendar} upcoming={p.upcoming} />
      </div>
    </div>
  );
}

function Briefing({ today, lines, countdown, profileLine }: { today: string; lines: string[]; countdown: Countdown[]; profileLine: string }) {
  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-lg font-semibold">今日简报</h1>
        <span className="text-sm text-zinc-500">{formatToday(today)}</span>
      </div>
      {lines.map((l) => (
        <p key={l} className="text-sm leading-relaxed">
          {l}
        </p>
      ))}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        {countdown.length === 0 ? (
          <>
            还没有关键日期：在<Link href="/schools" className="underline">研究科</Link>里关注目标研究科后，这里会显示出愿截止和考试倒计时。
          </>
        ) : (
          countdown.map((c) => (
            <span key={c.label}>
              {c.label} <span className="font-medium text-foreground tabular-nums">{c.days === 0 ? "就是今天" : `还有 ${c.days} 天`}</span>
              {c.tentative && <span className="ml-1 rounded border border-dashed border-amber-500 px-1 text-xs text-amber-700">仮</span>}
              {c.sourceUrl && <SourceLink url={c.sourceUrl} />}
            </span>
          ))
        )}
      </p>
      <p className="text-xs text-zinc-400">{profileLine}</p>
    </section>
  );
}

function SourceLink({ url }: { url: string }) {
  return (
    <OpenTabLink tab={{ kind: "web", url, title: "募集要项" }} href={url} className="ml-1.5 text-xs whitespace-nowrap text-blue-600 hover:underline dark:text-blue-400">
      要项原文
    </OpenTabLink>
  );
}

function Proposals({ tasks, changes, events, count }: Props["proposals"] & { count: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <section className="space-y-2 rounded-lg border border-dashed border-zinc-400 px-4 py-3 dark:border-zinc-600">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">AI 的提议</h2>
        <span className="text-sm text-zinc-500">{count} 项，同意后才会正式加进任务和日历</span>
        <button disabled={pending} onClick={() => startTransition(() => acceptAllProposalsAction())} className={`${btn} ml-auto`}>
          全部同意
        </button>
      </div>
      <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="text-xs text-zinc-500">新任务</span>
            <TaskTitle task={t} className="min-w-0 flex-1 hover:underline" />
            {t.dueDate && <span className="text-xs text-zinc-500 tabular-nums">截止 {formatDay(t.dueDate)}</span>}
            <ProposalButtons kind="task" id={t.id} date={t.dueDate} />
          </li>
        ))}
        {changes.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="text-xs text-zinc-500">改截止日</span>
            <TaskTitle task={t} className="min-w-0 flex-1 hover:underline" />
            <span className="text-xs text-zinc-500 tabular-nums">
              {t.dueDate ? formatDay(t.dueDate) : "未定"} → {t.proposedChange!.dueDate ? formatDay(t.proposedChange!.dueDate) : "不设截止日"}
            </span>
            <ProposalButtons kind="task" id={t.id} date={t.proposedChange!.dueDate} />
          </li>
        ))}
        {events.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="text-xs text-zinc-500">{e.isNew ? "新日程" : "改期"}</span>
            <span className="min-w-0 flex-1">{e.title}</span>
            <span className="text-xs text-zinc-500 tabular-nums">
              {e.isNew ? formatRange(e.date, e.endDate) : `${formatRange(e.date, e.endDate)} → ${formatRange(e.change!.date, e.change!.endDate)}`}
            </span>
            <ProposalButtons kind="event" id={e.id} date={e.change?.date ?? e.date} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatRange(date: string, endDate?: string | null) {
  return endDate && endDate !== date ? `${formatDay(date)}〜${formatDay(endDate)}` : formatDay(date);
}

/** 点任务名：在文稿栏打开任务详情，AI 栏切到这个任务的对话 */
function TaskTitle({ task, className = "" }: { task: Pick<TaskView, "id" | "title">; className?: string }) {
  const { openTab } = useShell();
  const startTask = useStartTask();
  return (
    <button
      onClick={() => {
        startTask(task.id, false);
        openTab({ kind: "task", id: task.id, title: task.title });
      }}
      className={`text-left ${className}`}
    >
      {task.title}
    </button>
  );
}

function TaskCard({ task, today }: { task: HomeTask; today: string }) {
  const { openTab } = useShell();
  const steps = task.steps.length ? `${task.steps.filter((s) => s.done).length}/${task.steps.length}` : null;
  const overdue = task.dueDate && task.dueDate < today;
  return (
    <li className="space-y-1.5 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex items-start gap-2">
        <TaskTitle task={task} className="min-w-0 flex-1 text-sm hover:underline" />
        <StatusChip status={task.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        {task.dueDate && <span className={`tabular-nums ${overdue ? "text-red-600" : ""}`}>截止 {formatDay(task.dueDate)}</span>}
        {task.proposedChange && (
          <span className="rounded border border-dashed border-zinc-400 px-1">AI 提议改到 {task.proposedChange.dueDate ? formatDay(task.proposedChange.dueDate) : "不设截止日"}</span>
        )}
        {task.link && <span className="truncate">{task.link}</span>}
        {steps && <span className="tabular-nums">子步骤 {steps}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {task.status === "review" ? (
            <>
              <button
                onClick={() =>
                  task.documentId ? openTab({ kind: "doc", id: task.documentId, title: "草稿" }) : openTab({ kind: "task", id: task.id, title: task.title })
                }
                className={btn}
              >
                {task.documentId ? "查看草稿" : "查看"}
              </button>
              <CompleteButton id={task.id} label="确认完成" />
            </>
          ) : (
            <>
              <StartButton task={task} started={task.started} />
              <CompleteButton id={task.id} />
            </>
          )}
        </span>
      </div>
    </li>
  );
}

/** 之后：下周及以后的任务和官方日期（出愿截止、考试），按日期列出 */
function Later({ tasks, milestones }: { tasks: HomeTask[]; milestones: CalendarItem[] }) {
  type Row = { date: string; key: string; task?: HomeTask; item?: CalendarItem };
  const rows: Row[] = [
    ...tasks.map((t) => ({ date: t.dueDate!, key: t.id, task: t })),
    ...milestones.map((it) => ({ date: it.date, key: it.key, item: it })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-medium">之后</h2>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3">
            <span className="w-12 shrink-0 tabular-nums text-zinc-500">{formatDay(r.date)}</span>
            {r.task ? (
              <>
                <TaskTitle task={r.task} className="min-w-0 flex-1 truncate hover:underline" />
                <StatusChip status={r.task.status} />
              </>
            ) : (
              <span className="min-w-0 flex-1">
                <span className={`mr-1.5 rounded px-1 text-xs ${KIND_STYLES[r.item!.kind]}`}>{CALENDAR_KIND_LABELS[r.item!.kind]}</span>
                {r.item!.tentative && <span className="mr-1 rounded border border-dashed border-amber-500 px-1 text-xs text-amber-700">仮</span>}
                {r.item!.title}
                {r.item!.sourceUrl && <SourceLink url={r.item!.sourceUrl} />}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddTaskForm() {
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = title.trim();
        if (!value) return;
        setTitle("");
        startTransition(() => addTaskAction(value));
      }}
      className="flex gap-2"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="添加一个任务"
        className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
      />
      <button type="submit" disabled={pending} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
        添加
      </button>
    </form>
  );
}

// ---------- 月历 ----------

const DOT: Record<CalendarKind, string> = {
  deadline: "bg-red-500 border-red-500",
  exam: "bg-amber-500 border-amber-500",
  followup: "bg-sky-500 border-sky-500",
  other: "bg-zinc-400 border-zinc-400",
};

const KIND_STYLES: Record<CalendarKind, string> = {
  deadline: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  exam: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  followup: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  other: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 圆点：实心 = 正式日程；空心 = 仮（按往年要项推算）；虚线圈 = AI 提议，还没同意 */
function Dot({ item }: { item: Pick<CalendarItem, "kind" | "tentative" | "proposed" | "done"> }) {
  const base = "inline-block size-1.5 rounded-full border";
  if (item.proposed) return <span className={`${base} border-dashed bg-transparent ${DOT[item.kind].split(" ")[1]}`} />;
  if (item.tentative) return <span className={`${base} bg-transparent ${DOT[item.kind].split(" ")[1]}`} />;
  return <span className={`${base} ${DOT[item.kind]} ${item.done ? "opacity-40" : ""}`} />;
}

function MonthCalendar({ today, month, items, upcoming }: { today: string; month: string; items: CalendarItem[]; upcoming: CalendarItem[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const weeks = monthGrid(month);
  const [y, mm] = month.split("-");
  // AI 的改期提议：在提议的那天显示一个虚线圈
  const ghosts: CalendarItem[] = items.flatMap((it) =>
    it.proposedChange ? [{ ...it, key: `${it.key}:change`, date: it.proposedChange.date, endDate: it.proposedChange.endDate, proposed: true }] : [],
  );
  const all = [...items, ...ghosts];
  const list = selected ? itemsOn(all, selected) : upcoming;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <h2 className="font-medium">日历</h2>
        <div className="ml-auto flex items-center gap-1">
          <Link href={`/workbench?m=${shiftMonth(month, -1)}`} className="rounded px-1.5 text-zinc-500 hover:text-foreground" aria-label="上个月">
            ‹
          </Link>
          <span className="tabular-nums">
            {y} 年 {Number(mm)} 月
          </span>
          <Link href={`/workbench?m=${shiftMonth(month, 1)}`} className="rounded px-1.5 text-zinc-500 hover:text-foreground" aria-label="下个月">
            ›
          </Link>
          {month !== today.slice(0, 7) && (
            <Link href="/workbench" className="text-xs text-zinc-500 hover:text-foreground">
              今天
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-zinc-400">
            {d}
          </div>
        ))}
        {weeks.flat().map(({ date, inMonth }) => {
          const day = itemsOn(all, date);
          const isSel = selected === date;
          return (
            <button
              key={date}
              onClick={() => setSelected(isSel ? null : date)}
              className={`flex h-10 flex-col items-center gap-0.5 rounded pt-1 ${inMonth ? "" : "text-zinc-300 dark:text-zinc-600"} ${
                isSel ? "bg-zinc-200 dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              aria-label={`${date}${day.length ? `，${day.length} 项` : ""}`}
            >
              <span className={`tabular-nums ${date === today ? "rounded-full bg-foreground px-1.5 text-background" : ""}`}>{Number(date.slice(8))}</span>
              <span className="flex gap-0.5">
                {day.slice(0, 3).map((it) => (
                  <Dot key={it.key} item={it} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-zinc-400">
        <span>
          <Dot item={{ kind: "deadline" }} /> 截止
        </span>
        <span>
          <Dot item={{ kind: "exam" }} /> 考试
        </span>
        <span>
          <Dot item={{ kind: "followup" }} /> 跟进
        </span>
        <span>
          <Dot item={{ kind: "deadline", tentative: true }} /> 仮
        </span>
        <span>
          <Dot item={{ kind: "other", proposed: true }} /> AI 提议
        </span>
      </p>

      <div className="space-y-2">
        <h3 className="text-sm text-zinc-500">{selected ? `${formatDay(selected)} 的日程` : "近期 30 天"}</h3>
        {list.length === 0 ? (
          <p className="text-sm text-zinc-500">{selected ? "这天没有日程。" : "近期没有日程。"}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {list.map((it) => (
              <EventRow key={it.key} item={it} />
            ))}
          </ul>
        )}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-500">添加日程</summary>
        <AddEventForm key={selected ?? month} defaultDate={selected ?? (month === today.slice(0, 7) ? today : `${month}-01`)} />
      </details>
    </section>
  );
}

function EventRow({ item: it }: { item: CalendarItem }) {
  const { openTab } = useShell();
  const [pending, startTransition] = useTransition();
  const proposalKind = it.source === "todo" ? "task" : it.source === "event" ? "event" : null;
  const isProposal = it.proposed || it.proposedChange;
  return (
    <li className={`group space-y-0.5 rounded-md px-2 py-1.5 ${isProposal ? "border border-dashed border-zinc-400 dark:border-zinc-600" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="w-16 shrink-0 tabular-nums text-zinc-500">{formatRange(it.date, it.endDate)}</span>
        <span className="min-w-0 flex-1">
          <span className={`mr-1.5 rounded px-1 text-xs ${KIND_STYLES[it.kind]}`}>{CALENDAR_KIND_LABELS[it.kind]}</span>
          {it.tentative && <span className="mr-1 rounded border border-dashed border-amber-500 px-1 text-xs text-amber-700">仮</span>}
          {it.source === "todo" && it.sourceId ? (
            <button onClick={() => openTab({ kind: "task", id: it.sourceId!, title: it.title })} className="text-left hover:underline">
              {it.title}
            </button>
          ) : (
            it.title
          )}
          {it.sourceUrl && <SourceLink url={it.sourceUrl} />}
        </span>
        {it.source === "event" && it.sourceId && !isProposal && (
          <button
            disabled={pending}
            onClick={() => startTransition(() => deleteEventAction(it.sourceId!))}
            className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600"
          >
            删除
          </button>
        )}
      </div>
      {it.note && <p className="pl-[4.5rem] text-xs text-zinc-500">{it.note}</p>}
      {isProposal && proposalKind && it.sourceId && (
        <div className="flex flex-wrap items-center gap-2 pl-[4.5rem] text-xs text-zinc-500">
          <span>{it.proposed && !it.proposedChange ? "AI 提议" : `AI 提议改到 ${it.proposedChange ? formatRange(it.proposedChange.date, it.proposedChange.endDate) : ""}`}</span>
          <ProposalButtons kind={proposalKind} id={it.sourceId} date={it.proposedChange?.date ?? it.date} />
        </div>
      )}
    </li>
  );
}

const input = "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

function AddEventForm({ defaultDate }: { defaultDate: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", date: defaultDate, endDate: "", kind: "other" as CalendarKind, note: "" });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await addEventAction(form);
          if (res.ok) setForm((f) => ({ ...f, title: "", endDate: "", note: "" }));
          else setError(res.error);
        });
      }}
      className="mt-2 space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="标题，如 JLPT N1 考试" className={input} />
      <div className="flex gap-2">
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${input} min-w-0`} required />
        <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={`${input} min-w-0`} title="结束日期（可选）" />
      </div>
      <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CalendarKind })} className={input}>
        {CALENDAR_KINDS.map((k) => (
          <option key={k} value={k}>
            {CALENDAR_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注（可选）" className={input} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="rounded-md bg-foreground px-3 py-1.5 text-background disabled:opacity-50">
        {pending ? "添加中…" : "添加"}
      </button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useStartTask } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { btn, formatDay, primaryBtn, ProposalButtons, StartButton, StatusSelect } from "@/components/tasks/task-ui";
import { DateInput } from "@/components/ui/date-input";
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS, itemsOn, monthGrid, shiftMonth, type CalendarItem, type CalendarKind } from "@/lib/calendar";
import { AGENDA_DAYS, type AgendaRow, type Countdown, type TaskView } from "@/lib/tasks";
import type { GuideChange } from "@/lib/admissions";
import { acceptAllProposalsAction, addEventAction, addTaskAction, deleteEventAction, setTaskStatusAction, updateEventAction } from "./actions";

export type HomeTask = TaskView & {
  /** 这个任务已经有对话（按钮显示「继续和 AI 做」） */
  started: boolean;
  /** 关联对象的名字（教授 / 文书 / 研究科） */
  link: string | null;
};

type ProposedEvent = { id: string; title: string; date: string; endDate: string | null; change: { date: string; endDate: string | null } | null; isNew: boolean };
/** AI 对志愿里教授跟进日的提议 */
type ProposedFollowUp = { id: string; name: string; date: string | null; proposed: string | null };

type GuideAlert = {
  schoolId: string;
  school: string;
  admissionYear: number;
  sourceUrl: string;
  changes: GuideChange[];
  /** 监控同时加的「查看新要项」任务 */
  task: { id: string; title: string; started: boolean } | null;
};

type Props = {
  today: string;
  month: string;
  profileLine: string;
  briefing: string[];
  countdown: Countdown[];
  alerts: GuideAlert[];
  /** 待你确认的任务（和 AI 的提议一起放在「等你处理」） */
  review: HomeTask[];
  proposals: { tasks: HomeTask[]; changes: HomeTask[]; events: ProposedEvent[]; followUps: ProposedFollowUp[] };
  /** 待办和日程：近 7 天有日期的（含已过期的任务）、没有日期的任务、更远的 */
  near: AgendaRow<HomeTask>[];
  undated: HomeTask[];
  far: AgendaRow<HomeTask>[];
  done: HomeTask[];
  /** 全部任务，日历里点某天时，待办也显示状态和「让 AI 开始」 */
  tasks: HomeTask[];
  calendar: CalendarItem[];
};

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function formatToday(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 周${WEEKDAY_NAMES[d.getUTCDay()]}`;
}

export function Home(p: Props) {
  const proposalCount = p.proposals.tasks.length + p.proposals.changes.length + p.proposals.events.length + p.proposals.followUps.length;
  return (
    <div className="@container mx-auto max-w-5xl space-y-6">
      <Briefing today={p.today} lines={p.briefing} countdown={p.countdown} profileLine={p.profileLine} />
      {p.alerts.map((a) => (
        <GuideAlertCard key={`${a.schoolId}:${a.admissionYear}`} alert={a} />
      ))}
      {proposalCount + p.review.length > 0 && <Awaiting review={p.review} {...p.proposals} proposalCount={proposalCount} today={p.today} />}

      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
        <Agenda near={p.near} undated={p.undated} far={p.far} done={p.done} today={p.today} />

        <MonthCalendar today={p.today} month={p.month} items={p.calendar} tasks={p.tasks} />
      </div>
    </div>
  );
}

function Briefing({ today, lines, countdown, profileLine }: { today: string; lines: string[]; countdown: Countdown[]; profileLine: string }) {
  return (
    <section className="space-y-3 rounded-xl bg-subtle/70 px-5 py-5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="page-title">今日简报</h1>
        <span className="text-sm text-muted">{formatToday(today)}</span>
      </div>
      {lines.map((l) => (
        <p key={l} className="leading-relaxed">
          {l}
        </p>
      ))}
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {countdown.length === 0 ? (
          <>
            还没有关键日期：<Link href="/aspirations" className="underline">志愿</Link>里有了研究科后，这里会显示出愿截止和考试倒计时。
          </>
        ) : (
          countdown.map((c) => (
            <span key={c.label} className="rounded-md bg-surface px-2.5 py-1">
              {c.label} <span className="font-medium text-foreground tabular-nums">{c.days === 0 ? "就是今天" : `还有 ${c.days} 天`}</span>
              {c.tentative && <span className="ml-1 rounded border border-dashed border-warn px-1 text-xs text-warn">仮</span>}
              {c.sourceUrl && <SourceLink url={c.sourceUrl} />}
            </span>
          ))
        )}
      </p>
      <p className="text-xs text-faint">{profileLine}</p>
    </section>
  );
}

function SourceLink({ url }: { url: string }) {
  return (
    <OpenTabLink tab={{ kind: "web", url, title: "募集要项" }} href={url} className="ml-1.5 text-xs whitespace-nowrap text-accent hover:underline">
      要项原文
    </OpenTabLink>
  );
}

/** 新募集要项公布：对照之前的仮日程，让 AI 提议调整自己的安排（提议要用户同意） */
function GuideAlertCard({ alert: a }: { alert: GuideAlert }) {
  const { openTab } = useShell();
  const startTask = useStartTask();
  const [pending, startTransition] = useTransition();
  return (
    <section className="space-y-2 rounded-xl bg-info-soft px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-medium">
          {a.school} {a.admissionYear} 年度募集要项已公布
        </h2>
        <SourceLink url={a.sourceUrl} />
      </div>
      <ul className="space-y-0.5 text-sm">
        {a.changes.map((e) => (
          <li key={`${e.label}:${e.date}`} className="flex flex-wrap gap-x-2">
            <span className="tabular-nums">{formatRange(e.date, e.endDate)}</span>
            <span>{e.label}</span>
            {e.before && <span className="text-xs text-muted">（之前是 {formatRange(e.before.date, e.before.endDate)}）</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">日历已经换成正式日程。你自己的任务和日程要不要跟着调，可以让 AI 对照一下，它会提议改动，你同意后才生效。</p>
      {a.task && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              startTask(a.task!.id);
              openTab({ kind: "task", id: a.task!.id, title: a.task!.title });
            }}
            className="btn-primary px-2.5 py-1 text-xs"
          >
            {a.task.started ? "继续和 AI 看" : "让 AI 提议调整日程"}
          </button>
          <button disabled={pending} onClick={() => startTransition(() => setTaskStatusAction(a.task!.id, "done"))} className={btn}>
            知道了
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * 等你处理：待你确认的任务和 AI 的提议都是「等你点一下」，放在一个虚线框里。
 * 提议仍然是虚线、仍然要用户点同意才生效；待你确认的任务仍然只有用户能标完成。
 */
function Awaiting({ review, tasks, changes, events, followUps, proposalCount, today }: Props["proposals"] & { review: HomeTask[]; proposalCount: number; today: string }) {
  const [pending, startTransition] = useTransition();
  const { openTab } = useShell();
  return (
    <section className="space-y-1 rounded-xl border border-dashed border-line-strong px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title text-foreground">等你处理</h2>
        <span className="text-xs text-muted">{review.length + proposalCount} 项 · 点一下就好；AI 的提议同意后才会加进任务和日历</span>
        {proposalCount > 1 && (
          <button disabled={pending} onClick={() => startTransition(() => acceptAllProposalsAction())} className={`${btn} ml-auto`}>
            全部同意提议
          </button>
        )}
      </div>
      <ul className="divide-y divide-line text-sm">
        {review.map((t) => (
          <li key={t.id} className="agenda-row py-2">
            <span className="ar-date pt-px text-xs text-warn">待你确认</span>
            <span className="ar-title min-w-0">
              <span className="ar-inline-date mr-1.5 rounded bg-warn-soft px-1 text-xs text-warn">待你确认</span>
              <TaskTitle task={t} className="hover:underline" />
            </span>
            <span className="ar-status" />
            <span className="ar-meta flex flex-wrap gap-x-3 text-xs text-muted">
              <span>AI 做好了，看一下结果</span>
              {t.link && <span className="truncate">{t.link}</span>}
              {t.dueDate && <DateText date={t.dueDate} today={today} overdue={t.dueDate < today} />}
            </span>
            <span className="ar-action">
              <button
                onClick={() => (t.documentId ? openTab({ kind: "doc", id: t.documentId, title: "草稿" }) : openTab({ kind: "task", id: t.id, title: t.title }))}
                className={t === review[0] ? primaryBtn : btn}
              >
                {t.documentId ? "看草稿" : "看看"}
              </button>
            </span>
          </li>
        ))}
        {tasks.map((t) => (
          <ProposalRow key={t.id} label="新任务" title={<TaskTitle task={t} className="hover:underline" />} when={t.dueDate && `截止 ${formatDay(t.dueDate)}`}>
            <ProposalButtons kind="task" id={t.id} date={t.dueDate} />
          </ProposalRow>
        ))}
        {changes.map((t) => (
          <ProposalRow
            key={t.id}
            label="改截止日"
            title={<TaskTitle task={t} className="hover:underline" />}
            when={`${t.dueDate ? formatDay(t.dueDate) : "未定"} → ${t.proposedChange!.dueDate ? formatDay(t.proposedChange!.dueDate) : "不设截止日"}`}
          >
            <ProposalButtons kind="task" id={t.id} date={t.proposedChange!.dueDate} />
          </ProposalRow>
        ))}
        {events.map((e) => (
          <ProposalRow
            key={e.id}
            label={e.isNew ? "新日程" : "改期"}
            title={e.title}
            when={e.isNew ? formatRange(e.date, e.endDate) : `${formatRange(e.date, e.endDate)} → ${formatRange(e.change!.date, e.change!.endDate)}`}
          >
            <ProposalButtons kind="event" id={e.id} date={e.change?.date ?? e.date} />
          </ProposalRow>
        ))}
        {followUps.map((f) => (
          <ProposalRow key={f.id} label="跟进日" title={`跟进 ${f.name}`} when={`${f.date ? formatDay(f.date) : "未定"} → ${f.proposed ? formatDay(f.proposed) : "取消跟进日"}`}>
            <ProposalButtons kind="professor" id={f.id} date={f.proposed} editable={!!f.proposed} />
          </ProposalRow>
        ))}
      </ul>
    </section>
  );
}

/** AI 提议的一行：窄的时候按钮放到第二行，标题不被挤（同待办和日程的行） */
function ProposalRow({ label, title, when, children }: { label: string; title: React.ReactNode; when?: string | null | false; children: React.ReactNode }) {
  return (
    <li className="agenda-row py-2">
      <span className="ar-date pt-px text-xs text-muted">{label}</span>
      <span className="ar-title min-w-0">
        <span className="ar-inline-date mr-1.5 text-xs text-muted">{label}</span>
        {title}
      </span>
      <span className="ar-status" />
      <span className="ar-meta text-xs text-muted tabular-nums">{when || null}</span>
      <span className="ar-action">{children}</span>
    </li>
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

/** 「随时可以做」默认露几条 */
const UNDATED_SHOWN = 2;

/** 待办和日程：有日期的按日期排在上（默认近 7 天，展开看更远），没有日期的任务收在下面 */
function Agenda({ near, undated, far, done, today }: { near: AgendaRow<HomeTask>[]; undated: HomeTask[]; far: AgendaRow<HomeTask>[]; done: HomeTask[]; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const [allUndated, setAllUndated] = useState(false);
  const row = (r: AgendaRow<HomeTask>) => (r.task ? <TaskRow key={r.task.id} task={r.task} today={today} /> : <EventRow key={r.item.key} item={r.item} today={today} />);
  const shownUndated = allUndated ? undated : undated.slice(0, UNDATED_SHOWN);
  const group = "section-title border-t border-line bg-subtle/50 px-4 py-1.5 text-xs";
  return (
    <section className="@container card self-start">
      <div className="card-head">
        <h2 className="card-title">待办和日程</h2>
        <span className="text-xs text-muted tabular-nums">
          近 {AGENDA_DAYS} 天 {near.length} 项{undated.length > 0 && ` · 没日期 ${undated.length} 项`}
          {far.length > 0 && ` · 更远 ${far.length} 项`}
        </span>
      </div>
      {near.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">近 {AGENDA_DAYS} 天没有到期的待办和日程。</p>
      ) : (
        <ul className="divide-y divide-line px-4">{near.map(row)}</ul>
      )}
      {expanded && far.length > 0 && (
        <>
          <p className={group}>{AGENDA_DAYS} 天以后</p>
          <ul className="divide-y divide-line border-t border-line px-4">{far.map(row)}</ul>
        </>
      )}
      {far.length > 0 && (
        <button onClick={() => setExpanded(!expanded)} className="card-foot block w-full text-left text-sm text-muted hover:bg-subtle hover:text-foreground">
          {expanded ? `收起，只看近 ${AGENDA_DAYS} 天` : `展开更远的 ${far.length} 项`}
        </button>
      )}
      {undated.length > 0 && (
        <>
          <p className={group}>随时可以做（没有日期）· {undated.length} 项</p>
          <ul className="divide-y divide-line border-t border-line px-4">
            {shownUndated.map((t) => (
              <TaskRow key={t.id} task={t} today={today} />
            ))}
          </ul>
          {undated.length > UNDATED_SHOWN && (
            <button onClick={() => setAllUndated(!allUndated)} className="card-foot block w-full text-left text-sm text-muted hover:bg-subtle hover:text-foreground">
              {allUndated ? "收起" : `展开其余 ${undated.length - UNDATED_SHOWN} 项`}
            </button>
          )}
        </>
      )}
      <div className="card-foot px-2">
        <AddTaskForm />
      </div>
      {done.length > 0 && (
        <details className="card-foot text-sm">
          <summary className="cursor-pointer py-1 text-muted hover:text-foreground">已完成 {done.length} 项</summary>
          <ul className="divide-y divide-line">
            {done.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <TaskTitle task={t} className="min-w-0 flex-1 text-faint line-through hover:text-foreground" />
                <StatusSelect id={t.id} status={t.status} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 日期：任务是截止日（没有就不显示），日程是当天或起止 */
function DateText({ date, endDate, today, overdue = false, className = "" }: { date: string | null; endDate?: string | null; today: string; overdue?: boolean; className?: string }) {
  if (!date) return null;
  return (
    <span className={`whitespace-nowrap text-xs tabular-nums ${overdue ? "text-danger" : date === today ? "font-medium text-accent" : "text-muted"} ${className}`}>
      {date === today && !endDate ? "今天" : formatRange(date, endDate)}
    </span>
  );
}

function TaskRow({ task, today }: { task: HomeTask; today: string }) {
  const { openTab } = useShell();
  const steps = task.steps.length ? `${task.steps.filter((s) => s.done).length}/${task.steps.length}` : null;
  const overdue = !!task.dueDate && task.dueDate < today;
  const meta = [task.link, steps && `子步骤 ${steps}`, overdue && "已过截止日"].filter(Boolean);
  return (
    <li className="agenda-row py-2.5 text-sm">
      <span className="ar-date pt-px">
        <DateText date={task.dueDate} today={today} overdue={overdue} />
      </span>
      <TaskTitle task={task} className="ar-title font-medium hover:underline" />
      <span className="ar-status">
        <StatusSelect id={task.id} status={task.status} />
      </span>
      <div className="ar-meta flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <DateText date={task.dueDate} today={today} overdue={overdue} className="ar-inline-date" />
        {meta.map((m) => (
          <span key={String(m)} className={m === "已过截止日" ? "text-danger" : "truncate"}>
            {m}
          </span>
        ))}
        {task.proposedChange && (
          <span className="rounded border border-dashed border-line-strong px-1">AI 提议改到 {task.proposedChange.dueDate ? formatDay(task.proposedChange.dueDate) : "不设截止日"}</span>
        )}
      </div>
      <span className="ar-action">
        {task.status === "review" ? (
          <button
            onClick={() => (task.documentId ? openTab({ kind: "doc", id: task.documentId, title: "草稿" }) : openTab({ kind: "task", id: task.id, title: task.title }))}
            className={btn}
          >
            {task.documentId ? "查看草稿" : "查看"}
          </button>
        ) : (
          <StartButton task={task} started={task.started} />
        )}
      </span>
    </li>
  );
}

function AddTaskForm() {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = title.trim();
        if (!value) return;
        setTitle("");
        setDueDate("");
        startTransition(async () => {
          await addTaskAction({ title: value, dueDate });
        });
      }}
      className="flex gap-2"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="＋ 添加一个任务"
        className="input min-w-0 flex-1 border-transparent bg-transparent px-2 py-1.5 text-sm hover:bg-subtle focus:bg-surface"
      />
      <DateInput
        value={dueDate}
        onChange={setDueDate}
        placeholder="截止日"
        clearable
        title="截止日（可选）"
        className="w-32 shrink-0 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle"
      />
      <button type="submit" disabled={pending || !title.trim()} className="btn px-3 py-1.5 text-sm">
        添加
      </button>
    </form>
  );
}

// ---------- 月历 ----------

const DOT: Record<CalendarKind, string> = {
  deadline: "bg-danger border-danger",
  exam: "bg-warn border-warn",
  followup: "bg-info border-info",
  other: "bg-faint border-line-strong",
};

const KIND_STYLES: Record<CalendarKind, string> = {
  deadline: "bg-danger-soft text-danger",
  exam: "bg-warn-soft text-warn",
  followup: "bg-info-soft text-info",
  other: "bg-subtle text-muted",
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 圆点：实心 = 正式日程；空心 = 仮（按往年要项推算）；虚线圈 = AI 提议，还没同意 */
function Dot({ item }: { item: Pick<CalendarItem, "kind" | "tentative" | "proposed" | "done"> & { source?: CalendarItem["source"] } }) {
  if (item.source === "todo") {
    const box = "inline-block size-1.5 rounded-[1px] border border-accent";
    return <span className={`${box} ${item.proposed ? "border-dashed bg-transparent" : item.done ? "bg-transparent opacity-40" : "bg-accent"}`} />;
  }
  const base = "inline-block size-1.5 rounded-full border";
  if (item.proposed) return <span className={`${base} border-dashed bg-transparent ${DOT[item.kind].split(" ")[1]}`} />;
  if (item.tentative) return <span className={`${base} bg-transparent ${DOT[item.kind].split(" ")[1]}`} />;
  return <span className={`${base} ${DOT[item.kind]} ${item.done ? "opacity-40" : ""}`} />;
}

function MonthCalendar({ today, month, items, tasks }: { today: string; month: string; items: CalendarItem[]; tasks: HomeTask[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const weeks = monthGrid(month);
  const [y, mm] = month.split("-");
  // AI 的改期提议：在提议的那天显示一个虚线圈
  const ghosts: CalendarItem[] = items.flatMap((it) =>
    it.proposedChange ? [{ ...it, key: `${it.key}:change`, date: it.proposedChange.date, endDate: it.proposedChange.endDate, proposed: true }] : [],
  );
  const all = [...items, ...ghosts];
  const list = selected ? itemsOn(all, selected) : [];

  return (
    <section className="@container card self-start">
        <div className="card-head text-sm">
          <h2 className="card-title">日历</h2>
          <div className="ml-auto flex items-center gap-1">
            <Link href={`/workbench?m=${shiftMonth(month, -1)}`} className="rounded px-1.5 text-muted hover:text-foreground" aria-label="上个月">
              ‹
            </Link>
            <span className="tabular-nums">
              {y} 年 {Number(mm)} 月
            </span>
            <Link href={`/workbench?m=${shiftMonth(month, 1)}`} className="rounded px-1.5 text-muted hover:text-foreground" aria-label="下个月">
              ›
            </Link>
            {month !== today.slice(0, 7) && (
              <Link href="/workbench" className="text-xs text-muted hover:text-foreground">
                今天
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-7 px-2 pt-2 text-center text-xs">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1 text-faint">
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
                className={`flex h-10 flex-col items-center gap-0.5 rounded pt-1 ${inMonth ? "" : "text-faint"} ${
                  isSel ? "bg-subtle-strong" : "hover:bg-subtle"
                }`}
                aria-label={`${date}${day.length ? `，${day.length} 项` : ""}`}
              >
                <span className={`tabular-nums ${date === today ? "rounded-full bg-primary px-1.5 text-on-primary" : ""}`}>{Number(date.slice(8))}</span>
                <span className="flex gap-0.5">
                  {day.slice(0, 3).map((it) => (
                    <Dot key={it.key} item={it} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <p className="flex flex-wrap gap-x-3 px-4 pt-1 pb-3 text-xs text-faint">
          <span>
            <Dot item={{ kind: "deadline", source: "todo" }} /> 待办
          </span>
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

        {selected && (
          <div className="border-t border-line px-4 py-2">
            <p className="section-title py-1 text-xs">{formatDay(selected)}</p>
            {list.length === 0 ? (
              <p className="py-1 text-sm text-muted">这天没有安排。</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((it) => {
                  // 待办和待办列表里一样：有状态和「让 AI 开始」；AI 提议的待办还走提议按钮
                  const task = it.source === "todo" && !it.proposed && !it.proposedChange ? taskById.get(it.sourceId ?? "") : undefined;
                  return task ? <TaskRow key={it.key} task={task} today={today} /> : <EventRow key={it.key} item={it} today={today} />;
                })}
              </ul>
            )}
          </div>
        )}

        <details className="card-foot text-sm">
          <summary className="cursor-pointer py-1 text-muted hover:text-foreground">＋ 添加</summary>
          <AddForm key={selected ?? month} defaultDate={selected ?? (month === today.slice(0, 7) ? today : `${month}-01`)} />
        </details>
    </section>
  );
}

function EventRow({ item: it, today }: { item: CalendarItem; today: string }) {
  const { openTab } = useShell();
  const [pending, startTransition] = useTransition();
  const proposalKind = it.source === "todo" ? "task" : it.source === "event" ? "event" : it.source === "professor" ? "professor" : null;
  const isProposal = it.proposed || it.proposedChange;
  const [editing, setEditing] = useState(false);
  if (editing && it.sourceId) {
    const id = it.sourceId;
    return (
      <li className="py-2.5">
        <EventForm
          initial={{ title: it.title, date: it.date, endDate: it.endDate ?? "", kind: it.kind, note: it.note ?? "" }}
          submitLabel="保存"
          onSubmit={async (form) => {
            const res = await updateEventAction(id, form);
            if (res.ok) setEditing(false);
            return res;
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="group agenda-row py-2.5 text-sm">
      <span className="ar-date pt-px">
        <DateText date={it.date} endDate={it.endDate} today={today} />
      </span>
      <span className="ar-title min-w-0">
        <span className={`mr-1.5 rounded px-1 text-xs ${KIND_STYLES[it.kind]}`}>{CALENDAR_KIND_LABELS[it.kind]}</span>
        {it.tentative && <span className="mr-1 rounded border border-dashed border-warn px-1 text-xs text-warn">仮</span>}
        {it.source === "todo" && it.sourceId ? (
          <button onClick={() => openTab({ kind: "task", id: it.sourceId!, title: it.title })} className="text-left hover:underline">
            {it.title}
          </button>
        ) : (
          it.title
        )}
        {it.sourceUrl && <SourceLink url={it.sourceUrl} />}
      </span>
      <span className="ar-status">
        {it.source === "event" && it.sourceId && !isProposal && (
          <span className="flex shrink-0 gap-2 text-xs text-faint opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
            <button onClick={() => setEditing(true)} className="hover:text-foreground">
              编辑
            </button>
            <button disabled={pending} onClick={() => startTransition(() => deleteEventAction(it.sourceId!))} className="hover:text-danger">
              删除
            </button>
          </span>
        )}
      </span>
      <div className="ar-meta min-w-0 space-y-1 text-xs text-muted">
        <p className="ar-inline-date">
          <DateText date={it.date} endDate={it.endDate} today={today} />
        </p>
        {it.note && <p>{it.note}</p>}
        {isProposal && proposalKind && it.sourceId && (
          <p>{it.proposed && !it.proposedChange ? "AI 提议" : `AI 提议改到 ${it.proposedChange ? formatRange(it.proposedChange.date, it.proposedChange.endDate) : ""}`}</p>
        )}
      </div>
      <span className="ar-action">
        {isProposal && proposalKind && it.sourceId && <ProposalButtons kind={proposalKind} id={it.sourceId} date={it.proposedChange?.date ?? it.date} />}
      </span>
    </li>
  );
}

const input = "input w-full px-3 py-1.5 text-sm";

type EventFormValues = { title: string; date: string; endDate: string; kind: CalendarKind; note: string };

/** 日历里的添加框，和 Google 日历一样顶部切换：待办（有状态，可以让 AI 开始）或日程（截止、考试这类时间点） */
function AddForm({ defaultDate }: { defaultDate: string }) {
  const [mode, setMode] = useState<"task" | "event">("task");
  const tab = (m: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-md px-2.5 py-1 text-xs ${mode === m ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-subtle p-3">
      <div className="inline-flex rounded-lg bg-subtle-strong p-0.5">
        {tab("task", "待办")}
        {tab("event", "日程")}
      </div>
      {mode === "task" ? (
        <TaskForm defaultDate={defaultDate} />
      ) : (
        <EventForm
          initial={{ title: "", date: defaultDate, endDate: "", kind: "other", note: "" }}
          submitLabel="添加"
          resetAfterSubmit
          bare
          onSubmit={(form) => addEventAction(form)}
        />
      )}
    </div>
  );
}

function TaskForm({ defaultDate }: { defaultDate: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", dueDate: defaultDate, note: "" });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await addTaskAction(form);
          if (res.ok) setForm((f) => ({ ...f, title: "", note: "" }));
          else setError(res.error);
        });
      }}
      className="space-y-2"
    >
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="要做的事，如 给佐藤教授发邮件" className={input} />
      <DateInput value={form.dueDate} onChange={(dueDate) => setForm({ ...form, dueDate })} placeholder="截止日（可选）" clearable className={input} title="截止日（可选）" />
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注（可选）" className={input} />
      {error && <p className="text-xs text-danger">{error}</p>}
      <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5">
        {pending ? "添加中…" : "添加待办"}
      </button>
    </form>
  );
}

/** 添加和编辑日程共用的表单 */
function EventForm({
  initial,
  submitLabel,
  resetAfterSubmit = false,
  bare = false,
  onSubmit,
  onCancel,
}: {
  initial: EventFormValues;
  submitLabel: string;
  resetAfterSubmit?: boolean;
  /** 放在别的容器里时不要自己的底色和边距 */
  bare?: boolean;
  onSubmit: (form: EventFormValues) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(initial);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await onSubmit(form);
          if (!res.ok) setError(res.error);
          else if (resetAfterSubmit) setForm((f) => ({ ...f, title: "", endDate: "", note: "" }));
        });
      }}
      className={bare ? "space-y-2" : "mt-2 space-y-2 rounded-xl bg-subtle p-3"}
    >
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="标题，如 JLPT N1 考试" className={input} autoFocus={!!onCancel} />
      <div className="flex gap-2">
        <DateInput value={form.date} onChange={(date) => setForm({ ...form, date })} className={input} required title="日期" />
        <DateInput value={form.endDate} onChange={(endDate) => setForm({ ...form, endDate })} placeholder="结束日期（可选）" clearable className={input} title="结束日期（可选）" />
      </div>
      <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CalendarKind })} className={input}>
        {CALENDAR_KINDS.map((k) => (
          <option key={k} value={k}>
            {CALENDAR_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注（可选）" className={input} />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5">
          {pending ? `${submitLabel}中…` : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost px-3 py-1.5">
            取消
          </button>
        )}
      </div>
    </form>
  );
}

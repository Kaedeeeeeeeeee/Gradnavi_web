"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useStartTask } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { btn, formatDay, primaryBtn, ProposalButtons, StartButton, StatusCircle } from "@/components/tasks/task-ui";
import { DateInput } from "@/components/ui/date-input";
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS, cellLabel, itemsOn, monthGrid, shiftMonth, type CalendarItem, type CalendarKind } from "@/lib/calendar";
import { AGENDA_DAYS, groupTasksByProject, shortTitle, TASK_AREA_LABELS, type AgendaRow, type Countdown, type TaskGroupKey, type TaskView } from "@/lib/tasks";
import type { GuideChange } from "@/lib/admissions";
import { acceptAllProposalsAction, addEventAction, addTaskAction, deleteEventAction, setTaskStatusAction, updateEventAction } from "./actions";

export type HomeTask = TaskView & {
  /** 这个任务已经有对话（按钮显示「继续和 AI 做」） */
  started: boolean;
  /** 关联对象的名字（教授 / 文书 / 研究科） */
  link: string | null;
};

export type GroupNames = {
  professors: Record<string, { name: string; school: string }>;
  schools: Record<string, { name: string; url: string | null }>;
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
  /** 日历显示的月份（YYYY-MM），一页一个月 */
  month: string;
  profileLine: string;
  briefing: string[];
  countdown: Countdown[];
  alerts: GuideAlert[];
  /** credit 用完、募集要项监控暂停了的研究科 */
  pausedMonitors: string[];
  /** 待你确认的任务（和 AI 的提议一起放在「等你处理」） */
  review: HomeTask[];
  proposals: { tasks: HomeTask[]; changes: HomeTask[]; events: ProposedEvent[]; followUps: ProposedFollowUp[] };
  /** 待办和日程：近 7 天有日期的（含已过期的任务）、其余任务（按教授 / 研究科 / 分类分组）、更远的日程 */
  near: AgendaRow<HomeTask>[];
  rest: HomeTask[];
  far: AgendaRow<HomeTask>[];
  /** 分组的组名：教授（名字 + 学校）、研究科 */
  groupNames: GroupNames;
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
      {p.pausedMonitors.length > 0 && <MonitorPaused schools={p.pausedMonitors} />}
      {proposalCount + p.review.length > 0 && <Awaiting review={p.review} {...p.proposals} proposalCount={proposalCount} today={p.today} />}

      <div className="grid gap-6 @3xl:grid-cols-2">
        <Agenda near={p.near} rest={p.rest} far={p.far} done={p.done} names={p.groupNames} today={p.today} />

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

/** credit 用完，募集要项监控暂停了：补充后自动恢复 */
function MonitorPaused({ schools }: { schools: string[] }) {
  return (
    <section className="space-y-1.5 rounded-xl bg-warn-soft px-4 py-3">
      <h2 className="font-medium">credit 用完了，募集要项监控已暂停</h2>
      <p className="text-sm">
        {schools.join("、")}：新要项公布时日历不会自动更新，也不会通知你。补充 credit 后，下次检查（每天一次）会自动恢复。
      </p>
      <Link href="/credits" className="btn-primary inline-block px-2.5 py-1 text-xs">
        查看 credit
      </Link>
    </section>
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
function TaskTitle({ task, label, className = "" }: { task: Pick<TaskView, "id" | "title">; label?: string; className?: string }) {
  const { openTab } = useShell();
  const startTask = useStartTask();
  return (
    <button
      onClick={() => {
        startTask(task.id, false);
        openTab({ kind: "task", id: task.id, title: task.title });
      }}
      title={label && label !== task.title ? task.title : undefined}
      className={`text-left ${className}`}
    >
      {label ?? task.title}
    </button>
  );
}

/** 「展开 / 收起」：一行淡灰小字，带箭头，一看就知道能点 */
function ExpandButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-expanded={open} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-subtle hover:text-foreground">
      <svg viewBox="0 0 16 16" aria-hidden className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}>
        <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </button>
  );
}

/** 分组小标题：组名 + 灰色补充（学校、项数） */
function GroupHead({ children, sub, strong = false }: { children: React.ReactNode; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <h3 className={`flex min-w-0 items-baseline gap-2 px-2 pt-3 pb-0.5 text-xs font-semibold ${strong ? "text-foreground" : "text-muted"}`}>
      <span className="shrink-0">{children}</span>
      {sub && <span className="truncate font-normal text-faint">{sub}</span>}
    </h3>
  );
}

/**
 * 待办和日程（像 Things 3 / Todoist 的清单）：
 * - 上面「近 7 天」：有日期的任务和日程按日期排；更远的日程收在「之后还有 N 项」
 * - 下面其余任务按项目分组：每位教授一组、每个研究科一组，其余按分类（语言考试 / 专业课和备考 / 申请准备 / 其他）
 * 每行只有状态圆圈、标题、行尾日期；「让 AI 开始」鼠标停上去才出现。
 */
function Agenda({ near, rest, far, done, names, today }: { near: AgendaRow<HomeTask>[]; rest: HomeTask[]; far: AgendaRow<HomeTask>[]; done: HomeTask[]; names: GroupNames; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const row = (r: AgendaRow<HomeTask>) => (r.task ? <TaskRow key={r.task.id} task={r.task} today={today} /> : <EventRow key={r.item.key} item={r.item} today={today} />);
  const groups = groupTasksByProject(rest);
  const onlyOther = groups.length === 1 && groups[0].key.kind === "area" && groups[0].key.area === "other";
  return (
    <section className="@container card self-start">
      <div className="card-head">
        <h2 className="card-title">待办和日程</h2>
        <button onClick={() => setAdding(true)} aria-label="添加任务" title="添加任务" className="ml-auto grid size-6 place-items-center rounded-md text-lg leading-none text-faint hover:bg-subtle hover:text-foreground">
          ＋
        </button>
      </div>
      <div className="px-2 pb-2">
        <GroupHead>近 {AGENDA_DAYS} 天</GroupHead>
        {near.length === 0 ? <p className="px-2 py-1.5 text-sm text-faint">近 {AGENDA_DAYS} 天没有到期的待办和日程。</p> : <ul>{near.map(row)}</ul>}
        {expanded && far.length > 0 && <ul>{far.map(row)}</ul>}
        {far.length > 0 && (
          <ExpandButton open={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起之后的日程" : `之后还有 ${far.length} 项日程`}
          </ExpandButton>
        )}

        {groups.map((g) => {
          const head = groupHead(g.key, names, onlyOther);
          return (
            <div key={head.id}>
              <GroupHead strong sub={head.sub}>
                {head.tab ? (
                  <OpenTabLink tab={head.tab} href={head.href ?? "/aspirations"} className="hover:underline">
                    {head.name}
                  </OpenTabLink>
                ) : (
                  head.name
                )}
              </GroupHead>
              <ul>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} label={g.key.kind === "professor" ? shortTitle(t.title, names.professors[g.key.id]?.name ?? "") : undefined} />
                ))}
              </ul>
            </div>
          );
        })}

        <AddTaskForm open={adding} onOpenChange={setAdding} />
      </div>
      {done.length > 0 && (
        <details className="card-foot text-sm">
          <summary className="cursor-pointer py-1 text-muted hover:text-foreground">已完成 {done.length} 项</summary>
          <ul className="-mx-2">
            {done.map((t) => (
              <li key={t.id} className="todo-row">
                <StatusCircle id={t.id} status={t.status} />
                <TaskTitle task={t} className="min-w-0 flex-1 text-faint line-through hover:text-foreground" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 分组的组名：教授名（点开看教授）+ 学校；研究科名（点开看入试页面）；分类名 */
function groupHead(key: TaskGroupKey, names: GroupNames, onlyOther: boolean) {
  if (key.kind === "professor") {
    const p = names.professors[key.id];
    const name = p ? `${p.name} 教授` : "教授";
    return { id: `p:${key.id}`, name, sub: p?.school, tab: { kind: "professor" as const, id: key.id, title: p?.name ?? "教授" }, href: "/aspirations" };
  }
  if (key.kind === "school") {
    const sc = names.schools[key.id];
    const name = sc?.name ?? "研究科";
    return { id: `s:${key.id}`, name, sub: undefined, tab: sc?.url ? { kind: "web" as const, url: sc.url, title: name } : undefined, href: sc?.url ?? undefined };
  }
  // 只有一组「其他」时叫「随时可以做」，不显得奇怪
  return { id: `a:${key.area}`, name: onlyOther ? "随时可以做" : TASK_AREA_LABELS[key.area], sub: undefined, tab: undefined, href: undefined };
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

/** 清单里的一行任务：圆圈（点开改状态）· 标题 · 子步骤 / AI 提议 · 行尾日期；悬停出现「✦ 让 AI 开始」 */
function TaskRow({ task, today, label }: { task: HomeTask; today: string; label?: string }) {
  const steps = task.steps.length ? `${task.steps.filter((s) => s.done).length}/${task.steps.length}` : null;
  const overdue = !!task.dueDate && task.dueDate < today;
  // 标题里已经有关联对象的名字（如「查清藤本 徹教授所在…」）就不再重复
  const link = task.link && !task.title.includes(task.link.replace(/教授$/, "")) && !label ? task.link : null;
  return (
    <li className="todo-row text-sm">
      <StatusCircle id={task.id} status={task.status} />
      <div className="min-w-0 flex-1 leading-5">
        <TaskTitle task={task} label={label} className="mr-2 hover:underline" />
        {(steps || link || task.proposedChange) && (
          <span className="inline-flex flex-wrap gap-x-2 text-xs text-faint">
            {steps && <span title="子步骤">{steps}</span>}
            {link && <span>{link}</span>}
            {task.proposedChange && (
              <span className="rounded border border-dashed border-line-strong px-1 text-muted">AI 提议改到 {task.proposedChange.dueDate ? formatDay(task.proposedChange.dueDate) : "不设截止日"}</span>
            )}
          </span>
        )}
      </div>
      {task.dueDate && (
        <span className="row-when leading-5">
          <DateText date={task.dueDate} today={today} overdue={overdue} />
        </span>
      )}
      <StartButton task={task} started={task.started} quiet />
    </li>
  );
}

/** 底部「＋ 添加任务」：平时只是一行淡灰字，点了（或点卡片右上角的 ＋）才出现输入框和截止日 */
function AddTaskForm({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  if (!open)
    return (
      <button onClick={() => onOpenChange(true)} className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-faint hover:bg-subtle hover:text-muted">
        <span className="grid size-5 place-items-center text-base leading-none">＋</span>
        添加任务
      </button>
    );
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
        inputRef.current?.focus();
      }}
      onKeyDown={(e) => e.key === "Escape" && onOpenChange(false)}
      className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-subtle p-1.5"
    >
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="要做什么？如：报名 12 月 JLPT N1"
        aria-label="任务标题"
        className="input min-w-40 flex-1 px-2 py-1 text-sm"
      />
      <DateInput value={dueDate} onChange={setDueDate} placeholder="截止日" clearable title="截止日（可选）" className="w-28 shrink-0 rounded-lg px-2 py-1 text-sm hover:bg-surface" />
      <button type="submit" disabled={pending || !title.trim()} className="btn-primary px-3 py-1 text-sm">
        添加
      </button>
      <button type="button" onClick={() => onOpenChange(false)} className="px-1 text-sm text-muted hover:text-foreground">
        取消
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

/** 格子里短标题的样式：截止红字、仮虚线框、AI 提议虚线、待办蓝字、做完的划掉 */
function labelClass(it: CalendarItem) {
  const base = "truncate rounded-[3px] px-1 text-left text-[11px] leading-4";
  if (it.done) return `${base} text-faint line-through`;
  if (it.proposed) return `${base} border border-dashed border-line-strong text-muted`;
  const color = it.source === "todo" ? "text-accent" : it.kind === "deadline" ? "text-danger" : it.kind === "exam" ? "text-warn" : "text-foreground";
  return `${base} ${color} ${it.tentative ? "border border-dashed border-warn" : "bg-subtle"}`;
}

/** 宽的时候格子里最多写几条，其余显示「+N」 */
const CELL_LABELS = 2;

function MonthCalendar({ today, month, items, tasks }: { today: string; month: string; items: CalendarItem[]; tasks: HomeTask[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const weeks = monthGrid(month);
  const nav = {
    prev: `/workbench?m=${shiftMonth(month, -1)}`,
    next: `/workbench?m=${shiftMonth(month, 1)}`,
    label: `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`,
    isNow: month === today.slice(0, 7),
  };
  const defaultDate = selected ?? (today.startsWith(month) ? today : `${month}-01`);
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
            <Link href={nav.prev} className="rounded px-1.5 text-muted hover:text-foreground" aria-label="往前">
              ‹
            </Link>
            <span className="tabular-nums">{nav.label}</span>
            <Link href={nav.next} className="rounded px-1.5 text-muted hover:text-foreground" aria-label="往后">
              ›
            </Link>
            {!nav.isNow && (
              <Link href="/workbench" className="ml-1 rounded-md bg-subtle px-1.5 py-0.5 text-xs text-muted hover:text-foreground">
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
            const labeled = day.flatMap((it) => {
              const text = cellLabel(it, date);
              return text ? [{ it, text }] : [];
            });
            const isSel = selected === date;
            const dayNum = String(Number(date.slice(8)));
            return (
              <button
                key={date}
                onClick={() => setSelected(isSel ? null : date)}
                className={`flex h-10 min-w-0 flex-col items-center gap-0.5 rounded pt-1 @md:h-auto @md:min-h-16 @md:items-stretch @md:px-0.5 @md:pb-1 ${inMonth ? "" : "text-faint"} ${
                  isSel ? "bg-subtle-strong" : "hover:bg-subtle"
                }`}
                aria-label={`${date}${day.length ? `，${day.length} 项` : ""}`}
              >
                <span className={`self-center tabular-nums ${date === today ? "rounded-full bg-primary px-1.5 text-on-primary" : ""}`}>{dayNum}</span>
                {/* 窄：圆点；宽：直接写短标题，超过两条显示 +N */}
                <span className="flex gap-0.5 @md:hidden">
                  {day.slice(0, 3).map((it) => (
                    <Dot key={it.key} item={it} />
                  ))}
                </span>
                <span className="hidden min-w-0 flex-col gap-0.5 @md:flex">
                  {labeled.slice(0, CELL_LABELS).map(({ it, text }) => (
                    <span key={it.key} className={labelClass(it)} title={it.title}>
                      {text}
                    </span>
                  ))}
                  {labeled.length > CELL_LABELS && <span className="px-1 text-left text-[11px] leading-4 text-muted">+{labeled.length - CELL_LABELS}</span>}
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
              <ul className="-mx-2">
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
          <AddForm key={defaultDate} defaultDate={defaultDate} />
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
      <li className="px-2 py-2">
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
    <li className="group todo-row text-sm">
      <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center">
        <span className={`h-3.5 w-[3px] rounded-full ${BAR[it.kind]} ${it.tentative ? "opacity-50" : ""}`} />
      </span>
      <div className="min-w-0 flex-1 leading-5">
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
        {(it.note || (isProposal && proposalKind && it.sourceId)) && (
          <div className="mt-0.5 space-y-1 text-xs text-muted">
            {it.note && <p>{it.note}</p>}
            {isProposal && proposalKind && it.sourceId && (
              <div className="flex flex-wrap items-center gap-2">
                <span>{it.proposed && !it.proposedChange ? "AI 提议" : `AI 提议改到 ${it.proposedChange ? formatRange(it.proposedChange.date, it.proposedChange.endDate) : ""}`}</span>
                <ProposalButtons kind={proposalKind} id={it.sourceId} date={it.proposedChange?.date ?? it.date} />
              </div>
            )}
          </div>
        )}
      </div>
      {it.source === "event" && it.sourceId && !isProposal && (
        <span className="flex shrink-0 gap-2 text-xs leading-5 text-faint opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
          <button onClick={() => setEditing(true)} className="hover:text-foreground">
            编辑
          </button>
          <button disabled={pending} onClick={() => startTransition(() => deleteEventAction(it.sourceId!))} className="hover:text-danger">
            删除
          </button>
        </span>
      )}
      <span className="leading-5">
        <DateText date={it.date} endDate={it.endDate} today={today} />
      </span>
    </li>
  );
}

/** 日程行左边的竖条颜色（和日历圆点一致） */
const BAR: Record<CalendarKind, string> = {
  deadline: "bg-danger",
  exam: "bg-warn",
  followup: "bg-info",
  other: "bg-faint",
};

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

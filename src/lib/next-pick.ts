// 主页「下一件事」：从手上的任务里挑现在最该做的一件，带用户和 AI 一起开始（纯函数，服务端和测试共用）。
// 分三步：① 代码给每件任务算出事实（截止、要准备几天 → 最晚哪天开始、被谁卡住、做完能推进什么、教授联系到哪一步）；
// ② AI 结合这些事实和 user.md 取舍（src/server/next-pick.ts）；③ 代码检查 AI 的选择，不合格的退回规则排序。

import { addDays, type CalendarItem } from "./calendar";
import { compareTasks, type TaskView } from "./tasks";

export type PickProfessor = { id: string; name: string; status: string; followUpDate: string | null };

export type TaskFact = {
  id: string;
  title: string;
  status: TaskView["status"];
  due: string | null;
  /** 准备要几天（任务上存的，没有就按类型给默认值，guessed = true） */
  prepDays: number;
  guessed: boolean;
  /** 最晚开始日 = 截止日 − 准备天数；跟进类任务 = 教授跟进日 */
  latestStart: string | null;
  /** 前置任务还没做完（标题） */
  blockedBy: string | null;
  /** 做完能推进的事 */
  unlocks: string | null;
  professor: string | null;
  /** 子步骤进度，如 2/5 */
  progress: string | null;
  note: string | null;
};

export type NextPick = {
  taskId: string;
  reasons: string[];
  /** 换一件时的备选（第一件在卡片上显示成「做完之后」） */
  alternatives: { taskId: string; reason: string }[];
  /** 15 分钟左右能做完的一件 */
  quickId: string | null;
  /** ai = AI 判断；rule = 按规则排（演示模式、credit 用完、AI 出错） */
  source: "ai" | "rule";
};

/** 流程任务默认要准备几天（AI 判断时会给没估过的任务估一个，存回任务上） */
const STEP_PREP: Record<string, number> = {
  confirm_path: 1,
  pick_schools: 3,
  write_plan: 14,
  find_professors: 3,
  school: 1,
  japanese: 1,
  english: 1,
  achievements: 2,
  application: 21,
  plan: 10,
  letter: 2,
  followup: 1,
  reply: 1,
  interview: 5,
};
const DEFAULT_PREP = 2;

/** 流程任务做完能推进什么 */
const STEP_UNLOCKS: Record<string, string> = {
  confirm_path: "后面所有任务的方向",
  pick_schools: "关注研究科、看募集要项",
  write_plan: "按计划书方向匹配教授",
  find_professors: "每位教授的计划书和联系",
  school: "判断这位教授值不值得继续跟",
  plan: "给这位教授写联系信",
  letter: "等教授回复、约面谈",
  reply: "和教授面谈",
  interview: "教授同意接收",
  application: "出愿",
};

export function stepOf(stepKey: string | null) {
  if (!stepKey) return null;
  return stepKey.startsWith("prof:") ? stepKey.split(":")[2] : stepKey;
}

export function defaultPrepDays(t: Pick<TaskView, "stepKey">) {
  return STEP_PREP[stepOf(t.stepKey) ?? ""] ?? DEFAULT_PREP;
}

/** 手上的任务：未开始和进行中，不含 AI 还在提议的 */
export function openTasks<T extends TaskView>(tasks: T[]) {
  return tasks.filter((t) => !t.proposed && (t.status === "todo" || t.status === "doing"));
}

export function taskFacts(tasks: TaskView[], professors: PickProfessor[]): TaskFact[] {
  const open = openTasks(tasks);
  const byKey = new Map(open.filter((t) => t.stepKey).map((t) => [t.stepKey!, t]));
  const profs = new Map(professors.map((p) => [p.id, p]));
  return open.map((t) => {
    const step = stepOf(t.stepKey);
    const prof = t.professorId ? profs.get(t.professorId) : undefined;
    const prepDays = t.prepDays ?? defaultPrepDays(t);
    let latestStart = t.dueDate ? addDays(t.dueDate, -prepDays) : null;
    if (step === "followup" && prof?.followUpDate && (!latestStart || prof.followUpDate < latestStart)) latestStart = prof.followUpDate;
    // 联系信要先有计划书草稿
    const blocker = step === "letter" && t.professorId ? byKey.get(`prof:${t.professorId}:plan`) : undefined;
    const done = t.steps.filter((s) => s.done).length;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      due: t.dueDate,
      prepDays,
      guessed: t.prepDays == null,
      latestStart,
      blockedBy: blocker?.title ?? null,
      unlocks: step ? (STEP_UNLOCKS[step] ?? null) : null,
      professor: prof ? `${prof.name}（${prof.status}${prof.followUpDate ? `，跟进日 ${prof.followUpDate}` : ""}）` : null,
      progress: t.steps.length ? `${done}/${t.steps.length}` : null,
      note: t.note,
    };
  });
}

/** 必须先做的：已过截止日，或今天已经到了最晚开始日 */
export function isForced(f: TaskFact, today: string) {
  return !f.blockedBy && ((!!f.due && f.due < today) || (!!f.latestStart && f.latestStart <= today));
}

/** 规则排序（AI 不可用时的结果，也是给 AI 的候选顺序）：必须先做的 → 一周内要开始的 → 进行中的 → 按最晚开始日 → 没日期的 */
export function ruleOrder(facts: TaskFact[], tasks: TaskView[], today: string): TaskFact[] {
  const order = new Map(tasks.map((t) => [t.id, t]));
  const soon = addDays(today, 7);
  const rank = (f: TaskFact) => (isForced(f, today) ? 0 : f.latestStart && f.latestStart <= soon ? 1 : f.status === "doing" ? 2 : f.latestStart ? 3 : 4);
  return facts
    .filter((f) => !f.blockedBy)
    .sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r) return r;
      const d = (a.latestStart ?? "9999").localeCompare(b.latestStart ?? "9999");
      if (d) return d;
      const ta = order.get(a.id);
      const tb = order.get(b.id);
      return ta && tb ? compareTasks(ta, tb) : 0;
    });
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 规则给的理由：只用算出来的事实 */
export function ruleReasons(f: TaskFact, today: string): string[] {
  const out: string[] = [];
  if (f.due && f.due < today) out.push(`已经过了截止日 ${md(f.due)}`);
  else if (f.due && f.latestStart) {
    out.push(f.latestStart <= today ? `截止 ${md(f.due)}，要准备约 ${f.prepDays} 天，今天就该开始了` : `截止 ${md(f.due)}，要准备约 ${f.prepDays} 天，最晚 ${md(f.latestStart)} 开始`);
  } else if (f.latestStart) out.push(f.latestStart <= today ? `跟进日 ${md(f.latestStart)} 已经到了` : `跟进日是 ${md(f.latestStart)}`);
  if (f.status === "doing") out.push(f.progress ? `你已经开始做了（子步骤 ${f.progress}）` : "你已经开始做了");
  if (f.unlocks) out.push(`做完能推进：${f.unlocks}`);
  if (!out.length) out.push("手上没有更急的事，这件可以先做起来");
  return out.slice(0, 2);
}

export function rulePick(facts: TaskFact[], tasks: TaskView[], today: string): NextPick | null {
  const ordered = ruleOrder(facts, tasks, today);
  if (!ordered.length) return null;
  const [first, ...rest] = ordered;
  return {
    taskId: first.id,
    reasons: ruleReasons(first, today),
    alternatives: rest.slice(0, 3).map((f) => ({ taskId: f.id, reason: ruleReasons(f, today)[0] })),
    quickId: null,
    source: "rule",
  };
}

/** 年度：4 月起算，如 2028 年 4 月入学 = 2028 年度，2027 年 10 月入学 = 2027 年度。没定返回 null */
export function intakeYear(targetEntry: string): number | null {
  const m = /^(\d{4})年(\d{1,2})月$/.exec(targetEntry);
  if (!m) return null;
  return Number(m[2]) >= 4 ? Number(m[1]) : Number(m[1]) - 1;
}

/** 募集要项日程是不是用户这届（或之后）的；不是要项的日程、入学时间没定的都算 */
export function isOwnIntake(it: Pick<CalendarItem, "source" | "admissionYear">, year: number | null) {
  return it.source !== "guide" || year == null || it.admissionYear == null || it.admissionYear >= year;
}

/** 给 AI 看的事实表 */
export function factsText(facts: TaskFact[], today: string) {
  return facts
    .map((f) =>
      [
        `- [${f.id}] ${f.title}`,
        `状态：${f.status === "doing" ? "进行中" : "未开始"}${f.progress ? `（子步骤 ${f.progress}）` : ""}`,
        `截止：${f.due ?? "未定"}`,
        `准备：约 ${f.prepDays} 天${f.guessed ? "（默认值，请你估）" : ""}`,
        f.latestStart ? `最晚开始：${f.latestStart}${isForced(f, today) ? "（已到，必须先做）" : ""}` : "",
        f.blockedBy ? `被卡住：要先完成「${f.blockedBy}」` : "",
        f.unlocks ? `做完能推进：${f.unlocks}` : "",
        f.professor ? `关联教授：${f.professor}` : "",
        f.note ? `说明：${f.note.slice(0, 120)}` : "",
      ]
        .filter(Boolean)
        .join("；"),
    )
    .join("\n");
}

export function calendarText(items: CalendarItem[], today: string, year: number | null) {
  const until = addDays(today, 60);
  const rows = items
    .filter((it) => it.source !== "todo" && !it.proposed && (it.endDate ?? it.date) >= today && it.date <= until && isOwnIntake(it, year))
    .slice(0, 30)
    .map((it) => `- ${it.date}${it.endDate ? `〜${it.endDate}` : ""} ${it.title}${it.tentative ? "（仮，按往年推算）" : ""}${it.note && !it.tentative ? `（${it.note}）` : ""}`);
  return rows.length ? rows.join("\n") : "（60 天内没有和你这届有关的日程）";
}

export function pickPrompt(p: { today: string; userMd: string; profileLine: string; facts: TaskFact[]; calendar: string }) {
  return `你是日本修考（申请日本研究生院）的规划助手。从用户手上的任务里选出「现在最该做的一件」，带用户马上开始。

今天：${p.today}
用户：${p.profileLine}

## 用户档案（user.md）
${p.userMd.slice(0, 4000) || "（空）"}

## 手上的任务（[ID] 后面是代码算出的事实）
${factsText(p.facts, p.today)}

## 60 天内的日程（只列和用户这届有关的）
${p.calendar}

## 怎么判断
- 看「最晚开始日」而不是截止日：要准备很久的事，截止日远也可能最急。标了「必须先做」的一定排第一（有多件时选最晚开始日最早的）。
- 被卡住的任务不能选。
- 同样急时：能解锁更多后续的优先；只要几分钟、但错过就没机会的事（报名、预约）优先；进行中的优先接着做。
- 结合 user.md：比如用户时间少就先做小事，用户说过不急的事往后放。
- 理由只能用上面给出的事实（日期必须是上面出现过的），不要编造报名截止日等没给出的日期；不知道的可以说「待查」。
- 准备天数标了「默认值」的，按任务内容给个合理估计（整数天）。

只输出一个 JSON，不要别的文字：
{"pick":"任务ID","reasons":["理由1（30 字内）","理由2（30 字内）"],"alternatives":[{"id":"任务ID","reason":"一句话理由"}],"quick":"15 分钟左右能做完的任务ID，没有就 null","prep":{"任务ID":天数}}
alternatives 按优先级给 2–3 件（不含 pick）。`;
}

const DATE_IN_TEXT = /(\d{4}-\d{2}-\d{2})|(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/g;

/** 理由里出现的日期必须是事实里有的（防止 AI 编日期） */
function datesKnown(text: string, known: Set<string>) {
  for (const m of text.matchAll(DATE_IN_TEXT)) {
    const key = m[1] ? md(m[1]) : `${Number(m[2])}/${Number(m[3])}`;
    if (!known.has(key)) return false;
  }
  return true;
}

export function knownDates(facts: TaskFact[], today: string, calendar: string) {
  const set = new Set<string>([md(today)]);
  const add = (s: string | null) => s && set.add(md(s));
  for (const f of facts) {
    add(f.due);
    add(f.latestStart);
    for (const m of `${f.title} ${f.note ?? ""} ${f.professor ?? ""}`.matchAll(DATE_IN_TEXT)) set.add(m[1] ? md(m[1]) : `${Number(m[2])}/${Number(m[3])}`);
  }
  for (const m of calendar.matchAll(/\d{4}-\d{2}-\d{2}/g)) set.add(md(m[0]));
  return set;
}

export type RawPick = { pick?: unknown; reasons?: unknown; alternatives?: unknown; quick?: unknown; prep?: unknown };

export function parsePick(text: string): RawPick | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" ? (v as RawPick) : null;
  } catch {
    return null;
  }
}

/** AI 估的准备天数（只收没估过的任务、1–180 天的整数） */
export function prepEstimates(raw: RawPick | null, facts: TaskFact[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw?.prep || typeof raw.prep !== "object") return out;
  const guessed = new Set(facts.filter((f) => f.guessed).map((f) => f.id));
  for (const [id, v] of Object.entries(raw.prep as Record<string, unknown>)) {
    const days = typeof v === "number" ? Math.round(v) : Number.NaN;
    if (guessed.has(id) && days >= 1 && days <= 180) out[id] = days;
  }
  return out;
}

/**
 * 检查 AI 的选择：选的必须是没被卡住的任务；有「必须先做」的而 AI 没选它们，就换成规则的第一件；
 * 理由里有事实里没出现过的日期就去掉那条，都去掉了用规则理由。AI 结果不能用时返回规则结果。
 */
export function guardPick(raw: RawPick | null, facts: TaskFact[], tasks: TaskView[], today: string, calendar: string): NextPick | null {
  const fallback = rulePick(facts, tasks, today);
  if (!fallback || !raw) return fallback;
  const ordered = ruleOrder(facts, tasks, today);
  const ok = new Map(ordered.map((f) => [f.id, f]));
  const forced = ordered.filter((f) => isForced(f, today));
  const known = knownDates(facts, today, calendar);
  const clean = (s: unknown, max: number) => (typeof s === "string" && s.trim() && datesKnown(s, known) ? s.trim().slice(0, max) : null);

  let id = typeof raw.pick === "string" && ok.has(raw.pick) ? raw.pick : null;
  if (!id) return fallback;
  let reasons = (Array.isArray(raw.reasons) ? raw.reasons : []).map((r) => clean(r, 60)).filter((r): r is string => !!r).slice(0, 2);
  if (forced.length && !forced.some((f) => f.id === id)) {
    id = forced[0].id;
    reasons = [];
  }
  if (!reasons.length) reasons = ruleReasons(ok.get(id)!, today);

  const alternatives: NextPick["alternatives"] = [];
  for (const a of Array.isArray(raw.alternatives) ? raw.alternatives : []) {
    const aid = a && typeof a === "object" ? (a as { id?: unknown }).id : null;
    if (typeof aid !== "string" || !ok.has(aid) || aid === id || alternatives.some((x) => x.taskId === aid)) continue;
    alternatives.push({ taskId: aid, reason: clean((a as { reason?: unknown }).reason, 60) ?? ruleReasons(ok.get(aid)!, today)[0] });
    if (alternatives.length >= 3) break;
  }
  for (const f of ordered) {
    if (alternatives.length >= 2) break;
    if (f.id !== id && !alternatives.some((x) => x.taskId === f.id)) alternatives.push({ taskId: f.id, reason: ruleReasons(f, today)[0] });
  }
  const quickId = typeof raw.quick === "string" && ok.has(raw.quick) ? raw.quick : null;
  return { taskId: id, reasons, alternatives, quickId, source: "ai" };
}

/**
 * 判断用到的输入；变了才重新让 AI 判断。不算「未开始 → 进行中」和子步骤进度：
 * 用户刚点了开始、勾了一个子步骤，卡片不该马上换成别的事（做完、删掉、改日期才算）。
 */
export function pickInputKey(p: { today: string; userMd: string; facts: TaskFact[]; calendar: string }) {
  const facts = p.facts.map((f) => ({ ...f, status: undefined, progress: undefined }));
  return JSON.stringify([p.today, p.userMd, facts, p.calendar]);
}

/** 任务对话的开场里补上「为什么现在先做这件」 */
export function pickKickoffNote(pick: NextPick, taskId: string): string | null {
  const reason = pick.taskId === taskId ? pick.reasons.join("；") : pick.alternatives.find((a) => a.taskId === taskId)?.reason;
  if (!reason) return null;
  return `（这是主页「下一件事」里选的，理由：${reason}。先用一两句话告诉我为什么现在做这件，再开始第一步。）`;
}

// 日历：类型、日期工具、月视图（纯函数，前后端共用）

export const CALENDAR_KINDS = ["deadline", "exam", "followup", "other"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  deadline: "截止",
  exam: "考试/面试",
  followup: "跟进",
  other: "其他",
};

/** 日历上的一项。来源：手动日程、Todo 截止日、教授跟进日、募集要项 */
export type CalendarItem = {
  /** 来源前缀 + 源记录 id，如 event:xxx、todo:xxx、prof:xxx、guide:学校id:序号 */
  key: string;
  source: "event" | "todo" | "professor" | "guide";
  /** 源记录 id（event / todo / professor），改动时用 */
  sourceId?: string;
  title: string;
  date: string;
  endDate?: string | null;
  kind: CalendarKind;
  /** 仮：按往年募集要项推算，新要项公开后自动更新 */
  tentative?: boolean;
  note?: string | null;
  done?: boolean;
  href?: string;
  /** 募集要项原文链接（官方日期附来源） */
  sourceUrl?: string;
  /** 募集要项日程：研究科名和日程名分开（title = 研究科名 + 日程名），主页关键日期分开显示 */
  school?: string;
  label?: string;
  /** AI 提议、用户还没同意的日程（日历上虚线显示）；proposedChange 是 AI 对已有日程改期的提议 */
  proposed?: boolean;
  proposedChange?: { date: string; endDate: string | null } | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 日本时间的今天（YYYY-MM-DD）。截止日都按日本时间算 */
export function todayJst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

/** 全站统一的日期写法：「10/24 周六」；不是今年的前面加年份「2027/1/15 周五」 */
export function formatDate(date: string, today = todayJst()) {
  const [y, m, d] = date.split("-").map(Number);
  const week = WEEKDAY_ZH[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${String(y) === today.slice(0, 4) ? "" : `${y}/`}${m}/${d} 周${week}`;
}

/** from 到 to 相隔几天（to 在前为负） */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 往后挪 n 年；2/29 落到平年时用 2/28 */
export function shiftYears(date: string, years: number) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/** 两个区间 [a1,a2] 和 [b1,b2] 是否有交集（日期字符串可直接比较） */
export function overlaps(start: string, end: string | null | undefined, from: string, to: string) {
  return start <= to && (end ?? start) >= from;
}

export function sortItems(items: CalendarItem[]) {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** "2026-11" → 该月的起止日期 */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function parseMonth(value: string | undefined, today: string) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : today.slice(0, 7);
}

/** 月视图的格子：从周一开始，整周补齐；不属于本月的格子 inMonth=false */
export function monthGrid(month: string): { date: string; inMonth: boolean }[][] {
  const { from, to } = monthRange(month);
  const weekday = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7; // 周一 = 0
  let cursor = addDays(from, -weekday);
  const weeks: { date: string; inMonth: boolean }[][] = [];
  while (cursor <= to) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: cursor, inMonth: cursor.startsWith(month) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * 日历格子里的短标题（宽的时候直接写在格子里，不用点开）。
 * 跨天的只在第一天和最后一天写（最后一天加「截止」）；募集要项的去掉研究科名，只留大学名的前两个字。
 * 中间的日子返回 null（只画一条底色）。
 */
export function cellLabel(it: Pick<CalendarItem, "title" | "date" | "endDate" | "source">, date: string): string | null {
  const short = it.source === "guide" ? `${it.title.split(/\s+/)[0].slice(0, 2)} ${it.title.split(/\s+/).at(-1)}` : it.title;
  if (!it.endDate || it.endDate === it.date || date === it.date) return short;
  return date === it.endDate ? `${short} 截止` : null;
}

/** 某天要显示的项（含跨天区间） */
export function itemsOn(items: CalendarItem[], date: string) {
  return items.filter((it) => overlaps(it.date, it.endDate, date, date));
}

/** 给 AI 用的一行描述 */
export function describeItem(it: CalendarItem) {
  const when = it.endDate && it.endDate !== it.date ? `${it.date}〜${it.endDate}` : it.date;
  const flags = [it.tentative ? "仮" : "", it.done ? "已完成" : "", it.proposed ? "AI 提议，等用户同意" : ""].filter(Boolean).join("，");
  const id = it.source === "guide" ? "" : `；来源：${it.source}，ID：${it.sourceId}`;
  const change = it.proposedChange ? `；AI 提议改到 ${it.proposedChange.date}${it.proposedChange.endDate ? `〜${it.proposedChange.endDate}` : ""}，等用户同意` : "";
  return `${when} ${it.title}${flags ? `（${flags}）` : ""}${id}${change}${it.note ? `；备注：${it.note.slice(0, 100)}` : ""}`;
}

import "server-only";
import { and, asc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { calendarEvent, savedProfessor, todo } from "@/db/schema";
import { addDays, daysBetween, overlaps, sortItems, type CalendarItem, type CalendarKind } from "@/lib/calendar";
import { listWatchedSchools } from "./schools";

// 日历的读写。主页上的日历（用户）和 AI 工具都走这里。AI 写进来的都是提议，用户同意后才生效。
// 手动日程存在 calendar_event；Todo 截止日、教授跟进日、募集要项日程从各自的表实时合并进来。

type Creator = "user" | "ai" | "system";

export type CalendarEventInput = {
  title: string;
  date: string;
  endDate?: string | null;
  kind?: CalendarKind;
  note?: string | null;
};

function normalize(input: Partial<CalendarEventInput>) {
  const out: Partial<CalendarEventInput> = { ...input };
  if (input.title !== undefined) out.title = input.title.trim();
  if (input.note !== undefined) out.note = input.note?.trim() || null;
  if (input.endDate !== undefined) out.endDate = input.endDate || null;
  return out;
}

/** AI 添加的日程是提议（日历上虚线显示），用户同意后才变成正式日程 */
export async function addCalendarEvent(userId: string, input: CalendarEventInput, createdBy: Creator) {
  const v = normalize(input) as CalendarEventInput;
  if (v.endDate && v.endDate < v.date) throw new Error("结束日期不能早于开始日期");
  const [row] = await db
    .insert(calendarEvent)
    .values({
      id: crypto.randomUUID(),
      userId,
      title: v.title,
      date: v.date,
      endDate: v.endDate ?? null,
      kind: v.kind ?? "other",
      note: v.note ?? null,
      createdBy,
      proposed: createdBy === "ai",
    })
    .returning();
  return row;
}

const mine = (userId: string, id: string) => and(eq(calendarEvent.id, id), eq(calendarEvent.userId, userId));

async function getEvent(userId: string, id: string) {
  const [row] = await db.select().from(calendarEvent).where(mine(userId, id));
  if (!row) throw new Error("找不到这条日程");
  return row;
}

/** 修改日程。by = "ai" 时，已同意的日程改日期只记成提议；AI 自己还没被同意的提议可以直接改 */
export async function updateCalendarEvent(userId: string, id: string, patch: Partial<CalendarEventInput>, by: "user" | "ai" = "user") {
  const row = await getEvent(userId, id);
  const { date, endDate, ...rest } = normalize(patch);
  const set: Partial<typeof calendarEvent.$inferInsert> = { ...rest, updatedAt: new Date() };
  const nextDate = date ?? row.date;
  const nextEnd = endDate !== undefined ? endDate : row.endDate;
  if (nextEnd && nextEnd < nextDate) throw new Error("结束日期不能早于开始日期");
  if (nextDate !== row.date || (nextEnd ?? null) !== row.endDate) {
    if (by === "ai" && !row.proposed) set.proposedChange = { date: nextDate, endDate: nextEnd ?? null };
    else Object.assign(set, { date: nextDate, endDate: nextEnd ?? null, proposedChange: null });
  }
  const [updated] = await db.update(calendarEvent).set(set).where(mine(userId, id)).returning();
  return updated;
}

/** 用户把日程挪到另一天（多天的日程整体平移），同时丢掉 AI 的改期提议 */
export async function rescheduleEvent(userId: string, id: string, date: string) {
  const row = await getEvent(userId, id);
  const endDate = row.endDate ? addDays(date, daysBetween(row.date, row.endDate)) : null;
  await db.update(calendarEvent).set({ date, endDate, proposedChange: null, updatedAt: new Date() }).where(mine(userId, id));
}

/** 用户同意 AI 的提议：新日程变正式，改期生效 */
export async function acceptEventProposal(userId: string, id: string) {
  const row = await getEvent(userId, id);
  const change = row.proposedChange;
  await db
    .update(calendarEvent)
    .set({ proposed: false, proposedChange: null, ...(change ? { date: change.date, endDate: change.endDate } : {}), updatedAt: new Date() })
    .where(mine(userId, id));
}

/** 用户拒绝：AI 提议的新日程删掉，改期提议丢掉 */
export async function rejectEventProposal(userId: string, id: string) {
  const row = await getEvent(userId, id);
  if (row.proposed) await db.delete(calendarEvent).where(mine(userId, id));
  else await db.update(calendarEvent).set({ proposedChange: null, updatedAt: new Date() }).where(mine(userId, id));
}

/** 还没处理的 AI 提议日程（新日程 + 改期） */
export async function listProposedEvents(userId: string) {
  return db
    .select()
    .from(calendarEvent)
    .where(and(eq(calendarEvent.userId, userId), or(eq(calendarEvent.proposed, true), isNotNull(calendarEvent.proposedChange))))
    .orderBy(asc(calendarEvent.date));
}

export async function deleteCalendarEvent(userId: string, id: string) {
  const rows = await db
    .delete(calendarEvent)
    .where(and(eq(calendarEvent.id, id), eq(calendarEvent.userId, userId)))
    .returning({ id: calendarEvent.id });
  return rows.length > 0;
}

/** [from, to] 区间内的全部日历项（含跨区间的日程），按日期排序 */
export async function listCalendar(userId: string, from: string, to: string, today: string): Promise<CalendarItem[]> {
  const [events, todos, professors, schools] = await Promise.all([
    db
      .select()
      .from(calendarEvent)
      .where(and(eq(calendarEvent.userId, userId), lte(calendarEvent.date, to)))
      .orderBy(asc(calendarEvent.date)),
    db
      .select()
      .from(todo)
      .where(and(eq(todo.userId, userId), isNull(todo.dismissedAt), isNotNull(todo.dueDate), gte(todo.dueDate, from), lte(todo.dueDate, to))),
    db
      .select()
      .from(savedProfessor)
      .where(and(eq(savedProfessor.userId, userId), or(isNotNull(savedProfessor.followUpDate), isNotNull(savedProfessor.proposedFollowUp)))),
    listWatchedSchools(userId, today),
  ]);

  const items: CalendarItem[] = [
    ...events
      .filter((e) => overlaps(e.date, e.endDate, from, to))
      .map((e) => ({
        key: `event:${e.id}`,
        source: "event" as const,
        sourceId: e.id,
        title: e.title,
        date: e.date,
        endDate: e.endDate,
        kind: e.kind,
        note: e.note,
        proposed: e.proposed,
        proposedChange: e.proposedChange,
      })),
    ...todos.map((t) => ({
      key: `todo:${t.id}`,
      source: "todo" as const,
      sourceId: t.id,
      title: t.title,
      date: t.dueDate!,
      kind: "deadline" as const,
      note: t.note,
      done: t.status === "done",
      proposed: t.proposed,
      proposedChange: t.proposedChange?.dueDate ? { date: t.proposedChange.dueDate, endDate: null } : null,
    })),
    ...professors.flatMap((p): CalendarItem[] => {
      if (p.status === "dropped") return [];
      // AI 提议的跟进日（虚线）：原来没有跟进日的是新日程，有的是改期
      const proposed = p.proposedFollowUp?.date ?? null;
      const date = p.followUpDate ?? proposed;
      if (!date) return [];
      const inRange = overlaps(date, null, from, to) || (!!proposed && overlaps(proposed, null, from, to));
      if (!inRange) return [];
      return [
        {
          key: `prof:${p.id}`,
          source: "professor",
          sourceId: p.id,
          title: `跟进 ${p.name}（${p.university}）`,
          date,
          kind: "followup",
          note: p.note,
          href: "/aspirations",
          proposed: !p.followUpDate,
          proposedChange: p.followUpDate && proposed ? { date: proposed, endDate: null } : null,
        },
      ];
    }),
    ...schools.flatMap((s) => s.calendar.filter((it) => overlaps(it.date, it.endDate, from, to))),
  ];
  return sortItems(items);
}

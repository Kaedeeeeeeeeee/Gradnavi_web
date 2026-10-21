import "server-only";
import { and, asc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { calendarEvent, savedProfessor, todo } from "@/db/schema";
import { overlaps, sortItems, type CalendarItem, type CalendarKind } from "@/lib/calendar";
import { listWatchedSchools } from "./schools";

// 日历的读写。日历页面（用户）和 AI 工具都走这里。
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

export async function addCalendarEvent(userId: string, input: CalendarEventInput, createdBy: Creator) {
  const v = normalize(input) as CalendarEventInput;
  if (v.endDate && v.endDate < v.date) throw new Error("结束日期不能早于开始日期");
  const [row] = await db
    .insert(calendarEvent)
    .values({ id: crypto.randomUUID(), userId, title: v.title, date: v.date, endDate: v.endDate ?? null, kind: v.kind ?? "other", note: v.note ?? null, createdBy })
    .returning();
  return row;
}

export async function updateCalendarEvent(userId: string, id: string, patch: Partial<CalendarEventInput>) {
  const [row] = await db
    .update(calendarEvent)
    .set({ ...normalize(patch), updatedAt: new Date() })
    .where(and(eq(calendarEvent.id, id), eq(calendarEvent.userId, userId)))
    .returning();
  if (!row) throw new Error("找不到这条日程");
  return row;
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
      .where(
        and(
          eq(savedProfessor.userId, userId),
          isNotNull(savedProfessor.followUpDate),
          gte(savedProfessor.followUpDate, from),
          lte(savedProfessor.followUpDate, to),
        ),
      ),
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
      })),
    ...todos.map((t) => ({
      key: `todo:${t.id}`,
      source: "todo" as const,
      sourceId: t.id,
      title: t.title,
      date: t.dueDate!,
      kind: "deadline" as const,
      note: t.note,
      done: t.done,
      href: "/workbench",
    })),
    ...professors
      .filter((p) => p.status !== "dropped")
      .map((p) => ({
        key: `prof:${p.id}`,
        source: "professor" as const,
        sourceId: p.id,
        title: `跟进 ${p.name}（${p.university}）`,
        date: p.followUpDate!,
        kind: "followup" as const,
        note: p.note,
        href: "/professors",
      })),
    ...schools.flatMap((s) => s.calendar.filter((it) => overlaps(it.date, it.endDate, from, to))),
  ];
  return sortItems(items);
}

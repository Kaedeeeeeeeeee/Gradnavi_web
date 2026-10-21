import "server-only";
import { and, asc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { todo } from "@/db/schema";

export type TodoInput = { title: string; note?: string | null; dueDate?: string | null };
type Creator = "user" | "ai" | "system";

export async function listTodos(userId: string, opts: { includeDone?: boolean } = {}) {
  const where = opts.includeDone ? eq(todo.userId, userId) : and(eq(todo.userId, userId), eq(todo.done, false));
  return db.select().from(todo).where(where).orderBy(asc(todo.done), asc(todo.sortOrder), asc(todo.createdAt));
}

export async function addTodos(userId: string, items: TodoInput[], createdBy: Creator) {
  if (!items.length) return [];
  const [{ last }] = await db.select({ last: max(todo.sortOrder) }).from(todo).where(eq(todo.userId, userId));
  const start = (last ?? -1) + 1;
  return db
    .insert(todo)
    .values(
      items.map((item, i) => ({
        id: crypto.randomUUID(),
        userId,
        title: item.title.trim(),
        note: item.note?.trim() || null,
        dueDate: item.dueDate || null,
        sortOrder: start + i,
        createdBy,
      })),
    )
    .returning();
}

export async function updateTodo(
  userId: string,
  id: string,
  patch: Partial<{ title: string; note: string | null; done: boolean; dueDate: string | null }>,
) {
  const [row] = await db
    .update(todo)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(todo.id, id), eq(todo.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteTodo(userId: string, id: string) {
  const rows = await db.delete(todo).where(and(eq(todo.id, id), eq(todo.userId, userId))).returning({ id: todo.id });
  return rows.length > 0;
}

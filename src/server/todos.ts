import "server-only";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import { todo } from "@/db/schema";
import { getDocument } from "./documents";
import { getSavedProfessor } from "./professors";

export type TodoInput = {
  title: string;
  note?: string | null;
  dueDate?: string | null;
  /** 挂在某位教授（教授清单 id）或某份文书下 */
  professorId?: string | null;
  documentId?: string | null;
};
type Creator = "user" | "ai" | "system";

/** 关联的教授 / 文书必须是这个用户自己的 */
async function checkLinks(userId: string, links: { professorId?: string | null; documentId?: string | null }) {
  if (links.professorId && !(await getSavedProfessor(userId, links.professorId))) throw new Error("教授清单里没有这位教授");
  if (links.documentId && !(await getDocument(userId, links.documentId))) throw new Error("找不到这份文书");
}

export async function listTodos(userId: string, opts: { includeDone?: boolean } = {}) {
  const visible = and(eq(todo.userId, userId), isNull(todo.dismissedAt));
  const where = opts.includeDone ? visible : and(visible, eq(todo.done, false));
  return db.select().from(todo).where(where).orderBy(asc(todo.done), asc(todo.sortOrder), asc(todo.createdAt));
}

export async function addTodos(userId: string, items: TodoInput[], createdBy: Creator) {
  if (!items.length) return [];
  for (const item of items) await checkLinks(userId, item);
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
        professorId: item.professorId || null,
        documentId: item.documentId || null,
        sortOrder: start + i,
        createdBy,
      })),
    )
    .returning();
}

export async function updateTodo(
  userId: string,
  id: string,
  patch: Partial<{
    title: string;
    note: string | null;
    done: boolean;
    dueDate: string | null;
    professorId: string | null;
    documentId: string | null;
  }>,
) {
  await checkLinks(userId, patch);
  const [row] = await db
    .update(todo)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(todo.id, id), eq(todo.userId, userId)))
    .returning();
  return row ?? null;
}

/** 流程任务只标记为已删除，免得按进度对账时又加回来 */
export async function deleteTodo(userId: string, id: string) {
  const mine = and(eq(todo.id, id), eq(todo.userId, userId));
  const [row] = await db.select({ stepKey: todo.stepKey }).from(todo).where(mine);
  if (!row) return false;
  if (row.stepKey) {
    await db.update(todo).set({ dismissedAt: new Date(), updatedAt: new Date() }).where(mine);
    return true;
  }
  await db.delete(todo).where(mine);
  return true;
}

import "server-only";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { graduateSchool, schoolWatch, todo } from "@/db/schema";
import { buildSteps, type TaskStatus, type TaskStep, type TaskView } from "@/lib/tasks";
import { getDocument } from "./documents";
import { getSavedProfessor } from "./professors";

// 任务（主页待办）的读写。主页、任务详情（用户）和 AI 工具都走这里。
// 规则：只有用户能标完成；AI 新建的任务、AI 改的截止日都先是提议，用户同意后才生效。

export type TodoRow = typeof todo.$inferSelect;

export type TodoInput = {
  title: string;
  note?: string | null;
  dueDate?: string | null;
  /** 挂在某位教授（教授清单 id）、某份文书或某个关注的研究科下 */
  professorId?: string | null;
  documentId?: string | null;
  schoolId?: string | null;
  steps?: { title: string; done?: boolean }[];
};
type Creator = "user" | "ai" | "system";

/** 关联的教授 / 文书 / 研究科必须是这个用户自己的 */
async function checkLinks(userId: string, links: { professorId?: string | null; documentId?: string | null; schoolId?: string | null }) {
  if (links.professorId && !(await getSavedProfessor(userId, links.professorId))) throw new Error("志愿里没有这位教授");
  if (links.documentId && !(await getDocument(userId, links.documentId))) throw new Error("找不到这份文书");
  if (links.schoolId && !(await db.$count(schoolWatch, and(eq(schoolWatch.userId, userId), eq(schoolWatch.schoolId, links.schoolId)))))
    throw new Error("没有关注这个研究科");
}

export function toTaskView(t: TodoRow): TaskView {
  return {
    id: t.id,
    title: t.title,
    note: t.note,
    status: t.status,
    dueDate: t.dueDate,
    steps: t.steps,
    proposed: t.proposed,
    proposedChange: t.proposedChange,
    stepKey: t.stepKey,
    professorId: t.professorId,
    documentId: t.documentId,
    schoolId: t.schoolId,
    sortOrder: t.sortOrder,
  };
}

/** 任务关联对象的名字（教授、文书、研究科），任务详情和任务对话里显示 */
export async function taskLinks(userId: string, t: Pick<TodoRow, "professorId" | "documentId" | "schoolId">) {
  const [professor, doc, school] = await Promise.all([
    t.professorId ? getSavedProfessor(userId, t.professorId) : null,
    t.documentId ? getDocument(userId, t.documentId) : null,
    t.schoolId ? db.select().from(graduateSchool).where(eq(graduateSchool.id, t.schoolId)).then((r) => r[0] ?? null) : null,
  ]);
  return {
    professor: professor ? { id: professor.id, name: professor.name, label: `${professor.name}（${professor.university}）` } : null,
    document: doc ? { id: doc.id, title: doc.title } : null,
    school: school ? { id: school.id, name: `${school.university} ${school.name}`, url: school.url } : null,
  };
}

const mine = (userId: string, id: string) => and(eq(todo.id, id), eq(todo.userId, userId));

export async function listTodos(userId: string, opts: { includeDone?: boolean } = {}) {
  const visible = and(eq(todo.userId, userId), isNull(todo.dismissedAt));
  const where = opts.includeDone ? visible : and(visible, sql`${todo.status} <> 'done'`);
  return db
    .select()
    .from(todo)
    .where(where)
    .orderBy(sql`case when ${todo.status} = 'done' then 1 else 0 end`, asc(todo.sortOrder), asc(todo.createdAt));
}

export async function getTodo(userId: string, id: string): Promise<TodoRow | null> {
  const [row] = await db.select().from(todo).where(and(mine(userId, id), isNull(todo.dismissedAt)));
  return row ?? null;
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
        schoolId: item.schoolId || null,
        steps: buildSteps(item.steps ?? []),
        // AI 加的任务是提议，用户在主页同意后才正式加入
        proposed: createdBy === "ai",
        sortOrder: start + i,
        createdBy,
      })),
    )
    .returning();
}

export type TodoPatch = Partial<{
  title: string;
  note: string | null;
  status: TaskStatus;
  dueDate: string | null;
  professorId: string | null;
  documentId: string | null;
  schoolId: string | null;
  steps: { title: string; done?: boolean }[];
}>;

/**
 * 修改任务。by = "ai" 时：不能标完成（改成「待你确认」）；改已同意任务的截止日只记成提议。
 * AI 自己提议、用户还没同意的任务，AI 可以直接改。
 */
export async function updateTodo(userId: string, id: string, patch: TodoPatch, by: "user" | "ai" = "user") {
  const row = await getTodo(userId, id);
  if (!row) return null;
  if (by === "ai" && patch.status === "done") throw new Error("只有用户能把任务标成完成。你认为做完了，请把状态改成 review（待你确认）");
  await checkLinks(userId, patch);

  const { steps, dueDate, ...rest } = patch;
  const set: Partial<typeof todo.$inferInsert> = { ...rest, updatedAt: new Date() };
  if (steps) set.steps = buildSteps(steps, row.steps);
  if (dueDate !== undefined && dueDate !== row.dueDate) {
    if (by === "ai" && !row.proposed) set.proposedChange = { dueDate };
    else {
      set.dueDate = dueDate;
      set.proposedChange = null;
    }
  }
  const [updated] = await db.update(todo).set(set).where(mine(userId, id)).returning();
  return updated ?? null;
}

/** 用户同意 AI 的提议：新任务正式加入，改期生效 */
export async function acceptTodoProposal(userId: string, id: string) {
  const row = await getTodo(userId, id);
  if (!row) return null;
  const set: Partial<typeof todo.$inferInsert> = { proposed: false, proposedChange: null, updatedAt: new Date() };
  if (row.proposedChange) set.dueDate = row.proposedChange.dueDate;
  const [updated] = await db.update(todo).set(set).where(mine(userId, id)).returning();
  return updated;
}

/** 用户拒绝：AI 提议的新任务直接删掉，改期提议丢掉 */
export async function rejectTodoProposal(userId: string, id: string) {
  const row = await getTodo(userId, id);
  if (!row) return;
  if (row.proposed) await db.delete(todo).where(mine(userId, id));
  else await db.update(todo).set({ proposedChange: null, updatedAt: new Date() }).where(mine(userId, id));
}

/** 用户在任务详情里改子步骤（勾选、增删、改名），整份替换 */
export async function setTodoSteps(userId: string, id: string, steps: TaskStep[]) {
  const row = await getTodo(userId, id);
  if (!row) return null;
  const [updated] = await db
    .update(todo)
    .set({ steps: buildSteps(steps, row.steps), updatedAt: new Date() })
    .where(mine(userId, id))
    .returning();
  return updated;
}

/** 流程任务只标记为已删除，免得按进度对账时又加回来 */
export async function deleteTodo(userId: string, id: string) {
  const [row] = await db.select({ stepKey: todo.stepKey }).from(todo).where(mine(userId, id));
  if (!row) return false;
  if (row.stepKey) {
    await db.update(todo).set({ dismissedAt: new Date(), updatedAt: new Date() }).where(mine(userId, id));
    return true;
  }
  await db.delete(todo).where(mine(userId, id));
  return true;
}

"use server";

import type { UIMessage } from "ai";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CALENDAR_KINDS } from "@/lib/calendar";
import { requireUser } from "@/lib/session";
import { kickoffPrompt, TASK_STATUSES } from "@/lib/tasks";
import { acceptEventProposal, addCalendarEvent, deleteCalendarEvent, listProposedEvents, rejectEventProposal, rescheduleEvent } from "@/server/calendar";
import { getTaskConversation, loadMessages } from "@/server/conversations";
import { getSavedProfessor } from "@/server/professors";
import {
  acceptTodoProposal,
  addTodos,
  deleteTodo,
  getTodo,
  listTodos,
  rejectTodoProposal,
  setTodoSteps,
  toTaskView,
  updateTodo,
} from "@/server/todos";

// 主页（任务、日历、AI 提议）和任务详情上的用户操作。与 AI 工具调用同一套 src/server 函数。
// 任务详情在文稿栏、待确认数量在外壳上，都由 layout 渲染，所以改完刷新整个 layout。

const refresh = () => revalidatePath("/", "layout");

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不对");

export async function addTaskAction(title: string) {
  const user = await requireUser();
  const t = title.trim();
  if (!t) return;
  await addTodos(user.id, [{ title: t.slice(0, 100) }], "user");
  refresh();
}

export async function setTaskStatusAction(id: string, status: (typeof TASK_STATUSES)[number]) {
  const user = await requireUser();
  await updateTodo(user.id, id, { status: z.enum(TASK_STATUSES).parse(status) });
  refresh();
}

const taskPatch = z.object({
  title: z.string().trim().min(1, "请填写标题").max(100).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  dueDate: date.nullable().optional(),
});

export async function updateTaskAction(id: string, patch: z.input<typeof taskPatch>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = taskPatch.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "输入有误" };
  await updateTodo(user.id, id, { ...parsed.data, note: parsed.data.note === "" ? null : parsed.data.note });
  refresh();
  return { ok: true };
}

const stepsSchema = z.array(z.object({ id: z.string().max(64), title: z.string().trim().max(100), done: z.boolean() })).max(20);

export async function setTaskStepsAction(id: string, steps: z.input<typeof stepsSchema>) {
  const user = await requireUser();
  await setTodoSteps(user.id, id, stepsSchema.parse(steps));
  refresh();
}

export async function deleteTaskAction(id: string) {
  const user = await requireUser();
  await deleteTodo(user.id, id);
  refresh();
}

export type TaskConversation = { taskId: string; title: string; conversationId: string | null; messages: UIMessage[]; kickoff: string };

/**
 * 打开任务专属的对话（一个任务一段）。start = 用户点了「让 AI 开始」：未开始的任务改成进行中。
 * 还没聊过时 conversationId 为空，第一条消息发出时由 /api/chat 建立。
 */
export async function openTaskConversationAction(id: string, start: boolean): Promise<TaskConversation | null> {
  const user = await requireUser();
  const task = await getTodo(user.id, id);
  if (!task) return null;
  if (start && task.status === "todo") {
    await updateTodo(user.id, id, { status: "doing" });
    refresh();
  }
  const [conversation, professor] = await Promise.all([
    getTaskConversation(user.id, id),
    task.professorId ? getSavedProfessor(user.id, task.professorId) : null,
  ]);
  return {
    taskId: id,
    title: task.title,
    conversationId: conversation?.id ?? null,
    messages: conversation ? await loadMessages(conversation.id) : [],
    kickoff: kickoffPrompt(toTaskView(task), professor?.name),
  };
}

// ---- AI 的提议（任务、截止日改动、日程）：同意 / 拒绝 ----

const proposalRef = z.object({ kind: z.enum(["task", "event"]), id: z.string().max(64) });
type ProposalRef = z.infer<typeof proposalRef>;

export async function acceptProposalAction(ref: ProposalRef) {
  const user = await requireUser();
  const { kind, id } = proposalRef.parse(ref);
  if (kind === "task") await acceptTodoProposal(user.id, id);
  else await acceptEventProposal(user.id, id);
  refresh();
}

export async function rejectProposalAction(ref: ProposalRef) {
  const user = await requireUser();
  const { kind, id } = proposalRef.parse(ref);
  if (kind === "task") await rejectTodoProposal(user.id, id);
  else await rejectEventProposal(user.id, id);
  refresh();
}

export async function acceptAllProposalsAction() {
  const user = await requireUser();
  const [tasks, events] = await Promise.all([listTodos(user.id), listProposedEvents(user.id)]);
  for (const t of tasks) if (t.proposed || t.proposedChange) await acceptTodoProposal(user.id, t.id);
  for (const e of events) await acceptEventProposal(user.id, e.id);
  refresh();
}

// ---- 日历 ----

const eventSchema = z.object({
  title: z.string().trim().min(1, "请填写标题").max(100),
  date,
  endDate: date.or(z.literal("")).optional(),
  kind: z.enum(CALENDAR_KINDS),
  note: z.string().trim().max(500).optional(),
});

export async function addEventAction(input: z.input<typeof eventSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "输入有误" };
  try {
    await addCalendarEvent(user.id, parsed.data, "user");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "添加失败" };
  }
  refresh();
  return { ok: true };
}

export async function rescheduleEventAction(id: string, newDate: string) {
  const user = await requireUser();
  await rescheduleEvent(user.id, id, date.parse(newDate));
  refresh();
}

export async function deleteEventAction(id: string) {
  const user = await requireUser();
  await deleteCalendarEvent(user.id, id);
  refresh();
}

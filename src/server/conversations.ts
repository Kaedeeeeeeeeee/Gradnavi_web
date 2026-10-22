import "server-only";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiConversation, aiMessage, aiToolCall } from "@/db/schema";

/** 最近的通用对话（主页上的，不属于任何任务） */
export async function getLatestConversation(userId: string) {
  const [row] = await db
    .select()
    .from(aiConversation)
    .where(and(eq(aiConversation.userId, userId), isNull(aiConversation.todoId)))
    .orderBy(desc(aiConversation.updatedAt))
    .limit(1);
  return row ?? null;
}

/** 任务专属的对话（一个任务一段），还没聊过时为空 */
export async function getTaskConversation(userId: string, todoId: string) {
  const [row] = await db
    .select()
    .from(aiConversation)
    .where(and(eq(aiConversation.userId, userId), eq(aiConversation.todoId, todoId)));
  return row ?? null;
}

/** 取会话（校验归属）；不存在则按给定 id 新建。todoId 是任务对话所属的任务（调用方先校验任务归属） */
export async function getOrCreateConversation(userId: string, id: string, todoId?: string | null) {
  const [row] = await db.select().from(aiConversation).where(eq(aiConversation.id, id));
  if (row) return row.userId === userId ? row : null;
  const [created] = await db
    .insert(aiConversation)
    .values({ id, userId, todoId: todoId ?? null })
    .onConflictDoNothing()
    .returning();
  // 同一个任务已经有对话了（两个窗口同时开始）：不另开一段
  return created ?? null;
}

export async function loadMessages(conversationId: string): Promise<UIMessage[]> {
  const rows = await db
    .select()
    .from(aiMessage)
    .where(eq(aiMessage.conversationId, conversationId))
    .orderBy(asc(aiMessage.seq));
  return rows.map((r) => ({ id: r.id, role: r.role, parts: r.parts as UIMessage["parts"] }));
}

/** 保存整段对话：已有的消息按 id 更新，新消息追加 */
export async function saveMessages(conversationId: string, messages: UIMessage[]) {
  await db.transaction(async (tx) => {
    const [{ last }] = await tx
      .select({ last: max(aiMessage.seq) })
      .from(aiMessage)
      .where(eq(aiMessage.conversationId, conversationId));
    let seq = (last ?? -1) + 1;
    for (const m of messages) {
      await tx
        .insert(aiMessage)
        .values({ id: m.id, conversationId, role: m.role, parts: m.parts, seq: seq++ })
        .onConflictDoUpdate({ target: aiMessage.id, set: { parts: m.parts } });
    }
    const firstUser = messages.find((m) => m.role === "user");
    const title = firstUser?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("").slice(0, 40);
    await tx
      .update(aiConversation)
      .set({ updatedAt: new Date(), title: sql`coalesce(${aiConversation.title}, ${title || null})` })
      .where(eq(aiConversation.id, conversationId));
  });
}

/** 新开一段通用对话，第一条是 AI 按模板生成的消息（不调用 AI），可附快捷回复按钮 */
export async function startConversation(userId: string, opening: { text: string; quickReplies: string[] }) {
  const id = crypto.randomUUID();
  await db.insert(aiConversation).values({ id, userId });
  const parts: UIMessage["parts"] = [{ type: "text", text: opening.text }];
  if (opening.quickReplies.length) parts.push({ type: "data-quickReplies", data: opening.quickReplies });
  await saveMessages(id, [{ id: crypto.randomUUID(), role: "assistant", parts }]);
  return id;
}

/** 已经聊过的任务（任务卡上显示「继续和 AI 做」） */
export async function listTaskConversationIds(userId: string) {
  const rows = await db
    .select({ todoId: aiConversation.todoId })
    .from(aiConversation)
    .where(and(eq(aiConversation.userId, userId), isNotNull(aiConversation.todoId)));
  return new Set(rows.map((r) => r.todoId!));
}

/** 一段对话里的工具调用（按时间），任务「待你确认」时列出 AI 做了什么 */
export async function listToolCalls(conversationId: string) {
  return db
    .select({ toolName: aiToolCall.toolName, input: aiToolCall.input, output: aiToolCall.output, ok: aiToolCall.ok })
    .from(aiToolCall)
    .where(eq(aiToolCall.conversationId, conversationId))
    .orderBy(asc(aiToolCall.createdAt));
}

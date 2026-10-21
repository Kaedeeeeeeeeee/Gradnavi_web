import "server-only";
import { z } from "zod";
import { syncNextSteps } from "@/server/next-steps";
import { addTodos, deleteTodo, listTodos, updateTodo } from "@/server/todos";
import { defineTool } from "./registry";

const links = {
  professorId: z.string().optional().describe("挂在教授清单里的某位教授下（教授 ID）"),
  documentId: z.string().optional().describe("挂在某份文书下（文书 ID）"),
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("截止日期 YYYY-MM-DD");

export const listTodosTool = defineTool({
  name: "list_todos",
  description: "列出用户的 Todo。默认只列未完成的。auto 为 true 的是系统按进度自动管理的流程任务。",
  inputSchema: z.object({ includeDone: z.boolean().default(false) }),
  execute: async ({ includeDone }, { userId }) => {
    await syncNextSteps(userId);
    const rows = await listTodos(userId, { includeDone });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      note: t.note,
      done: t.done,
      dueDate: t.dueDate,
      professorId: t.professorId,
      documentId: t.documentId,
      auto: !!t.stepKey,
    }));
  },
});

export const addTodosTool = defineTool({
  name: "add_todos",
  description: "给用户添加一条或多条 Todo。把大任务拆成具体、可执行的下一步动作。有截止日期的 Todo 会显示在日历上。",
  inputSchema: z.object({
    items: z
      .array(
        z.object({ title: z.string().min(1).max(100), note: z.string().max(500).optional(), dueDate: dateSchema.optional(), ...links }),
      )
      .min(1)
      .max(10),
  }),
  execute: async ({ items }, { userId }) => {
    const rows = await addTodos(userId, items, "ai");
    return rows.map((t) => ({ id: t.id, title: t.title }));
  },
});

export const updateTodoTool = defineTool({
  name: "update_todo",
  description: "修改一条 Todo：标记完成/未完成、改标题、备注或截止日期。id 先用 list_todos 查。",
  inputSchema: z.object({
    id: z.string(),
    done: z.boolean().optional(),
    title: z.string().min(1).max(100).optional(),
    note: z.string().max(500).optional(),
    dueDate: dateSchema.nullable().optional(),
    professorId: z.string().nullable().optional(),
    documentId: z.string().nullable().optional(),
  }),
  execute: async ({ id, ...patch }, { userId }) => {
    const row = await updateTodo(userId, id, patch);
    if (!row) throw new Error("找不到这条 Todo");
    return { id: row.id, title: row.title, done: row.done };
  },
});

export const deleteTodoTool = defineTool({
  name: "delete_todo",
  description: "删除一条 Todo。只在用户明确要求、或这条 Todo 已经没有意义时使用；做完了的用 update_todo 标记完成。",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }, { userId }) => {
    if (!(await deleteTodo(userId, id))) throw new Error("找不到这条 Todo");
    return { deleted: id };
  },
});

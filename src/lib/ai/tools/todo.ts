import "server-only";
import { z } from "zod";
import { AI_TASK_STATUSES, TASK_AREAS, TASK_STATUS_LABELS } from "@/lib/tasks";
import { syncNextSteps } from "@/server/next-steps";
import { addTodos, deleteTodo, listTodos, updateTodo } from "@/server/todos";
import { defineTool } from "./registry";

const links = {
  professorId: z.string().optional().describe("挂在志愿里的某位教授下（教授 ID）"),
  documentId: z.string().optional().describe("挂在某份文书下（文书 ID）"),
  schoolId: z.string().optional().describe("挂在某个关注的研究科下（研究科 ID，用 list_watched_schools 查）"),
};

const areaSchema = z
  .enum(TASK_AREAS)
  .describe(
    "分类（主页按它分组）：language 语言考试（JLPT、TOEFL 等）/ study 专业课和备考（复习、笔试、课程）/ prep 申请准备（选校、计划书、出愿材料）/ other 其他（签证、住宿等）。挂在教授或研究科下的任务按教授 / 研究科分组，可以不填。",
  );

const stepsSchema = z
  .array(z.object({ title: z.string().min(1).max(200), done: z.boolean().optional() }))
  .max(20)
  .describe(
    "子步骤（任务内的小清单），整份写入；同名的子步骤保留原来的勾选状态。用户要做的每个具体动作写成一条，链接写在对应那条里（如「用表单事前登记：https://…」「准备 1 分钟自我介绍」「准备要问的问题：…」）",
  );

const prepSchema = z
  .number()
  .int()
  .min(1)
  .max(180)
  .describe("做这件事大概要提前准备几天（如计划书草稿 10、成绩证明从国内寄来 21、报名 1）。主页按「截止日 − 准备天数」算最晚哪天开始，用来排「下一件事」");

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("截止日期 YYYY-MM-DD");

export const listTodosTool = defineTool({
  name: "list_todos",
  description:
    "列出用户的任务（Todo）。默认只列未完成的。status：todo 未开始 / doing 进行中 / review 待你确认 / done 完成。auto 为 true 的是系统按进度自动管理的流程任务；proposed 为 true 的是你提议、用户还没同意的任务。",
  inputSchema: z.object({ includeDone: z.boolean().default(false) }),
  execute: async ({ includeDone }, { userId }) => {
    await syncNextSteps(userId);
    const rows = await listTodos(userId, { includeDone });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      note: t.note,
      status: t.status,
      dueDate: t.dueDate,
      proposedDueDate: t.proposedChange ? t.proposedChange.dueDate : undefined,
      steps: t.steps.length ? t.steps.map((s) => `[${s.done ? "x" : " "}] ${s.title}`) : undefined,
      professorId: t.professorId,
      documentId: t.documentId,
      schoolId: t.schoolId,
      area: t.area ?? undefined,
      prepDays: t.prepDays ?? undefined,
      auto: !!t.stepKey,
      proposed: t.proposed || undefined,
    }));
  },
});

export const addTodosTool = defineTool({
  name: "add_todos",
  description:
    "给用户添加一条或多条任务。添加的任务是提议：主页上虚线显示，用户同意后才正式加入。只加商量好的、接下来真要做的事；可以顺便带上子步骤。有截止日期的显示在日历上。",
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          title: z.string().min(1).max(100),
          note: z.string().max(500).optional().describe("说明：只写背景和为什么做（一两句）；要做的动作写进 steps，不要堆在这里"),
          dueDate: dateSchema.optional(),
          prepDays: prepSchema.optional(),
          steps: stepsSchema.optional(),
          area: areaSchema.optional(),
          ...links,
        }),
      )
      .min(1)
      .max(10),
  }),
  execute: async ({ items }, { userId }) => {
    const rows = await addTodos(userId, items, "ai");
    return { proposed: rows.map((t) => ({ id: t.id, title: t.title })), note: "已作为提议加到主页，等用户同意" };
  },
});

export const updateTodoTool = defineTool({
  name: "update_todo",
  description:
    "修改一条任务：改状态、标题、备注、截止日期、子步骤。id 先用 list_todos 查。状态只能设 todo / doing / review：只有用户能标完成，你认为做完了就设 review（待你确认）。改已同意任务的截止日会变成提议，用户同意后才生效。",
  inputSchema: z.object({
    id: z.string(),
    status: z.enum(AI_TASK_STATUSES).optional(),
    steps: stepsSchema.optional(),
    title: z.string().min(1).max(100).optional(),
    note: z.string().max(500).optional(),
    dueDate: dateSchema.nullable().optional(),
    prepDays: prepSchema.nullable().optional(),
    professorId: z.string().nullable().optional(),
    documentId: z.string().nullable().optional(),
    schoolId: z.string().nullable().optional(),
    area: areaSchema.nullable().optional(),
  }),
  execute: async ({ id, ...patch }, { userId }) => {
    const row = await updateTodo(userId, id, patch, "ai");
    if (!row) throw new Error("找不到这条任务");
    return {
      id: row.id,
      title: row.title,
      status: TASK_STATUS_LABELS[row.status],
      dueDate: row.dueDate,
      ...(row.proposedChange ? { proposedDueDate: row.proposedChange.dueDate, note: "截止日改动已作为提议，等用户同意" } : {}),
    };
  },
});

export const deleteTodoTool = defineTool({
  name: "delete_todo",
  description: "删除一条任务。只在用户明确要求、或你自己提议的任务已经没有意义时使用；做完了的用 update_todo 改成 review，等用户确认。",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }, { userId }) => {
    if (!(await deleteTodo(userId, id))) throw new Error("找不到这条任务");
    return { deleted: id };
  },
});

import "server-only";
import { bindTools, type AnyAiTool, type ToolContext } from "./registry";
import { CALENDAR_TOOLS } from "./calendar";
import { DOCUMENT_TOOLS } from "./documents";
import { PROFESSOR_TOOLS } from "./professors";
import { addTodosTool, deleteTodoTool, listTodosTool, updateTodoTool } from "./todo";
import { readUserMd, updateUserMd } from "./user-md";

// 所有 AI 可用的工具
export const ALL_TOOLS: AnyAiTool[] = [
  readUserMd,
  updateUserMd,
  listTodosTool,
  addTodosTool,
  updateTodoTool,
  deleteTodoTool,
  ...DOCUMENT_TOOLS,
  ...PROFESSOR_TOOLS,
  ...CALENDAR_TOOLS,
];

export function buildTools(ctx: ToolContext) {
  return bindTools(ALL_TOOLS, ctx);
}

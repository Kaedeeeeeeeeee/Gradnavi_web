import "server-only";
import { bindTools, type AnyAiTool, type ToolContext } from "./registry";
import { DOCUMENT_TOOLS } from "./documents";
import { addTodosTool, listTodosTool, updateTodoTool } from "./todo";
import { readUserMd, updateUserMd } from "./user-md";

// 所有 AI 可用的工具。日历（第 5 步）、教授清单（第 4 步）在这里追加。
export const ALL_TOOLS: AnyAiTool[] = [
  readUserMd,
  updateUserMd,
  listTodosTool,
  addTodosTool,
  updateTodoTool,
  ...DOCUMENT_TOOLS,
];

export function buildTools(ctx: ToolContext) {
  return bindTools(ALL_TOOLS, ctx);
}

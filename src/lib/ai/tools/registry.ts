import "server-only";
import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import { db } from "@/db";
import { aiToolCall } from "@/db/schema";
import type { UsageMeter } from "@/lib/credits";

// AI 工具注册表。
// 每个工具只是一层薄包装：真正的读写逻辑放在 src/server/*，页面上的用户操作也调用同一套函数，
// 这样“用户能做的事 AI 也能做”。后续步骤（日历、编辑器、教授清单）新增工具时：
//   1. 在 src/lib/ai/tools/ 下新建文件，用 defineTool 定义工具
//   2. 加进 src/lib/ai/tools/index.ts 的 ALL_TOOLS
//   3. 在 src/lib/ai/tool-meta.ts 登记中文名（侧边栏展示用）

export type ToolContext = {
  userId: string;
  conversationId: string;
  /** 本轮对话的用量累加器：会花钱的工具（检索、抓取、找教授）把用量记在这里，对话结束时一起扣 credit */
  meter: UsageMeter;
};

export type AiToolDef<I = unknown, O = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 注册表里存放各种输入类型的工具
export type AnyAiTool = AiToolDef<any, any>;

export function defineTool<I, O>(def: AiToolDef<I, O>): AiToolDef<I, O> {
  return def;
}

/** 把工具定义绑定到当前用户/会话，并记录每次调用到 ai_tool_call */
export function bindTools(defs: AnyAiTool[], ctx: ToolContext): ToolSet {
  const tools: ToolSet = {};
  for (const def of defs) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (input: unknown) => {
        let output: unknown;
        let ok = true;
        try {
          output = await def.execute(input, ctx);
        } catch (error) {
          ok = false;
          output = { error: error instanceof Error ? error.message : String(error) };
        }
        await db.insert(aiToolCall).values({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          toolName: def.name,
          input,
          output,
          ok,
        });
        return output;
      },
    });
  }
  return tools;
}

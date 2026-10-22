import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { headers } from "next/headers";
import { z } from "zod";
import { getChatModel } from "@/lib/ai/model";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import { buildTools } from "@/lib/ai/tools";
import { auth } from "@/lib/auth";
import { UsageMeter } from "@/lib/credits";
import { parseQuotes, quotesForModel } from "@/lib/quotes";
import { describeTask } from "@/lib/tasks";
import { raisedBudget, shouldWrapUp, STEP_BUDGET, taskStepOf, turnKind, type StepTools } from "@/lib/ai/turn-budget";
import { getOrCreateConversation, loadMessages, saveMessages } from "@/server/conversations";
import { getBalance, InsufficientCreditsError, recordUsageSafe } from "@/server/credits";
import { getUserMd } from "@/server/profile";
import { getTodo, taskLinks, toTaskView } from "@/server/todos";

// 查研究科、对比学校可能要几分钟（一轮最长 5 分钟后进入总结）
export const maxDuration = 360;

// 只保留最近的若干条消息发给模型，控制 token 费用
const HISTORY_LIMIT = 30;

// 一轮的步数按这轮在做什么自动定（见 lib/ai/turn-budget）。该收尾时最后一步不给工具，让 AI 一定写出文字回答，不会查完资料就没下文
const WRAP_UP =
  "\n\n【本轮该收尾了】不要再调用工具。根据目前查到的内容直接回答：先写已经查清的结论（附出处链接），再列还没查到的部分和下一步建议，最后告诉用户可以说「继续」让你接着查。";

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  /** 新开任务对话时带上任务 ID（一个任务一段对话） */
  taskId: z.string().max(64).optional(),
  message: z.custom<UIMessage>((v) => typeof v === "object" && v !== null && "parts" in v),
  page: z.object({ path: z.string().max(200), title: z.string().max(200).optional(), content: z.string().max(20000).optional(), workPath: z.string().max(200).optional() }).optional(),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return new Response("请求格式错误", { status: 400 });
  const { conversationId, message, page, taskId } = parsed.data;

  // 任务已被删除（它的对话也随之删除）时，当作普通对话继续
  const validTask = taskId && (await getTodo(userId, taskId)) ? taskId : null;
  const conversation = await getOrCreateConversation(userId, conversationId, validTask);
  if (!conversation) return new Response("无权访问该对话", { status: 403 });
  // 任务对话：把任务的最新情况（状态、子步骤、关联对象）放进系统提示
  const taskRow = conversation.todoId ? await getTodo(userId, conversation.todoId) : null;
  const task = taskRow
    ? await taskLinks(userId, taskRow).then((l) =>
        describeTask(toTaskView(taskRow), { professor: l.professor?.label, document: l.document?.title, school: l.school?.name }),
      )
    : undefined;

  if ((await getBalance(userId)) <= 0) return new Response(new InsufficientCreditsError().message, { status: 402 });

  // 本轮所有模型步骤 + 工具里的检索/抓取都记在 meter 上，结束（或中断）时扣 credit。
  // settle 可多次调用，每次只结算新增部分；串成一条链避免并发重复记账。
  const meter = new UsageMeter();
  let settling: Promise<void> = Promise.resolve();
  const settle = () => {
    settling = settling.then(async () => {
      await recordUsageSafe({ userId, feature: "chat", meter, refId: conversationId });
    });
    return settling;
  };
  req.signal.addEventListener("abort", () => void settle(), { once: true });

  const tools = buildTools({ userId, conversationId, meter });
  // 只接受用户发来的新消息，历史一律从数据库读，避免客户端伪造 AI 的发言或工具结果
  // 「加入对话」的引用：data-quotes 部分，校验后保留（聊天记录里显示），发给模型时转成文字
  const quotes = parseQuotes(message.parts.flatMap((p) => (p.type === "data-quotes" && "data" in p ? [p.data] : []))[0]);
  const userMessage: UIMessage = {
    id: message.id,
    role: "user",
    parts: [...(quotes.length ? [{ type: "data-quotes" as const, data: quotes }] : []), ...message.parts.filter((p) => p.type === "text")],
  };
  const history = await loadMessages(conversationId);
  const messages = await validateUIMessages({ messages: [...history, userMessage], tools });

  const today = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeZone: "Asia/Tokyo" }).format(new Date());
  const instructions = buildSystemPrompt({ userMd: await getUserMd(userId), page, today, task });
  const userText = userMessage.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
  const kind = turnKind({ taskStep: taskStepOf(taskRow?.stepKey), taskTitle: taskRow?.title, pagePath: page?.path, workPath: page?.workPath, userText });
  const startedAt = Date.now();
  let wrapped = false;
  const result = streamText({
    model: getChatModel(),
    instructions,
    messages: await convertToModelMessages(messages.slice(-HISTORY_LIMIT), {
      tools,
      convertDataPart: (part) => (part.type === "data-quotes" ? { type: "text", text: quotesForModel(parseQuotes(part.data)) } : undefined),
    }),
    tools,
    // 收尾那一步写完就停；isStepCount 只是兜底
    stopWhen: [() => wrapped, isStepCount(STEP_BUDGET.compare)],
    prepareStep: ({ stepNumber, steps }) => {
      const tools: StepTools[] = steps.map((st) =>
        st.toolCalls.map((c) => ({ toolName: c.toolName, output: st.toolResults.find((r) => r.toolCallId === c.toolCallId)?.output })),
      );
      const budget = raisedBudget(STEP_BUDGET[kind], tools.flat().map((t) => t.toolName));
      if (!shouldWrapUp({ stepNumber, budget, elapsedMs: Date.now() - startedAt, steps: tools })) return {};
      wrapped = true;
      return { toolChoice: "none", instructions: instructions + WRAP_UP };
    },
    onStepEnd: (step) => meter.addTokens(step.usage),
    onEnd: () => settle(),
    onAbort: () => settle(),
    onError: () => void settle(),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      generateMessageId: () => crypto.randomUUID(),
      onEnd: async ({ messages: all }) => {
        // 只写入本轮新增/变化的消息
        await saveMessages(conversationId, all.slice(history.length));
        // 等扣费写完再结束响应，侧边栏随后取到的余额就是最新的
        await settle();
      },
      onError: (error) => {
        console.error("[chat]", error);
        return "AI 暂时出错了，请稍后再试。";
      },
    }),
  });
}

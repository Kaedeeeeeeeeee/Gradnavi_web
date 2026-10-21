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
import { getOrCreateConversation, loadMessages, saveMessages } from "@/server/conversations";
import { getUserMd } from "@/server/profile";

export const maxDuration = 60;

// 只保留最近的若干条消息发给模型，控制 token 费用
const HISTORY_LIMIT = 30;

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  message: z.custom<UIMessage>((v) => typeof v === "object" && v !== null && "parts" in v),
  page: z.object({ path: z.string().max(200), title: z.string().max(200).optional(), content: z.string().max(20000).optional() }).optional(),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return new Response("请求格式错误", { status: 400 });
  const { conversationId, message, page } = parsed.data;

  const conversation = await getOrCreateConversation(userId, conversationId);
  if (!conversation) return new Response("无权访问该对话", { status: 403 });

  const tools = buildTools({ userId, conversationId });
  // 只接受用户发来的新消息，历史一律从数据库读，避免客户端伪造 AI 的发言或工具结果
  const userMessage: UIMessage = { id: message.id, role: "user", parts: message.parts.filter((p) => p.type === "text") };
  const history = await loadMessages(conversationId);
  const messages = await validateUIMessages({ messages: [...history, userMessage], tools });

  const today = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeZone: "Asia/Tokyo" }).format(new Date());
  const result = streamText({
    model: getChatModel(),
    instructions: buildSystemPrompt({ userMd: await getUserMd(userId), page, today }),
    messages: await convertToModelMessages(messages.slice(-HISTORY_LIMIT), { tools }),
    tools,
    stopWhen: isStepCount(6),
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
      },
      onError: (error) => {
        console.error("[chat]", error);
        return "AI 暂时出错了，请稍后再试。";
      },
    }),
  });
}

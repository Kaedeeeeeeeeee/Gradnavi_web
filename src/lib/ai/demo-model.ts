import type { LanguageModelV4, LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";

// 演示模型：没有配置 DEEPSEEK_API_KEY 时使用，不花钱、结果固定，方便本地开发和测试整条链路。
//   “记住：xxx” → 调用 update_user_md 写进“偏好与备注”
//   “待办：xxx” → 调用 add_todos
//   “写入：xxx” → 在文书编辑器页面时，调用 update_document_section 追加到当前文书的“メモ”一节
//   “找教授：xxx” → 调用 search_professors（返回示例教授）
//   其他 → 固定回复

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

type Reply = { text: string } | { toolName: string; input: unknown };

export function demoReply(prompt: LanguageModelV4Prompt): Reply {
  const last = prompt.at(-1);
  if (last?.role === "tool") {
    const result = last.content.find((p) => p.type === "tool-result");
    return { text: `（演示模式）已执行工具 ${result?.toolName ?? ""}，你可以在页面上看到变化。` };
  }
  const text =
    last?.role === "user"
      ? last.content
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("")
          .trim()
      : "";

  const remember = /^记住[:：]\s*([\s\S]+)$/.exec(text);
  if (remember) {
    return { toolName: "update_user_md", input: { section: "偏好与备注", content: `- ${remember[1]}`, mode: "append" } };
  }
  const todo = /^待办[:：]\s*([\s\S]+)$/.exec(text);
  if (todo) return { toolName: "add_todos", input: { items: [{ title: todo[1].slice(0, 100) }] } };
  const find = /^找教授[:：]\s*([\s\S]+)$/.exec(text);
  if (find) return { toolName: "search_professors", input: { keywords: find[1].slice(0, 200), schools: [] } };
  const write = /^写入[:：]\s*([\s\S]+)$/.exec(text);
  if (write) {
    const system = prompt.find((m) => m.role === "system")?.content ?? "";
    const docId = /文档 ID：(\S+)/.exec(system)?.[1];
    if (!docId) return { text: "（演示模式）请先打开一份文书，再发送「写入：……」。" };
    return { toolName: "update_document_section", input: { id: docId, section: "メモ", content: write[1], mode: "append" } };
  }

  return {
    text:
      "（演示模式：服务器还没有配置 DEEPSEEK_API_KEY，这是固定回复。）\n\n" +
      `收到：「${text.slice(0, 100)}」。\n\n` +
      "可以发送「记住：……」测试写入 user.md，「待办：……」测试添加 Todo，「找教授：……」测试教授检索，在文书页面发送「写入：……」测试写入文书。",
  };
}

function toStream(reply: Reply): ReadableStream<LanguageModelV4StreamPart> {
  const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
  if ("text" in reply) {
    parts.push({ type: "text-start", id: "t" });
    // 按小块输出，模拟流式效果
    for (const chunk of reply.text.match(/[\s\S]{1,8}/g) ?? []) parts.push({ type: "text-delta", id: "t", delta: chunk });
    parts.push({ type: "text-end", id: "t" }, { type: "finish", usage, finishReason: { unified: "stop", raw: undefined } });
  } else {
    parts.push(
      { type: "tool-call", toolCallId: crypto.randomUUID(), toolName: reply.toolName, input: JSON.stringify(reply.input) },
      { type: "finish", usage, finishReason: { unified: "tool-calls", raw: undefined } },
    );
  }
  return new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
        await new Promise((r) => setTimeout(r, 15));
      }
      controller.close();
    },
  });
}

export const demoModel: LanguageModelV4 = {
  specificationVersion: "v4",
  provider: "gradnavi-demo",
  modelId: "demo",
  supportedUrls: {},
  async doGenerate({ prompt }) {
    const reply = demoReply(prompt);
    return {
      content:
        "text" in reply
          ? [{ type: "text", text: reply.text }]
          : [{ type: "tool-call", toolCallId: crypto.randomUUID(), toolName: reply.toolName, input: JSON.stringify(reply.input) }],
      finishReason: { unified: "text" in reply ? "stop" : "tool-calls", raw: undefined },
      usage,
      warnings: [],
    };
  },
  async doStream({ prompt }) {
    return { stream: toStream(demoReply(prompt)) };
  },
};

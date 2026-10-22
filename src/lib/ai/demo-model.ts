import type { LanguageModelV4, LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";

// 演示模型：没有配置 DEEPSEEK_API_KEY 时使用，不花钱、结果固定，方便本地开发和测试整条链路。
//   “记住：xxx” → 调用 update_user_md 写进“偏好与备注”
//   “待办：xxx” → 调用 add_todos
//   “写入：xxx” → 在文书编辑器页面时，对当前文书的“メモ”一节提出修改建议（追加）
//   “提纲” → 在文书编辑器页面时，给当前文书提出一份示例提纲
//   “找教授：xxx” → 调用 search_professors（返回示例教授）
//   “日程：2026-12-01 xxx” → 调用 add_calendar_event
//   “查资料：xxx” → 每步都查看志愿，直到这轮步数用完（测试折叠的查询记录和最后一步的总结）
//   其他 → 固定回复

// 报一个假用量，方便在演示模式下测试 credit 扣费（每步约 1 credit）
const usage = {
  inputTokens: { total: 1200, noCache: 1000, cacheRead: 200, cacheWrite: undefined },
  outputTokens: { total: 80, text: 80, reasoning: undefined },
};

type Reply = { text: string } | { toolName: string; input: unknown };

export function demoReply(prompt: LanguageModelV4Prompt, toolsOff = false): Reply {
  const lastUser = prompt.findLast((m) => m.role === "user");
  const research = lastUser?.role === "user" && lastUser.content.some((p) => p.type === "text" && /^查资料[:：]/.test(p.text.trim()));
  if (research) {
    const steps = prompt.slice(prompt.indexOf(lastUser!)).filter((m) => m.role === "tool").length;
    return toolsOff ? { text: `（演示模式）这轮工具次数用完了。已经查了 ${steps} 次志愿，结论是……还没查清的部分可以说「继续」。` } : { toolName: "list_aspirations", input: {} };
  }
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

  // 原样回显，测试回答的 Markdown 显示
  const echo = /^回显[:：]\s*([\s\S]+)$/.exec(text);
  if (echo) return { text: echo[1] };
  const remember = /^记住[:：]\s*([\s\S]+)$/.exec(text);
  if (remember) {
    return { toolName: "update_user_md", input: { section: "偏好与备注", content: `- ${remember[1]}`, mode: "append", note: remember[1].slice(0, 60) } };
  }
  const todo = /^待办[:：]\s*([\s\S]+)$/.exec(text);
  if (todo) return { toolName: "add_todos", input: { items: [{ title: todo[1].slice(0, 100) }] } };
  const schedule = /^日程[:：]\s*(\d{4}-\d{2}-\d{2})\s+([\s\S]+)$/.exec(text);
  if (schedule) return { toolName: "add_calendar_event", input: { date: schedule[1], title: schedule[2].slice(0, 100), kind: "other" } };
  const find = /^找教授[:：]\s*([\s\S]+)$/.exec(text);
  if (find) return { toolName: "search_professors", input: { keywords: find[1].slice(0, 200), schools: [] } };
  const write = /^写入[:：]\s*([\s\S]+)$/.exec(text);
  if (write) {
    const system = prompt.find((m) => m.role === "system")?.content ?? "";
    const docId = /文档 ID：(\S+)/.exec(system)?.[1];
    if (!docId) return { text: "（演示模式）请先打开一份文书，再发送「写入：……」。" };
    return {
      toolName: "update_document_section",
      input: { id: docId, section: "メモ", content: write[1], mode: "append", zh: `（演示译文）${write[1].slice(0, 40)}`, summary: "在メモ里追加一段" },
    };
  }
  if (/^提纲$/.test(text)) {
    const system = prompt.find((m) => m.role === "system")?.content ?? "";
    const docId = /文档 ID：(\S+)/.exec(system)?.[1];
    if (!docId) return { text: "（演示模式）请先打开一份文书，再发送「提纲」。" };
    return {
      toolName: "propose_outline",
      input: {
        id: docId,
        sections: [
          { heading: "研究題目", points: ["（演示）暂定题目"] },
          { heading: "研究背景と問題意識", points: ["（演示）为什么关心这个问题", "（演示）相关经历"] },
          { heading: "研究方法", points: ["（演示）资料和分析方法"] },
          { heading: "期待される成果", points: ["（演示）预期成果"] },
        ],
      },
    };
  }

  return {
    text:
      "（演示模式：服务器还没有配置 DEEPSEEK_API_KEY，这是固定回复。）\n\n" +
      `收到：「${text.slice(0, 100)}」。\n\n` +
      "可以发送「记住：……」测试写入 user.md，「待办：……」测试添加 Todo，「找教授：……」测试教授检索，「日程：2026-12-01 ……」测试添加日程，在文书页面发送「写入：……」测试修改建议、发送「提纲」测试提纲，「回显：……」原样回复（测试 Markdown 显示）。",
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
  async doGenerate({ prompt, toolChoice }) {
    const reply = demoReply(prompt, toolChoice?.type === "none");
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
  async doStream({ prompt, toolChoice }) {
    return { stream: toStream(demoReply(prompt, toolChoice?.type === "none")) };
  },
};

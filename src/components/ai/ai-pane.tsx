"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "@/components/shell/app-shell";
import { TOOL_META } from "@/lib/ai/tool-meta";
import { uuid } from "@/lib/browser";
import { activeTab, type DocTab } from "@/lib/shell";
import { usePageStore } from "./page-context";

// 三栏里的 AI 对话栏。顶部一行说明 AI 现在和你一起在做什么（文稿栏打开的文书 / 工作台当前页面）。

const WORK_PAGE_LABELS: [string, string][] = [
  ["/workbench", "今天的待办"],
  ["/schools", "目标研究科"],
  ["/professors", "找教授"],
  ["/documents", "文书列表"],
  ["/calendar", "日历"],
  ["/profile", "我的档案"],
  ["/onboarding", "新用户引导"],
];

type Props = {
  initialConversationId: string | null;
  initialMessages: UIMessage[];
  demo: boolean;
  initialBalance: number;
};

export function AiPane({ initialConversationId, initialMessages, demo, initialBalance }: Props) {
  const shell = useShell();
  const [conversationId, setConversationId] = useState(() => initialConversationId ?? uuid());
  const [input, setInput] = useState("");
  const [balance, setBalance] = useState(initialBalance);
  const router = useRouter();
  const pathname = usePathname();
  const pageStore = usePageStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const visible = shell.isVisible("ai");
  const { setBadge, expand } = shell;

  // 栏收起时 AI 回复了：竖条 / 底部标签上亮一个点，看到后清掉
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
    if (visible) setBadge("ai", false);
  }, [visible, setBadge]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // 只发新消息，历史由服务器从数据库读取
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { conversationId: id, message: messages.at(-1), page: pageStore.get() },
        }),
      }),
    [pageStore],
  );

  // 每轮结束后取一次余额（扣费在服务器端，流结束后才结算）
  const refreshBalance = () => {
    fetch("/api/credits")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balance?: number } | null) => {
        if (typeof d?.balance === "number") setBalance(d.balance);
      })
      .catch(() => {});
  };

  const { messages, sendMessage, status, stop, error } = useChat({
    id: conversationId,
    messages: conversationId === initialConversationId ? initialMessages : [],
    transport,
    onError: () => refreshBalance(),
    onFinish: ({ message }) => {
      refreshBalance();
      if (!visibleRef.current) setBadge("ai", true);
      // AI 改了数据（user.md、Todo 等）后刷新页面，让用户马上看到
      const mutated = message.parts.some((p) => isToolUIPart(p) && TOOL_META[getToolName(p)]?.mutates);
      if (mutated) router.refresh();
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  async function send(text: string) {
    // 先让页面做准备（如编辑器保存未保存的修改），AI 才能读到最新内容
    try {
      await pageStore.runBeforeSend();
    } catch (e) {
      console.error("[ai-sidebar] beforeSend", e);
    }
    sendMessage({ text });
  }

  // 页面上的按钮（如“AI 改写选中内容”）通过 useAskAi 代用户发消息
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = busy ? () => Promise.resolve() : send;
  });
  useEffect(
    () =>
      pageStore.onAsk((text) => {
        expand("ai");
        void sendRef.current(text);
      }),
    [pageStore, expand],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    void send(text);
    setInput("");
  }

  const tab = activeTab(shell.tabs);
  const docShown = tab && shell.isVisible("doc");
  const workLabel = WORK_PAGE_LABELS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1];

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 text-xs dark:border-zinc-800">
        <span className="min-w-0 flex-1 truncate text-zinc-500" title={docShown ? tab.title : undefined}>
          {docShown ? (
            <>
              正在一起做：<span className="text-foreground">{tab.title || "（无标题）"}</span>
            </>
          ) : (
            `当前：${workLabel ?? "工作台"}`
          )}
          {demo && <span className="ml-2 text-amber-600">演示模式</span>}
        </span>
        <Link href="/credits" className={`shrink-0 tabular-nums ${balance <= 0 ? "text-red-600" : "text-zinc-500"}`}>
          余额 {balance.toLocaleString()}
        </Link>
        <button
          className="shrink-0 text-zinc-500 hover:text-foreground disabled:opacity-40"
          disabled={busy || messages.length === 0}
          onClick={() => setConversationId(uuid())}
        >
          新对话
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2 text-zinc-500">
            <p>我能看到你的档案（user.md）、左边工作台的页面和中间打开的文稿，可以帮你记录信息、拆分任务、一起写文书。</p>
            <p>试试：「我下一步该做什么？」</p>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {status === "submitted" && <p className="text-zinc-400">思考中…</p>}
        {error && <p className="text-red-600">出错了：{error.message || "请稍后再试"}</p>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
          }}
          rows={3}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          className="w-full resize-none rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <div className="mt-2 flex justify-end">
          {busy ? (
            <button type="button" onClick={stop} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              停止
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40">
              发送
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function Message({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    const text = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");
    return <div className="ml-8 rounded-lg bg-zinc-100 px-3 py-2 whitespace-pre-wrap dark:bg-zinc-800">{text}</div>;
  }
  return (
    <div className="space-y-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") return <div key={i} className="whitespace-pre-wrap leading-relaxed">{part.text}</div>;
        if (isToolUIPart(part))
          return <ToolChip key={i} name={getToolName(part)} state={part.state} input={part.input} output={part.state === "output-available" ? part.output : undefined} />;
        return null;
      })}
    </div>
  );
}

const DOC_WRITE_TOOLS = new Set(["create_document", "update_document_section", "replace_document_text", "update_document"]);

const field = (v: unknown, key: string) => (v && typeof v === "object" && typeof (v as Record<string, unknown>)[key] === "string" ? ((v as Record<string, unknown>)[key] as string) : undefined);

/** 动作记录对应的成果：在文稿栏打开（文书、教授、AI 读过的网页） */
function chipTarget(name: string, input: unknown, output: unknown): DocTab | null {
  if (DOC_WRITE_TOOLS.has(name)) {
    const id = field(output, "id") ?? field(input, "id");
    return id ? { kind: "doc", id, title: field(output, "title") ?? field(input, "title") ?? "文书" } : null;
  }
  if (name === "save_professor") {
    const id = field(output, "id");
    return id ? { kind: "professor", id, title: field(output, "name") ?? "教授" } : null;
  }
  if (name === "fetch_page") {
    const url = field(input, "url");
    return url ? { kind: "web", url, title: url.replace(/^https?:\/\//, "").slice(0, 40) } : null;
  }
  return null;
}

function ToolChip({ name, state, input, output }: { name: string; state: string; input: unknown; output: unknown }) {
  const { openTab } = useShell();
  const label = TOOL_META[name]?.label ?? name;
  const failed = state === "output-error";
  const done = state === "output-available";
  const target = done ? chipTarget(name, input, output) : null;
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-700">
      <span>{failed ? "✗" : done ? "✓" : "…"}</span>
      <span>AI {label}</span>
      {done && name === "update_user_md" && (
        <Link href="/profile" className="underline">
          查看
        </Link>
      )}
      {target && (
        <button onClick={() => openTab(target)} className="underline hover:text-foreground">
          查看 →
        </button>
      )}
    </div>
  );
}

"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TOOL_META } from "@/lib/ai/tool-meta";
import { usePageStore } from "./page-context";

// 侧边栏开关记在 localStorage；不可用（隐私模式等）时退回内存
const OPEN_KEY = "gradnavi.aiSidebarOpen";
const openListeners = new Set<() => void>();
let memoryOpen = true;

function readOpen() {
  try {
    return (localStorage.getItem(OPEN_KEY) ?? (memoryOpen ? "1" : "0")) !== "0";
  } catch {
    return memoryOpen;
  }
}

function writeOpen(next: boolean) {
  memoryOpen = next;
  try {
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
  } catch {}
  openListeners.forEach((l) => l());
}

function subscribeOpen(listener: () => void) {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

type Props = {
  initialConversationId: string | null;
  initialMessages: UIMessage[];
  demo: boolean;
};

export function AiSidebar({ initialConversationId, initialMessages, demo }: Props) {
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => true);
  const [conversationId, setConversationId] = useState(() => initialConversationId ?? crypto.randomUUID());
  const [input, setInput] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const pageStore = usePageStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pageStore.set({ path: pathname });
  }, [pageStore, pathname]);

  const toggle = writeOpen;

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

  const { messages, sendMessage, status, stop, error } = useChat({
    id: conversationId,
    messages: conversationId === initialConversationId ? initialMessages : [],
    transport,
    onFinish: ({ message }) => {
      // AI 改了数据（user.md、Todo 等）后刷新页面，让用户马上看到
      const mutated = message.parts.some((p) => isToolUIPart(p) && TOOL_META[getToolName(p)]?.mutates);
      if (mutated) router.refresh();
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  if (!open) {
    return (
      <button
        onClick={() => toggle(true)}
        className="fixed right-4 bottom-4 z-30 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg"
      >
        问 AI
      </button>
    );
  }

  return (
    <aside className="fixed inset-0 z-30 flex flex-col border-zinc-200 bg-background md:sticky md:top-0 md:inset-auto md:h-dvh md:w-96 md:shrink-0 md:border-l dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <span className="font-medium">AI 助手{demo && <span className="ml-2 text-xs text-amber-600">演示模式</span>}</span>
        <div className="flex gap-3 text-sm text-zinc-500">
          <button
            className="hover:text-foreground disabled:opacity-40"
            disabled={busy || messages.length === 0}
            onClick={() => setConversationId(crypto.randomUUID())}
          >
            新对话
          </button>
          <button className="hover:text-foreground" onClick={() => toggle(false)}>
            收起
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2 text-zinc-500">
            <p>我能看到你的档案（user.md）和当前页面，可以帮你记录信息、拆分任务、解答申请问题。</p>
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
    </aside>
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
        if (isToolUIPart(part)) return <ToolChip key={i} name={getToolName(part)} state={part.state} />;
        return null;
      })}
    </div>
  );
}

function ToolChip({ name, state }: { name: string; state: string }) {
  const label = TOOL_META[name]?.label ?? name;
  const failed = state === "output-error";
  const done = state === "output-available";
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-700">
      <span>{failed ? "✗" : done ? "✓" : "…"}</span>
      <span>AI {label}</span>
      {done && name === "update_user_md" && (
        <Link href="/profile" className="underline">
          查看
        </Link>
      )}
    </div>
  );
}

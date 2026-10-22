"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { uuid } from "@/lib/browser";
import { MAX_QUOTES, type Quote } from "@/lib/quotes";

// 页面向 AI 对话栏提供“当前页面”信息（路径、页面内容如编辑器里的文档），AI 回答时能看到。
// 页面用法：在客户端组件里调用 useAiPageContent(文本)；文稿栏里的内容（编辑器）用 useAiPageContent(文本, "doc")。
// 工作台栏和文稿栏同时打开时，两边的内容都发给 AI，文稿在前。
// 页面还可以：
//   - 用 useAskAi() 让侧边栏代用户发一条消息（如“改写选中段落”按钮）
//   - 用 useAiBeforeSend(fn) 在消息发出前先做一件事（如编辑器先保存，AI 才能读到最新内容）
//   - 用 useStartTask() 切到某个任务的专属对话（点任务卡），或者顺便让 AI 开始（「让 AI 开始」）
//   - 用 useAddToChat() 把选中的文字加进 AI 输入框（「加入对话」），随用户下一条消息一起发出

type PageInfo = { path: string; title?: string; content?: string; workPath?: string };
/** 用户在输入框上面点掉的「AI 能看到」：这一栏的内容不发给 AI */
export type Hidden = Record<"work" | "doc", boolean>;
type Slot = "work" | "doc";
/** 文稿栏当前标签：路径（如 /documents/<id>）和标题；栏收起时为空 */
type DocInfo = { path: string; title: string } | null;

// 接口限制 20000 字
const CONTENT_LIMIT = 19000;
type AskListener = (text: string) => void;
type StartTaskListener = (taskId: string, start: boolean) => void;
type BeforeSend = () => Promise<void>;
/** 输入框里待发的引用；range 用来在原文上标出编号（原文被重新渲染后就标不出了，引用照样发） */
export type QuoteDraft = Quote & { id: string; range: Range | null };
const NO_QUOTES: QuoteDraft[] = [];

function createPageStore() {
  let workPath = "/";
  let doc: DocInfo = null;
  /** AI 栏当前对话所属的任务（一个任务一段对话） */
  let task: string | null = null;
  const content: Record<Slot, string | undefined> = { work: undefined, doc: undefined };
  let hidden: Hidden = { work: false, doc: false };
  let beforeSend: BeforeSend | undefined;
  const askListeners = new Set<AskListener>();
  const startListeners = new Set<StartTaskListener>();
  let quotes: QuoteDraft[] = NO_QUOTES;
  const quoteListeners = new Set<() => void>();
  const setQuotes = (next: QuoteDraft[]) => {
    quotes = next;
    quoteListeners.forEach((l) => l());
  };
  return {
    get: (): PageInfo => {
      const title = typeof document === "undefined" ? undefined : document.title;
      const work = hidden.work ? undefined : content.work;
      if (!doc || hidden.doc) return { path: hidden.work ? "/" : workPath, title, content: work };
      const parts = [content.doc, work && `=== 左侧工作台页面的内容 ===\n${work}`].filter(Boolean);
      return { path: doc.path, title: doc.title, workPath, content: parts.join("\n\n").slice(0, CONTENT_LIMIT) || undefined };
    },
    setHidden: (next: Hidden) => {
      hidden = next;
    },
    setWorkPath: (path: string) => {
      workPath = path;
    },
    setDoc: (next: DocInfo) => {
      doc = next;
    },
    getTask: () => task,
    setTask: (id: string | null) => {
      task = id;
    },
    setContent: (slot: Slot, text: string | undefined) => {
      content[slot] = text;
    },
    setBeforeSend: (fn: BeforeSend | undefined) => {
      beforeSend = fn;
    },
    runBeforeSend: async () => {
      await beforeSend?.();
    },
    ask: (text: string) => askListeners.forEach((l) => l(text)),
    onAsk: (listener: AskListener) => {
      askListeners.add(listener);
      return () => {
        askListeners.delete(listener);
      };
    },
    /** 切到任务的对话；start = 用户点了「让 AI 开始」 */
    startTask: (taskId: string, start = true) => startListeners.forEach((l) => l(taskId, start)),
    onStartTask: (listener: StartTaskListener) => {
      startListeners.add(listener);
      return () => {
        startListeners.delete(listener);
      };
    },
    getQuotes: () => quotes,
    /** 同一处文字重复加入只算一次；最多 MAX_QUOTES 段，返回是否加上了 */
    addQuote: (q: Omit<QuoteDraft, "id">) => {
      if (quotes.length >= MAX_QUOTES) return false;
      if (!quotes.some((x) => x.text === q.text && x.source === q.source)) setQuotes([...quotes, { ...q, id: uuid() }]);
      return true;
    },
    removeQuote: (id: string) => setQuotes(quotes.filter((q) => q.id !== id)),
    clearQuotes: () => setQuotes(NO_QUOTES),
    onQuotes: (listener: () => void) => {
      quoteListeners.add(listener);
      return () => {
        quoteListeners.delete(listener);
      };
    },
  };
}

type PageStore = ReturnType<typeof createPageStore>;

const PageStoreContext = createContext<PageStore | null>(null);

export function AiPageContextProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createPageStore);
  return <PageStoreContext value={store}>{children}</PageStoreContext>;
}

export function usePageStore() {
  const store = useContext(PageStoreContext);
  if (!store) throw new Error("需要在 AiPageContextProvider 内使用");
  return store;
}

export function useAiPageContent(content: string | undefined, slot: Slot = "work") {
  const store = usePageStore();
  useEffect(() => {
    store.setContent(slot, content);
    return () => store.setContent(slot, undefined);
  }, [store, content, slot]);
}

export function useAiBeforeSend(fn: BeforeSend) {
  const store = usePageStore();
  useEffect(() => {
    store.setBeforeSend(fn);
    return () => store.setBeforeSend(undefined);
  }, [store, fn]);
}

export function useAskAi() {
  return usePageStore().ask;
}

export function useStartTask() {
  return usePageStore().startTask;
}

/** 输入框里待发的引用 */
export function useQuotes() {
  const store = usePageStore();
  return useSyncExternalStore(store.onQuotes, store.getQuotes, () => NO_QUOTES);
}

export function useAddToChat() {
  return usePageStore().addQuote;
}

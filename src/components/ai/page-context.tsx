"use client";

import { createContext, useContext, useEffect, useState } from "react";

// 页面向 AI 侧边栏提供“当前页面”信息（路径、页面内容如编辑器里的文档），AI 回答时能看到。
// 页面用法：在客户端组件里调用 useAiPageContent(文本)。
// 页面还可以：
//   - 用 useAskAi() 让侧边栏代用户发一条消息（如“改写选中段落”按钮）
//   - 用 useAiBeforeSend(fn) 在消息发出前先做一件事（如编辑器先保存，AI 才能读到最新内容）

type PageInfo = { path: string; title?: string; content?: string };
type AskListener = (text: string) => void;
type BeforeSend = () => Promise<void>;

function createPageStore() {
  let info: PageInfo = { path: "/" };
  let beforeSend: BeforeSend | undefined;
  const askListeners = new Set<AskListener>();
  return {
    get: (): PageInfo => ({ ...info, title: typeof document === "undefined" ? undefined : document.title }),
    set: (patch: Partial<PageInfo>) => {
      info = { ...info, ...patch };
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

export function useAiPageContent(content: string | undefined) {
  const store = usePageStore();
  useEffect(() => {
    store.set({ content });
    return () => store.set({ content: undefined });
  }, [store, content]);
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

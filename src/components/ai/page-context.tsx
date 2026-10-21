"use client";

import { createContext, useContext, useEffect, useState } from "react";

// 页面向 AI 侧边栏提供“当前页面”信息（路径、页面内容如编辑器里的文档），AI 回答时能看到。
// 页面用法：在客户端组件里调用 useAiPageContent(文本)。

type PageInfo = { path: string; title?: string; content?: string };

function createPageStore() {
  let info: PageInfo = { path: "/" };
  return {
    get: (): PageInfo => ({ ...info, title: typeof document === "undefined" ? undefined : document.title }),
    set: (patch: Partial<PageInfo>) => {
      info = { ...info, ...patch };
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

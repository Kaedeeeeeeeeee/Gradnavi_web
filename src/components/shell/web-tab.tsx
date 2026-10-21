"use client";

import { useEffect, useState } from "react";
import { useAskAi } from "@/components/ai/page-context";
import { probeFrameAction } from "./actions";

// 文稿栏里的外部网页（研究室主页、募集要项原文、AI 读过的网页）。
// 网站允许嵌入就直接显示；不允许时给出退路：新标签页打开，或让 AI 读这个页面并总结。

type Frame = "checking" | "ok" | "blocked" | "unknown";

export function WebTab({ url, title }: { url: string; title: string }) {
  const askAi = useAskAi();
  const [frame, setFrame] = useState<Frame>("checking");

  useEffect(() => {
    let live = true;
    // https 页面里不能嵌 http 网页（浏览器会拦）
    const mixed = window.location.protocol === "https:" && url.startsWith("http:");
    (mixed ? Promise.resolve("blocked" as const) : probeFrameAction(url))
      .then((r) => live && setFrame(r))
      .catch(() => live && setFrame("unknown"));
    return () => {
      live = false;
    };
  }, [url]);

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const askSummary = () => askAi(`请读取这个网页并用中文总结要点（和我的申请相关的部分优先）：${url}`);
  const btn = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:border-zinc-500 dark:border-zinc-700";

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <span className="min-w-0 flex-1 truncate text-zinc-500" title={url}>
          {host}
        </span>
        <button onClick={askSummary} className={btn}>
          让 AI 读这个页面
        </button>
        <a href={url} target="_blank" rel="noreferrer noopener" className={btn}>
          新标签页打开
        </a>
      </div>
      {frame === "checking" ? (
        <p className="px-6 py-10 text-sm text-zinc-500">正在打开 {host}…</p>
      ) : frame === "blocked" ? (
        <div className="space-y-3 px-6 py-10 text-sm">
          <p className="font-medium">{title}</p>
          <p className="text-zinc-500">这个网站不允许嵌入其他页面显示。可以在新标签页打开原网页，或者让 AI 读取后在右侧总结给你（消耗少量 credit）。</p>
          <div className="flex gap-2">
            <a href={url} target="_blank" rel="noreferrer noopener" className="rounded-md bg-foreground px-3 py-1.5 text-background">
              新标签页打开
            </a>
            <button onClick={askSummary} className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
              让 AI 读这个页面
            </button>
          </div>
        </div>
      ) : (
        <>
          {frame === "unknown" && <p className="shrink-0 px-3 py-1 text-xs text-zinc-500">如果下面是空白，说明网站不允许嵌入，请点「新标签页打开」。</p>}
          <iframe src={url} title={title} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" className="min-h-0 w-full flex-1 bg-white" />
        </>
      )}
    </div>
  );
}

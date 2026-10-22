"use client";

import { useEffect, useRef, useState } from "react";
import { useShell } from "@/components/shell/app-shell";
import { cleanQuoteText, MAX_QUOTES, quoteSnippet } from "@/lib/quotes";
import { usePageStore, type QuoteDraft } from "./page-context";

// 「加入对话」（像 ChatGPT / Codex 的 Add to chat）：
// 在带 data-quote-source 的区域（AI 的回复、文稿栏、工作台页面）里选中文字，选区上方浮出「加入对话」；
// 点一下，这段文字变成输入框里的编号标签，原文上标出同样的编号；用户下一条消息把它们一起发给 AI。
// 文书编辑器里有自己的选中菜单，那里的「加入对话」按钮直接调 useAddToChat()。

type Picked = { range: Range; text: string; source: string; top: number; left: number; below: boolean };

/** 选区的第一行矩形（多行选区只取开头，标签和按钮都挂在开头） */
function firstRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  return rects[0] ?? null;
}

function pick(): Picked | null {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  const host = el?.closest<HTMLElement>("[data-quote-source]");
  // 输入框、编辑器里不弹（编辑器有自己的选中菜单）
  if (!host || el?.closest("input, textarea, [contenteditable='true']")) return null;
  const text = cleanQuoteText(sel.toString());
  const rect = firstRect(range);
  if (!text || !rect) return null;
  const below = rect.top < 48;
  return {
    range: range.cloneRange(),
    text,
    source: host.dataset.quoteSource || "对话",
    top: below ? (range.getBoundingClientRect().bottom + 6) : rect.top - 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 120)),
    below,
  };
}

/** 选中文字后浮出的「加入对话」按钮，整个应用只挂一个 */
export function AddToChatButton() {
  const store = usePageStore();
  const { expand } = useShell();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setPicked(pick());
        setFull(false);
      });
    };
    // 拖选过程中不弹，松开鼠标 / 键盘选完再算；选区没了（点了别处）就收起
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPicked(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicked(null);
      else if (e.shiftKey || e.key === "Shift") update();
    };
    // 滚动时跟着选区走
    const onScroll = () => setPicked((p) => (p ? pick() : p));
    document.addEventListener("pointerup", update);
    document.addEventListener("keyup", onKey);
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerup", update);
      document.removeEventListener("keyup", onKey);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  if (!picked) return null;

  function add() {
    if (!picked) return;
    if (!store.addQuote({ text: picked.text, source: picked.source, range: picked.range })) {
      setFull(true);
      return;
    }
    window.getSelection()?.removeAllRanges();
    setPicked(null);
    expand("ai");
  }

  return (
    <div
      data-testid="add-to-chat"
      className={`fixed z-50 ${picked.below ? "" : "-translate-y-full"}`}
      style={{ top: picked.top, left: picked.left }}
      // 按下时不让选区消失
      onPointerDown={(e) => e.preventDefault()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        onClick={add}
        className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm shadow-[0_4px_12px_rgb(15_15_15/0.12)] hover:bg-subtle"
      >
        <QuoteIcon />
        {full ? `最多加 ${MAX_QUOTES} 段` : "加入对话"}
      </button>
    </div>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" />
      <path d="M5 6h6M5 8h4" strokeLinecap="round" />
    </svg>
  );
}

/** 最近的可滚动祖先：编号标签滚出这个区域就不显示 */
function scrollParent(node: Node): Element | null {
  for (let el = node instanceof Element ? node : node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

type Marker = { id: string; n: number; top: number; left: number };

/** 原文上的高亮 + 编号（和输入框里的标签编号一致）。原文被重新渲染、栏收起时不显示 */
export function QuoteMarkers({ quotes }: { quotes: QuoteDraft[] }) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const clips = useRef(new Map<string, Element | null>());

  // 高亮用 CSS Custom Highlight API（不改 DOM，不会和 React 打架）；不支持的浏览器只显示编号
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const ranges = quotes.flatMap((q) => (q.range && q.range.startContainer.isConnected ? [q.range] : []));
    if (!ranges.length) return;
    CSS.highlights.set("gn-quote", new Highlight(...ranges));
    return () => {
      CSS.highlights.delete("gn-quote");
    };
  }, [quotes]);

  useEffect(() => {
    const live = new Set(quotes.map((q) => q.id));
    for (const id of clips.current.keys()) if (!live.has(id)) clips.current.delete(id);
    // 位置随滚动、拖动栏宽、AI 回复变长而变，逐帧跟着；只在变了的时候 setState。没有可标的原文就只算一次
    const follow = quotes.some((q) => q.range);
    let frame = 0;
    let last = "";
    const tick = () => {
      const next: Marker[] = [];
      quotes.forEach((q, i) => {
        const range = q.range;
        if (!range || !range.startContainer.isConnected) return;
        const rect = firstRect(range);
        if (!rect) return;
        if (!clips.current.has(q.id)) clips.current.set(q.id, scrollParent(range.startContainer));
        const box = clips.current.get(q.id)?.getBoundingClientRect();
        if (box && (rect.top < box.top || rect.top > box.bottom - 8 || box.width === 0)) return;
        next.push({ id: q.id, n: i + 1, top: Math.round(rect.top), left: Math.round(rect.left) });
      });
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setMarkers(next);
      }
      if (follow) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [quotes]);

  return (
    <>
      {markers.map((m) => (
        <span
          key={m.id}
          aria-hidden
          className="pointer-events-none fixed z-40 flex size-[18px] -translate-x-1/2 -translate-y-full items-center justify-center rounded-full rounded-bl-[3px] bg-accent text-[11px] font-semibold text-white shadow-sm"
          style={{ top: m.top - 1, left: m.left + 4 }}
        >
          {m.n}
        </span>
      ))}
    </>
  );
}

/** 输入框里的编号标签：悬停看全文，× 删掉 */
export function QuoteChips({ quotes, onRemove }: { quotes: QuoteDraft[]; onRemove: (id: string) => void }) {
  if (!quotes.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5" data-testid="quote-chips">
      {quotes.map((q, i) => (
        <span key={q.id} title={`${q.source}：\n${q.text}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-subtle py-0.5 pl-1 pr-0.5 text-xs">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white">{i + 1}</span>
          <span className="min-w-0 truncate">{quoteSnippet(q.text)}</span>
          <button type="button" onClick={() => onRemove(q.id)} className="shrink-0 rounded px-1 text-faint hover:bg-line hover:text-foreground" aria-label={`删掉引用 ${i + 1}`}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** 聊天记录里用户消息上方：这条消息带了哪些引用 */
export function SentQuotes({ quotes }: { quotes: { text: string; source: string }[] }) {
  if (!quotes.length) return null;
  return (
    <div className="ml-auto w-fit max-w-[85%] space-y-1">
      {quotes.map((q, i) => (
        <div key={i} title={`${q.source}：\n${q.text}`} className="flex items-start gap-1.5 text-xs text-muted">
          <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-line text-[10px] font-semibold">{i + 1}</span>
          <span className="line-clamp-2 border-l-2 border-line pl-1.5">{q.text}</span>
        </div>
      ))}
    </div>
  );
}

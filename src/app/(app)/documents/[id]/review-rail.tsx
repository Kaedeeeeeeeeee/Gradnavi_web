"use client";

import { useState } from "react";
import { diffText, type DiffPart } from "@/lib/doc-history";
import { opBeforeAfter, SUGGESTION_SOURCE_LABELS, type DocOp, type SuggestionSource } from "@/lib/doc-ops";
import { COMMENT_CATEGORY_LABELS, type CommentCategory, type CommentStatus } from "@/lib/documents";

// 编辑器右侧（窄屏时在上方）的「待你确认」栏：AI 的修改建议（接受 / 拒绝）和教授视角的批注（按这条改 / 忽略）。

export type SuggestionView = { id: string; op: DocOp; zh: string[]; summary: string; source: SuggestionSource };
export type CommentView = { id: string; quote: string; body: string; category: CommentCategory; status: CommentStatus };

/** 差异：删掉的标红划线，新增的标绿 */
export function DiffText({ parts, className = "" }: { parts: DiffPart[]; className?: string }) {
  return (
    <div className={`whitespace-pre-wrap break-words leading-relaxed ${className}`}>
      {parts.map(([op, text], i) =>
        op === 0 ? (
          <span key={i}>{text}</span>
        ) : op === 1 ? (
          <ins key={i} className="bg-emerald-100 text-emerald-900 no-underline dark:bg-emerald-950 dark:text-emerald-200">
            {text}
          </ins>
        ) : (
          <del key={i} className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
            {text}
          </del>
        ),
      )}
    </div>
  );
}

const card = "rounded-md border bg-background p-3 text-sm shadow-sm transition-colors";

type RailProps = {
  markdown: string;
  suggestions: SuggestionView[];
  comments: CommentView[];
  active: string | null;
  busy: string | null;
  onFocus: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onApplyComment: (id: string) => void;
  onIgnoreComment: (id: string) => void;
};

export function ReviewRail(p: RailProps) {
  if (!p.suggestions.length && !p.comments.length) return null;
  return (
    <div className="space-y-3" data-testid="review-rail">
      {p.suggestions.length > 0 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>AI 修改建议 {p.suggestions.length} 条，待你确认</span>
          {p.suggestions.length > 1 && (
            <button onClick={p.onAcceptAll} disabled={!!p.busy} className="underline hover:text-foreground disabled:opacity-40">
              全部接受
            </button>
          )}
        </div>
      )}
      {p.suggestions.map((s) => (
        <SuggestionCard key={s.id} s={s} {...p} />
      ))}
      {p.comments.length > 0 && <div className="pt-1 text-xs text-zinc-500">教授批注 {p.comments.length} 条</div>}
      {p.comments.map((c) => (
        <CommentCard key={c.id} c={c} {...p} />
      ))}
    </div>
  );
}

function SuggestionCard({ s, markdown, active, busy, onFocus, onAccept, onReject }: RailProps & { s: SuggestionView }) {
  const [showZh, setShowZh] = useState(false);
  const { before, after, where } = opBeforeAfter(markdown, s.op);
  const parts = diffText(before, after);
  const isActive = active === s.id;
  return (
    <div
      data-testid="suggestion-card"
      data-rail-id={s.id}
      onClick={() => onFocus(s.id)}
      className={`${card} ${isActive ? "border-emerald-500" : "border-emerald-200 dark:border-emerald-900"}`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-medium">{s.summary}</span>
        <span className="shrink-0 text-xs text-zinc-400">{SUGGESTION_SOURCE_LABELS[s.source]}</span>
      </div>
      {where && <div className="mb-1 text-xs text-zinc-500">位置：{where}</div>}
      <DiffText parts={parts} className="max-h-60 overflow-y-auto rounded bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900" />
      {s.zh.length > 0 && (
        <div className="mt-2">
          <button onClick={(e) => (e.stopPropagation(), setShowZh(!showZh))} className="text-xs text-zinc-500 underline">
            {showZh ? "收起中文" : "看中文意思"}
          </button>
          {showZh && (
            <div lang="zh-CN" className="mt-1 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {s.zh.map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={(e) => (e.stopPropagation(), onAccept(s.id))}
          disabled={!!busy}
          className="rounded-md bg-foreground px-3 py-1 text-background disabled:opacity-40"
        >
          {busy === s.id ? "处理中…" : "接受"}
        </button>
        <button
          onClick={(e) => (e.stopPropagation(), onReject(s.id))}
          disabled={!!busy}
          className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

function CommentCard({ c, active, busy, onFocus, onApplyComment, onIgnoreComment }: RailProps & { c: CommentView }) {
  const isActive = active === c.id;
  const waiting = c.status === "suggested";
  return (
    <div
      data-testid="comment-card"
      data-rail-id={c.id}
      onClick={() => onFocus(c.id)}
      className={`${card} ${isActive ? "border-amber-500" : "border-amber-200 dark:border-amber-900"} ${waiting ? "opacity-60" : ""}`}
    >
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{COMMENT_CATEGORY_LABELS[c.category]}</span>
        <span lang="ja" className="min-w-0 truncate text-zinc-500" title={c.quote}>
          「{c.quote}」
        </span>
      </div>
      <p className="leading-relaxed">{c.body}</p>
      {waiting ? (
        <p className="mt-2 text-xs text-zinc-500">已按这条生成修改建议，见上方。</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            onClick={(e) => (e.stopPropagation(), onApplyComment(c.id))}
            disabled={!!busy}
            className="rounded-md border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
          >
            {busy === c.id ? "AI 修改中…" : "按这条改"}
          </button>
          <button onClick={(e) => (e.stopPropagation(), onIgnoreComment(c.id))} disabled={!!busy} className="px-2 py-1 text-zinc-500 disabled:opacity-40">
            忽略
          </button>
        </div>
      )}
    </div>
  );
}

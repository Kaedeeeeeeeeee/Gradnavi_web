"use client";

import { useState, useTransition } from "react";
import { DOC_KIND_LABELS, isBlankDoc, sectionStatus, type DocKind, type Outline, type TargetProfessor, type WriteMode } from "@/lib/documents";
import type { Track } from "@/lib/onboarding";
import { approveOutlineAction, setWriteModeAction } from "../actions";

// 不从空白页开始：先在对话里回答几个问题 → AI 给提纲 → 同意提纲 → 一节一节起草（或自己写，AI 只给意见）。

type Props = {
  doc: { id: string; kind: DocKind; markdown: string; outline: Outline | null; writeMode: WriteMode | null; targetProfessor: TargetProfessor | null };
  track: Track | null;
  onAsk: (text: string) => void;
};

const box = "space-y-3 rounded-xl border border-line p-4 text-sm";

export function WritingGuide({ doc, track, onAsk }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "操作失败"));
    });

  const label = DOC_KIND_LABELS[doc.kind];
  const p = doc.targetProfessor;
  const fit = p ? `这份要贴合目标教授 ${p.name} 的研究方向。` : track === "plan_first" ? "我已经有自己的研究想法，请在我的思路基础上整理。" : "";
  const blank = isBlankDoc(doc.markdown);

  // 1. 还没开始：选怎么写
  if (blank && !doc.outline && !doc.writeMode) {
    return (
      <div className={box} data-testid="start-card">
        <p className="font-medium">怎么开始写这份{label}？</p>
        <p className="text-muted">不用对着空白页发愁：AI 先在对话里问你五六个问题（为什么想做这个方向、有什么相关经历……），然后列出提纲，你同意后再一节一节写。</p>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={pending}
            onClick={() => {
              run(() => setWriteModeAction(doc.id, "together"));
              onAsk(`我想开始写这份${label}（文书 ID：${doc.id}）。请先在对话里一次问我 5–6 个关键问题（编号列出），我回答后用 propose_outline 给出提纲。${fit}`);
            }}
            className="btn-primary px-3 py-1.5"
          >
            和 AI 一起写（先回答几个问题）
          </button>
          <button
            disabled={pending}
            onClick={() => run(() => setWriteModeAction(doc.id, "self"))}
            className="btn px-3 py-1.5"
          >
            我自己写，AI 只给意见
          </button>
        </div>
        {error && <p className="text-danger">{error}</p>}
      </div>
    );
  }

  // 2. AI 给了提纲，等用户同意
  if (doc.outline?.status === "proposed") return <OutlineCard outline={doc.outline} docId={doc.id} onAsk={onAsk} />;

  // 3. 按节推进
  const sections = sectionStatus(doc.markdown, doc.outline);
  if (!sections.length) return null;
  const self = doc.writeMode === "self";
  const next = sections.find((s) => !s.written);
  const points = (h: string) => doc.outline?.sections.find((s) => s.heading === h)?.points ?? [];
  const draft = (h: string) => {
    const pts = points(h);
    onAsk(`请起草「${h}」这一节${pts.length ? `（提纲要点：${pts.join("；")}）` : ""}。${fit}用 update_document_section 写，附中文对照；信息不够就先问我。`);
  };

  const written = sections.filter((s) => s.written).length;
  // 一行：各节进度（点没写的节让 AI 起草）+ 下一步按钮 + 写法切换
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="section-progress">
      <span className="mr-1 text-muted tabular-nums">
        {next ? `写到：${next.heading}` : "各节都有内容了"}（{written}/{sections.length} 节）
      </span>
      {sections.map((s) => (
        <button
          key={s.heading}
          title={self || s.written ? s.heading : `让 AI 起草「${s.heading}」`}
          disabled={self}
          onClick={() => draft(s.heading)}
          className={`rounded-full px-2 py-px text-xs ${s.written ? "bg-ok-soft text-ok" : s === next ? "bg-info-soft text-info" : "bg-subtle text-muted"}`}
        >
          {s.heading}
          {s.written && " ✓"}
        </button>
      ))}
      {!self && next && (
        <button onClick={() => draft(next.heading)} className="btn-primary ml-1 px-2.5 py-0.5 text-xs">
          AI 起草：{next.heading}
        </button>
      )}
      <button
        disabled={pending}
        onClick={() => run(() => setWriteModeAction(doc.id, self ? "together" : "self"))}
        className="ml-auto text-xs text-muted underline disabled:opacity-40"
        title={self ? "你自己写，AI 只给意见" : undefined}
      >
        {self ? "改成和 AI 一起写" : "改成自己写，AI 只给意见"}
      </button>
      {error && <p className="basis-full text-danger">{error}</p>}
    </div>
  );
}

function OutlineCard({ outline, docId, onAsk }: { outline: Outline; docId: string; onAsk: (text: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [change, setChange] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`${box} border-info/40`} data-testid="outline-card">
      <p className="font-medium">AI 列的提纲，待你确认</p>
      <ol className="list-decimal space-y-1.5 pl-5">
        {outline.sections.map((s) => (
          <li key={s.heading}>
            <span lang="ja" className="font-medium">
              {s.heading}
            </span>
            {s.points.length > 0 && <span className="text-muted"> — {s.points.join("；")}</span>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await approveOutlineAction(docId);
              setError(r.ok ? null : r.error);
            })
          }
          className="btn-primary px-3 py-1.5"
        >
          同意这个提纲
        </button>
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!change.trim()) return;
            onAsk(`提纲请这样调整：${change.trim()}。调整后再用 propose_outline 给我看。`);
            setChange("");
          }}
        >
          <input
            value={change}
            onChange={(e) => setChange(e.target.value)}
            placeholder="想调整？比如：先行研究和背景合成一节"
            className="input min-w-0 flex-1 px-3 py-1.5"
          />
          <button className="btn px-3 py-1.5">让 AI 改</button>
        </form>
      </div>
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

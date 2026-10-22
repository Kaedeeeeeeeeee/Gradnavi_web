"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { diffStats, diffText, VERSION_TRIGGER_LABELS, type VersionTrigger } from "@/lib/doc-history";
import type { ZhEntry } from "@/lib/doc-zh";
import { listVersionsAction, renameVersionAction, restoreVersionAction, snapshotAction } from "../actions";
import { DiffText } from "./review-rail";

// 版本历史（在文稿栏里替换编辑器显示）：左边时间线，右边和上一版（或当前）的差异，可切中文对照，可恢复。

type Version = { number: number; markdown: string; zh: ZhEntry[]; summary: string; name: string | null; trigger: VersionTrigger; createdAt: string };

const CURRENT = 0;
const zhText = (zh: ZhEntry[]) => zh.map((e) => e.zh).join("\n\n");

const fmt = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

type Props = {
  docId: string;
  current: { markdown: string; zh: ZhEntry[] };
  /** 打开历史前先保存编辑器里的修改 */
  flush: () => Promise<void>;
  onClose: () => void;
};

export function HistoryView({ docId, current, flush, onClose }: Props) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [picked, setSelected] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<"prev" | "current">("prev");
  const [showZh, setShowZh] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => listVersionsAction(docId).then(setVersions);
  useEffect(() => {
    void flush().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开时加载
  }, [docId]);

  const latest = versions?.[0];
  const dirty = !!versions && (!latest || latest.markdown.trim() !== current.markdown.trim());
  // 默认看「当前未存的修改」；没有的话看最新一版
  const selected = picked ?? (dirty || !latest ? CURRENT : latest.number);
  const sel = selected === CURRENT ? null : versions?.find((v) => v.number === selected);

  const pair = useMemo(() => {
    if (!versions) return null;
    const asText = (v: { markdown: string; zh: ZhEntry[] } | undefined) => (v ? (showZh ? zhText(v.zh) : v.markdown) : "");
    if (!sel) return { before: asText(latest), after: asText(current), label: latest ? `第 ${latest.number} 版 → 当前` : "当前" };
    if (compareTo === "current") return { before: asText(sel), after: asText(current), label: `第 ${sel.number} 版 → 当前` };
    const prev = versions.find((v) => v.number < sel.number);
    return { before: asText(prev), after: asText(sel), label: prev ? `第 ${prev.number} 版 → 第 ${sel.number} 版` : `第 ${sel.number} 版（第一版）` };
  }, [versions, sel, compareTo, showZh, current, latest]);
  const parts = pair ? diffText(pair.before, pair.after) : [];
  const stats = diffStats(parts);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "操作失败");
      else {
        await load();
        after?.();
      }
    });
  }

  return (
    <div className="space-y-3" data-testid="history-view">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">版本历史</span>
        <span className="text-muted">停手 30 分钟、审阅改完、导出 PDF、复制套磁信时会自动存一版</span>
        <button onClick={onClose} className="btn ml-auto px-3 py-1">
          回到编辑
        </button>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => snapshotAction(docId, "manual", name),
            () => setName(""),
          );
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="给当前内容存一版，可起个名字，如「发给佐藤教授的版本」"
          className="input min-w-0 flex-1 px-3 py-1.5"
        />
        <button disabled={pending} className="btn-primary px-3 py-1.5">
          存一版
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}

      {!versions ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4 @2xl:flex-row">
          <ol className="max-h-[60vh] shrink-0 space-y-1 overflow-y-auto text-sm @2xl:w-64">
            {dirty && (
              <TimelineItem active={selected === CURRENT} onClick={() => setSelected(CURRENT)} title="当前（还没存成一版）" sub="自上一版以来的修改" />
            )}
            {versions.map((v) => (
              <TimelineItem
                key={v.number}
                active={selected === v.number}
                onClick={() => setSelected(v.number)}
                title={`第 ${v.number} 版${v.name ? ` · ${v.name}` : ""}`}
                sub={v.summary}
                meta={`${fmt.format(new Date(v.createdAt))} · ${VERSION_TRIGGER_LABELS[v.trigger]}`}
              />
            ))}
            {!versions.length && !dirty && <li className="text-muted">还没有版本。</li>}
          </ol>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span>{pair?.label}</span>
              <span className="text-ok">+{stats.added}</span>
              <span className="text-danger">−{stats.removed}</span>
              {sel && (
                <select value={compareTo} onChange={(e) => setCompareTo(e.target.value as "prev" | "current")} className="rounded border border-line-strong bg-transparent px-1 py-0.5">
                  <option value="prev">和上一版比</option>
                  <option value="current">和当前比</option>
                </select>
              )}
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showZh} onChange={(e) => setShowZh(e.target.checked)} />
                中文对照
              </label>
            </div>
            <DiffText parts={parts} className="max-h-[60vh] overflow-y-auto rounded-md border border-line px-4 py-3 text-sm" />
            {sel && (
              <div className="flex flex-wrap gap-2 text-sm">
                <button
                  disabled={pending}
                  onClick={() => {
                    if (!confirm(`恢复到第 ${sel.number} 版？当前内容会先存成一版，不会丢。`)) return;
                    run(() => restoreVersionAction(docId, sel.number), onClose);
                  }}
                  className="btn-primary px-3 py-1.5"
                >
                  恢复到这一版
                </button>
                <button
                  disabled={pending}
                  onClick={() => {
                    const n = prompt("给这一版起个名字", sel.name ?? "");
                    if (n !== null) run(() => renameVersionAction(docId, sel.number, n));
                  }}
                  className="btn px-3 py-1.5"
                >
                  {sel.name ? "改名" : "命名"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineItem({ active, onClick, title, sub, meta }: { active: boolean; onClick: () => void; title: string; sub: string; meta?: string }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full rounded-md border-l-2 px-3 py-2 text-left ${active ? "border-primary bg-subtle" : "border-line hover:bg-subtle"}`}
      >
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted">{sub}</div>
        {meta && <div className="text-xs text-faint">{meta}</div>}
      </button>
    </li>
  );
}

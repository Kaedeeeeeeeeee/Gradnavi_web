"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { DOC_KIND_LABELS, type DocKind } from "@/lib/documents";
import { deleteDocumentAction, renameDocumentAction, reorderDocumentsAction, restoreDocumentAction } from "./actions";

// 文书列表：点开在文稿栏编辑；拖动左边的把手调整顺序；「⋯」菜单里重命名、上移下移、删除（删除后几秒内可撤销）。

export type DocItem = { id: string; kind: DocKind; title: string; updatedAt: string };

const fmt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
const UNDO_MS = 8000;

export function DocumentList({ docs }: { docs: DocItem[] }) {
  const { closeTab } = useShell();
  const [order, setOrder] = useState(docs);
  const [prev, setPrev] = useState(docs);
  // 服务器数据变了（新建、AI 改了标题等）就跟上
  if (docs !== prev) {
    setPrev(docs);
    setOrder(docs);
  }
  const [dragging, setDragging] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<DocItem | null>(null);
  const [, startTransition] = useTransition();
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  function saveOrder(next: DocItem[]) {
    setOrder(next);
    startTransition(() => reorderDocumentsAction(next.map((d) => d.id)));
  }

  function move(id: string, delta: number) {
    const i = order.findIndex((d) => d.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    saveOrder(next);
  }

  function remove(d: DocItem) {
    setOrder(order.filter((x) => x.id !== d.id));
    setDeleted(d);
    closeTab(`doc:${d.id}`);
    startTransition(() => deleteDocumentAction(d.id));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), UNDO_MS);
  }

  function undo() {
    if (!deleted) return;
    const d = deleted;
    setDeleted(null);
    startTransition(() => restoreDocumentAction(d.id));
  }

  function rename(d: DocItem, title: string) {
    setRenaming(null);
    const t = title.trim();
    if (!t || t === d.title) return;
    setOrder(order.map((x) => (x.id === d.id ? { ...x, title: t } : x)));
    startTransition(() => renameDocumentAction(d.id, t));
  }

  return (
    <div className="space-y-2">
      {order.length === 0 ? (
        <p className="text-sm text-muted">还没有文书。新建一份研究计划书，AI 会分步带你写。</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line" data-testid="doc-list">
          {order.map((d, i) => (
            <li
              key={d.id}
              data-testid="doc-row"
              onDragOver={(e) => {
                if (!dragging || dragging === d.id) return;
                e.preventDefault();
                const from = order.findIndex((x) => x.id === dragging);
                if (from === i) return;
                const next = [...order];
                next.splice(i, 0, ...next.splice(from, 1));
                setOrder(next);
              }}
              onDrop={(e) => e.preventDefault()}
              className={`group relative flex items-center gap-1 pr-2 ${dragging === d.id ? "opacity-40" : ""}`}
            >
              <span
                draggable
                onDragStart={(e) => {
                  setDragging(d.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", d.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  saveOrder(order);
                }}
                title="拖动调整顺序"
                aria-label="拖动调整顺序"
                className="cursor-grab select-none px-2 py-3 text-muted opacity-40 group-hover:opacity-100"
              >
                ⋮⋮
              </span>
              {renaming === d.id ? (
                <input
                  autoFocus
                  defaultValue={d.title}
                  maxLength={100}
                  aria-label="文书名称"
                  onBlur={(e) => rename(d, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="my-2 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 outline-none focus:border-foreground"
                />
              ) : (
                <OpenTabLink
                  tab={{ kind: "doc", id: d.id, title: d.title }}
                  href={`/documents/${d.id}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-4 py-3 pr-2 hover:opacity-80"
                >
                  <span className="min-w-0 truncate" onDoubleClick={(e) => (e.preventDefault(), setRenaming(d.id))}>
                    <span className="mr-2 text-xs text-muted">{DOC_KIND_LABELS[d.kind]}</span>
                    {d.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{fmt.format(new Date(d.updatedAt))}</span>
                </OpenTabLink>
              )}
              <button
                aria-label="更多操作"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === d.id ? null : d.id);
                }}
                className="rounded px-2 py-1 text-muted hover:bg-subtle hover:text-foreground"
              >
                ⋯
              </button>
              {menu === d.id && (
                <div role="menu" className="absolute right-2 top-full z-20 mt-1 w-32 overflow-hidden rounded-md border border-line bg-background py-1 text-sm shadow-md">
                  <MenuItem onClick={() => setRenaming(d.id)}>重命名</MenuItem>
                  <MenuItem disabled={i === 0} onClick={() => move(d.id, -1)}>
                    上移
                  </MenuItem>
                  <MenuItem disabled={i === order.length - 1} onClick={() => move(d.id, 1)}>
                    下移
                  </MenuItem>
                  <MenuItem danger onClick={() => remove(d)}>
                    删除
                  </MenuItem>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleted && (
        <div role="status" className="flex items-center gap-3 rounded-md border border-line bg-subtle px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">已删除「{deleted.title}」</span>
          <button onClick={undo} className="font-medium underline">
            撤销
          </button>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left hover:bg-subtle disabled:opacity-40 ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}

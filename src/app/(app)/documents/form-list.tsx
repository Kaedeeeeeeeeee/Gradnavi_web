"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { FormTile } from "@/components/ui/icons";
import { deleteFormAction, renameFormAction, restoreFormAction } from "./form-actions";

// 文书页下面的「申请表」：AI 下载并填好的学校表格。点开在文稿栏预览、修改、下载；「⋯」里重命名、删除（几秒内可撤销）。

export type FormItem = { id: string; title: string; reference: boolean; pending: number; updatedAt: string };

const fmt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
const UNDO_MS = 8000;

export function FormList({ forms }: { forms: FormItem[] }) {
  const { closeTab } = useShell();
  const [hidden, setHidden] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<FormItem | null>(null);
  const [, startTransition] = useTransition();
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  function remove(f: FormItem) {
    setHidden((h) => [...h, f.id]);
    setDeleted(f);
    closeTab(`form:${f.id}`);
    startTransition(() => deleteFormAction(f.id));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), UNDO_MS);
  }

  function undo() {
    if (!deleted) return;
    const f = deleted;
    setDeleted(null);
    setHidden((h) => h.filter((x) => x !== f.id));
    startTransition(() => restoreFormAction(f.id));
  }

  function rename(f: FormItem, title: string) {
    setRenaming(null);
    const t = title.trim();
    if (t && t !== f.title) startTransition(() => renameFormAction(f.id, t));
  }

  const shown = forms.filter((f) => !hidden.includes(f.id));

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted">申请表</h2>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-4 text-sm text-muted">
          学校发的入学願書、研究生出願票这类 PDF，可以让右侧 AI 下载下来按你的资料填好，比如说「帮我填东京学芸大学的研究生出願票」。填好的表放在这里，预览、修改后下载打印。
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line" data-testid="form-list">
          {shown.map((f) => (
            <li key={f.id} className="group relative flex items-center gap-1 pl-3 pr-2">
              {renaming === f.id ? (
                <input
                  autoFocus
                  defaultValue={f.title}
                  maxLength={100}
                  aria-label="申请表名称"
                  onBlur={(e) => rename(f, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="my-2 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 outline-none focus:border-foreground"
                />
              ) : (
                <OpenTabLink tab={{ kind: "form", id: f.id, title: f.title }} href={`/documents/forms/${f.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-4 py-3 pr-2 hover:opacity-80">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FormTile />
                    <span className="min-w-0 truncate">{f.title}</span>
                    {f.reference && <span className="shrink-0 rounded bg-[var(--warn-soft)] px-1.5 text-xs text-[var(--warn)]">参照版</span>}
                    {f.pending > 0 && <span className="shrink-0 rounded bg-[var(--info-soft)] px-1.5 text-xs text-[var(--info)]">{f.pending} 栏待确认</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{fmt.format(new Date(f.updatedAt))}</span>
                </OpenTabLink>
              )}
              <button
                aria-label="更多操作"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === f.id ? null : f.id);
                }}
                className="rounded px-2 py-1 text-muted hover:bg-subtle hover:text-foreground"
              >
                ⋯
              </button>
              {menu === f.id && (
                <div role="menu" className="absolute right-2 top-full z-20 mt-1 w-32 overflow-hidden rounded-md border border-line bg-background py-1 text-sm shadow-md">
                  <button role="menuitem" onClick={() => setRenaming(f.id)} className="block w-full px-3 py-1.5 text-left hover:bg-subtle">
                    重命名
                  </button>
                  <button role="menuitem" onClick={() => remove(f)} className="block w-full px-3 py-1.5 text-left text-danger hover:bg-subtle">
                    删除
                  </button>
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
    </section>
  );
}

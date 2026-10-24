"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { FormTile } from "@/components/ui/icons";
import {
  acceptFormFieldsAction,
  addFormFieldAction,
  moveFormFieldAction,
  rejectFormFieldsAction,
  removeFormFieldAction,
  setFormFieldOptionsAction,
  setFormFieldValueAction,
  setFormHandwritingAction,
} from "@/app/(app)/documents/form-actions";
import { describeForm, fitText, pendingCount, type Box, type FormField, type FormMode, type FormPage, type Handwriting, type MissingInfo } from "@/lib/forms";

// 文稿栏里的一份申请表：每页是原表的图片，上面叠着要印的字（和下载的 PDF 用同一套位置和字号）。
// 虚线框是 AI 填的、还没接受的内容；点一栏可以改内容、接受或不要 AI 的提议，拖动调整位置，拖右下角改大小。
// 学校要求手写时，顶部说明这是参照版，下载的 PDF 每页顶上印「参照用」。

export type FormViewData = {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourcePages: number[];
  totalPages: number;
  mode: FormMode;
  pages: FormPage[];
  fields: FormField[];
  handwriting: Handwriting | null;
  missing: MissingInfo[];
};

const MODE_LABELS: Record<FormMode, string> = {
  acroform: "PDF 自带填写栏，字印在栏的位置",
  overlay: "按表格的格子印字",
  scanned: "扫描版，位置是 AI 看图估的，可能要拖一下",
};

type Drag = { id: string; kind: "move" | "resize"; startX: number; startY: number; box: Box; scale: number };

export function FormView({ form }: { form: FormViewData }) {
  const ask = useAskAi();
  const [fields, setFields] = useState(form.fields);
  const [prev, setPrev] = useState(form.fields);
  // AI 改了（服务器数据变了）就跟上
  if (form.fields !== prev) {
    setPrev(form.fields);
    setFields(form.fields);
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const drag = useRef<Drag | null>(null);

  const pending = pendingCount(fields);
  const current = fields.find((f) => f.id === selected) ?? null;
  const reference = !!form.handwriting?.required;
  const aiText = useMemo(() => describeForm({ ...form, fields }), [form, fields]);
  useAiPageContent(aiText, "doc");

  function run(action: () => Promise<{ fields: FormField[] }>) {
    setError(null);
    startTransition(async () => {
      try {
        setFields((await action()).fields);
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败，请再试一次");
      }
    });
  }

  const patchLocal = (id: string, patch: Partial<FormField>) => setFields((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.scale;
    const dy = (e.clientY - d.startY) / d.scale;
    if (d.kind === "move") patchLocal(d.id, { x: d.box.x + dx, y: d.box.y + dy });
    else patchLocal(d.id, { w: Math.max(6, d.box.w + dx), h: Math.max(6, d.box.h + dy) });
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const f = fields.find((x) => x.id === d.id);
    if (!f || (f.x === d.box.x && f.y === d.box.y && f.w === d.box.w && f.h === d.box.h)) return;
    const box = { x: round(f.x), y: round(f.y), w: round(f.w), h: round(f.h) };
    run(() => moveFormFieldAction(form.id, f.id, box));
  }

  function startDrag(e: React.PointerEvent, f: FormField, kind: Drag["kind"], scale: number) {
    e.stopPropagation();
    e.preventDefault();
    setSelected(f.id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { id: f.id, kind, startX: e.clientX, startY: e.clientY, box: { x: f.x, y: f.y, w: f.w, h: f.h }, scale };
  }

  function addAt(page: number, x: number, y: number) {
    setAdding(false);
    run(async () => {
      const r = await addFormFieldAction(form.id, page, { x: round(x), y: round(y - 7), w: 120, h: 16 }, "新的一栏");
      setSelected(r.fields.at(-1)?.id ?? null);
      return r;
    });
  }

  const missingText = form.missing.map((m) => `- ${m.label}：${m.question}`).join("\n");

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="space-y-2">
        <h1 className="page-title flex items-center gap-2">
          <FormTile />
          <span className="min-w-0 truncate">{form.title}</span>
        </h1>
        <p className="text-sm text-muted">
          {MODE_LABELS[form.mode]}
          {form.totalPages > form.sourcePages.length && `；原 PDF 共 ${form.totalPages} 页，这里是第 ${form.sourcePages.join("、")} 页`}
          {form.sourceUrl && (
            <>
              {"。"}
              <a href={form.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline">
                原表
              </a>
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/forms/${form.id}/pdf?download`} className="btn-primary px-3 py-1.5 text-sm">
            下载 PDF{reference ? "（参照版）" : ""}
          </a>
          <a href={`/api/forms/${form.id}/pdf`} target="_blank" rel="noreferrer" className="btn px-3 py-1.5 text-sm">
            打开 PDF 看看
          </a>
          <button onClick={() => setAdding((a) => !a)} className={`btn px-3 py-1.5 text-sm ${adding ? "border-[var(--accent)]" : ""}`}>
            {adding ? "点表上要加的位置…" : "加一栏"}
          </button>
          <button onClick={() => ask(`按我最新的资料，把「${form.title}」（申请表 ID：${form.id}）再填一遍，缺的信息先问我。`)} className="btn px-3 py-1.5 text-sm">
            让 AI 再填一遍
          </button>
        </div>
      </div>

      {reference ? (
        <div className="space-y-1 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-3 py-2 text-sm">
          <p>
            <b>这份是参照版。</b>学校要求亲笔填写（{form.handwriting?.reason}）。下载打印后照着抄到学校的原表上，不要直接提交这份；PDF 每页顶上印着「参照用」。
          </p>
          <button onClick={() => startTransition(() => setFormHandwritingAction(form.id, false))} className="text-xs text-muted underline">
            学校其实允许打印提交
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">
          打印后可以直接提交。学校要求手写的话，
          <button onClick={() => startTransition(() => setFormHandwritingAction(form.id, true))} className="underline">
            标成参照版
          </button>
          。
        </p>
      )}

      {pending > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--info-soft)] px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">AI 填了 {pending} 栏（虚线框），接受后才会印进 PDF。点某一栏可以单独改。</span>
          <button onClick={() => run(() => acceptFormFieldsAction(form.id))} className="btn-primary px-3 py-1 text-sm">
            全部接受
          </button>
          <button onClick={() => run(() => rejectFormFieldsAction(form.id))} className="btn px-3 py-1 text-sm">
            全部不要
          </button>
        </div>
      )}

      {form.missing.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-line px-3 py-2 text-sm">
          <p className="font-medium">还缺这些信息</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            {form.missing.map((m) => (
              <li key={m.label}>
                {m.label}：{m.question}
              </li>
            ))}
          </ul>
          <button onClick={() => ask(`「${form.title}」（申请表 ID：${form.id}）还缺这些信息，我们一项项补上：\n${missingText}`)} className="btn px-3 py-1 text-xs">
            在对话里告诉 AI
          </button>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {current && (
        <FieldEditor
          key={`${current.id}:${current.value}`}
          field={current}
          onClose={() => setSelected(null)}
          onValue={(v) => run(() => setFormFieldValueAction(form.id, current.id, v))}
          onAccept={() => run(() => acceptFormFieldsAction(form.id, [current.id]))}
          onReject={() => run(() => rejectFormFieldsAction(form.id, [current.id]))}
          onOptions={(o) => run(() => setFormFieldOptionsAction(form.id, current.id, o))}
          onRemove={() => {
            setSelected(null);
            run(() => removeFormFieldAction(form.id, current.id));
          }}
        />
      )}

      <div className="space-y-4">
        {form.pages.map((p, i) => (
          <PagePreview
            key={i}
            formId={form.id}
            index={i}
            page={p}
            fields={fields.filter((f) => f.page === i)}
            selected={selected}
            adding={adding}
            reference={reference}
            onSelect={setSelected}
            onAdd={addAt}
            onDrag={startDrag}
          />
        ))}
      </div>

      <details className="rounded-lg border border-line text-sm">
        <summary className="cursor-pointer px-3 py-2 text-muted">全部栏目（{fields.length}）</summary>
        <ul className="divide-y divide-line">
          {fields.map((f) => (
            <li key={f.id}>
              <button onClick={() => setSelected(f.id)} className="flex w-full gap-3 px-3 py-1.5 text-left hover:bg-subtle">
                <span className="w-10 shrink-0 text-xs text-muted">p.{f.page + 1}</span>
                <span className="w-32 shrink-0 truncate">{f.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{f.kind === "mark" ? (f.value ? "✓" : "—") : f.value || "（空）"}</span>
                {f.proposed !== null && <span className="shrink-0 text-xs text-[var(--accent)]">AI 提议</span>}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** 和 PDF 里一样用明朝体（下载的 PDF 用 Noto Serif JP） */
const FORM_FONT = '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif';

const round = (n: number) => Math.round(n * 10) / 10;

function PagePreview({
  formId,
  index,
  page,
  fields,
  selected,
  adding,
  reference,
  onSelect,
  onAdd,
  onDrag,
}: {
  formId: string;
  index: number;
  page: FormPage;
  fields: FormField[];
  selected: string | null;
  adding: boolean;
  reference: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (page: number, x: number, y: number) => void;
  onDrag: (e: React.PointerEvent, f: FormField, kind: "move" | "resize", scale: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const scale = width / page.w;

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted">第 {index + 1} 页</figcaption>
      <div
        ref={ref}
        onClick={(e) => {
          if (!adding) return onSelect(null);
          const r = e.currentTarget.getBoundingClientRect();
          onAdd(index, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
        }}
        style={{ aspectRatio: `${page.w} / ${page.h}` }}
        className={`relative w-full overflow-hidden rounded-md border border-line bg-white text-[#111] ${adding ? "cursor-crosshair" : ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 底图来自自己的接口，按需渲染 */}
        <img src={`/api/forms/${formId}/pages/${index + 1}`} alt={`第 ${index + 1} 页`} draggable={false} className="absolute inset-0 size-full select-none" />
        {reference && scale > 0 && (
          <div style={{ top: 4 * scale, fontSize: 7.5 * scale }} className="pointer-events-none absolute inset-x-0 text-center text-[#b91c1c]">
            参照用（記入見本）：この内容を見ながら、原本に手書きで記入してください。
          </div>
        )}
        {scale > 0 &&
          fields.map((f) => (
            <FieldBox key={f.id} f={f} scale={scale} adding={adding} active={selected === f.id} onSelect={() => onSelect(f.id)} onDrag={(e, kind) => onDrag(e, f, kind, scale)} />
          ))}
      </div>
    </figure>
  );
}

function FieldBox({ f, scale, adding, active, onSelect, onDrag }: { f: FormField; scale: number; adding: boolean; active: boolean; onSelect: () => void; onDrag: (e: React.PointerEvent, kind: "move" | "resize") => void }) {
  const shown = f.proposed ?? f.value;
  const proposed = f.proposed !== null;
  const outline = active
    ? "outline outline-2 outline-[var(--accent)]"
    : proposed
      ? "outline outline-1 outline-dashed outline-[var(--accent)] bg-[var(--accent)]/10"
      : shown
        ? "hover:outline hover:outline-1 hover:outline-[var(--line-strong)]"
        : "outline outline-1 outline-dotted outline-[#c9c8c4]";
  const style: React.CSSProperties = { left: f.x * scale, top: f.y * scale, width: f.w * scale, height: f.h * scale, fontFamily: FORM_FONT };
  let content: React.ReactNode = null;
  if (f.kind === "mark") {
    if (shown) content = f.mark === "circle" ? <span className="absolute inset-0 rounded-[50%] border border-[#111]" /> : <span style={{ fontSize: Math.min(f.w, f.h) * 0.9 * scale, lineHeight: `${f.h * scale}px` }} className="block text-center">✓</span>;
  } else if (shown) {
    const { size } = fitText(shown, f, f.multiline);
    content = (
      <span
        style={{ fontSize: size * scale, justifyContent: f.multiline ? "flex-start" : "center", textAlign: f.align ?? "left" }}
        className={`flex size-full flex-col overflow-hidden leading-[1.25] ${f.multiline ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
      >
        {shown}
      </span>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      title={`${f.label}${f.note ? `：${f.note}` : ""}`}
      aria-label={f.label}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      onPointerDown={(e) => active && onDrag(e, "move")}
      // 加一栏时点在已有的栏上也是加在那里
      className={`absolute ${adding ? "pointer-events-none" : active ? "cursor-move" : "cursor-pointer"} ${outline}`}
    >
      {content}
      {active && <span onPointerDown={(e) => onDrag(e, "resize")} className="absolute -bottom-1 -right-1 size-2.5 cursor-nwse-resize rounded-sm bg-[var(--accent)]" />}
    </div>
  );
}

function FieldEditor({
  field: f,
  onClose,
  onValue,
  onAccept,
  onReject,
  onOptions,
  onRemove,
}: {
  field: FormField;
  onClose: () => void;
  onValue: (v: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onOptions: (o: { multiline?: boolean; label?: string }) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(f.value);
  const [label, setLabel] = useState(f.label);
  return (
    <div className="sticky top-0 z-10 space-y-2 rounded-lg border border-line bg-[var(--surface)] p-3 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">第 {f.page + 1} 页</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label.trim() && label !== f.label && onOptions({ label: label.trim() })}
          aria-label="栏名"
          maxLength={60}
          className="input min-w-0 flex-1 px-2 py-0.5 font-medium"
        />
        <button onClick={onClose} aria-label="关闭" className="btn-ghost px-2 py-0.5">
          ×
        </button>
      </div>
      {f.proposed !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--info-soft)] px-2 py-1.5">
          <span className="min-w-0 flex-1 break-all">
            AI 提议：{f.kind === "mark" ? (f.proposed ? "圈上 / 勾上" : "不圈") : f.proposed || "（清空）"}
            {f.note && <span className="block text-xs text-muted">{f.note}</span>}
          </span>
          <button onClick={onAccept} className="btn-primary px-2.5 py-0.5 text-xs">
            接受
          </button>
          <button onClick={onReject} className="btn px-2.5 py-0.5 text-xs">
            不要
          </button>
        </div>
      )}
      {f.kind === "mark" ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!f.value} onChange={(e) => onValue(e.target.checked ? "✓" : "")} />
          {f.mark === "circle" ? "圈上这个选项" : "打勾"}
        </label>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== f.value && onValue(draft)}
            rows={f.multiline ? 4 : 1}
            maxLength={2000}
            placeholder="印在这一栏的内容（日文）"
            aria-label="内容"
            className="input w-full resize-y px-2 py-1"
          />
          {f.note && f.proposed === null && <p className="text-xs text-muted">{f.note}</p>}
        </>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>拖动框调整位置，拖右下角改大小</span>
        {f.kind === "text" && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!!f.multiline} onChange={(e) => onOptions({ multiline: e.target.checked })} />
            多行
          </label>
        )}
        <button onClick={onRemove} className="ml-auto text-danger underline">
          删除这一栏
        </button>
      </div>
    </div>
  );
}

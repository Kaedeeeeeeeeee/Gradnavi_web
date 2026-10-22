"use client";

import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DOC_COLOR_LABELS, DOC_COLORS, type ColorKind, type DocColor } from "@/lib/doc-color";
import { writeAtCursorAction } from "../actions";
import { setDocColor, startBlockDrag, type MenuStore, type SlashItem } from "./doc-marks";

// 编辑器里的 Notion 式浮动界面：「/」菜单、段落左边的「+」和拖动把手、光标处让 AI 写、选中文字后的格式栏。

const panel = "rounded-lg border border-line-strong bg-background text-sm shadow-lg";

const noItems = (): SlashItem[] => NO_ITEMS;
const NO_ITEMS: SlashItem[] = [];

/** 「/」菜单：跟着光标出现，上下键选择、回车确认 */
export function SlashMenu({ store, wrap }: { store: MenuStore; wrap: React.RefObject<HTMLDivElement | null> }) {
  const slash = useSyncExternalStore(store.subscribe, store.getSlash, () => null);
  const items = useSyncExternalStore(store.subscribe, store.getSlashItems, noItems);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [slash?.index]);
  if (!slash?.rect || !wrap.current) return null;
  const box = wrap.current.getBoundingClientRect();
  return (
    <div
      ref={list}
      role="listbox"
      data-testid="slash-menu"
      className={`${panel} absolute z-30 max-h-72 w-60 overflow-y-auto py-1`}
      style={{ top: slash.rect.bottom - box.top + 4, left: Math.max(0, slash.rect.left - box.left) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it: SlashItem, i) => {
        const head = i === 0 || items[i - 1].group !== it.group ? it.group : null;
        return (
          <div key={it.id}>
            {head && <div className="px-3 pb-0.5 pt-1.5 text-xs text-muted">{head}</div>}
            <button
              role="option"
              aria-selected={i === slash.index}
              onClick={() => store.pick(it)}
              className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left ${i === slash.index ? "bg-subtle-strong" : "hover:bg-subtle"}`}
            >
              <span className={it.group === "AI" ? "text-accent" : ""}>{it.label}</span>
              <span className="text-xs text-muted">{it.hint}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

type Hovered = { pos: number; top: number; height: number };

/** 鼠标停在某一段上时，左边出现「+」（在下面加一行并打开「/」菜单）和「⋮⋮」（拖动换位置，点一下选中这段） */
export function BlockHandle({ editor, wrap }: { editor: Editor | null; wrap: React.RefObject<HTMLDivElement | null> }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!editor || !el) return;
    const onMove = (e: MouseEvent) => {
      if (editor.isDestroyed || (e.target as HTMLElement).closest("[data-block-handle]")) return;
      const box = el.getBoundingClientRect();
      // 只看正文这一列（中文对照的格子不算）
      const block = [...editor.view.dom.children].find((c) => {
        if (c.classList.contains("zh-cell")) return false;
        const r = c.getBoundingClientRect();
        return e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4;
      }) as HTMLElement | undefined;
      if (!block) return setHovered(null);
      try {
        const $pos = editor.state.doc.resolve(editor.view.posAtDOM(block, 0));
        const pos = $pos.depth ? $pos.before(1) : $pos.pos;
        if (!editor.state.doc.nodeAt(pos)) return setHovered(null);
        const r = block.getBoundingClientRect();
        const line = parseFloat(getComputedStyle(block).lineHeight) || 24;
        setHovered({ pos, top: r.top - box.top, height: Math.min(line, r.height) });
      } catch {
        setHovered(null);
      }
    };
    const onLeave = () => setHovered(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, wrap]);

  if (!editor || !hovered || !editor.isEditable) return null;
  const node = editor.state.doc.nodeAt(hovered.pos);
  if (!node) return null;
  const left = editor.view.dom.getBoundingClientRect().left - (wrap.current?.getBoundingClientRect().left ?? 0);

  function add() {
    if (!editor || !node) return;
    if (node.type.name === "paragraph" && node.content.size === 0) {
      editor.chain().focus().setTextSelection(hovered!.pos + 1).insertContent("/").run();
      return;
    }
    const end = hovered!.pos + node.nodeSize;
    editor.chain().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).insertContent("/").focus().run();
  }

  function select() {
    if (!editor || !node) return;
    const { pos } = hovered!;
    if (node.isTextblock && node.content.size) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1, pos + node.nodeSize - 1)));
    } else {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    }
    editor.view.focus();
  }

  const btn = "flex h-6 w-5 items-center justify-center rounded text-muted hover:bg-subtle-strong hover:text-foreground";
  return (
    <div
      data-block-handle
      className="absolute z-10 flex items-center"
      style={{ top: hovered.top + Math.max(0, (hovered.height - 24) / 2), left: left + 4 }}
      onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
    >
      <button type="button" onClick={add} title="在下面加一行" aria-label="在下面加一行" className={btn}>
        +
      </button>
      <span draggable onDragStart={(e) => startBlockDrag(editor.view, hovered.pos, e.nativeEvent)} onClick={select} title="拖动换位置，点一下选中这段" aria-label="拖动换位置" className={`${btn} cursor-grab`}>
        ⋮⋮
      </span>
    </div>
  );
}

const QUICK_WRITES = ["接着上文往下写一段", "写这一节的内容", "列出这一节要写的要点"];

/** 光标处让 AI 写：说一句要求（或点快捷按钮）→ 看结果 → 插入 / 重写 / 放弃。插入前不改正文 */
export function AiWriter({
  editor,
  docId,
  at,
  initial,
  wrap,
  flush,
  onClose,
}: {
  editor: Editor;
  docId: string;
  at: number;
  initial?: string;
  wrap: React.RefObject<HTMLDivElement | null>;
  flush: () => Promise<void>;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ja: string; zh: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  async function run(text = instruction) {
    const doc = editor.state.doc;
    const pos = Math.min(at, doc.content.size);
    let heading = "";
    doc.nodesBetween(0, pos, (n) => {
      if (n.type.name === "heading") heading = n.textContent;
      return n.type.name === "doc";
    });
    setBusy(true);
    setError(null);
    await flush();
    const r = await writeAtCursorAction(docId, {
      instruction: text,
      before: doc.textBetween(0, pos, "\n\n"),
      after: doc.textBetween(pos, doc.content.size, "\n\n"),
      heading,
    });
    setBusy(false);
    if (r.ok) setResult(r.value);
    else setError(r.error);
  }

  useEffect(() => {
    // 从「/」菜单选了「AI 续写」：直接开始写
    if (initial && !started.current) {
      started.current = true;
      void run(initial);
    } else input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开时执行一次
  }, []);

  function insert() {
    if (!result) return;
    const pos = Math.min(at, editor.state.doc.content.size);
    const $pos = editor.state.doc.resolve(pos);
    // 光标在空白行：用写好的内容替换这一行
    const range = $pos.parent.type.name === "paragraph" && !$pos.parent.content.size && $pos.depth === 1 ? { from: $pos.before(1), to: $pos.after(1) } : pos;
    editor.chain().focus().insertContentAt(range, result.ja, { contentType: "markdown" }).run();
    onClose();
  }

  let top = 0;
  try {
    const c = editor.view.coordsAtPos(Math.min(at, editor.state.doc.content.size));
    top = c.bottom - (wrap.current?.getBoundingClientRect().top ?? 0) + 4;
  } catch {}

  return (
    <div
      data-testid="ai-writer"
      className={`${panel} absolute inset-x-6 z-30 space-y-2 p-3`}
      style={{ top }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
          editor.commands.focus();
        }
      }}
    >
      {result ? (
        <>
          <div lang="ja" className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-subtle px-3 py-2">
            {result.ja}
          </div>
          {result.zh && <p className="text-xs text-muted">中文意思：{result.zh}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={insert} className="btn-primary px-3 py-1">
              插入
            </button>
            <button onClick={() => void run()} disabled={busy} className="btn px-3 py-1">
              {busy ? "重写中…" : "重写"}
            </button>
            <button onClick={onClose} className="rounded-md px-3 py-1 text-muted hover:bg-subtle">
              放弃
            </button>
          </div>
        </>
      ) : (
        <>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <span className="text-accent">✦</span>
            <input
              ref={input}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={busy}
              maxLength={500}
              placeholder="告诉 AI 要写什么，例如：写研究背景，提到留学生日语学习的动机"
              className="min-w-0 flex-1 bg-transparent py-1 outline-none"
            />
            <button disabled={busy} className="btn-primary px-3 py-1">
              {busy ? "AI 正在写…" : "写"}
            </button>
          </form>
          {!busy && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_WRITES.map((q) => (
                <button key={q} onClick={() => (setInstruction(q), void run(q))} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-foreground">
                  {q}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

const BLOCK_TYPES = [
  { id: "p", label: "正文" },
  { id: "h2", label: "标题" },
  { id: "h3", label: "小标题" },
  { id: "ul", label: "• 列表" },
  { id: "ol", label: "1. 列表" },
  { id: "quote", label: "引用" },
] as const;

/** 选中文字后的格式栏：段落类型、粗体、斜体、删除线、文字颜色和背景色 */
export function FormatBar({ editor }: { editor: Editor }) {
  const [colorOpen, setColorOpen] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 2 })
        ? "h2"
        : e.isActive("heading", { level: 3 })
          ? "h3"
          : e.isActive("bulletList")
            ? "ul"
            : e.isActive("orderedList")
              ? "ol"
              : e.isActive("blockquote")
                ? "quote"
                : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      color: (e.getAttributes("docColor").c as DocColor | undefined) ?? null,
      bg: (e.getAttributes("docBg").c as DocColor | undefined) ?? null,
    }),
  });

  function setBlock(id: string) {
    const c = editor.chain().focus();
    // 先回到普通段落，再套上新的类型
    if (s.block === "ul") c.toggleBulletList();
    if (s.block === "ol") c.toggleOrderedList();
    if (s.block === "quote") c.toggleBlockquote();
    if (id === "p") c.setParagraph();
    if (id === "h2") c.setHeading({ level: 2 });
    if (id === "h3") c.setHeading({ level: 3 });
    if (id === "ul") c.setParagraph().toggleBulletList();
    if (id === "ol") c.setParagraph().toggleOrderedList();
    if (id === "quote") c.setParagraph().toggleBlockquote();
    c.run();
  }

  const btn = (active: boolean) => `rounded px-2 py-1 ${active ? "bg-subtle-strong" : "hover:bg-subtle"}`;
  return (
    <div className="relative flex items-center gap-0.5 px-1 py-0.5" data-testid="format-bar">
      <select value={s.block} onChange={(e) => setBlock(e.target.value)} aria-label="段落类型" className="rounded bg-transparent px-1 py-1 hover:bg-subtle">
        {BLOCK_TYPES.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
      <span className="mx-0.5 h-4 w-px bg-line" />
      <button title="粗体" onClick={() => editor.chain().focus().toggleBold().run()} className={`${btn(s.bold)} font-bold`}>
        B
      </button>
      <button title="斜体" onClick={() => editor.chain().focus().toggleItalic().run()} className={`${btn(s.italic)} italic`}>
        I
      </button>
      <button title="删除线" onClick={() => editor.chain().focus().toggleStrike().run()} className={`${btn(s.strike)} line-through`}>
        S
      </button>
      <button title="文字颜色和背景色" aria-label="颜色" onClick={() => setColorOpen(!colorOpen)} className={btn(colorOpen)}>
        <span className={s.color ? `doc-color-${s.color}` : ""}>
          <span className={`rounded-sm px-0.5 underline decoration-2 underline-offset-2 ${s.bg ? `doc-bg-${s.bg}` : ""}`}>A</span>
        </span>
        <span className="ml-0.5 text-xs text-muted">▾</span>
      </button>
      {colorOpen && (
        <div className={`${panel} absolute left-0 top-full z-30 mt-1 w-64 space-y-2 p-2`} data-testid="color-menu">
          <ColorRow kind="color" current={s.color} editor={editor} onPick={() => setColorOpen(false)} />
          <ColorRow kind="bg" current={s.bg} editor={editor} onPick={() => setColorOpen(false)} />
        </div>
      )}
    </div>
  );
}

function ColorRow({ kind, current, editor, onPick }: { kind: ColorKind; current: DocColor | null; editor: Editor; onPick: () => void }) {
  const pick = (c: DocColor | null) => {
    setDocColor(editor, kind, c);
    onPick();
  };
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{kind === "color" ? "文字颜色" : "背景色"}</div>
      <div className="flex flex-wrap gap-1">
        <button title="默认" aria-label={`${kind === "color" ? "文字" : "背景"}默认`} onClick={() => pick(null)} className={`h-6 w-6 rounded border ${!current ? "border-foreground" : "border-line"}`}>
          A
        </button>
        {DOC_COLORS.map((c) => (
          <button
            key={c}
            title={DOC_COLOR_LABELS[c]}
            aria-label={`${kind === "color" ? "文字" : "背景"}${DOC_COLOR_LABELS[c]}`}
            onClick={() => pick(c)}
            className={`h-6 w-6 rounded border ${current === c ? "border-foreground" : "border-line"} ${kind === "color" ? `doc-color-${c}` : `doc-bg-${c}`}`}
          >
            A
          </button>
        ))}
      </div>
    </div>
  );
}

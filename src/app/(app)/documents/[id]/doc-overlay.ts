import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { diffText } from "@/lib/doc-history";
import { alignZh, type ZhCell, type ZhEntry } from "@/lib/doc-zh";

// 编辑器上的叠加显示（不改正文）：
//   - 标出 AI 修改建议要改的原文、教授批注针对的原文（点卡片能定位，点高亮能找到卡片）
//   - 一段之内的 AI 修改建议直接显示在正文里：删掉的划红线、新增的标绿，后面跟「接受 / 拒绝」
//   - 中文对照：每个段落后面插一个中文格子，宽的时候编辑器用两栏网格排版，中文正好落在日文右边；窄的时候落在日文下面

/** replace：在正文里直接显示这条修改（一段之内的纯文字改动才这样显示，其余的在旁边的卡片里） */
export type OverlayMark = { id: string; text: string; nth?: number; kind: "suggestion" | "comment"; active: boolean; replace?: string };

export type OverlayState = {
  marks: OverlayMark[];
  zh: { stored: ZhEntry[]; keyOf: (node: PmNode) => string; onTranslate: (key: string) => void; busy: boolean } | null;
  onMarkClick: (id: string) => void;
  /** 正文里的修改建议：接受 / 拒绝；busy = 正在处理的建议 id */
  suggest?: { onAccept: (id: string) => void; onReject: (id: string) => void; busy: string | null };
};

/** 这条修改能不能直接显示在正文里：原文和新文字都在一段之内，且没有 Markdown 符号 */
export function isInlineReplace(find: string, replace: string) {
  const plain = (t: string) => !t.includes("\n") && searchableText(t) === t.trim();
  return find.trim().length > 0 && plain(find) && (replace === "" || plain(replace));
}

export const overlayKey = new PluginKey("docOverlay");

/** 编辑器插件读取的叠加数据。React 组件在 effect 里 set，再派发一个空事务让插件重画 */
export function createOverlayStore() {
  let state: OverlayState = { marks: [], zh: null, onMarkClick: () => {} };
  return {
    get: () => state,
    set: (next: OverlayState) => {
      state = next;
    },
  };
}

/** 去掉 Markdown 符号，取第一段第一行，用来在编辑器文字里查找 */
export function searchableText(text: string): string {
  const line =
    text
      .split("\n")
      .map((l) => l.replace(/^[ \t]*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "").replace(/[\\*_`~]/g, "").trim())
      .find(Boolean) ?? "";
  return line;
}

/** 在文档里找第 nth 处 text（只在同一段内匹配），返回 ProseMirror 位置 */
export function findTextRange(doc: PmNode, text: string, nth = 0): { from: number; to: number } | null {
  const needle = searchableText(text);
  if (!needle) return null;
  let seen = 0;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    const segments: { start: number; pos: number; len: number }[] = [];
    let acc = 0;
    node.forEach((child, offset) => {
      if (child.isText) {
        segments.push({ start: acc, pos: pos + 1 + offset, len: child.text!.length });
        acc += child.text!.length;
      }
    });
    const content = node.textContent;
    const toPos = (c: number) => {
      const seg = segments.find((s) => c >= s.start && c <= s.start + s.len) ?? segments.at(-1);
      return seg ? seg.pos + (c - seg.start) : pos + 1;
    };
    let at = content.indexOf(needle);
    while (at !== -1) {
      if (seen === nth) {
        found = { from: toPos(at), to: toPos(at + needle.length) };
        return false;
      }
      seen++;
      at = content.indexOf(needle, at + needle.length);
    }
    return false;
  });
  return found;
}

function zhWidget(cell: ZhCell, key: string | null, state: NonNullable<OverlayState["zh"]>) {
  return () => {
    const el = document.createElement("div");
    el.className = "zh-cell";
    el.setAttribute("contenteditable", "false");
    el.lang = "zh-CN";
    if (!key) return el; // 空段落：占位，保持左右对齐
    if (cell) {
      const p = document.createElement("p");
      p.textContent = cell.zh;
      if (cell.stale) p.className = "zh-stale";
      el.append(p);
    }
    if (!cell || cell.stale) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zh-action";
      btn.textContent = state.busy ? "翻译中…" : cell ? "待更新 · 重新翻译" : "还没有中文 · 翻译";
      btn.disabled = state.busy;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => state.onTranslate(key));
      el.append(btn);
    }
    return el;
  };
}

function insWidget(text: string, id: string) {
  return () => {
    const el = document.createElement("ins");
    el.className = "doc-ins";
    el.textContent = text;
    el.setAttribute("contenteditable", "false");
    el.dataset.markId = id;
    return el;
  };
}

function suggestButtons(id: string, s: NonNullable<OverlayState["suggest"]>) {
  return () => {
    const el = document.createElement("span");
    el.className = "doc-suggest-actions";
    el.setAttribute("contenteditable", "false");
    for (const [label, cls, fn] of [
      ["接受", "doc-suggest-accept", s.onAccept],
      ["拒绝", "doc-suggest-reject", s.onReject],
    ] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = s.busy === id ? "…" : label;
      b.disabled = !!s.busy;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => fn(id));
      el.append(b);
    }
    return el;
  };
}

function build(state: EditorState, overlay: OverlayState): DecorationSet {
  const decos: Decoration[] = [];
  for (const m of overlay.marks) {
    const range = findTextRange(state.doc, m.text, m.nth);
    if (!range || range.from >= range.to) continue;
    if (m.replace !== undefined && overlay.suggest) {
      // 正文里直接显示：按字比较原文和新文字，删掉的部分划线，新增的部分在对应位置插绿字
      let c = range.from;
      let i = 0;
      for (const [op, text] of diffText(searchableText(m.text), m.replace)) {
        if (op === 0) c += text.length;
        else if (op === -1) {
          decos.push(Decoration.inline(c, c + text.length, { class: `doc-del${m.active ? " doc-mark-active" : ""}`, "data-mark-id": m.id }));
          c += text.length;
        } else decos.push(Decoration.widget(c, insWidget(text, m.id), { side: 1, key: `ins:${m.id}:${i++}:${text}`, ignoreSelection: true }));
      }
      decos.push(
        Decoration.widget(range.to, suggestButtons(m.id, overlay.suggest), { side: 2, key: `sg:${m.id}:${overlay.suggest.busy ?? ""}`, ignoreSelection: true }),
      );
      continue;
    }
    decos.push(
      Decoration.inline(range.from, range.to, {
        class: `doc-mark doc-mark-${m.kind}${m.active ? " doc-mark-active" : ""}`,
        "data-mark-id": m.id,
      }),
    );
  }
  const zh = overlay.zh;
  if (zh) {
    // 标题横跨两栏、不需要中文；其余每个段落后面跟一个中文格子（空段落也放一个空格子，保持左右对齐）
    const blocks: { end: number; key: string | null }[] = [];
    state.doc.forEach((node, offset) => {
      if (node.type.name === "heading") return;
      blocks.push({ end: offset + node.nodeSize, key: zh.keyOf(node) || null });
    });
    const keys = blocks.flatMap((b) => (b.key ? [b.key] : []));
    const cells = alignZh(keys, zh.stored);
    let i = 0;
    for (const b of blocks) {
      const cell = b.key ? cells[i++] : null;
      decos.push(
        Decoration.widget(b.end, zhWidget(cell, b.key, zh), {
          side: -1,
          key: `zh:${b.key ?? ""}:${cell?.zh.length ?? 0}:${cell?.stale ? 1 : 0}:${zh.busy ? 1 : 0}:${b.end}`,
          ignoreSelection: true,
        }),
      );
    }
  }
  return DecorationSet.create(state.doc, decos);
}

export const DocOverlay = Extension.create<{ get: () => OverlayState }>({
  name: "docOverlay",
  addOptions() {
    return { get: () => ({ marks: [], zh: null, onMarkClick: () => {} }) };
  },
  addProseMirrorPlugins() {
    const get = this.options.get;
    return [
      new Plugin({
        key: overlayKey,
        props: {
          decorations: (state) => build(state, get()),
          handleDOMEvents: {
            click: (_view, event) => {
              const el = (event.target as HTMLElement | null)?.closest?.("[data-mark-id]");
              if (el) get().onMarkClick(el.getAttribute("data-mark-id")!);
              return false;
            },
          },
        },
      }),
    ];
  },
});

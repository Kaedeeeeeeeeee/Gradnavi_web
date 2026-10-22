import { Extension, Mark, type Editor, type Range } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { colorSpanStart, matchColorSpan, type ColorKind, type DocColor } from "@/lib/doc-color";

// 编辑器的 Notion 式操作：文字颜色/背景色、「/」菜单、空白行按空格让 AI 写、空白行提示。
// 这些扩展只管编辑器里的行为；菜单的界面在 editor-menus.tsx，通过 createMenuStore() 共享状态。

/** 文字颜色、背景色两种 mark，Markdown 存成 {color:red}…{/color}、{bg:yellow}…{/bg}（见 lib/doc-color.ts） */
function colorMark(kind: ColorKind) {
  const name = kind === "color" ? "docColor" : "docBg";
  return Mark.create({
    name,
    addAttributes() {
      return {
        c: {
          default: null,
          parseHTML: (el) => el.getAttribute(`data-${kind}`),
          renderHTML: (a) => ({ [`data-${kind}`]: a.c, class: `doc-${kind}-${a.c}` }),
        },
      };
    },
    parseHTML: () => [{ tag: `span[data-${kind}]` }],
    renderHTML: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
    renderMarkdown: (node, h) => `{${kind}:${node.attrs?.c}}${h.renderChildren(node)}{/${kind}}`,
    parseMarkdown: (token, h) => h.applyMark(name, h.parseInline(token.tokens || []), { c: token.color }),
    markdownTokenizer: {
      name,
      level: "inline",
      start: (src) => colorSpanStart(src) ?? -1,
      tokenize(src, _, h) {
        const m = matchColorSpan(src);
        if (!m || m.kind !== kind) return undefined;
        return { type: name, raw: m.raw, color: m.color, text: m.inner, tokens: h.inlineTokens(m.inner) };
      },
    },
  });
}

export const DocColorMark = colorMark("color");
export const DocBgMark = colorMark("bg");

export function setDocColor(editor: Editor, kind: ColorKind, color: DocColor | null) {
  const name = kind === "color" ? "docColor" : "docBg";
  const chain = editor.chain().focus();
  (color ? chain.setMark(name, { c: color }) : chain.unsetMark(name)).run();
}

/** 菜单的共享状态：编辑器扩展写，React 组件用 useSyncExternalStore 读 */
export type SlashState = { query: string; range: Range; rect: DOMRect | null; index: number } | null;

export function createMenuStore() {
  let slash: SlashState = null;
  let slashItems: SlashItem[] = [];
  let run: ((item: SlashItem) => void) | null = null;
  let openAi: (pos: number, instruction?: string) => void = () => {};
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSlash: () => slash,
    getSlashItems: () => slashItems,
    /** 光标处打开「让 AI 写」：由 React 那边用 onOpenAi 接上 */
    openAi: (pos: number, instruction?: string) => openAi(pos, instruction),
    onOpenAi(fn: (pos: number, instruction?: string) => void) {
      openAi = fn;
    },
    setSlash(next: SlashState, items: SlashItem[], command: ((item: SlashItem) => void) | null) {
      slash = next;
      slashItems = items;
      run = command;
      emit();
    },
    moveSlash(delta: number) {
      if (!slash || !slashItems.length) return;
      slash = { ...slash, index: (slash.index + delta + slashItems.length) % slashItems.length };
      emit();
    },
    pick(item?: SlashItem) {
      const it = item ?? (slash ? slashItems[slash.index] : undefined);
      if (it && run) run(it);
    },
  };
}
export type MenuStore = ReturnType<typeof createMenuStore>;

export type SlashItem = { id: string; label: string; hint: string; group: "格式" | "AI"; keys: string; run: (editor: Editor, range: Range, store: MenuStore) => void };

export const SLASH_ITEMS: SlashItem[] = [
  { id: "ai-continue", group: "AI", label: "AI 续写", hint: "接着上文写一段", keys: "ai xu xie continue", run: (e, r, s) => (e.chain().focus().deleteRange(r).run(), s.openAi(r.from, "接着上文往下写一段")) },
  { id: "ai-write", group: "AI", label: "让 AI 写…", hint: "说说要写什么", keys: "ai write xie", run: (e, r, s) => (e.chain().focus().deleteRange(r).run(), s.openAi(r.from)) },
  { id: "p", group: "格式", label: "正文", hint: "普通段落", keys: "text paragraph zhengwen", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: "h2", group: "格式", label: "标题", hint: "大节标题", keys: "h2 heading biaoti", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: "h3", group: "格式", label: "小标题", hint: "小节标题", keys: "h3 heading xiaobiaoti", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: "ul", group: "格式", label: "• 列表", hint: "无序列表", keys: "bullet list liebiao", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: "ol", group: "格式", label: "1. 列表", hint: "编号列表", keys: "ordered number list liebiao bianhao", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: "quote", group: "格式", label: "引用", hint: "引用一段文字", keys: "quote yinyong", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: "hr", group: "格式", label: "分割线", hint: "一条横线", keys: "divider hr fengexian", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

export function filterSlash(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((it) => it.label.toLowerCase().includes(q) || it.hint.includes(q) || it.keys.split(" ").some((k) => k.startsWith(q)));
}

export const SlashCommand = Extension.create<{ store: MenuStore }>({
  name: "slashCommand",
  addOptions: () => ({ store: null as unknown as MenuStore }),
  addProseMirrorPlugins() {
    const store = this.options.store;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allowedPrefixes: null,
        items: ({ query }) => filterSlash(query),
        command: ({ editor, range, props }) => props.run(editor, range, store),
        render: () => {
          const show = (p: SuggestionProps<SlashItem, SlashItem>) =>
            store.setSlash(p.items.length ? { query: p.query, range: p.range, rect: p.clientRect?.() ?? null, index: 0 } : null, p.items, p.command);
          return {
            onStart: show,
            onUpdate: show,
            onExit: () => store.setSlash(null, [], null),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (!store.getSlash()) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                store.moveSlash(event.key === "ArrowDown" ? 1 : -1);
                return true;
              }
              if (event.key === "Enter" && !event.isComposing) {
                store.pick();
                return true;
              }
              if (event.key === "Escape") {
                store.setSlash(null, [], null);
                return true;
              }
              return false;
            },
          };
        },
      }),
    ];
  },
});

/** 空白行（顶层的空段落）按空格：打开「让 AI 写」，和 Notion 一样 */
export const SpaceToAi = Extension.create<{ store: MenuStore }>({
  name: "spaceToAi",
  addOptions: () => ({ store: null as unknown as MenuStore }),
  addKeyboardShortcuts() {
    return {
      Space: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;
        if (!selection.empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parent.content.size) return false;
        this.options.store.openAi(selection.from);
        return true;
      },
    };
  },
});

export const EmptyLineHint = Placeholder.configure({
  placeholder: ({ node, editor, pos }) => {
    // 只在顶层的空段落提示（列表、引用里的空行不提示）
    if (node.type.name !== "paragraph" || editor.state.doc.resolve(pos).depth > 0) return "";
    return editor.isEmpty ? "从这里开始写，或按空格让 AI 写，输入「/」选择格式" : "按空格让 AI 写，输入「/」选择格式";
  },
  showOnlyCurrent: true,
});

/** 拖动段落左边的把手：选中整段，交给 ProseMirror 自己的拖放（放下时把这段移过去） */
export function startBlockDrag(view: EditorView, pos: number, e: DragEvent) {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.dragging = { slice: view.state.selection.content(), move: true };
  const dom = view.nodeDOM(pos);
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", view.state.doc.nodeAt(pos)?.textContent ?? "");
  if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 0, 0);
}

// 三栏外壳（工作台 | 文稿/浏览 | AI 对话）的布局与文稿栏标签状态（纯函数，服务器和浏览器共用）。
// 两者都存在 cookie 里：服务器首屏就按用户上次的布局渲染，文稿栏当前标签的内容也由服务器渲染。
// 文稿栏按需出现：没有打开任何标签时只有「工作台 | AI 对话」两栏（hasDoc = 有标签）。

import { z } from "zod";

export const PANES = ["work", "doc", "ai"] as const;
export type PaneId = (typeof PANES)[number];

export const PANE_LABELS: Record<PaneId, string> = { work: "工作台", doc: "文稿", ai: "AI 对话" };

export type Layout = {
  /** 展开的栏按权重分宽度 */
  weights: Record<PaneId, number>;
  collapsed: Record<PaneId, boolean>;
  /** 窄屏只显示一栏 */
  mobile: PaneId;
};

export type DocTab =
  | { kind: "doc"; id: string; title: string }
  | { kind: "professor"; id: string; title: string }
  | { kind: "web"; url: string; title: string };

export type Tabs = { tabs: DocTab[]; active: string | null };

export const LAYOUT_COOKIE = "gn_layout";
export const TABS_COOKIE = "gn_tabs";
export const MAX_TABS = 8;

const DEFAULT_WEIGHTS: Record<PaneId, number> = { work: 30, doc: 40, ai: 30 };
const OPEN: Record<PaneId, boolean> = { work: false, doc: false, ai: false };

export const DEFAULT_LAYOUT: Layout = { weights: DEFAULT_WEIGHTS, collapsed: OPEN, mobile: "work" };
export const EMPTY_TABS: Tabs = { tabs: [], active: null };

export type Preset = "three" | "chatDoc" | "focus";

export function presetLabel(preset: Preset, hasDoc: boolean) {
  if (preset === "three") return hasDoc ? "三栏" : "两栏";
  return preset === "chatDoc" ? "聊天 + 文稿" : "专注";
}

/** 没有文稿时没有「聊天 + 文稿」 */
export const presetsFor = (hasDoc: boolean): Preset[] => (hasDoc ? ["three", "chatDoc", "focus"] : ["three", "focus"]);

/** 现在显示着的栏（文稿栏没标签时不算） */
export const shownPanes = (hasDoc: boolean): PaneId[] => (hasDoc ? [...PANES] : ["work", "ai"]);

export const openPanes = (layout: Layout, hasDoc: boolean) => shownPanes(hasDoc).filter((p) => !layout.collapsed[p]);

/** 套用预设。focus 放大 `pane`，其余收成竖条 */
export function applyPreset(layout: Layout, preset: Preset, pane: PaneId): Layout {
  if (preset === "three") return { ...layout, weights: DEFAULT_WEIGHTS, collapsed: OPEN };
  if (preset === "chatDoc") return { ...layout, weights: { work: 30, doc: 60, ai: 40 }, collapsed: { work: true, doc: false, ai: false } };
  return { ...layout, collapsed: { work: pane !== "work", doc: pane !== "doc", ai: pane !== "ai" }, mobile: pane };
}

export function currentPreset(layout: Layout, hasDoc: boolean): Preset | null {
  const open = openPanes(layout, hasDoc);
  if (open.length === shownPanes(hasDoc).length) return "three";
  if (open.length === 1) return "focus";
  if (layout.collapsed.work) return "chatDoc";
  return null;
}

/** 收起一栏；最后一栏不能收起 */
export function collapsePane(layout: Layout, pane: PaneId, hasDoc: boolean): Layout {
  if (openPanes(layout, hasDoc).length <= 1 && !layout.collapsed[pane]) return layout;
  return { ...layout, collapsed: { ...layout.collapsed, [pane]: true } };
}

/**
 * 文稿栏刚消失（关掉了最后一个标签）后修正布局：剩下的两栏都收着（原来专注在文稿上）时回到两栏，窄屏停在文稿时回到工作台。
 * 文稿栏的收起状态清掉，下次打开文稿时直接显示。
 */
export function withoutDoc(layout: Layout): Layout {
  const collapsed = { ...layout.collapsed, doc: false };
  if (collapsed.work && collapsed.ai) collapsed.work = collapsed.ai = false;
  return { ...layout, collapsed, mobile: layout.mobile === "doc" ? "work" : layout.mobile };
}

export function expandPane(layout: Layout, pane: PaneId): Layout {
  if (!layout.collapsed[pane] && layout.mobile === pane) return layout;
  return { ...layout, collapsed: { ...layout.collapsed, [pane]: false }, mobile: pane };
}

export const tabKey = (t: DocTab) => (t.kind === "web" ? `web:${t.url}` : `${t.kind}:${t.id}`);

/** 打开（或切到）一个标签；超过上限时去掉最早打开的 */
export function openTab(state: Tabs, tab: DocTab): Tabs {
  const key = tabKey(tab);
  const exists = state.tabs.some((t) => tabKey(t) === key);
  let tabs = exists ? state.tabs.map((t) => (tabKey(t) === key ? tab : t)) : [...state.tabs, tab];
  if (tabs.length > MAX_TABS) tabs = tabs.slice(tabs.length - MAX_TABS);
  return { tabs, active: key };
}

/** 关闭标签；关的是当前标签时切到它旁边的一个 */
export function closeTab(state: Tabs, key: string): Tabs {
  const i = state.tabs.findIndex((t) => tabKey(t) === key);
  if (i < 0) return state;
  const tabs = state.tabs.filter((_, j) => j !== i);
  if (state.active !== key) return { tabs, active: state.active };
  const next = tabs[Math.min(i, tabs.length - 1)];
  return { tabs, active: next ? tabKey(next) : null };
}

export function activeTab(state: Tabs): DocTab | null {
  return state.tabs.find((t) => tabKey(t) === state.active) ?? null;
}

// ---- cookie ----

const paneRecord = <T extends z.ZodType>(v: T) => z.object({ work: v, doc: v, ai: v });

const layoutSchema = z.object({
  weights: paneRecord(z.number().min(1).max(1000)),
  collapsed: paneRecord(z.boolean()),
  mobile: z.enum(PANES),
});

const tabSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("doc"), id: z.string().max(64), title: z.string().max(100) }),
  z.object({ kind: z.literal("professor"), id: z.string().max(64), title: z.string().max(100) }),
  z.object({ kind: z.literal("web"), url: z.string().max(500), title: z.string().max(100) }),
]);

const tabsSchema = z.object({ tabs: z.array(tabSchema).max(MAX_TABS), active: z.string().max(600).nullable() });

function parse<T>(schema: z.ZodType<T>, raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const result = schema.safeParse(JSON.parse(decodeURIComponent(raw)));
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

export function parseLayout(raw: string | undefined, hasDoc = true): Layout {
  const layout = parse(layoutSchema, raw, DEFAULT_LAYOUT);
  // 全部收起是坏数据，退回默认
  if (PANES.every((p) => layout.collapsed[p])) return DEFAULT_LAYOUT;
  return hasDoc ? layout : withoutDoc(layout);
}

export function parseTabs(raw: string | undefined): Tabs {
  const state = parse(tabsSchema, raw, EMPTY_TABS);
  return state.active && !state.tabs.some((t) => tabKey(t) === state.active) ? { ...state, active: null } : state;
}

/** 标题太长时截断，保证 cookie 不超过 4KB */
export function serializeTabs(state: Tabs) {
  const tabs = state.tabs.map((t) => ({ ...t, title: t.title.slice(0, 40) }));
  return encodeURIComponent(JSON.stringify({ ...state, tabs }));
}

export function serializeLayout(layout: Layout) {
  return encodeURIComponent(JSON.stringify(layout));
}

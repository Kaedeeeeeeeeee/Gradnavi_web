"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { usePageStore } from "@/components/ai/page-context";
import {
  activeTab,
  applyPreset,
  closeTab as closeTabIn,
  collapsePane,
  currentPreset,
  expandPane,
  LAYOUT_COOKIE,
  MAX_TABS,
  openTab as openTabIn,
  PANE_LABELS,
  openPanes,
  presetLabel,
  presetsFor,
  shownPanes,
  serializeLayout,
  serializeTabs,
  tabKey,
  TABS_COOKIE,
  type DocTab,
  type Layout,
  type PaneId,
  type Preset,
  type Tabs,
  withoutDoc,
} from "@/lib/shell";

// 三栏外壳：工作台 | 文稿/浏览 | AI 对话，三栏平级、同时打开。
// 文稿栏按需出现：没打开文书/网页时只有「工作台 | AI 对话」两栏，打开第一个标签时滑入，关掉最后一个后隐藏。
// - 栏间拖动调宽；每栏可放大（其余收成竖条）或收起成 52px 竖条，竖条上显示未读/待确认标记
// - 顶栏三个布局预设；布局和文稿栏标签存在 cookie 里，下次打开保持原样
// - 窄屏（<1024px）只显示一栏，底部标签「主页 / 志愿 / 文书 / AI 对话」切换；打开的文稿盖在上面，左上角「返回」
// - 宽度不到 1280px（平板横屏、小笔记本）时，第一次打开文稿默认用「聊天 + 文稿」，工作台收成竖条，三栏不会都挤成 300px
// 文稿栏当前标签的内容由服务器渲染（layout 读 cookie），切换标签 = 写 cookie + router.refresh()。

const MIN_PANE_PX = 280;
/** 窗口比这窄时，打开文稿默认「聊天 + 文稿」 */
const ROOMY_PX = 1280;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

const narrowQuery = "(max-width: 1023.98px)";
function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(narrowQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useNarrow = () =>
  useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(narrowQuery).matches,
    () => false,
  );

type Badge = number | boolean;

type ShellApi = {
  layout: Layout;
  tabs: Tabs;
  openTab: (tab: DocTab) => void;
  closeTab: (key: string) => void;
  renameTab: (key: string, title: string) => void;
  expand: (pane: PaneId) => void;
  /** 这一栏用户现在看得见（宽屏：没收起；窄屏：当前标签） */
  isVisible: (pane: PaneId) => boolean;
  setBadge: (pane: PaneId, badge: Badge) => void;
};

const ShellContext = createContext<ShellApi | null>(null);

export function useShell() {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("需要在 AppShell 内使用");
  return shell;
}

/** 文稿栏里网页标签和 AI 等用的路径（发给 AI 作为“当前页面”） */
function tabPath(tab: DocTab) {
  if (tab.kind === "doc") return `/documents/${tab.id}`;
  if (tab.kind === "professor") return `/professors/${tab.id}`;
  if (tab.kind === "school") return `/schools/${tab.id}`;
  if (tab.kind === "task") return `/tasks/${tab.id}`;
  if (tab.kind === "search") return `/search/${tab.id}`;
  if (tab.kind === "compare") return "/aspirations/compare";
  return "/web";
}

type Props = {
  initialLayout: Layout;
  initialTabs: Tabs;
  /** 服务器渲染的是哪个标签（与 initialTabs.active 一致时内容才是新的） */
  docKey: string | null;
  /** 服务器读到的标签真实标题（文书改名后同步到标签上）；null = 已删除 */
  docTitle: string | null;
  doc: React.ReactNode;
  ai: React.ReactNode;
  topRight: React.ReactNode;
  /** 待你确认的任务 + AI 的提议数量，显示在工作台竖条 / 底部标签上 */
  awaiting: number;
  children: React.ReactNode;
};

export function AppShell({ initialLayout, initialTabs, docKey, docTitle, doc, ai, topRight, awaiting, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const pageStore = usePageStore();
  const narrow = useNarrow();
  const [layout, setLayout] = useState(initialLayout);
  const [tabs, setTabs] = useState(initialTabs);
  const [badges, setBadges] = useState<Record<PaneId, Badge>>({ work: false, doc: false, ai: false });
  const [lastPane, setLastPane] = useState<PaneId>(initialTabs.active ? "doc" : "work");
  /** 窄屏上文稿的「返回」回到哪一栏 */
  const [backTo, setBackTo] = useState<PaneId>("work");
  const [dragging, setDragging] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const paneRefs = useRef<Record<PaneId, HTMLElement | null>>({ work: null, doc: null, ai: null });

  useEffect(() => {
    if (!dragging) writeCookie(LAYOUT_COOKIE, serializeLayout(layout));
  }, [layout, dragging]);

  const updateTabs = useCallback(
    (next: Tabs, refresh: boolean) => {
      setTabs(next);
      writeCookie(TABS_COOKIE, serializeTabs(next));
      if (refresh) startRefresh(() => router.refresh());
    },
    [router],
  );

  const hasDoc = tabs.tabs.length > 0;
  const isVisible = useCallback(
    (pane: PaneId) => (pane === "doc" && !hasDoc ? false : narrow ? layout.mobile === pane : !layout.collapsed[pane]),
    [narrow, layout, hasDoc],
  );

  const api = useMemo<ShellApi>(
    () => ({
      layout,
      tabs,
      openTab: (tab) => {
        if (tab.kind === "web" && tab.url.length > 500) {
          window.open(tab.url, "_blank", "noopener");
          return;
        }
        const next = openTabIn(tabs, tab);
        updateTabs(next, next.active !== tabs.active || next.tabs.length !== tabs.tabs.length);
        // 文稿栏刚出现、窗口又不够三栏时，先让工作台让位；志愿并排对比要宽，也让工作台让位
        const cramped =
          !narrow && currentPreset(layout, true) === "three" && ((!tabs.tabs.length && window.innerWidth < ROOMY_PX) || (tab.kind === "compare" && window.innerWidth < 1800));
        setLayout((l) => (cramped ? applyPreset(l, "chatDoc", "doc") : expandPane(l, "doc")));
        if (layout.mobile !== "doc") setBackTo(layout.mobile);
        setLastPane("doc");
      },
      closeTab: (key) => {
        const next = closeTabIn(tabs, key);
        updateTabs(next, next.active !== tabs.active);
        if (!next.tabs.length) setLayout(withoutDoc);
      },
      renameTab: (key, title) => {
        if (!tabs.tabs.some((t) => tabKey(t) === key && t.title !== title)) return;
        updateTabs({ ...tabs, tabs: tabs.tabs.map((t) => (tabKey(t) === key ? { ...t, title } : t)) }, false);
      },
      expand: (pane) => setLayout((l) => expandPane(l, pane)),
      isVisible,
      setBadge: (pane, badge) => setBadges((b) => (b[pane] === badge ? b : { ...b, [pane]: badge })),
    }),
    [layout, tabs, updateTabs, isVisible, narrow],
  );

  // 告诉 AI 用户正在看什么：工作台栏的页面 + 文稿栏的当前标签（栏收起时不算）
  const current = activeTab(tabs);
  // 窄屏上用户切到 AI 标签问的通常就是刚才看的文稿，所以窄屏一直算可见
  const docVisible = hasDoc && (narrow || !layout.collapsed.doc);
  useEffect(() => {
    pageStore.setWorkPath(pathname);
  }, [pageStore, pathname]);
  useEffect(() => {
    pageStore.setDoc(
      current && docVisible ? { path: tabPath(current), title: current.kind === "web" ? `${current.title}（${current.url}）`.slice(0, 200) : current.title } : null,
    );
  }, [pageStore, current, docVisible]);

  // 服务器发现标签对应的文书已删除：关掉；改了名：同步标题
  const { closeTab, renameTab } = api;
  useEffect(() => {
    if (!docKey || docKey !== tabs.active) return;
    if (docTitle === null) closeTab(docKey);
    else renameTab(docKey, docTitle);
  }, [docKey, docTitle, tabs.active, closeTab, renameTab]);

  function startDrag(e: React.PointerEvent<HTMLDivElement>, a: PaneId, b: PaneId) {
    const ea = paneRefs.current[a];
    const eb = paneRefs.current[b];
    if (!ea || !eb) return;
    const pa = ea.getBoundingClientRect().width;
    const pb = eb.getBoundingClientRect().width;
    const total = layout.weights[a] + layout.weights[b];
    const x0 = e.clientX;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const na = Math.min(Math.max(pa + ev.clientX - x0, MIN_PANE_PX), pa + pb - MIN_PANE_PX);
      const wa = (total * na) / (pa + pb);
      setLayout((l) => ({ ...l, weights: { ...l.weights, [a]: wa, [b]: total - wa } }));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDragging(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  const shown = shownPanes(hasDoc);
  const open = openPanes(layout, hasDoc);
  const nextOpen = (p: PaneId) => open[open.indexOf(p) + 1];
  const preset = currentPreset(layout, hasDoc);
  const focusPane = shown.includes(lastPane) ? lastPane : "work";
  const choosePreset = (p: Preset) => setLayout((l) => applyPreset(l, p, p === "focus" ? focusPane : l.mobile));

  const badgeOf = (pane: PaneId): Badge => {
    if (pane === "doc" && !badges.doc) return tabs.tabs.length || false;
    if (pane === "work" && !badges.work) return awaiting || false;
    return badges[pane];
  };

  const showMobile = (pane: PaneId) => setLayout((l) => ({ ...l, mobile: pane }));

  const header: Record<PaneId, React.ReactNode> = {
    work: <WorkTabs pathname={pathname} />,
    doc: (
      <div className="flex items-center gap-1">
        <button onClick={() => showMobile(backTo === "doc" ? "work" : backTo)} className="shrink-0 rounded-md px-2 py-1 text-sm text-muted hover:bg-subtle hover:text-foreground lg:hidden">
          ‹ 返回
        </button>
        <div className="min-w-0 flex-1">
          <DocTabBar tabs={tabs} onActivate={(key) => key !== tabs.active && updateTabs({ ...tabs, active: key }, true)} onClose={closeTab} />
        </div>
      </div>
    ),
    ai: <span className="px-1 text-sm font-medium">AI 对话</span>,
  };

  const docBody =
    tabs.active === docKey && !refreshing ? (
      doc
    ) : (
      <p className="px-6 py-10 text-sm text-muted">打开中…</p>
    );
  const body: Record<PaneId, React.ReactNode> = {
    work: <div className="px-4 py-6 sm:px-6 sm:py-8">{children}</div>,
    doc: docBody,
    ai,
  };

  return (
    <ShellContext value={api}>
      <div className={`flex h-dvh flex-col bg-canvas ${dragging ? "cursor-col-resize select-none" : ""}`}>
        <header className="flex h-12 shrink-0 items-center gap-4 px-4 max-lg:border-b max-lg:border-line max-lg:bg-surface">
          <Link href="/workbench" className="flex items-center gap-2 text-[15px] font-semibold">
            <LogoMark />
            GradNavi
          </Link>
          <div className="hidden rounded-md bg-subtle p-0.5 text-xs lg:flex">
            {presetsFor(hasDoc).map((p) => (
              <button
                key={p}
                onClick={() => choosePreset(p)}
                title={p === "focus" ? `放大当前栏（${PANE_LABELS[focusPane]}），其余收成竖条` : undefined}
                className={`rounded-[5px] px-2.5 py-1 ${preset === p ? "bg-surface shadow-[0_1px_2px_rgb(15_15_15/0.1)]" : "text-muted hover:text-foreground"}`}
              >
                {presetLabel(p, hasDoc)}
              </button>
            ))}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1 text-sm">{topRight}</div>
        </header>

        <div className="flex min-h-0 flex-1 lg:px-2 lg:pb-2">
          {shown.map((p) => (
            <Fragment key={p}>
              {layout.collapsed[p] && <Rail pane={p} badge={badgeOf(p)} onOpen={() => api.expand(p)} />}
              <section
                ref={(el) => {
                  paneRefs.current[p] = el;
                }}
                onPointerDownCapture={() => setLastPane(p)}
                style={{ flexGrow: layout.weights[p], flexBasis: 0 }}
                className={`min-w-0 flex-col ${layout.collapsed[p] ? "lg:hidden" : "lg:flex"} ${layout.mobile === p ? "max-lg:flex" : "max-lg:hidden"} lg:min-w-[280px] ${p === "doc" ? "animate-pane-in" : ""} overflow-hidden lg:rounded-xl lg:border lg:border-line lg:shadow-[0_1px_2px_rgb(15_15_15/0.04)] ${p === "ai" ? "bg-panel" : "bg-surface"}`}
                aria-label={PANE_LABELS[p]}
              >
                <div className={`flex h-10 shrink-0 items-center gap-1 border-b border-line pl-2 pr-1 ${p === "work" ? "max-lg:hidden" : ""}`}>
                  <div className="min-w-0 flex-1">{header[p]}</div>
                  <PaneControls only={open.length === 1} onMax={() => choosePresetFor(p)} onRestore={() => choosePreset("three")} onCollapse={() => setLayout((l) => collapsePane(l, p, hasDoc))} />
                </div>
                <div className={`min-h-0 flex-1 ${p === "ai" ? "flex flex-col" : "overflow-y-auto"}`}>{body[p]}</div>
              </section>
              {!layout.collapsed[p] && nextOpen(p) && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  title="拖动调整宽度"
                  onPointerDown={(e) => startDrag(e, p, nextOpen(p)!)}
                  className="relative z-10 hidden w-2 shrink-0 cursor-col-resize touch-none rounded-full lg:block hover:bg-accent/20"
                />
              )}
            </Fragment>
          ))}
        </div>

        <nav className="flex shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
          {WORK_TABS.map((t, i) => {
            const active = layout.mobile === "work" && isWorkTabActive(pathname, t.href);
            const badge = i === 0 ? badgeOf("work") : false;
            return (
              <Link
                key={t.href}
                href={t.href}
                onClick={() => showMobile("work")}
                className={`relative flex-1 py-2.5 text-center text-sm ${active ? "font-medium" : "text-muted"}`}
              >
                {t.label}
                {!active && badge ? <BadgeDot badge={badge} className="ml-1" /> : null}
              </Link>
            );
          })}
          <button onClick={() => showMobile("ai")} className={`relative flex-1 py-2.5 text-sm ${layout.mobile === "ai" ? "font-medium" : "text-muted"}`}>
            {PANE_LABELS.ai}
            {layout.mobile !== "ai" && badgeOf("ai") ? <BadgeDot badge={badgeOf("ai")} className="ml-1" /> : null}
          </button>
        </nav>
      </div>
    </ShellContext>
  );

  function choosePresetFor(p: PaneId) {
    setLastPane(p);
    setLayout((l) => applyPreset(l, "focus", p));
  }
}

function PaneControls({ only, onMax, onRestore, onCollapse }: { only: boolean; onMax: () => void; onRestore: () => void; onCollapse: () => void }) {
  const cls = "rounded px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-foreground";
  return (
    <div className="hidden shrink-0 items-center lg:flex">
      {only ? (
        <button onClick={onRestore} className={cls} title="还原成三栏">
          还原
        </button>
      ) : (
        <>
          <button onClick={onMax} className={cls} title="放大这一栏，其余收成竖条" aria-label="放大">
            ⤢
          </button>
          <button onClick={onCollapse} className={cls} title="收起成竖条" aria-label="收起">
            —
          </button>
        </>
      )}
    </div>
  );
}

function Rail({ pane, badge, onOpen }: { pane: PaneId; badge: Badge; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title={`展开${PANE_LABELS[pane]}`}
      className="mx-1 hidden w-[48px] shrink-0 flex-col items-center gap-2 rounded-xl border border-line bg-surface py-3 text-sm text-muted first:ml-0 last:mr-0 hover:bg-subtle hover:text-foreground lg:flex"
    >
      {badge ? <BadgeDot badge={badge} /> : null}
      <span className="[writing-mode:vertical-rl] tracking-widest">{PANE_LABELS[pane]}</span>
    </button>
  );
}

/** 品牌标志：蓝底白字的 G */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid size-[22px] shrink-0 place-items-center rounded-[5px] bg-primary text-xs font-bold text-on-primary ${className}`}>
      G
    </span>
  );
}

function BadgeDot({ badge, className = "" }: { badge: Badge; className?: string }) {
  if (typeof badge === "number")
    return <span className={`inline-flex min-w-5 justify-center rounded-full bg-subtle-strong px-1.5 text-xs tabular-nums text-foreground ${className}`}>{badge}</span>;
  return <span className={`inline-block size-2 rounded-full bg-accent ${className}`} aria-label="有新内容" />;
}

// 日历并进了主页，不再单独一个标签
// 研究科和教授合并成「志愿」（每条 = 教授 + 教授所在的研究科）
const WORK_TABS = [
  { href: "/workbench", label: "主页" },
  { href: "/aspirations", label: "志愿" },
  { href: "/documents", label: "文书" },
];

const isWorkTabActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function WorkTabs({ pathname }: { pathname: string }) {
  return (
    <nav className="flex gap-0.5 overflow-x-auto text-sm">
      {WORK_TABS.map((t) => {
        const active = isWorkTabActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 rounded-md px-2.5 py-1 ${active ? "bg-subtle font-medium" : "text-muted hover:bg-subtle hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

const TAB_ICONS: Record<DocTab["kind"], string> = { doc: "文", professor: "志", school: "志", task: "任", search: "找", compare: "比", web: "网" };

function DocTabBar({ tabs, onActivate, onClose }: { tabs: Tabs; onActivate: (key: string) => void; onClose: (key: string) => void }) {
  if (!tabs.tabs.length) return <span className="px-1 text-sm font-medium">文稿 / 浏览</span>;
  return (
    <div className="flex gap-0.5 overflow-x-auto text-sm" role="tablist">
      {tabs.tabs.map((t) => {
        const key = tabKey(t);
        const active = key === tabs.active;
        return (
          <div
            key={key}
            role="tab"
            aria-selected={active}
            className={`group flex max-w-48 shrink-0 items-center rounded-md ${active ? "bg-subtle font-medium" : "text-muted hover:bg-subtle hover:text-foreground"}`}
          >
            <button onClick={() => onActivate(key)} className="flex min-w-0 items-center gap-1.5 py-1 pl-2" title={t.kind === "web" ? t.url : t.title}>
              <span className="text-[10px] text-faint">{TAB_ICONS[t.kind]}</span>
              <span className="truncate">{t.title || "（无标题）"}</span>
            </button>
            <button onClick={() => onClose(key)} className="px-1.5 py-1 text-faint hover:text-foreground" aria-label={`关闭 ${t.title}`}>
              ×
            </button>
          </div>
        );
      })}
      {tabs.tabs.length >= MAX_TABS && <span className="self-center px-1 text-xs text-faint">最多 {MAX_TABS} 个</span>}
    </div>
  );
}

/** 在文稿栏打开的链接：点击开标签，不跳页；href 留作新窗口打开 / 无 JS 时的退路 */
export function OpenTabLink({ tab, href, className, children }: { tab: DocTab; href: string; className?: string; children: React.ReactNode }) {
  const { openTab } = useShell();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openTab(tab);
      }}
    >
      {children}
    </a>
  );
}

/** 路由 /documents/[id] 用：进入时在文稿栏打开这份文书，地址改回 /documents */
export function OpenTabOnMount({ tab, replaceWith }: { tab: DocTab; replaceWith: string }) {
  const { openTab } = useShell();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    window.history.replaceState(null, "", replaceWith);
    openTab(tab);
  }, [openTab, tab, replaceWith]);
  return null;
}

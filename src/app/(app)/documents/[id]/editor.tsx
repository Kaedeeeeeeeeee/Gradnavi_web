"use client";

import { Markdown } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useAiBeforeSend, useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { takeAutoAsk } from "@/components/shell/pending-ask";
import { copyText } from "@/lib/browser";
import { isRewrite, SELECTION_ACTION_LABELS, SELECTION_ACTIONS, type SelectionAction } from "@/lib/doc-assist";
import { alignZh, blockKey, type ZhEntry } from "@/lib/doc-zh";
import { describeDocument, DOC_KIND_LABELS, type DocKind, type Outline, type TargetProfessor, type WriteMode } from "@/lib/documents";
import type { Track } from "@/lib/onboarding";
import type { ProfessorStatus } from "@/lib/professors";
import {
  acceptAllSuggestionsAction,
  acceptSuggestionAction,
  applyCommentAction,
  assistSelectionAction,
  deleteDocumentAction,
  ignoreCommentAction,
  rejectSuggestionAction,
  renameDocumentAction,
  reviewAction,
  saveDocumentAction,
  snapshotAction,
  translateAction,
} from "../actions";
import { createOverlayStore, DocOverlay, findTextRange, overlayKey, type OverlayMark } from "./doc-overlay";
import { HistoryView } from "./history-view";
import { LetterPanel, ProfessorForm, TailoredCopies, type DocLink, type PlanOption, type ProfessorOption } from "./panels";
import { ReviewRail, type CommentView, type SuggestionView } from "./review-rail";
import { WritingGuide } from "./writing-guide";

type Doc = {
  id: string;
  kind: DocKind;
  title: string;
  markdown: string;
  version: number;
  targetProfessor: TargetProfessor | null;
  zh: ZhEntry[];
  outline: Outline | null;
  writeMode: WriteMode | null;
};

type Props = {
  doc: Doc;
  track: Track | null;
  /** 志愿，用来选目标教授、复制定制版 */
  professors: ProfessorOption[];
  /** 关联教授在清单里的联系状态 */
  linkedStatus: ProfessorStatus | null;
  suggestions: SuggestionView[];
  comments: CommentView[];
  /** 定制版：复制自哪份文书的第几版 */
  parent: (DocLink & { version: number | null }) | null;
  copies: (DocLink & { professorName: string | null; parentVersion: number | null })[];
  /** 套磁信：附上的计划书和可选的计划书 */
  attachment: DocLink | null;
  plans: PlanOption[];
  versionCount: number;
};

const AUTOSAVE_MS = 1500;
// 发给 AI 的页面内容上限（接口限制 20000 字），更长时 AI 用 read_document 读全文
const PAGE_CONTENT_LIMIT = 16000;
const ZH_PREF = "gn_doc_zh";

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

function readZhPref() {
  try {
    return localStorage.getItem(ZH_PREF) === "1";
  } catch {
    return false;
  }
}
const noSubscribe = () => () => {};

export function DocumentEditor(props: Props) {
  const { doc, suggestions, comments } = props;
  const askAi = useAskAi();
  const { closeTab } = useShell();
  const [markdown, setMarkdown] = useState(doc.markdown);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  // 冲突时服务器上的最新版本（通常是用户刚在别处接受了 AI 的修改）
  const [conflict, setConflict] = useState<{ markdown: string; version: number } | null>(null);
  // 中文对照开关按浏览器记住
  const [zhPicked, setZhOn] = useState<boolean | null>(null);
  const zhStored = useSyncExternalStore(noSubscribe, readZhPref, () => false);
  const zhOn = zhPicked ?? zhStored;
  const [view, setView] = useState<"edit" | "history">("edit");
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [, startTransition] = useTransition();
  const version = useRef(doc.version);
  const baseline = useRef<string | null>(null); // 编辑器规范化后的“已保存”内容
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  // 段落指纹的缓存（ProseMirror 节点不可变，按节点缓存）；叠加显示的数据由下面的 effect 更新
  const [keyCache] = useState(() => new WeakMap<PmNode, string>());
  const [overlay] = useState(createOverlayStore);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), Markdown, DocOverlay.configure({ get: overlay.get })],
    content: doc.markdown,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        lang: "ja",
        class: "doc-prose min-h-[60vh] rounded-md border border-line px-6 py-5 outline-none focus:border-line-strong",
      },
    },
    onCreate: ({ editor }) => {
      baseline.current = editor.getMarkdown();
      setMarkdown(baseline.current);
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      setMarkdown(md);
      if (md === baseline.current) return;
      setSaveState((s) => (s === "conflict" ? s : "dirty"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(editor), AUTOSAVE_MS);
    },
  });

  const save = useCallback(
    async (ed: Editor) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (saving.current) await saving.current;
      const md = ed.getMarkdown();
      if (md === baseline.current) return;
      const run = (async () => {
        setSaveState("saving");
        try {
          const result = await saveDocumentAction(doc.id, md, version.current);
          if (result.ok) {
            version.current = result.version;
            baseline.current = md;
            setSaveState(ed.getMarkdown() === md ? "saved" : "dirty");
          } else {
            setConflict({ markdown: result.markdown, version: result.version });
            setSaveState("conflict");
          }
        } catch {
          setSaveState("error");
        }
      })();
      saving.current = run;
      await run;
      saving.current = null;
    },
    [doc.id],
  );

  const loadVersion = useCallback(
    (md: string, v: number) => {
      if (!editor) return;
      if (timer.current) clearTimeout(timer.current);
      editor.commands.setContent(md, { contentType: "markdown", emitUpdate: false });
      version.current = v;
      baseline.current = editor.getMarkdown();
      setMarkdown(baseline.current);
      setConflict(null);
      setSaveState("saved");
    },
    [editor],
  );

  // 接受了 AI 的修改、恢复了旧版等，页面刷新会带来新版本：没有未保存的修改就直接载入，否则提示冲突
  useEffect(() => {
    if (!editor || doc.version <= version.current) return;
    if (editor.getMarkdown() === baseline.current) loadVersion(doc.markdown, doc.version);
    else setConflict({ markdown: doc.markdown, version: doc.version });
  }, [editor, doc.markdown, doc.version, loadVersion]);

  // 离开页面时把还没自动保存的修改存掉（编辑器即将销毁，这里同步取内容）
  useEffect(() => {
    if (!editor) return;
    return () => {
      if (!timer.current || editor.isDestroyed) return;
      clearTimeout(timer.current);
      const md = editor.getMarkdown();
      if (md !== baseline.current) void saveDocumentAction(doc.id, md, version.current);
    };
  }, [editor, doc.id]);

  // 发消息给 AI、接受修改、审阅前先保存，服务器上才是最新内容
  const flush = useCallback(async () => {
    if (editor) await save(editor);
  }, [editor, save]);
  useAiBeforeSend(flush);

  /** 跑一个编辑器里的操作：先保存，失败时在顶部提示 */
  function act(id: string, fn: () => Promise<{ ok: true; value?: unknown } | { ok: false; error: string }>, done?: string) {
    setBusy(id);
    setNotice(null);
    startTransition(async () => {
      await flush();
      const r = await fn();
      setBusy(null);
      if (!r.ok) setNotice({ text: r.error, error: true });
      else if (done) setNotice({ text: done });
    });
  }

  // ---------- 编辑器上的叠加显示：修改建议、批注的位置，中文对照 ----------

  const translate = (key?: string) => act("translate", () => translateAction(doc.id, key ? [key] : undefined));

  const keyOf = useCallback(
    (node: PmNode) => {
      let k = keyCache.get(node);
      if (k === undefined) {
        const md = editor?.markdown?.serialize({ type: "doc", content: [node.toJSON()] }) ?? node.textContent;
        k = blockKey(md);
        keyCache.set(node, k);
      }
      return k;
    },
    [editor, keyCache],
  );

  const marks: OverlayMark[] = [
    ...suggestions.flatMap((s): OverlayMark[] =>
      s.op.type === "replace"
        ? [{ id: s.id, text: s.op.find, nth: s.op.nth, kind: "suggestion", active: active === s.id }]
        : s.op.type === "section"
          ? [{ id: s.id, text: s.op.heading, kind: "suggestion", active: active === s.id }]
          : [],
    ),
    ...comments.map((c): OverlayMark => ({ id: c.id, text: c.quote, kind: "comment", active: active === c.id })),
  ];
  const zhBusy = busy === "translate";
  const translateRef = useRef(translate);
  useLayoutEffect(() => {
    translateRef.current = translate;
  });
  const overlaySig = JSON.stringify([marks, zhOn, doc.zh, zhBusy]);
  useLayoutEffect(() => {
    overlay.set({
      marks: JSON.parse(overlaySig)[0] as OverlayMark[],
      zh: zhOn ? { stored: doc.zh, keyOf, onTranslate: (k) => translateRef.current(k), busy: zhBusy } : null,
      onMarkClick: (id) => {
        setActive(id);
        document.querySelector(`[data-rail-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      },
    });
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(overlayKey, true));
  }, [editor, overlay, overlaySig, zhOn, doc.zh, keyOf, zhBusy]);

  function focusMark(id: string) {
    setActive(id);
    const m = marks.find((x) => x.id === id);
    if (!editor || !m) return;
    const range = findTextRange(editor.state.doc, m.text, m.nth);
    if (!range) return;
    const dom = editor.view.domAtPos(range.from).node;
    (dom instanceof HTMLElement ? dom : dom.parentElement)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // 中文对照：缺失或待更新的段落数
  const zhMissing = (() => {
    if (!zhOn || !editor) return 0;
    const keys: string[] = [];
    editor.state.doc.forEach((n) => {
      if (n.type.name === "heading") return;
      const k = keyOf(n);
      if (k) keys.push(k);
    });
    return alignZh(keys, doc.zh).filter((c) => !c || c.stale).length;
  })();

  // ---------- 发给 AI 的页面内容 ----------

  const header = describeDocument(doc);
  const outlineLine = doc.outline
    ? `\n提纲（${doc.outline.status === "approved" ? "用户已同意" : "等用户同意"}）：${doc.outline.sections.map((s) => s.heading).join(" / ")}`
    : "";
  const modeLine = doc.writeMode === "self" ? "\n写法：用户自己写，AI 只给意见" : doc.writeMode === "together" ? "\n写法：和 AI 一起写" : "";
  const pendingLine = suggestions.length ? `\n待用户确认的修改建议：${suggestions.map((s) => s.summary).join("；")}` : "";
  const body = markdown.length > PAGE_CONTENT_LIMIT ? `${markdown.slice(0, PAGE_CONTENT_LIMIT)}\n\n（后文省略，用 read_document 读取全文）` : markdown;
  useAiPageContent(`${header}${outlineLine}${modeLine}${pendingLine}\n\n---\n${body}`, "doc");

  // 从找教授页“写套磁信”进来时让 AI 写初稿（只触发一次）
  useEffect(() => {
    if (!editor || takeAutoAsk(doc.id) !== "letter") return;
    askAi(
      `请给目标教授 ${doc.targetProfessor?.name ?? ""} 写这封套磁信的日文初稿，用 update_document 整篇写入当前文书（附中文对照和一句说明）。根据我的 user.md 和教授的研究方向，说明我为什么对教授的研究感兴趣、我的背景和研究计划概要，并提到附上研究计划书（草稿）。缺少关键信息（如姓名、研究计划）时先用占位符，写完告诉我需要补充什么。`,
    );
  }, [editor, askAi, doc.id, doc.targetProfessor?.name]);

  async function exportPdf() {
    // 先打开窗口再保存，避免浏览器拦截弹窗
    const win = window.open("", "_blank");
    await flush();
    const url = `/api/documents/${doc.id}/pdf`;
    if (win) win.location.href = url;
    else window.open(url, "_self");
  }

  async function copyLetter() {
    if (!editor) return false;
    const ok = await copyText(editor.getText({ blockSeparator: "\n" }));
    if (ok) {
      await flush();
      void snapshotAction(doc.id, "copy");
    }
    return ok;
  }

  const reviewer = doc.targetProfessor ? `${doc.targetProfessor.name}教授` : "教授";
  const guided = doc.kind === "plan" || doc.kind === "intro";
  const hasRail = suggestions.length > 0 || comments.length > 0;

  return (
    <div className="@container mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/documents" className="hover:text-foreground">
          文书
        </Link>
        <span>/</span>
        <span>{DOC_KIND_LABELS[doc.kind]}</span>
        {props.parent && (
          <span data-testid="copied-from">
            · 复制自
            <OpenTabLink tab={{ kind: "doc", id: props.parent.id, title: props.parent.title }} href={`/documents/${props.parent.id}`} className="mx-0.5 underline hover:text-foreground">
              「{props.parent.title}」
            </OpenTabLink>
            {props.parent.version && `第 ${props.parent.version} 版`}
          </span>
        )}
      </div>

      <TitleInput id={doc.id} title={doc.title} />

      {guided && <WritingGuide doc={doc} track={props.track} onAsk={askAi} />}
      {doc.kind === "plan" && !props.parent && <TailoredCopies docId={doc.id} copies={props.copies} professors={props.professors} />}
      {doc.kind === "plan" && (
        <div className="rounded-md border border-line p-4 text-sm">
          <ProfessorForm docId={doc.id} professor={doc.targetProfessor} professors={props.professors} defaultOpen={false} />
        </div>
      )}
      {doc.kind === "letter" && (
        <LetterPanel
          docId={doc.id}
          professor={doc.targetProfessor}
          professors={props.professors}
          linkedStatus={props.linkedStatus}
          attachment={props.attachment}
          plans={props.plans}
          onCopy={copyLetter}
        />
      )}

      {conflict && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm">
          <span>文书在别处被修改了，你这里还有未保存的内容。</span>
          <button className="underline" onClick={() => loadVersion(conflict.markdown, conflict.version)}>
            载入最新版（放弃我的修改）
          </button>
          <button
            className="underline"
            onClick={() => {
              version.current = conflict.version;
              setConflict(null);
              if (editor) void save(editor);
            }}
          >
            用我的版本覆盖
          </button>
        </div>
      )}

      {notice && (
        <p className={`text-sm ${notice.error ? "text-danger" : "text-ok"}`} role="status">
          {notice.text}
        </p>
      )}

      {view === "history" && (
        <HistoryView docId={doc.id} current={{ markdown, zh: doc.zh }} flush={flush} onClose={() => setView("edit")} />
      )}

      <div className={`flex flex-col gap-4 @4xl:flex-row @4xl:items-start ${view === "history" ? "hidden" : ""}`}>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Toolbar editor={editor} />
            <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  data-testid="zh-toggle"
                  checked={zhOn}
                  onChange={(e) => {
                    setZhOn(e.target.checked);
                    try {
                      localStorage.setItem(ZH_PREF, e.target.checked ? "1" : "0");
                    } catch {}
                  }}
                />
                中文对照
              </label>
              {zhOn && zhMissing > 0 && (
                <button onClick={() => translate()} disabled={!!busy} className="text-accent underline disabled:opacity-40">
                  {busy === "translate" ? "翻译中…" : `翻译 ${zhMissing} 段`}
                </button>
              )}
              <button onClick={() => setView("history")} className="btn px-3 py-1">
                版本历史{props.versionCount ? `（${props.versionCount}）` : ""}
              </button>
              <button
                data-testid="review-button"
                onClick={() => act("review", () => reviewAction(doc.id), "审阅完成，批注在页边。")}
                disabled={!!busy}
                className="btn-primary px-3 py-1"
              >
                {busy === "review" ? "AI 正在审阅…" : `让 AI 当${reviewer}审一遍`}
              </button>
            </div>
          </div>

          <SelectionArea editor={editor} zhOn={zhOn} docId={doc.id} flush={flush} />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm">
            <span className="text-muted">{SAVE_LABELS[saveState]}</span>
            <div className="flex gap-2">
              <button onClick={exportPdf} className="btn px-3 py-1.5">
                导出 PDF
              </button>
              <form
                action={async () => {
                  await deleteDocumentAction(doc.id);
                  closeTab(`doc:${doc.id}`);
                }}
                onSubmit={(e) => !confirm("确定删除这份文书？") && e.preventDefault()}
              >
                <button className="rounded-md px-3 py-1.5 text-danger hover:bg-danger-soft">删除</button>
              </form>
            </div>
          </div>
        </div>

        {hasRail && (
          <aside className="order-first shrink-0 @4xl:sticky @4xl:top-2 @4xl:order-none @4xl:max-h-[85vh] @4xl:w-80 @4xl:overflow-y-auto">
            <ReviewRail
              markdown={markdown}
              suggestions={suggestions}
              comments={comments}
              active={active}
              busy={busy}
              onFocus={focusMark}
              onAccept={(id) => act(id, () => acceptSuggestionAction(id))}
              onReject={(id) => act(id, () => rejectSuggestionAction(id))}
              onAcceptAll={() =>
                act("all", async () => {
                  const r = await acceptAllSuggestionsAction(doc.id);
                  return r.ok && r.value ? { ok: false, error: `有 ${r.value} 条修改的原文已经变了，没能接受，请逐条处理。` } : r;
                })
              }
              onApplyComment={(id) => act(id, () => applyCommentAction(doc.id, id), "已按批注生成修改建议。")}
              onIgnoreComment={(id) => act(id, () => ignoreCommentAction(doc.id, id))}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: "已保存",
  dirty: "有未保存的修改",
  saving: "保存中…",
  conflict: "保存冲突，请在上方选择",
  error: "保存失败，请检查网络后继续编辑重试",
};

/** 编辑区 + 选中文字后弹出的小菜单（改得更自然 / 更简短 / 解释这句 / 翻成中文） */
function SelectionArea({ editor, zhOn, docId, flush }: { editor: Editor | null; zhOn: boolean; docId: string; flush: () => Promise<void> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const sel = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const { from, to } = e.state.selection;
      if (from === to) return null;
      const text = e.state.doc.textBetween(from, to, "\n").trim();
      return text ? { from, to, text } : null;
    },
    equalityFn: (a, b) => a?.from === b?.from && a?.to === b?.to,
  });
  const [result, setResult] = useState<{ for: string; text: string; error?: boolean } | null>(null);
  const [running, setRunning] = useState<SelectionAction | null>(null);

  const pos = (() => {
    if (!editor || !sel || editor.isDestroyed) return null;
    try {
      // 编辑区（view.dom）贴着外层容器的左上角，按它算相对位置
      const start = editor.view.coordsAtPos(sel.from);
      const box = editor.view.dom.getBoundingClientRect();
      return { top: start.top - box.top, left: Math.max(0, Math.min(start.left - box.left, box.width - 320)) };
    } catch {
      return null;
    }
  })();

  async function run(action: SelectionAction) {
    if (!editor || !sel) return;
    // 选中的是原文里第几处相同的文字（原文重复出现时定位用）
    const before = editor.state.doc.textBetween(0, sel.from, "\n");
    let nth = 0;
    for (let at = before.indexOf(sel.text); at !== -1; at = before.indexOf(sel.text, at + sel.text.length)) nth++;
    setRunning(action);
    setResult(null);
    await flush();
    const r = await assistSelectionAction(docId, { action, text: sel.text, nth });
    setRunning(null);
    if (!r.ok) setResult({ for: sel.text, text: r.error, error: true });
    else if (r.value.kind === "text") setResult({ for: sel.text, text: r.value.text });
    else setResult({ for: sel.text, text: "已生成修改建议，在旁边接受或拒绝。" });
  }

  const showResult = result && sel?.text === result.for;
  return (
    <div ref={wrap} className={`relative ${zhOn ? "zh-on" : ""}`}>
      <EditorContent editor={editor} />
      {sel && pos && (
        <div
          data-testid="selection-menu"
          className="absolute z-20 w-80 -translate-y-full pb-1"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {showResult && (
            <div className={`mb-1 rounded-md border bg-background p-2 text-sm shadow-md ${result.error ? "border-danger/40 text-danger" : "border-line"}`} lang="zh-CN">
              {result.text}
            </div>
          )}
          <div className="inline-flex overflow-hidden rounded-md border border-line-strong bg-background text-sm shadow-md">
            {SELECTION_ACTIONS.map((a) => (
              <button
                key={a}
                disabled={!!running}
                onClick={() => void run(a)}
                className="border-r border-line px-2.5 py-1 last:border-r-0 hover:bg-subtle disabled:opacity-50"
              >
                {running === a ? (isRewrite(a) ? "改写中…" : "思考中…") : SELECTION_ACTION_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TitleInput({ id, title }: { id: string; title: string }) {
  const [value, setValue] = useState(title);
  const [prev, setPrev] = useState(title);
  if (title !== prev) {
    setPrev(title);
    setValue(title);
  }
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() && value !== title && void renameDocumentAction(id, value)}
      maxLength={100}
      className="w-full bg-transparent text-2xl font-semibold outline-none"
    />
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });
  if (!editor || !state) return <div className="h-8" />;
  const chain = () => editor.chain().focus();
  const buttons: { label: string; active?: boolean; disabled?: boolean; run: () => void }[] = [
    { label: "标题", active: state.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
    { label: "小标题", active: state.h3, run: () => chain().toggleHeading({ level: 3 }).run() },
    { label: "B", active: state.bold, run: () => chain().toggleBold().run() },
    { label: "I", active: state.italic, run: () => chain().toggleItalic().run() },
    { label: "• 列表", active: state.bullet, run: () => chain().toggleBulletList().run() },
    { label: "1. 列表", active: state.ordered, run: () => chain().toggleOrderedList().run() },
    { label: "引用", active: state.quote, run: () => chain().toggleBlockquote().run() },
    { label: "撤销", disabled: !state.canUndo, run: () => chain().undo().run() },
    { label: "重做", disabled: !state.canRedo, run: () => chain().redo().run() },
  ];
  return (
    <div className="flex flex-wrap gap-1 text-sm">
      {buttons.map((b) => (
        <button
          key={b.label}
          onClick={b.run}
          disabled={b.disabled}
          className={`rounded px-2 py-1 disabled:opacity-30 ${b.active ? "bg-subtle-strong" : "hover:bg-subtle"}`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

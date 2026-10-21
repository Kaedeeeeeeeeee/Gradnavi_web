"use client";

import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useAiBeforeSend, useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { useShell } from "@/components/shell/app-shell";
import { takeAutoAsk } from "@/components/shell/pending-ask";
import { copyText } from "@/lib/browser";
import { describeDocument, DOC_KIND_LABELS, planProgress, type DocKind, type TargetProfessor } from "@/lib/documents";
import type { Field, Track } from "@/lib/onboarding";
import { PROFESSOR_STATUS_LABELS, type ProfessorStatus } from "@/lib/professors";
import {
  deleteDocumentAction,
  linkProfessorAction,
  markLetterSentAction,
  renameDocumentAction,
  saveDocumentAction,
  setTargetProfessorAction,
} from "../actions";

type Doc = {
  id: string;
  kind: DocKind;
  title: string;
  markdown: string;
  version: number;
  targetProfessor: TargetProfessor | null;
};

type ProfessorOption = { id: string; label: string };

type Props = {
  doc: Doc;
  planField: Field;
  track: Track | null;
  /** 教授清单，用来选目标教授 */
  professors: ProfessorOption[];
  /** 关联教授在清单里的联系状态 */
  linkedStatus: ProfessorStatus | null;
};

const AUTOSAVE_MS = 1500;
// 发给 AI 的页面内容上限（接口限制 20000 字），更长时 AI 用 read_document 读全文
const PAGE_CONTENT_LIMIT = 18000;

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

export function DocumentEditor({ doc, planField, track, professors, linkedStatus }: Props) {
  const askAi = useAskAi();
  const { closeTab } = useShell();
  const [markdown, setMarkdown] = useState(doc.markdown);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  // 冲突时服务器上的最新版本（通常是 AI 刚改过）
  const [conflict, setConflict] = useState<{ markdown: string; version: number } | null>(null);
  const version = useRef(doc.version);
  const baseline = useRef<string | null>(null); // 编辑器规范化后的“已保存”内容
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), Markdown],
    content: doc.markdown,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        lang: "ja",
        class: "doc-prose min-h-[60vh] rounded-md border border-zinc-200 px-6 py-5 outline-none focus:border-zinc-400 dark:border-zinc-800",
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

  const save = useCallback(async (ed: Editor) => {
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
  }, [doc.id]);

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

  // AI 改了文书后页面会刷新、带来新版本：没有未保存的修改就直接载入，否则提示冲突
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

  // 发消息给 AI 前先保存，AI 才能读到最新内容
  const flush = useCallback(async () => {
    if (editor) await save(editor);
  }, [editor, save]);
  useAiBeforeSend(flush);

  const progress = doc.kind === "plan" ? planProgress(markdown, planField) : null;
  const header = describeDocument(doc);
  const progressLine = progress ? `\n带写进度：${progress.steps.map((s) => `${s.label}${s.done ? "✓" : "…"}`).join(" → ")}` : "";
  const body = markdown.length > PAGE_CONTENT_LIMIT ? `${markdown.slice(0, PAGE_CONTENT_LIMIT)}\n\n（后文省略，用 read_document 读取全文）` : markdown;
  useAiPageContent(`${header}${progressLine}\n\n---\n${body}`, "doc");

  // 从找教授页“写套磁信”进来时让 AI 写初稿（只触发一次）
  useEffect(() => {
    if (!editor || takeAutoAsk(doc.id) !== "letter") return;
    askAi(
      `请给目标教授 ${doc.targetProfessor?.name ?? ""} 写这封套磁信的日文初稿，直接写进当前文书（整篇替换）。根据我的 user.md 和教授的研究方向，说明我为什么对教授的研究感兴趣、我的背景和研究计划概要，并提到附上研究计划书（草稿）。缺少关键信息（如姓名、研究计划）时先用占位符，写完告诉我需要补充什么。`,
    );
  }, [editor, askAi, doc.id, doc.targetProfessor?.name]);

  const selection = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return "";
      const { from, to } = e.state.selection;
      return from === to ? "" : e.state.doc.textBetween(from, to, "\n");
    },
  });
  const [instruction, setInstruction] = useState("");

  function rewriteSelection() {
    if (!selection) return;
    const req = instruction.trim() || "让日语更自然、更符合学术文书的表达，保持原意";
    askAi(`请改写文书中我选中的这段内容（${req}），改好后直接替换原文：\n\n「${selection}」`);
    setInstruction("");
  }

  async function exportPdf() {
    // 先打开窗口再保存，避免浏览器拦截弹窗
    const win = window.open("", "_blank");
    await flush();
    const url = `/api/documents/${doc.id}/pdf`;
    if (win) win.location.href = url;
    else window.open(url, "_self");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Link href="/documents" className="hover:text-foreground">
          文书
        </Link>
        <span>/</span>
        <span>{DOC_KIND_LABELS[doc.kind]}</span>
      </div>

      <TitleInput id={doc.id} title={doc.title} />

      {progress && (
        <PlanGuide
          progress={progress}
          professor={doc.targetProfessor}
          track={track}
          onAsk={(text) => askAi(text)}
          docId={doc.id}
          professors={professors}
        />
      )}

      {doc.kind === "letter" && (
        <LetterPanel docId={doc.id} professor={doc.targetProfessor} professors={professors} linkedStatus={linkedStatus} editor={editor} />
      )}

      {conflict && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950">
          <span>文书在别处被修改了（可能是 AI 刚改过），你这里还有未保存的内容。</span>
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

      <Toolbar editor={editor} />

      <EditorContent editor={editor} />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={selection ? "改写要求（可选），如：更简洁" : "先在文中选中一段，再让 AI 改写"}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <button
          onClick={rewriteSelection}
          disabled={!selection}
          className="rounded-md bg-foreground px-3 py-1.5 text-background disabled:opacity-40"
        >
          AI 改写选中内容
        </button>
        <button
          onClick={() => askAi("请通读这份文书，检查日语表达（语法、敬语/である体是否统一、学术用语）和逻辑，先列出问题，等我确认后再改。")}
          className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
        >
          AI 检查日语
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        <span className="text-zinc-500">{SAVE_LABELS[saveState]}</span>
        <div className="flex gap-2">
          <button onClick={exportPdf} className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">
            导出 PDF
          </button>
          <form
            action={async () => {
              await deleteDocumentAction(doc.id);
              closeTab(`doc:${doc.id}`);
            }}
            onSubmit={(e) => !confirm("确定删除这份文书？") && e.preventDefault()}
          >
            <button className="rounded-md px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950">删除</button>
          </form>
        </div>
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
          className={`rounded px-2 py-1 disabled:opacity-30 ${b.active ? "bg-zinc-200 dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

type Progress = ReturnType<typeof planProgress>;

function PlanGuide({
  progress,
  professor,
  track,
  onAsk,
  docId,
  professors,
}: {
  progress: Progress;
  professor: TargetProfessor | null;
  track: Track | null;
  onAsk: (text: string) => void;
  docId: string;
  professors: ProfessorOption[];
}) {
  const next = progress.next;
  const needProfessor = track === "professor_first" && !professor;

  function askNext() {
    if (!next) {
      onAsk("计划书各部分都写好了。请通读全文，从逻辑、和目标教授研究的契合度、日语表达三方面给出修改建议。");
      return;
    }
    const fit = professor
      ? `要贴合目标教授 ${professor.name} 的研究方向。`
      : track === "plan_first"
        ? "我已经有自己的研究计划，请在我的思路基础上打磨。"
        : "";
    onAsk(`带我写计划书的「${next.label}」部分（${next.headings.join("、")}）。${fit}先问我几个关键问题，再动笔写进文书。`);
  }

  return (
    <div className="space-y-3 rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        {progress.steps.map((s, i) => (
          <span
            key={s.key}
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              s.done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : s === next ? "bg-foreground text-background" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
            }`}
          >
            {i + 1}. {s.label}
            {s.done && " ✓"}
          </span>
        ))}
        <button onClick={askNext} className="ml-auto rounded-md bg-foreground px-3 py-1.5 text-background">
          {next ? `AI 带写：${next.label}` : "AI 通读并提建议"}
        </button>
      </div>
      {needProfessor && (
        <p className="text-amber-700 dark:text-amber-400">
          你目前的路线是“先找教授”：计划书最好贴合目标教授的近期研究。先从教授清单选择目标教授（还没有的话去
          <Link href="/professors" className="underline">
            找教授
          </Link>
          ），或在下面手动填写。
        </p>
      )}
      <ProfessorForm key={professorKey(professor)} docId={docId} professor={professor} professors={professors} defaultOpen={needProfessor} />
    </div>
  );
}

// 目标教授变了（例如从清单里选了另一位）时重新挂载表单，让输入框显示新的信息
const professorKey = (p: TargetProfessor | null) => (p ? `${p.professorId ?? ""}:${p.name}` : "none");

/** 套磁信：收件教授、一键复制（用户用自己的邮箱发送）、发送后标记状态 */
function LetterPanel({
  docId,
  professor,
  professors,
  linkedStatus,
  editor,
}: {
  docId: string;
  professor: TargetProfessor | null;
  professors: ProfessorOption[];
  linkedStatus: ProfessorStatus | null;
  editor: Editor | null;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const professorId = professor?.professorId;

  async function copy() {
    if (!editor) return;
    if (!(await copyText(editor.getText({ blockSeparator: "\n" })))) {
      alert("复制失败，请在编辑器里全选（Ctrl/⌘+A）后手动复制");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3 rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500">GradNavi 不代发邮件：复制全文后用你自己的邮箱发送。</span>
        <button onClick={copy} className="ml-auto rounded-md bg-foreground px-3 py-1.5 text-background">
          {copied ? "已复制" : "复制全文"}
        </button>
        {professorId &&
          (linkedStatus === "to_contact" ? (
            <button
              disabled={pending}
              onClick={() => startTransition(() => markLetterSentAction(docId, professorId))}
              className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              我已发送，标记为“已发套磁”
            </button>
          ) : (
            linkedStatus && <span className="text-zinc-500">教授状态：{PROFESSOR_STATUS_LABELS[linkedStatus]}</span>
          ))}
      </div>
      <ProfessorForm key={professorKey(professor)} docId={docId} professor={professor} professors={professors} defaultOpen={!professor} label="收件教授" />
    </div>
  );
}

function ProfessorPicker({ docId, professor, professors }: { docId: string; professor: TargetProfessor | null; professors: ProfessorOption[] }) {
  const [pending, startTransition] = useTransition();
  if (!professors.length) {
    return (
      <p className="text-zinc-500">
        教授清单还是空的，可以先去
        <Link href="/professors" className="underline">
          找教授
        </Link>
        并收藏，或在下面手动填写。
      </p>
    );
  }
  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="text-zinc-500">从教授清单选择</span>
      <select
        value={professor?.professorId ?? ""}
        disabled={pending}
        onChange={(e) => e.target.value && startTransition(() => linkProfessorAction(docId, e.target.value))}
        className="min-w-0 max-w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
      >
        <option value="">{professor && !professor.professorId ? "（手动填写）" : "请选择"}</option>
        {professors.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfessorForm({
  docId,
  professor,
  professors,
  defaultOpen,
  label = "目标教授",
}: {
  docId: string;
  professor: TargetProfessor | null;
  professors: ProfessorOption[];
  defaultOpen: boolean;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: professor?.name ?? "",
    affiliation: professor?.affiliation ?? "",
    research: professor?.research ?? "",
  });
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value }),
    className: "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-700",
  });
  return (
    <details open={defaultOpen}>
      <summary className="cursor-pointer text-zinc-500">
        {label}：{professor ? `${professor.name}${professor.affiliation ? `（${professor.affiliation}）` : ""}` : "未设定"}
      </summary>
      <div className="mt-3">
        <ProfessorPicker docId={docId} professor={professor} professors={professors} />
      </div>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(() => setTargetProfessorAction(docId, form));
        }}
      >
        <input placeholder="教授姓名" maxLength={100} {...field("name")} />
        <input placeholder="大学・研究科・研究室" maxLength={200} {...field("affiliation")} />
        <textarea placeholder="研究方向、近期论文（标题或摘要），AI 写计划书时会据此贴合" rows={4} maxLength={3000} {...field("research")} />
        <button disabled={pending} className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700">
          {pending ? "保存中…" : "保存目标教授"}
        </button>
      </form>
    </details>
  );
}

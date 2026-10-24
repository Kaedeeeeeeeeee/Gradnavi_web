"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { copyText } from "@/lib/browser";
import type { TargetProfessor } from "@/lib/documents";
import { composeLink, isEmail, MAIL_CLIENTS, splitLetter, type MailClient } from "@/lib/mail-compose";
import { PROFESSOR_STATUS_LABELS, type ProfessorStatus } from "@/lib/professors";
import {
  createTailoredCopyAction,
  linkProfessorAction,
  markLetterSentAction,
  setAttachmentAction,
  setProfessorEmailAction,
  setTargetProfessorAction,
} from "../actions";

// 编辑器上方的几块面板：目标教授、给教授的定制版、套磁信（用邮箱打开、复制、附件、联系状态）。

export type ProfessorOption = { id: string; label: string };
export type DocLink = { id: string; title: string };
export type PlanOption = DocLink & { professorId: string | null; isCopy: boolean };

const box = "space-y-3 rounded-xl border border-line p-4 text-sm";
const btn = "btn px-3 py-1.5";
/** 编辑器标题下面的一行小字：收着时只是一行，点开后占满整行 */
const inlinePanel = "text-sm open:basis-full open:space-y-3 open:rounded-xl open:border open:border-line open:p-3";

/** 计划书：通用版下面列出给每位教授的定制版，可以再为一位教授复制一份 */
export function TailoredCopies({
  docId,
  copies,
  professors,
}: {
  docId: string;
  copies: (DocLink & { professorName: string | null; parentVersion: number | null })[];
  professors: ProfessorOption[];
}) {
  const { openTab } = useShell();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <details className={inlinePanel} data-testid="tailored-copies">
      <summary className="cursor-pointer text-muted hover:text-foreground">定制版 {copies.length} 份</summary>
      <p className="text-muted">这份是通用版。为志愿里的每位教授复制一份定制版，再按那位教授的论文调整；通用版之后的修改不会影响已复制的定制版。</p>
      {copies.length > 0 && (
        <ul className="space-y-1">
          {copies.map((c) => (
            <li key={c.id}>
              <OpenTabLink tab={{ kind: "doc", id: c.id, title: c.title }} href={`/documents/${c.id}`} className="text-accent hover:underline">
                {c.title}
              </OpenTabLink>
              {c.parentVersion && <span className="text-muted">（复制自第 {c.parentVersion} 版）</span>}
            </li>
          ))}
        </ul>
      )}
      {professors.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input min-w-0 max-w-full px-2 py-1">
            <option value="">选择教授</option>
            {professors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            disabled={!pick || pending}
            className={btn}
            onClick={() =>
              startTransition(async () => {
                const r = await createTailoredCopyAction(docId, pick);
                if (!r.ok) return setError(r.error);
                setError(null);
                setPick("");
                openTab({ kind: "doc", id: r.value.id, title: r.value.title });
              })
            }
          >
            {pending ? "复制中…" : "复制一份定制版"}
          </button>
        </div>
      ) : (
        <p className="text-muted">
          志愿里还没有教授，先去
          <Link href="/aspirations" className="underline">
            找教授
          </Link>
          。
        </p>
      )}
      {error && <p className="text-danger">{error}</p>}
    </details>
  );
}

/** 套磁信：在用户自己的邮箱里打开（或复制全文）、附上计划书、发送后标记状态。GradNavi 不代发邮件 */
export function LetterPanel({
  docId,
  professor,
  professors,
  linkedStatus,
  linkedEmail,
  attachment,
  plans,
  letter,
}: {
  docId: string;
  professor: TargetProfessor | null;
  professors: ProfessorOption[];
  linkedStatus: ProfessorStatus | null;
  linkedEmail: string | null;
  attachment: DocLink | null;
  plans: PlanOption[];
  /** 编辑器里的全文；taken = 复制或打开邮箱后存一版 */
  letter: { text: () => string; taken: () => Promise<void> };
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const professorId = professor?.professorId;
  // 给这位教授的定制版排在前面
  const sorted = [...plans].sort((a, b) => Number(b.professorId === professorId && !!professorId) - Number(a.professorId === professorId && !!professorId));

  async function copy() {
    if (!(await copyText(letter.text()))) {
      alert("复制失败，请在编辑器里全选（Ctrl/⌘+A）后手动复制");
      return;
    }
    void letter.taken();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={box} data-testid="letter-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">GradNavi 不代发邮件：在你自己的邮箱里打开，检查后自己点发送。</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <OpenInMail key={`${professorId ?? ""}:${linkedEmail ?? ""}`} professorId={professorId} savedEmail={linkedEmail} letter={letter} />
          <button onClick={copy} className={btn}>
            {copied ? "已复制" : "复制全文"}
          </button>
          {professorId &&
            (linkedStatus === "to_contact" ? (
              <button disabled={pending} onClick={() => startTransition(() => markLetterSentAction(docId, professorId))} className={btn}>
                我已发送，标记为“已发信”
              </button>
            ) : (
              linkedStatus && <span className="text-muted">教授状态：{PROFESSOR_STATUS_LABELS[linkedStatus]}</span>
            ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">附件</span>
        <select
          value={attachment?.id ?? ""}
          disabled={pending}
          onChange={(e) => startTransition(async () => void (await setAttachmentAction(docId, e.target.value || null)))}
          className="input min-w-0 max-w-full px-2 py-1"
          data-testid="attachment-select"
        >
          <option value="">不附计划书</option>
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.professorId && p.professorId === professorId ? "（给这位教授的定制版）" : p.isCopy ? "（定制版）" : ""}
            </option>
          ))}
        </select>
        {attachment && (
          <>
            <OpenTabLink tab={{ kind: "doc", id: attachment.id, title: attachment.title }} href={`/documents/${attachment.id}`} className="text-accent hover:underline">
              打开
            </OpenTabLink>
            <a href={`/api/documents/${attachment.id}/pdf`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              导出附件 PDF
            </a>
          </>
        )}
      </div>
      <ProfessorForm docId={docId} professor={professor} professors={professors} defaultOpen={!professor} label="收件教授" />
    </div>
  );
}

const CLIENT_KEY = "gradnavi:mail-client";

/**
 * 「用邮箱打开」：收件人、标题（第一行「件名：」）、正文都填好，用户检查后自己点发送。
 * 正文同时复制到剪贴板：日文正文编码后很长，链接放不下或邮箱不支持带正文时直接粘贴。
 */
function OpenInMail({ professorId, savedEmail, letter }: { professorId?: string; savedEmail: string | null; letter: { text: () => string; taken: () => Promise<void> } }) {
  const [to, setTo] = useState(savedEmail ?? "");
  const [notice, setNotice] = useState<{ text: string; subject?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const menu = useRef<HTMLDetailsElement>(null);
  // 上次用的邮箱排在最前面（打开菜单时再读，避免服务器渲染和浏览器不一致）
  const [last, setLast] = useState<MailClient | null>(null);
  function readLast() {
    try {
      const v = localStorage.getItem(CLIENT_KEY);
      if (MAIL_CLIENTS.some((c) => c.id === v)) setLast(v as MailClient);
    } catch {
      // 读不到就按默认顺序
    }
  }

  function saveEmail() {
    const value = to.trim();
    setError(value && !isEmail(value) ? "邮箱格式不对" : null);
    if (!professorId || value === (savedEmail ?? "") || (value && !isEmail(value))) return;
    startTransition(async () => {
      try {
        await setProfessorEmailAction(professorId, value);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function open(client: MailClient) {
    menu.current?.removeAttribute("open");
    const recipient = isEmail(to) ? to.trim() : "";
    const { subject, body } = splitLetter(letter.text());
    const { url, prefilled } = composeLink(client, { to: recipient, subject, body });
    // 先在点击当下开始复制、打开新窗口，避免浏览器拦截
    const copying = copyText(body);
    const win = client === "default" ? null : window.open("", "_blank");
    const ok = await copying;
    await letter.taken();
    if (client === "default") window.location.assign(url);
    else if (win) {
      win.opener = null;
      win.location.href = url;
    } else window.open(url, "_blank", "noopener");
    try {
      localStorage.setItem(CLIENT_KEY, client);
    } catch {
      // 记不住上次用的邮箱也没关系
    }
    setLast(client);
    const paste = ok ? "正文已复制，在邮件正文里粘贴（Ctrl/⌘+V）" : "复制失败，请在编辑器里全选（Ctrl/⌘+A）后复制正文";
    const missing = recipient ? "" : "收件人还空着，记得填上。";
    if (prefilled === "all")
      setNotice({ text: `已在邮箱里打开，${missing}检查后自己点发送。${ok ? "正文也复制了一份，邮件里正文不完整时删掉重新粘贴即可。" : ""}` });
    else if (prefilled === "no-body") setNotice({ text: `信比较长，邮件里只填好了收件人和标题。${paste}。${missing}` });
    else setNotice({ text: `已打开邮箱首页：点「写信」，收件人填 ${recipient || "教授邮箱"}，${paste}。`, subject });
    setTimeout(() => setNotice(null), 15000);
  }

  const clients = last ? [...MAIL_CLIENTS].sort((a, b) => Number(b.id === last) - Number(a.id === last)) : MAIL_CLIENTS;

  return (
    <>
      <label className="flex items-center gap-2">
        <span className="text-muted">收件人</span>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onBlur={saveEmail}
          placeholder="教授邮箱（研究室主页上一般有）"
          className="input w-56 min-w-0 max-w-full px-2 py-1"
          data-testid="letter-to"
        />
      </label>
      <details ref={menu} className="relative" onToggle={(e) => e.currentTarget.open && readLast()}>
        <summary className="btn-primary cursor-pointer list-none px-3 py-1.5 [&::-webkit-details-marker]:hidden" data-testid="open-in-mail">
          用邮箱打开 <span className="text-xs">▾</span>
        </summary>
        <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-line-strong bg-background p-1 text-sm shadow-lg">
          {clients.map((c) => (
            <button key={c.id} onClick={() => void open(c.id)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-subtle">
              {c.label}
              {c.id === last && <span className="text-muted">（上次用的）</span>}
            </button>
          ))}
        </div>
      </details>
      {error && <span className="basis-full text-right text-danger">{error}</span>}
      {notice && (
        <span className="basis-full text-right text-muted" role="status" data-testid="mail-notice">
          {notice.text}
          {notice.subject && (
            <>
              标题：<span className="select-all text-foreground">{notice.subject}</span>
            </>
          )}
        </span>
      )}
    </>
  );
}

function ProfessorPicker({ docId, professor, professors }: { docId: string; professor: TargetProfessor | null; professors: ProfessorOption[] }) {
  const [pending, startTransition] = useTransition();
  if (!professors.length) {
    return (
      <p className="text-muted">
        志愿还是空的，可以先去
        <Link href="/aspirations" className="underline">
          找教授
        </Link>
        并收藏，或在下面手动填写。
      </p>
    );
  }
  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="text-muted">从志愿选择</span>
      <select
        value={professor?.professorId ?? ""}
        disabled={pending}
        onChange={(e) => e.target.value && startTransition(() => linkProfessorAction(docId, e.target.value))}
        className="input min-w-0 max-w-full px-2 py-1"
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

// 目标教授变了（例如从清单里选了另一位）时重新挂载表单，让输入框显示新的信息
const professorKey = (p: TargetProfessor | null) => (p ? `${p.professorId ?? ""}:${p.name}` : "none");

export function ProfessorForm(props: { docId: string; professor: TargetProfessor | null; professors: ProfessorOption[]; defaultOpen: boolean; label?: string; inline?: boolean }) {
  return <ProfessorFormInner key={professorKey(props.professor)} {...props} />;
}

function ProfessorFormInner({
  docId,
  professor,
  professors,
  defaultOpen,
  label = "目标教授",
  inline = false,
}: {
  docId: string;
  professor: TargetProfessor | null;
  professors: ProfessorOption[];
  defaultOpen: boolean;
  label?: string;
  inline?: boolean;
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
    className: "input w-full px-3 py-1.5",
  });
  return (
    <details open={defaultOpen} className={inline ? inlinePanel : undefined}>
      <summary className="cursor-pointer text-muted hover:text-foreground">
        {label}：{professor ? `${professor.name}${professor.affiliation ? `（${professor.affiliation}）` : ""}` : "未设定"}
      </summary>
      <div className={inline ? "" : "mt-3"}>
        <ProfessorPicker docId={docId} professor={professor} professors={professors} />
      </div>
      <form
        className={inline ? "space-y-2" : "mt-3 space-y-2"}
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(() => setTargetProfessorAction(docId, form));
        }}
      >
        <input placeholder="教授姓名" maxLength={100} {...field("name")} />
        <input placeholder="大学・研究科・研究室" maxLength={200} {...field("affiliation")} />
        <textarea placeholder="研究方向、近期论文（标题或摘要），AI 写计划书、审阅时会据此贴合" rows={4} maxLength={3000} {...field("research")} />
        <button disabled={pending} className={btn}>
          {pending ? "保存中…" : "保存目标教授"}
        </button>
      </form>
    </details>
  );
}

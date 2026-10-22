"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import type { TargetProfessor } from "@/lib/documents";
import { PROFESSOR_STATUS_LABELS, type ProfessorStatus } from "@/lib/professors";
import { createTailoredCopyAction, linkProfessorAction, markLetterSentAction, setAttachmentAction, setTargetProfessorAction } from "../actions";

// 编辑器上方的几块面板：目标教授、给教授的定制版、套磁信（复制、附件、联系状态）。

export type ProfessorOption = { id: string; label: string };
export type DocLink = { id: string; title: string };
export type PlanOption = DocLink & { professorId: string | null; isCopy: boolean };

const box = "space-y-3 rounded-md border border-line p-4 text-sm";
const btn = "btn px-3 py-1.5";

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
    <details className={box} data-testid="tailored-copies" open={copies.length > 0}>
      <summary className="cursor-pointer text-muted">给教授的定制版（{copies.length}）</summary>
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

/** 套磁信：复制全文（用户用自己的邮箱发送）、附上计划书、发送后标记状态 */
export function LetterPanel({
  docId,
  professor,
  professors,
  linkedStatus,
  attachment,
  plans,
  onCopy,
}: {
  docId: string;
  professor: TargetProfessor | null;
  professors: ProfessorOption[];
  linkedStatus: ProfessorStatus | null;
  attachment: DocLink | null;
  plans: PlanOption[];
  onCopy: () => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const professorId = professor?.professorId;
  // 给这位教授的定制版排在前面
  const sorted = [...plans].sort((a, b) => Number(b.professorId === professorId && !!professorId) - Number(a.professorId === professorId && !!professorId));

  async function copy() {
    if (!(await onCopy())) {
      alert("复制失败，请在编辑器里全选（Ctrl/⌘+A）后手动复制");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={box} data-testid="letter-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">GradNavi 不代发邮件：复制全文后用你自己的邮箱发送。</span>
        <button onClick={copy} className="btn-primary ml-auto px-3 py-1.5">
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

export function ProfessorForm(props: { docId: string; professor: TargetProfessor | null; professors: ProfessorOption[]; defaultOpen: boolean; label?: string }) {
  return <ProfessorFormInner key={professorKey(props.professor)} {...props} />;
}

function ProfessorFormInner({
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
    className: "input w-full px-3 py-1.5",
  });
  return (
    <details open={defaultOpen}>
      <summary className="cursor-pointer text-muted">
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
        <textarea placeholder="研究方向、近期论文（标题或摘要），AI 写计划书、审阅时会据此贴合" rows={4} maxLength={3000} {...field("research")} />
        <button disabled={pending} className={btn}>
          {pending ? "保存中…" : "保存目标教授"}
        </button>
      </form>
    </details>
  );
}

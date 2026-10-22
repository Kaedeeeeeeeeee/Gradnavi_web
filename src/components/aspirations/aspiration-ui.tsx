"use client";

import { useState, useTransition } from "react";
import { updateProfessorAction } from "@/app/(app)/professors/actions";
import { useAskAi } from "@/components/ai/page-context";
import { OpenTabLink } from "@/components/shell/app-shell";
import { DateInput } from "@/components/ui/date-input";
import { btn, formatDay, ProposalButtons } from "@/components/tasks/task-ui";
import { formatDate } from "@/lib/calendar";
import { contactLabel, languageLabel, type AspirationView, type ProfessorView, type SchoolView } from "@/lib/aspirations";
import { CONTACT_FLOW, PROFESSOR_STATUS_LABELS, type PaperRef, type ProfessorStatus } from "@/lib/professors";

// 志愿列表、志愿详情、找教授候选卡片共用的小部件：联系进度、近期论文、研究科要点、差距、跟进日。

/** 联系进度：未联系 → 已发信 → 已回复 → 面谈过 → 同意接收。点哪一步就改到哪一步 */
const CONTACT_STYLES: Record<ProfessorStatus, string> = {
  to_contact: "bg-subtle text-muted",
  contacted: "bg-info-soft text-info",
  replied: "bg-ok-soft text-ok",
  interview: "bg-ok-soft text-ok",
  accepted: "bg-ok-soft text-ok",
  dropped: "bg-subtle text-faint",
};

/** 联系状态：一个标签，点开是下拉（和主页任务的状态一样），一点就能改 */
export function ContactStatusSelect({ id, status }: { id: string; status: ProfessorStatus }) {
  const [pending, startTransition] = useTransition();
  return (
    <span className="relative inline-flex shrink-0">
      <select
        aria-label="联系状态"
        value={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ProfessorStatus;
          if (next === "dropped" && !confirm("不再考虑这位教授？之后可以重新考虑。")) return;
          startTransition(() => updateProfessorAction(id, { status: next }));
        }}
        className={`cursor-pointer appearance-none rounded py-0.5 pr-5 pl-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${CONTACT_STYLES[status]}`}
      >
        {[...CONTACT_FLOW, "dropped" as const].map((s) => (
          <option key={s} value={s}>
            {s === "dropped" ? "已放弃" : PROFESSOR_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[9px] opacity-60">
        ▼
      </span>
    </span>
  );
}

export function ContactStepper({ id, status, compact = false }: { id: string; status: ProfessorStatus; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const current = CONTACT_FLOW.indexOf(status as (typeof CONTACT_FLOW)[number]);
  const set = (s: ProfessorStatus) => startTransition(() => updateProfessorAction(id, { status: s }));
  if (status === "dropped")
    return (
      <span className="flex items-center gap-2 text-xs text-muted">
        已放弃
        <button disabled={pending} onClick={() => set("to_contact")} className="underline hover:text-foreground">
          重新考虑
        </button>
      </span>
    );
  return (
    <span className={`flex flex-wrap items-center gap-0.5 text-xs ${pending ? "opacity-60" : ""}`} aria-label={`联系状态：${PROFESSOR_STATUS_LABELS[status]}`}>
      {CONTACT_FLOW.map((s, i) => (
        <button
          key={s}
          disabled={pending}
          onClick={() => s !== status && set(s)}
          title={`改成「${PROFESSOR_STATUS_LABELS[s]}」`}
          className={`rounded px-1.5 py-0.5 ${
            i === current
              ? "bg-primary text-on-primary"
              : i < current
                ? "bg-subtle-strong text-muted"
                : "text-faint hover:text-foreground"
          } ${compact && i !== current ? "max-sm:hidden" : ""}`}
        >
          {PROFESSOR_STATUS_LABELS[s]}
        </button>
      ))}
      {!compact && (
        <button disabled={pending} onClick={() => confirm("不再考虑这位教授？之后可以重新考虑。") && set("dropped")} className="ml-1 px-1 text-faint hover:text-danger">
          放弃
        </button>
      )}
    </span>
  );
}

export function PaperList({ refs, papers }: { refs: PaperRef[]; papers: string[] }) {
  const list: PaperRef[] = refs.length ? refs : papers.map((title) => ({ title }));
  if (!list.length) return null;
  return (
    <ul className="space-y-0.5 text-sm text-muted" lang="ja">
      {list.map((p) => (
        <li key={p.title} className="flex gap-1.5">
          <span className="shrink-0 text-faint">·</span>
          <span className="min-w-0">
            {p.url ? (
              <OpenTabLink tab={{ kind: "web", url: p.url, title: p.title.slice(0, 40) }} href={p.url} className="text-accent hover:underline">
                {p.title}
              </OpenTabLink>
            ) : (
              p.title
            )}
            {p.year && !p.title.includes(String(p.year)) && <span className="ml-1 text-xs text-faint">{p.year}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Gaps({ gaps }: { gaps: string[] }) {
  if (!gaps.length) return null;
  return (
    <ul className="space-y-0.5 text-xs text-warn">
      {gaps.map((g) => (
        <li key={g}>⚠ {g}</li>
      ))}
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function Tentative() {
  return <span className="ml-1 rounded border border-dashed border-warn px-1 text-xs text-warn">仮</span>;
}

/** 研究科这边：要不要先联系、考试科目、语言、出愿截止 */
export function SchoolFacts({ school }: { school: SchoolView }) {
  const req = school.requirements;
  return (
    <dl className="space-y-1 text-sm">
      <Fact label="事先联系">
        <span className={req?.contact === "required" ? "font-medium" : ""}>{contactLabel(req)}</span>
        {req?.contact && req.contactNote && <span className="ml-1 text-xs text-muted">{req.contactNote}</span>}
      </Fact>
      <Fact label="考试科目">{req?.subjects.length ? req.subjects.join("、") : <span className="text-muted">未查到</span>}</Fact>
      <Fact label="语言">{languageLabel(req)}</Fact>
      <Fact label="出愿截止">
        {school.deadline ? (
          <>
            <span className="tabular-nums">{formatDate(school.deadline.date)}</span>
            {school.deadline.tentative && <Tentative />}
          </>
        ) : (
          <span className="text-muted">{school.pending ? "等待首次检查" : "还没有日程"}</span>
        )}
      </Fact>
      {req?.notes && <Fact label="其他">{req.notes}</Fact>}
    </dl>
  );
}

/** 还没关联研究科的教授：让 AI 查教授所在研究科怎么考 */
export function FindSchoolButton({ professor }: { professor: Pick<ProfessorView, "id" | "name" | "university" | "department"> }) {
  const ask = useAskAi();
  return (
    <button
      onClick={() =>
        ask(
          `帮我查清${professor.name}教授（${professor.university}${professor.department ? ` ${professor.department}` : ""}）所在研究科怎么考：找到官网的入试信息 / 募集要项页面并关注、关联到这位教授，记下要不要先联系教授、考试科目、语言要求，再对照我的档案说说差距。`,
        )
      }
      className={btn}
    >
      让 AI 查研究科怎么考
    </button>
  );
}

/** 跟进日：用户直接改；AI 提议的改动用虚线框显示，同意后才生效 */
export function FollowUp({ professor }: { professor: Pick<ProfessorView, "id" | "followUpDate" | "proposedFollowUp"> }) {
  const [pending, startTransition] = useTransition();
  const proposal = professor.proposedFollowUp;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <label className="flex items-center gap-1">
        跟进日
        <DateInput
          value={professor.followUpDate ?? ""}
          disabled={pending}
          onChange={(v) => startTransition(() => updateProfessorAction(professor.id, { followUpDate: v || null }))}
          placeholder="未定"
          clearable
          className="rounded border border-line-strong px-1 py-0.5 text-xs text-foreground"
        />
      </label>
      {proposal && (
        <span className="flex items-center gap-1.5 rounded border border-dashed border-line-strong px-1.5 py-0.5">
          AI 提议{proposal.date ? `改到 ${formatDay(proposal.date)}` : "取消跟进日"}
          <ProposalButtons kind="professor" id={professor.id} date={proposal.date} editable={!!proposal.date} />
        </span>
      )}
    </span>
  );
}

/** 贴教授回信：交给 AI 读懂、更新联系状态、建议怎么回 */
export function PasteReply({ professor }: { professor: Pick<ProfessorView, "id" | "name"> }) {
  const ask = useAskAi();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className={btn}>
        贴教授回信
      </button>
    );
  return (
    <div className="w-full space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        autoFocus
        placeholder={`把${professor.name}教授的回信原文贴在这里，AI 会读懂它、更新联系状态，并建议怎么回复`}
        className="input w-full px-3 py-2 text-sm"
        lang="ja"
      />
      <div className="flex gap-2">
        <button
          disabled={!text.trim()}
          onClick={() => {
            ask(
              `这是${professor.name}教授的回信：\n\n${text.trim().slice(0, 4000)}\n\n请用中文告诉我教授的意思，更新联系状态，把要点记进备注，再建议我怎么回复。提到面谈时间的话，提议写进日历。`,
            );
            setText("");
            setOpen(false);
          }}
          className="btn-primary px-3 py-1 text-xs"
        >
          交给 AI
        </button>
        <button onClick={() => setOpen(false)} className={btn}>
          取消
        </button>
      </div>
    </div>
  );
}

export function SourceLinks({ sources }: { sources: { title: string; url: string }[] }) {
  if (!sources.length) return null;
  return (
    <p className="flex flex-wrap gap-x-3 text-xs">
      {sources.map((s) => (
        <OpenTabLink key={s.url} tab={{ kind: "web", url: s.url, title: s.title.slice(0, 40) }} href={s.url} className="max-w-full truncate text-accent hover:underline">
          {s.title}
        </OpenTabLink>
      ))}
    </p>
  );
}

export function aspirationTabTitle(a: Pick<AspirationView, "professor" | "school">) {
  return a.professor ? a.professor.name : `${a.school!.university} ${a.school!.name}`;
}

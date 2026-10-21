"use client";

import { useState, useTransition } from "react";
import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import type { Field } from "@/lib/onboarding";
import {
  describeProfessor,
  PROFESSOR_STATUS_LABELS,
  PROFESSOR_STATUSES,
  professorAffiliation,
  splitSchools,
  type ProfessorCandidate,
  type ProfessorStatus,
  type SourceLink,
} from "@/lib/professors";
import {
  createLetterAction,
  createPlanAction,
  deleteProfessorAction,
  saveProfessorAction,
  searchProfessorsAction,
  updateProfessorAction,
} from "./actions";

type Saved = {
  id: string;
  name: string;
  university: string;
  department: string | null;
  lab: string | null;
  research: string | null;
  papers: string[];
  acceptsInternational: string | null;
  sources: SourceLink[];
  status: ProfessorStatus;
  note: string | null;
  followUpDate: string | null;
};

type Props = { defaults: { keywords: string; schools: string; field: Field }; saved: Saved[] };

const inputClass = "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-700";
const key = (p: { name: string; university: string }) => `${p.name.replace(/\s/g, "")}@${p.university}`;

export function ProfessorsView({ defaults, saved }: Props) {
  const askAi = useAskAi();
  const [form, setForm] = useState(defaults);
  const [result, setResult] = useState<{ candidates: ProfessorCandidate[]; demo: boolean } | null>(null);
  const [error, setError] = useState("");
  const [searching, startSearch] = useTransition();
  const savedKeys = new Set(saved.map(key));

  const pageContent = [
    `教授清单（${saved.length} 位）：`,
    ...saved.map((p) => `- ${describeProfessor(p)}`),
    result ? `\n本次检索结果（${result.demo ? "演示数据" : "未收藏"}）：\n${result.candidates.map((c) => `- ${describeProfessor(c)}`).join("\n")}` : "",
  ].join("\n");
  useAiPageContent(pageContent);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startSearch(async () => {
      const res = await searchProfessorsAction({ keywords: form.keywords, schools: splitSchools(form.schools), field: form.field });
      if (res.ok) setResult({ candidates: res.candidates, demo: res.demo });
      else setError(res.error);
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">找教授</h1>
        <p className="text-sm text-zinc-500">
          输入研究方向和目标校，AI 检索 researchmap、大学官网、KAKEN 等来源，整理出教授候选。收藏后可以给教授写套磁信、写贴合教授方向的计划书。
        </p>
      </div>

      <form onSubmit={search} className="space-y-3 rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <label className="block space-y-1">
          <span className="text-zinc-500">研究方向（日文关键词效果最好，如：第二言語習得、強化学習）</span>
          <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} maxLength={200} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-zinc-500">目标校（可多个，用顿号或空格分隔，最多 5 所；留空则不限）</span>
          <input
            value={form.schools}
            onChange={(e) => setForm({ ...form, schools: e.target.value })}
            placeholder="東京大学、京都大学"
            maxLength={300}
            className={inputClass}
          />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          {(["humanities", "sciences"] as const).map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <input type="radio" checked={form.field === f} onChange={() => setForm({ ...form, field: f })} />
              {f === "humanities" ? "文科" : "理科"}
            </label>
          ))}
          <button disabled={searching || !form.keywords.trim()} className="ml-auto rounded-md bg-foreground px-4 py-1.5 text-background disabled:opacity-40">
            {searching ? "检索中（约 20–40 秒）…" : "检索教授"}
          </button>
        </div>
        {error && <p className="text-red-600">{error}</p>}
      </form>

      {result && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium">检索结果（{result.candidates.length}）</h2>
            {result.candidates.length > 0 && (
              <button onClick={() => askAi("帮我比较一下这次检索到的教授，结合我的背景和方向，说说哪几位最值得优先联系、为什么。")} className="text-sm underline">
                让 AI 帮我比较
              </button>
            )}
          </div>
          {result.demo && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              演示模式：服务器还没有配置 DEEPSEEK_API_KEY，下面是示例数据，不是真实教授。
            </p>
          )}
          {result.candidates.length === 0 ? (
            <p className="text-sm text-zinc-500">没有找到合适的教授。可以换成日文关键词、放宽目标校，或在右侧让 AI 帮你调整检索词。</p>
          ) : (
            <ul className="space-y-3">
              {result.candidates.map((c) => (
                <CandidateCard key={key(c)} candidate={c} saved={savedKeys.has(key(c))} />
              ))}
            </ul>
          )}
          <p className="text-xs text-zinc-500">信息由 AI 根据检索结果整理，可能不完整或过时。联系前请打开来源链接核实，招生情况以研究室主页和募集要项为准。</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">我的教授清单（{saved.length}）</h2>
        {saved.length === 0 ? (
          <p className="text-sm text-zinc-500">还没有收藏教授。检索后点“收藏”，或者在右侧让 AI 帮你找。</p>
        ) : (
          <ul className="space-y-3">
            {saved.map((p) => (
              <SavedCard key={p.id} professor={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type InfoProps = Pick<ProfessorCandidate, "name" | "university" | "papers" | "sources"> & {
  department?: string | null;
  lab?: string | null;
  research?: string | null;
  acceptsInternational?: string | null;
};

function ProfessorInfo({ p }: { p: InfoProps }) {
  return (
    <div className="space-y-1.5">
      <div>
        <span className="font-medium">{p.name}</span>
        <span className="ml-2 text-sm text-zinc-500">{professorAffiliation(p)}</span>
      </div>
      {p.research && <p className="text-sm">{p.research}</p>}
      {p.papers.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400" lang="ja">
          {p.papers.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {p.acceptsInternational && <p className="text-sm text-zinc-600 dark:text-zinc-400">留学生：{p.acceptsInternational}</p>}
      {p.sources.length > 0 && (
        <p className="flex flex-wrap gap-x-3 text-xs">
          {p.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="max-w-full truncate text-blue-600 hover:underline dark:text-blue-400">
              {s.title}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

function CandidateCard({ candidate, saved }: { candidate: ProfessorCandidate; saved: boolean }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="min-w-0 flex-1">
        <ProfessorInfo p={candidate} />
      </div>
      <button
        disabled={saved || pending}
        onClick={() => start(async () => void (await saveProfessorAction(candidate)))}
        className="h-fit shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-zinc-700"
      >
        {saved ? "已收藏" : pending ? "收藏中…" : "收藏"}
      </button>
    </li>
  );
}

function SavedCard({ professor: p }: { professor: Saved }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState(p.note ?? "");
  // AI 改了备注后页面刷新，同步过来
  const [prevNote, setPrevNote] = useState(p.note);
  if (p.note !== prevNote) {
    setPrevNote(p.note);
    setNote(p.note ?? "");
  }
  const update = (patch: Parameters<typeof updateProfessorAction>[1]) => start(() => updateProfessorAction(p.id, patch));

  return (
    <li className={`space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800 ${p.status === "dropped" ? "opacity-60" : ""}`}>
      <ProfessorInfo p={p} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          状态
          <select
            value={p.status}
            onChange={(e) => update({ status: e.target.value as ProfessorStatus })}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          >
            {PROFESSOR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROFESSOR_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          跟进日期
          <input
            type="date"
            value={p.followUpDate ?? ""}
            onChange={(e) => update({ followUpDate: e.target.value || null })}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-0.5 dark:border-zinc-700"
          />
        </label>
        {pending && <span className="text-zinc-500">保存中…</span>}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (p.note ?? "") && update({ note })}
        placeholder="备注（如：教授回复要点、面谈安排）"
        rows={2}
        maxLength={1000}
        className={`${inputClass} text-sm`}
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <form action={createLetterAction.bind(null, p.id)}>
          <button className="rounded-md bg-foreground px-3 py-1.5 text-background">写套磁信</button>
        </form>
        <form action={createPlanAction.bind(null, p.id)}>
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">以这位教授为目标写计划书</button>
        </form>
        <button
          onClick={() => confirm(`从清单中删除 ${p.name}？`) && start(() => deleteProfessorAction(p.id))}
          className="ml-auto rounded-md px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
        >
          删除
        </button>
      </div>
    </li>
  );
}

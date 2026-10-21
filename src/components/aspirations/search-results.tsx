"use client";

import { useState, useTransition } from "react";
import { addCandidateAction, rejectCandidateAction, undoRejectAction } from "@/app/(app)/aspirations/actions";
import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { useShell } from "@/components/shell/app-shell";
import { btn, primaryBtn } from "@/components/tasks/task-ui";
import { PROFESSOR_STATUS_LABELS, professorAffiliation, type ProfessorCandidate, type ProfessorStatus } from "@/lib/professors";
import { PaperList, SourceLinks, Tentative } from "./aspiration-ui";

// 文稿栏里的找教授结果：AI 在对话里检索的这一轮候选。用户点「加入志愿」或「不合适」（顺手说原因，记进 user.md），
// 想调整就在右侧对话里接着说，AI 再搜一轮，这里换成新结果。

export type CandidateView = {
  key: string;
  candidate: ProfessorCandidate;
  saved: { id: string; status: ProfessorStatus } | null;
  rejected: string | null;
  /** 所在研究科系统里已有时的要点 */
  school: { name: string; contact: string; language: string; deadline: { date: string; tentative: boolean } | null } | null;
};

type Props = {
  search: { id: string; keywords: string; schools: string[]; preference: string | null; demo: boolean; createdAt: string };
  candidates: CandidateView[];
  aiText: string;
};

const REASONS = ["方向不对", "太偏理论", "太偏应用", "地区不合适", "不收留学生"];

export function SearchResults({ search, candidates, aiText }: Props) {
  const ask = useAskAi();
  useAiPageContent(aiText, "doc");
  const added = candidates.filter((c) => c.saved).length;
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">找教授：{search.keywords}</h1>
        <p className="text-sm text-zinc-500">
          {[search.schools.length ? search.schools.join("、") : "不限学校", search.preference].filter(Boolean).join(" · ")} · {candidates.length} 位候选
          {added > 0 && ` · 已加入志愿 ${added} 位`}
        </p>
        <p className="text-xs text-zinc-500">想调整就在右侧对话里说，比如「更偏应用一点」「只要关东的」，AI 会再搜一轮。</p>
      </div>
      {search.demo && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          演示模式：服务器还没有配置 DEEPSEEK_API_KEY，下面是示例数据，不是真实教授。
        </p>
      )}
      {candidates.length === 0 ? (
        <div className="space-y-2 text-sm text-zinc-500">
          <p>这一轮没有找到合适的教授。</p>
          <button onClick={() => ask("这一轮没找到合适的教授，帮我换个检索方式（换日文关键词、放宽学校）再找一次。")} className={btn}>
            让 AI 换个方式再找
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {candidates.map((c) => (
            <CandidateCard key={c.key} searchId={search.id} c={c} />
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-500">信息由 AI 根据检索结果整理，可能不完整或过时。联系前请打开来源链接核实，招生情况以研究室主页和募集要项为准。</p>
    </div>
  );
}

function CandidateCard({ searchId, c }: { searchId: string; c: CandidateView }) {
  const ask = useAskAi();
  const { openTab } = useShell();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const p = c.candidate;
  const dim = c.rejected !== null;

  function add() {
    startTransition(async () => {
      const res = await addCandidateAction(searchId, c.key);
      // 加入后让 AI 提议下一步（讲解论文、起草套磁信；研究科还没对上时顺便查入试要求）
      ask(
        `我把${res.name}教授（${res.university}）加入志愿了。${res.schoolLinked ? "" : "帮我查一下教授所在研究科怎么考，"}接下来建议我做什么？`,
      );
    });
  }

  return (
    <li className={`space-y-2.5 rounded-lg border p-4 ${c.saved ? "border-emerald-300 dark:border-emerald-800" : "border-zinc-200 dark:border-zinc-800"} ${dim ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{p.name}</span>
        <span className="text-sm text-zinc-500">{professorAffiliation(p)}</span>
      </div>
      {p.fit && (
        <p className="text-sm">
          <span className="mr-1 text-xs text-zinc-500">为什么适合</span>
          {p.fit}
        </p>
      )}
      {p.research && <p className="text-sm text-zinc-600 dark:text-zinc-400">{p.research}</p>}
      <div className="space-y-1">
        <h3 className="text-xs text-zinc-500">近期论文</h3>
        <PaperList refs={p.paperRefs ?? []} papers={p.papers} />
        {!p.papers.length && <p className="text-sm text-zinc-500">没查到近期论文，可以在研究室主页或 researchmap 上看</p>}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">留学生 / 研究生制度：{p.acceptsInternational || "未查到，以研究室主页为准"}</p>
      {c.school && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          研究科（{c.school.name}）：{c.school.contact} · {c.school.language}
          {c.school.deadline && (
            <>
              {" "}
              · 出愿截止 {c.school.deadline.date}
              {c.school.deadline.tentative && <Tentative />}
            </>
          )}
        </p>
      )}
      <SourceLinks sources={p.sources} />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {c.saved ? (
          <>
            <span className="text-xs text-emerald-700 dark:text-emerald-400">✓ 已加入志愿 · {PROFESSOR_STATUS_LABELS[c.saved.status]}</span>
            <button onClick={() => openTab({ kind: "professor", id: c.saved!.id, title: p.name })} className={btn}>
              查看志愿
            </button>
            <button onClick={() => ask(`用中文给我讲讲${p.name}教授的代表论文：各在研究什么、用了什么方法，和我的方向能怎么结合。`)} className={btn}>
              讲解代表论文
            </button>
            <button onClick={() => ask(`帮我给${p.name}教授起草套磁信。`)} className={btn}>
              起草套磁信
            </button>
          </>
        ) : dim ? (
          <>
            <span className="text-xs text-zinc-500">已标不合适{c.rejected ? `：${c.rejected}` : ""}（已记进你的档案，下次避开）</span>
            <button disabled={pending} onClick={() => startTransition(() => undoRejectAction(searchId, c.key))} className={btn}>
              撤销
            </button>
          </>
        ) : rejecting ? (
          <div className="w-full space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} onClick={() => setReason(r)} className={`${btn} ${reason === r ? "border-zinc-500 bg-zinc-100 dark:bg-zinc-800" : ""}`}>
                  {r}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
                maxLength={200}
                placeholder="顺手说一句原因（可不填），AI 下次找得更准"
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
              <button disabled={pending} onClick={() => startTransition(() => rejectCandidateAction(searchId, c.key, reason))} className={primaryBtn}>
                确定
              </button>
              <button onClick={() => setRejecting(false)} className={btn}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <>
            <button disabled={pending} onClick={add} className="rounded-md bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50">
              {pending ? "加入中…" : "加入志愿"}
            </button>
            <button disabled={pending} onClick={() => setRejecting(true)} className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700">
              不合适
            </button>
          </>
        )}
      </div>
    </li>
  );
}

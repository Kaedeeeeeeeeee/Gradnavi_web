"use client";

import { useState, useTransition } from "react";
import { createLetterAction, createPlanAction, deleteProfessorAction, updateProfessorAction } from "@/app/(app)/professors/actions";
import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { btn } from "@/components/tasks/task-ui";
import type { AspirationView, ProfessorView } from "@/lib/aspirations";
import { professorAffiliation } from "@/lib/professors";
import { ContactStepper, FindSchoolButton, FollowUp, Gaps, PaperList, PasteReply, SchoolFacts, SourceLinks, Tentative } from "./aspiration-ui";

// 文稿栏里的一条志愿：左边教授这边（为什么适合、近期论文、联系进度、回信），右边研究科这边（入试要点、日程、差距）。

type Props = {
  a: AspirationView & { professor: ProfessorView };
  documents: { id: string; title: string }[];
  aiText: string;
};

export function AspirationDetail({ a, documents, aiText }: Props) {
  useAiPageContent(aiText, "doc");
  const ask = useAskAi();
  const { closeTab } = useShell();
  const [pending, startTransition] = useTransition();
  const p = a.professor;
  const s = a.school;

  return (
    <div className="@container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="text-sm text-zinc-500">{professorAffiliation(p)}</p>
        <ContactStepper id={p.id} status={p.status} />
      </div>

      <div className="grid gap-6 @2xl:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-500">教授这边</h2>
          {p.fit && (
            <p className="text-sm leading-relaxed">
              <span className="mr-1 text-xs text-zinc-500">为什么适合</span>
              {p.fit}
            </p>
          )}
          {p.research && <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{p.research}</p>}
          <div className="space-y-1">
            <h3 className="text-xs text-zinc-500">近期论文</h3>
            <PaperList refs={p.paperRefs} papers={p.papers} />
          </div>
          {p.acceptsInternational && <p className="text-sm text-zinc-600 dark:text-zinc-400">留学生：{p.acceptsInternational}</p>}
          <SourceLinks sources={p.sources} />
          <FollowUp professor={p} />
          <Note professor={p} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-500">研究科这边</h2>
          {s ? (
            <>
              <p className="text-sm font-medium">
                {s.university} {s.name}
                <OpenTabLink tab={{ kind: "web", url: s.url, title: `${s.university} ${s.name}` }} href={s.url} className="ml-2 text-xs font-normal text-blue-600 hover:underline dark:text-blue-400">
                  要项页面
                </OpenTabLink>
              </p>
              <SchoolFacts school={s} />
              <Gaps gaps={a.gaps} />
              {s.problem && <p className="text-xs text-amber-700 dark:text-amber-400">{s.problem}</p>}
              {s.events.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-zinc-500">
                    {s.guideYear} 年度要项日程{s.tentative && "（按往年推算）"}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {s.events.map((e) => (
                      <li key={e.key} className="flex gap-2">
                        <span className="w-40 shrink-0 tabular-nums text-zinc-500">
                          {e.date}
                          {e.endDate && `〜${e.endDate.slice(5)}`}
                          {s.tentative && <Tentative />}
                        </span>
                        <span>{e.title.replace(`${s.university} ${s.name} `, "")}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div className="space-y-2 text-sm text-zinc-500">
              <p>还没关联研究科：要不要先联系教授、考什么、语言要求多少，都要看教授所在研究科的募集要项。</p>
              <FindSchoolButton professor={p} />
            </div>
          )}
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-500">接下来</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => ask(`用中文给我讲讲${p.name}教授的代表论文：各在研究什么、用了什么方法，和我的方向能怎么结合。`)} className={btn}>
            讲解代表论文
          </button>
          <form action={createLetterAction.bind(null, p.id)}>
            <button className={btn}>写套磁信</button>
          </form>
          <form action={createPlanAction.bind(null, p.id)}>
            <button className={btn}>以这位教授为目标写计划书</button>
          </form>
          <PasteReply professor={p} />
        </div>
        {documents.length > 0 && (
          <p className="flex flex-wrap gap-x-3 text-sm">
            <span className="text-zinc-500">相关文书</span>
            {documents.map((d) => (
              <OpenTabLink key={d.id} tab={{ kind: "doc", id: d.id, title: d.title }} href={`/documents/${d.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                {d.title}
              </OpenTabLink>
            ))}
          </p>
        )}
      </section>

      <button
        disabled={pending}
        onClick={() =>
          confirm(`把${p.name}移出志愿？相关的文书会保留。`) &&
          startTransition(async () => {
            await deleteProfessorAction(p.id);
            closeTab(`professor:${p.id}`);
          })
        }
        className="text-xs text-zinc-400 hover:text-red-600"
      >
        移出志愿
      </button>
    </div>
  );
}

function Note({ professor: p }: { professor: ProfessorView }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(p.note ?? "");
  // AI 改了备注（如读了回信）后页面刷新，同步过来
  const [prevNote, setPrevNote] = useState(p.note);
  if (p.note !== prevNote) {
    setPrevNote(p.note);
    setNote(p.note ?? "");
  }
  return (
    <textarea
      value={note}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => note !== (p.note ?? "") && startTransition(() => updateProfessorAction(p.id, { note }))}
      placeholder="备注（如：教授回信要点、面谈安排）"
      rows={3}
      maxLength={1000}
      disabled={pending}
      className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
    />
  );
}

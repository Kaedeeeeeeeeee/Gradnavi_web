"use client";

import { useState, useTransition } from "react";
import { checkNowAction, unwatchSchoolAction, watchSchoolAction } from "@/app/(app)/schools/actions";
import { ContactStepper, FindSchoolButton, Gaps, SchoolFacts, Tentative } from "@/components/aspirations/aspiration-ui";
import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { btn } from "@/components/tasks/task-ui";
import { aspirationTitle, contactLabel, describeAspiration, languageLabel, type AspirationView } from "@/lib/aspirations";
import { PROFESSOR_STATUS_LABELS, professorAffiliation } from "@/lib/professors";

type Props = { list: AspirationView[]; lastSearch: { id: string; title: string; count: number } | null };

const input = "input px-3 py-1.5 text-sm";

export function AspirationsView({ list, lastSearch }: Props) {
  const [mode, setMode] = useState<"list" | "compare">("list");
  const active = list.filter((a) => a.professor?.status !== "dropped");
  useAiPageContent(list.length ? `志愿（${list.length} 条）：\n\n${list.map(describeAspiration).join("\n\n")}` : "志愿还是空的。");

  return (
    <div className="@container mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="page-title">志愿</h1>
        <p className="text-sm text-muted">
          每条志愿 = 一位教授 + 教授所在的研究科。教授想收、研究科也考得上，才算稳；两边一起看，AI 帮你权衡，你来决定。
        </p>
      </div>

      <FindProfessors lastSearch={lastSearch} />

      {list.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="section-title">我的志愿（{active.length}）</h2>
            {active.length >= 2 && (
              <div className="ml-auto flex rounded-xl border border-line p-0.5 text-xs">
                {(["list", "compare"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={`rounded px-2.5 py-1 ${mode === m ? "bg-subtle-strong" : "text-muted hover:text-foreground"}`}>
                    {m === "list" ? "列表" : "并排对比"}
                  </button>
                ))}
              </div>
            )}
          </div>
          {mode === "compare" && active.length >= 2 ? (
            <CompareTable list={active} />
          ) : (
            <ul className="space-y-3">
              {list.map((a) => (
                <AspirationCard key={a.key} a={a} />
              ))}
            </ul>
          )}
        </section>
      )}

      <StartFromSchool empty={list.length === 0} />
    </div>
  );
}

/** 找教授在对话里进行：这里只是个入口，说一句话就交给 AI */
function FindProfessors({ lastSearch }: { lastSearch: Props["lastSearch"] }) {
  const ask = useAskAi();
  const [text, setText] = useState("");
  return (
    <section className="space-y-2 rounded-xl border border-line p-4">
      <h2 className="section-title">和 AI 一起找教授</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          ask(t ? `帮我找教授：${t}` : "帮我找教授：根据我的档案，先问我一两个关键问题，再检索合适的教授。");
          setText("");
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="说说方向，如：二语习得，想去关东的国立大学"
          maxLength={300}
          className={`${input} min-w-0 flex-1`}
        />
        <button type="submit" className="btn-primary px-3 py-1.5 text-sm">
          开始
        </button>
      </form>
      <p className="text-xs text-muted">
        候选教授会显示在中间（附近两三年的论文和为什么适合你），点「加入志愿」或「不合适」；想调整就在右边接着说，比如「更偏应用一点」。
        {lastSearch && (
          <>
            {" "}
            <OpenTabLink tab={{ kind: "search", id: lastSearch.id, title: lastSearch.title }} href="/aspirations" className="underline hover:text-foreground">
              查看上次的 {lastSearch.count} 位候选
            </OpenTabLink>
          </>
        )}
      </p>
    </section>
  );
}

function AspirationCard({ a }: { a: AspirationView }) {
  const { openTab } = useShell();
  const ask = useAskAi();
  const [pending, startTransition] = useTransition();
  const p = a.professor;
  const s = a.school;
  return (
    <li className={`space-y-3 rounded-xl border border-line p-4 ${p?.status === "dropped" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        {p ? (
          <button onClick={() => openTab({ kind: "professor", id: p.id, title: p.name })} className="text-left font-medium hover:underline">
            {p.name}
          </button>
        ) : (
          <span className="font-medium">
            {s!.university} {s!.name}
          </span>
        )}
        <span className="text-sm text-muted">{p ? professorAffiliation(p) : "只有研究科，还没定教授"}</span>
      </div>

      <div className="grid gap-4 @xl:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted">教授这边</h3>
          {p ? (
            <>
              {(p.fit || p.research) && <p className="line-clamp-3 text-sm">{p.fit || p.research}</p>}
              <ContactStepper id={p.id} status={p.status} compact />
            </>
          ) : (
            <button onClick={() => ask(`帮我在${s!.university} ${s!.name}找和我方向相关的教授。`)} className={btn}>
              在这个研究科找教授
            </button>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted">
            研究科这边{p && s && <span className="ml-1 font-normal">{s.name}</span>}
          </h3>
          {s ? <SchoolFacts school={s} /> : p && <FindSchoolButton professor={p} />}
          <Gaps gaps={a.gaps} />
        </div>
      </div>

      {s && !p && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <OpenTabLink tab={{ kind: "web", url: s.url, title: `${s.university} ${s.name}` }} href={s.url} className="underline hover:text-foreground">
            要项页面
          </OpenTabLink>
          {s.problem && <span className="text-warn">{s.problem}</span>}
          <button disabled={pending || s.pending} onClick={() => startTransition(() => checkNowAction(s.id))} className="ml-auto hover:text-foreground disabled:opacity-50">
            {s.pending ? "等待检查…" : "立即检查"}
          </button>
          <button
            disabled={pending}
            onClick={() => confirm(`把「${s.university} ${s.name}」移出志愿（不再监控募集要项）？`) && startTransition(() => unwatchSchoolAction(s.id))}
            className="hover:text-danger"
          >
            移出志愿
          </button>
        </div>
      )}
    </li>
  );
}

/** 并排对比：帮用户判断「教授想收但难考」「好考但教授一般」这类取舍 */
function CompareTable({ list }: { list: AspirationView[] }) {
  const ask = useAskAi();
  const rows: [string, (a: AspirationView) => React.ReactNode][] = [
    ["研究方向匹配", (a) => a.professor?.fit || a.professor?.research || "—"],
    ["联系状态", (a) => (a.professor ? PROFESSOR_STATUS_LABELS[a.professor.status] : "—")],
    ["收留学生", (a) => a.professor?.acceptsInternational || "未查到"],
    ["研究科", (a) => (a.school ? `${a.school.university} ${a.school.name}` : "未关联")],
    ["事先联系", (a) => (a.school ? contactLabel(a.school.requirements) : "—")],
    ["考试科目", (a) => a.school?.requirements?.subjects.join("、") || "未查到"],
    ["语言要求", (a) => (a.school ? languageLabel(a.school.requirements) : "—")],
    [
      "出愿截止",
      (a) =>
        a.school?.deadline ? (
          <>
            {a.school.deadline.date}
            {a.school.deadline.tentative && <Tentative />}
          </>
        ) : (
          "—"
        ),
    ],
    ["差距", (a) => (a.gaps.length ? <span className="text-warn">{a.gaps.join("；")}</span> : "—")],
  ];
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="w-24 p-2" />
              {list.map((a) => (
                <th key={a.key} className="p-2 align-top font-medium">
                  {a.professor ? a.professor.name : "（只有研究科）"}
                  <div className="text-xs font-normal text-muted">{a.professor ? a.professor.university : `${a.school!.university} ${a.school!.name}`}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <th className="p-2 align-top text-xs font-normal text-muted">{label}</th>
                {list.map((a) => (
                  <td key={a.key} className="p-2 align-top">
                    {cell(a)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() =>
          ask(
            `帮我对比这几条志愿：${list.map(aspirationTitle).join("、")}。结合我的档案，从「教授想不想收、方向合不合」和「研究科好不好考、我差多少」两边分析取舍，给一个建议的优先顺序和理由（最后我来决定）。`,
          )
        }
        className={btn}
      >
        让 AI 给建议
      </button>
    </div>
  );
}

/** 也可以从研究科开始：某研究科好考、不太需要联系教授时 */
function StartFromSchool({ empty }: { empty: boolean }) {
  const ask = useAskAi();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ university: "", name: "", url: "" });
  return (
    <details className="rounded-xl border border-line p-4 text-sm" open={empty || undefined}>
      <summary className="cursor-pointer font-medium">从研究科开始</summary>
      <p className="mt-2 text-muted">有的研究科好考、不太需要先联系教授，可以先把研究科加进志愿。系统每天检查它的募集要项，日程和入试要点自动带出来，不消耗 credit。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!form.url.trim()) {
            if (!form.university.trim() || !form.name.trim()) return setError("请填写大学和研究科");
            ask(`帮我把「${form.university} ${form.name}」加进志愿：找到它官网的入试信息 / 募集要项页面，确认后关注，并记下入试要点。`);
            setForm({ university: "", name: "", url: "" });
            return;
          }
          startTransition(async () => {
            const res = await watchSchoolAction(form);
            if (res.ok) setForm({ university: "", name: "", url: "" });
            else setError(res.error);
          });
        }}
        className="mt-3 space-y-2"
      >
        <div className="flex flex-wrap gap-2">
          <input value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} placeholder="大学，如 東京大学" className={`${input} min-w-0 flex-1`} />
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="研究科，如 教育学研究科" className={`${input} min-w-0 flex-1`} />
        </div>
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="入试信息 / 募集要项网址（不知道就留空，AI 帮你找）" className={`${input} w-full`} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5">
          {form.url.trim() ? "加入志愿" : "让 AI 找网址并加入"}
        </button>
      </form>
    </details>
  );
}

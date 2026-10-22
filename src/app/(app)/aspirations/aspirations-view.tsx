"use client";

import { useState } from "react";
import { ContactStepper, Tentative } from "@/components/aspirations/aspiration-ui";
import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { btn } from "@/components/tasks/task-ui";
import { aspirationTitle, contactLabel, describeAspiration, languageLabel, type AspirationView } from "@/lib/aspirations";
import { PROFESSOR_STATUS_LABELS, professorAffiliation } from "@/lib/professors";

// 志愿 = 收藏馆：一条条志愿（教授 + 教授所在的研究科，也可以只有研究科），点开在文稿栏看详情。
// 页面上没有表单：找教授、加研究科都在右侧对话里，AI 问清方向、找到合适的，再问用户要不要加入志愿。

type Props = { list: AspirationView[]; lastSearch: { id: string; title: string; count: number } | null };

/** 和 AI 开始（或继续）找志愿：AI 先问方向、地区、有没有心仪的教授或研究科，再去找 */
const START_PROMPT = "我想开始找志愿（教授 + 研究科）。先根据我的档案问我几个关键问题，问清楚再帮我找。";
const MORE_PROMPT = "我想再找一些志愿。先看看我现在的志愿和档案，问我想补充什么方向或学校，再帮我找。";

export function AspirationsView({ list, lastSearch }: Props) {
  const ask = useAskAi();
  const [mode, setMode] = useState<"grid" | "compare">("grid");
  const active = list.filter((a) => a.professor?.status !== "dropped");
  useAiPageContent(list.length ? `志愿（${list.length} 条）：\n\n${list.map(describeAspiration).join("\n\n")}` : "志愿还是空的。");

  if (!list.length) return <Empty lastSearch={lastSearch} />;

  return (
    <div className="@container mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="page-title">志愿</h1>
          <p className="text-sm text-muted">
            {active.length} 条志愿
            {lastSearch && (
              <>
                {" · "}
                <OpenTabLink tab={{ kind: "search", id: lastSearch.id, title: lastSearch.title }} href="/aspirations" className="hover:text-foreground hover:underline">
                  上次找到的 {lastSearch.count} 位候选
                </OpenTabLink>
              </>
            )}
          </p>
        </div>
        {active.length >= 2 && (
          <div className="flex rounded-lg border border-line p-0.5 text-xs">
            {(["grid", "compare"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-subtle-strong" : "text-muted hover:text-foreground"}`}>
                {m === "grid" ? "收藏" : "并排对比"}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => ask(MORE_PROMPT)} className="btn px-3 py-1.5 text-sm">
          和 AI 继续找
        </button>
      </div>

      {mode === "compare" && active.length >= 2 ? (
        <CompareTable list={active} />
      ) : (
        <ul className="grid gap-3 @xl:grid-cols-2">
          {list.map((a) => (
            <AspirationTile key={a.key} a={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 什么都没有时：只有一个按钮，交给 AI 在对话里问 */
function Empty({ lastSearch }: { lastSearch: Props["lastSearch"] }) {
  const ask = useAskAi();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <h1 className="page-title">志愿</h1>
      <p className="text-sm leading-relaxed text-muted">
        这里收藏你的每一条志愿：一位教授，加上教授所在的研究科。
        <br />
        和 AI 聊聊你想研究什么，它会帮你找合适的教授，问过你再加进来。
      </p>
      <button onClick={() => ask(START_PROMPT)} className="btn-primary px-4 py-2 text-sm">
        和 AI 开始找志愿
      </button>
      {lastSearch && (
        <OpenTabLink tab={{ kind: "search", id: lastSearch.id, title: lastSearch.title }} href="/aspirations" className="text-xs text-muted hover:text-foreground hover:underline">
          看看上次找到的 {lastSearch.count} 位候选
        </OpenTabLink>
      )}
    </div>
  );
}

/** 收藏馆里的一条志愿：一眼看到是谁、在哪、进展到哪、最近的截止和差距。点开看详情 */
function AspirationTile({ a }: { a: AspirationView }) {
  const { openTab } = useShell();
  const p = a.professor;
  const s = a.school;
  const open = () => (p ? openTab({ kind: "professor", id: p.id, title: p.name }) : openTab({ kind: "school", id: s!.id, title: `${s!.university} ${s!.name}` }));
  return (
    <li className={`card flex flex-col ${p?.status === "dropped" ? "opacity-60" : ""}`}>
      <button onClick={open} className="flex-1 space-y-2 p-4 text-left hover:bg-subtle">
        <div>
          <div className="font-medium">{p ? p.name : `${s!.university} ${s!.name}`}</div>
          <div className="text-xs text-muted">{p ? (s ? `${s.university} ${s.name}` : professorAffiliation(p)) : "只有研究科，还没定教授"}</div>
        </div>
        {p && (p.fit || p.research) && <p className="line-clamp-2 text-sm text-muted">{p.fit || p.research}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {s?.deadline ? (
            <span>
              出愿截止 <span className="tabular-nums text-foreground">{s.deadline.date}</span>
              {s.deadline.tentative && <Tentative />}
            </span>
          ) : (
            <span>{s ? (s.pending ? "要项检查中" : "还没有出愿日程") : "研究科还没查"}</span>
          )}
          {a.gaps.length > 0 && <span className="text-warn">⚠ {a.gaps[0]}{a.gaps.length > 1 ? ` 等 ${a.gaps.length} 项` : ""}</span>}
        </div>
      </button>
      {p && (
        <div className="card-foot">
          <ContactStepper id={p.id} status={p.status} compact />
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

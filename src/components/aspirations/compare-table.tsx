"use client";

import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { btn } from "@/components/tasks/task-ui";
import { formatDate } from "@/lib/calendar";
import { aspirationTitle, contactLabel, describeAspiration, languageLabel, type AspirationView } from "@/lib/aspirations";
import { PROFESSOR_STATUS_LABELS } from "@/lib/professors";
import { Tentative } from "./aspiration-ui";

// 志愿的并排对比：在中间的文稿栏打开（像打开一份文稿），左右两栏让出宽度，几位教授一屏看得完。

export function CompareView({ list }: { list: AspirationView[] }) {
  useAiPageContent(`志愿并排对比（用户正在看，${list.length} 条）：\n\n${list.map(describeAspiration).join("\n\n")}`, "doc");
  return (
    <div className="space-y-4 px-6 py-8">
      <h1 className="page-title">对比 {list.length} 条志愿</h1>
      {list.length < 2 ? <p className="text-sm text-muted">志愿里至少要有两条（没放弃的）才能对比。</p> : <CompareTable list={list} />}
    </div>
  );
}

/** 并排对比：帮用户判断「教授想收但难考」「好考但教授一般」这类取舍 */
export function CompareTable({ list }: { list: AspirationView[] }) {
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
            {formatDate(a.school.deadline.date)}
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

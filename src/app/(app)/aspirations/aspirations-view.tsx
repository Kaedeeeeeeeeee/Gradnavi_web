"use client";

import { ContactStatusSelect, Tentative } from "@/components/aspirations/aspiration-ui";
import { useAiPageContent, useAskAi } from "@/components/ai/page-context";
import { OpenTabLink, useShell } from "@/components/shell/app-shell";
import { btn } from "@/components/tasks/task-ui";
import { AI_ICON, Icon, PersonTile, SchoolTile } from "@/components/ui/icons";
import { ArrowRight, Flag, GraduationCap, TriangleAlert } from "lucide-react";
import { formatDate } from "@/lib/calendar";
import { aspirationNextStep, describeAspiration, sortAspirations, type AspirationView } from "@/lib/aspirations";
import { professorAffiliation } from "@/lib/professors";

// 志愿 = 收藏馆：一条条志愿（教授 + 教授所在的研究科，也可以只有研究科），点开在文稿栏看详情。
// 页面上没有表单：找教授、加研究科都在右侧对话里，AI 问清方向、找到合适的，再问用户要不要加入志愿。

type Props = { list: AspirationView[]; lastSearch: { id: string; title: string; count: number } | null };

/** 和 AI 开始（或继续）找志愿：AI 先问方向、地区、有没有心仪的教授或研究科，再去找 */
const START_PROMPT = "我想开始找志愿（教授 + 研究科）。先根据我的档案问我几个关键问题，问清楚再帮我找。";
const MORE_PROMPT = "我想再找一些志愿。先看看我现在的志愿和档案，问我想补充什么方向或学校，再帮我找。";

export function AspirationsView({ list: unsorted, lastSearch }: Props) {
  const ask = useAskAi();
  const { openTab } = useShell();
  // 默认按最近的出愿日期排，放弃的在最后
  const list = sortAspirations(unsorted);
  const active = list.filter((a) => a.professor?.status !== "dropped");
  useAiPageContent(list.length ? `志愿（${list.length} 条）：\n\n${list.map(describeAspiration).join("\n\n")}` : "志愿还是空的。");

  if (!list.length) return <Empty lastSearch={lastSearch} />;

  return (
    <div className="@container mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="page-title flex items-center gap-2">
            <Icon icon={GraduationCap} className="size-5" />
            志愿
          </h1>
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
        {/* 并排对比在中间的文稿栏打开，左右两栏让出宽度 */}
        {active.length >= 2 && (
          <button onClick={() => openTab({ kind: "compare", id: "all", title: "对比志愿" })} className="btn px-3 py-1.5 text-sm">
            并排对比
          </button>
        )}
        <button onClick={() => ask(MORE_PROMPT)} className="btn px-3 py-1.5 text-sm">
          <Icon icon={AI_ICON} className="size-3.5" />
          和 AI 继续找
        </button>
      </div>

      <ul className="grid gap-3 @xl:grid-cols-2">
        {list.map((a) => (
          <AspirationTile key={a.key} a={a} />
        ))}
      </ul>
    </div>
  );
}

/** 什么都没有时：只有一个按钮，交给 AI 在对话里问 */
function Empty({ lastSearch }: { lastSearch: Props["lastSearch"] }) {
  const ask = useAskAi();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <Icon icon={GraduationCap} className="size-9 text-faint" />
      <h1 className="page-title">志愿</h1>
      <p className="text-sm leading-relaxed text-muted">
        这里收藏你的每一条志愿：一位教授，加上教授所在的研究科。
        <br />
        和 AI 聊聊你想研究什么，它会帮你找合适的教授，问过你再加进来。
      </p>
      <button onClick={() => ask(START_PROMPT)} className="btn-primary gap-1.5 px-4 py-2 text-sm">
        <Icon icon={AI_ICON} className="text-on-primary" />
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

/** 收藏馆里的一条志愿：名字旁边是联系状态（下拉），下面是研究科、最近的截止和差距，最后一行「下一步」。点开看详情 */
function AspirationTile({ a }: { a: AspirationView }) {
  const { openTab } = useShell();
  const ask = useAskAi();
  const p = a.professor;
  const s = a.school;
  const next = aspirationNextStep(a);
  const open = () => (p ? openTab({ kind: "professor", id: p.id, title: p.name }) : openTab({ kind: "school", id: s!.id, title: `${s!.university} ${s!.name}` }));
  return (
    <li className={`card flex flex-col ${p?.status === "dropped" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2 px-4 pt-3.5">
        {p ? <PersonTile name={p.name} className="mt-0.5" /> : <SchoolTile className="mt-0.5" />}
        <button onClick={open} className="min-w-0 flex-1 text-left font-medium hover:underline">
          {p ? p.name : `${s!.university} ${s!.name}`}
        </button>
        {p && <ContactStatusSelect id={p.id} status={p.status} />}
      </div>
      {/* button 默认把内容垂直居中，内容少的卡片会往下掉；改成从顶部排 */}
      <button onClick={open} className="flex flex-1 flex-col justify-start gap-1.5 px-4 pt-0.5 pb-3 text-left">
        <span className="text-xs text-muted">
          {p ? (s ? `${s.university} ${s.name}` : professorAffiliation(p)) : "只有研究科，还没定教授"}
          {" · "}
          {s?.deadline ? (
            <>
              <Icon icon={Flag} className="mr-0.5 inline size-3 align-[-1px]" />
              出愿截止 <span className="tabular-nums text-foreground">{formatDate(s.deadline.date)}</span>
              {s.deadline.tentative && <Tentative />}
            </>
          ) : s ? (
            s.pending ? "要项检查中" : "还没有出愿日程"
          ) : (
            "研究科还没查"
          )}
        </span>
        {p && (p.fit || p.research) && <span className="line-clamp-2 text-sm text-muted">{p.fit || p.research}</span>}
        {a.gaps.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-warn">
            <Icon icon={TriangleAlert} className="size-3.5 text-warn" />
            {a.gaps[0]}
            {a.gaps.length > 1 ? ` 等 ${a.gaps.length} 项` : ""}
          </span>
        )}
      </button>
      {next && (
        <div className="card-foot flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <Icon icon={ArrowRight} className="size-3.5" />
            <span className="text-muted">下一步：</span>
            {next.text}
          </span>
          {next.action && (
            <button onClick={() => ask(next.action!.prompt)} className={btn}>
              {next.action.label}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

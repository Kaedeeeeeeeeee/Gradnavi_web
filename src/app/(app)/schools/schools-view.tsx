"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useAskAi } from "@/components/ai/page-context";
import { OpenTabLink } from "@/components/shell/app-shell";
import { checkNowAction, unwatchSchoolAction, watchSchoolAction } from "./actions";

type School = {
  id: string;
  university: string;
  name: string;
  url: string;
  checkedAt: string | null;
  pending: boolean;
  problem: string | null;
  guideYear: number | null;
  guideUpdatedAt: string | null;
  tentative: boolean;
  events: { key: string; title: string; date: string; endDate: string | null }[];
};

const input = "rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function SchoolsView({ schools }: { schools: School[] }) {
  const ask = useAskAi();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ university: "", name: "", url: "" });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">目标研究科</h1>
        <p className="text-sm text-zinc-500">
          关注想报考的研究科后，系统每天检查一次它的募集要项页面。新要项公开前，<Link href="/calendar" className="underline">日历</Link>
          里按往年日程排“仮”计划；新要项一公开，自动更新日历并邮件通知你。监控不消耗 credit。
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">关注新的研究科</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await watchSchoolAction(form);
              if (res.ok) setForm({ university: "", name: "", url: "" });
              else setError(res.error);
            });
          }}
          className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap gap-2">
            <input value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} placeholder="大学，如 東京大学" className={`${input} flex-1`} />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="研究科，如 教育学研究科" className={`${input} flex-1`} />
          </div>
          <input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="入试信息 / 募集要项页面网址（https://…）"
            className={`${input} w-full`}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="submit" disabled={pending} className="rounded-md bg-foreground px-3 py-1.5 text-background disabled:opacity-50">
              关注
            </button>
            <button
              type="button"
              onClick={() =>
                ask(
                  form.university || form.name
                    ? `帮我找到「${form.university} ${form.name}」官网的入试信息 / 募集要项页面，确认后帮我关注。`
                    : "根据我的目标校，帮我找到对应研究科官网的入试信息 / 募集要项页面，确认后帮我关注。",
                )
              }
              className="text-zinc-500 underline hover:text-foreground"
            >
              不知道网址？让 AI 帮我找
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">已关注 {schools.length} 个</h2>
        {schools.length === 0 && <p className="text-sm text-zinc-500">还没有关注任何研究科。</p>}
        <ul className="space-y-3">
          {schools.map((s) => (
            <SchoolCard key={s.id} school={s} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function SchoolCard({ school: s }: { school: School }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-medium">
          {s.university} {s.name}
        </p>
        <OpenTabLink tab={{ kind: "web", url: s.url, title: `${s.university} ${s.name}` }} href={s.url} className="truncate text-xs text-zinc-500 underline">
          要项页面
        </OpenTabLink>
        <div className="ml-auto flex gap-3 text-xs">
          <button disabled={pending || s.pending} onClick={() => startTransition(() => checkNowAction(s.id))} className="text-zinc-500 hover:text-foreground disabled:opacity-50">
            {s.pending ? "等待检查…" : "立即检查"}
          </button>
          <button
            disabled={pending}
            onClick={() => confirm(`取消关注「${s.university} ${s.name}」？`) && startTransition(() => unwatchSchoolAction(s.id))}
            className="text-zinc-400 hover:text-red-600"
          >
            取消关注
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        {s.checkedAt ? `最近检查：${formatTime(s.checkedAt)}` : "等待首次检查（几分钟内）"}
        {s.guideYear &&
          ` · 已解析 ${s.guideYear} 年度要项${s.tentative ? "（已过期，日历里按此顺延一年排仮日程）" : ""}`}
      </p>
      {s.problem && <p className="text-xs text-amber-700 dark:text-amber-400">{s.problem}</p>}
      {s.events.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {s.events.map((e) => (
            <li key={e.key} className="flex gap-2">
              <span className="w-40 shrink-0 tabular-nums text-zinc-500">
                {s.tentative && <span className="mr-1 text-amber-700">仮</span>}
                {e.date}
                {e.endDate && `〜${e.endDate.slice(5)}`}
              </span>
              <span>{e.title.replace(`${s.university} ${s.name} `, "")}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

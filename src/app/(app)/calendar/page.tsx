import Link from "next/link";
import { addDays, CALENDAR_KIND_LABELS, itemsOn, monthGrid, parseMonth, shiftMonth, todayJst, type CalendarItem } from "@/lib/calendar";
import { requireUser } from "@/lib/session";
import { listCalendar } from "@/server/calendar";
import { AddEventForm, DeleteEventButton } from "./calendar-view";

export const metadata = { title: "日历 · GradNavi" };

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const KIND_STYLES: Record<CalendarItem["kind"], string> = {
  deadline: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  exam: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  followup: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  other: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const SOURCE_LABELS: Record<CalendarItem["source"], string> = {
  event: "日程",
  todo: "Todo",
  professor: "教授跟进",
  guide: "募集要项",
};

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await requireUser();
  const today = todayJst();
  const m = (await searchParams).m;
  const month = parseMonth(typeof m === "string" ? m : undefined, today);
  const weeks = monthGrid(month);
  const gridFrom = weeks[0][0].date;
  const gridTo = weeks.at(-1)![6].date;
  const upcomingTo = addDays(today, 60);
  const items = await listCalendar(user.id, gridFrom < today ? gridFrom : today, gridTo > upcomingTo ? gridTo : upcomingTo, today);
  const upcoming = items.filter((it) => (it.endDate ?? it.date) >= today && it.date <= upcomingTo && !it.done);
  const [y, mm] = month.split("-");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">日历</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Link href={`/calendar?m=${shiftMonth(month, -1)}`} className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700">
            ‹
          </Link>
          <span className="w-24 text-center font-medium">
            {y} 年 {Number(mm)} 月
          </span>
          <Link href={`/calendar?m=${shiftMonth(month, 1)}`} className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700">
            ›
          </Link>
          <Link href="/calendar" className="text-zinc-500 hover:text-foreground">
            今天
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th key={d} className="py-1 font-normal text-zinc-500">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0].date}>
                {week.map(({ date, inMonth }) => (
                  <td
                    key={date}
                    className={`h-24 border border-zinc-200 p-1 align-top dark:border-zinc-800 ${inMonth ? "" : "bg-zinc-50 text-zinc-400 dark:bg-zinc-900"}`}
                  >
                    <div className={`mb-1 ${date === today ? "inline-block rounded-full bg-foreground px-1.5 text-background" : ""}`}>
                      {Number(date.slice(8))}
                    </div>
                    <ul className="space-y-0.5">
                      {itemsOn(items, date).map((it) => (
                        <li
                          key={it.key}
                          title={[it.title, it.note].filter(Boolean).join("\n")}
                          className={`truncate rounded px-1 ${KIND_STYLES[it.kind]} ${it.done ? "line-through opacity-60" : ""} ${it.tentative ? "border border-dashed border-current" : ""}`}
                        >
                          {it.tentative && "仮 "}
                          {it.title}
                        </li>
                      ))}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <h2 className="font-medium">接下来 60 天</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-zinc-500">
              暂无日程。可以在<Link href="/schools" className="underline">目标研究科</Link>里关注想报考的研究科，系统会自动把募集要项日程排进日历。
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
              {upcoming.map((it) => (
                <li key={it.key} className="group flex items-start gap-3 px-4 py-2.5">
                  <span className="w-28 shrink-0 tabular-nums text-zinc-500">
                    {it.date.slice(5)}
                    {it.endDate && it.endDate !== it.date && `〜${it.endDate.slice(5)}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className={`mr-2 rounded px-1 text-xs ${KIND_STYLES[it.kind]}`}>{CALENDAR_KIND_LABELS[it.kind]}</span>
                      {it.tentative && <span className="mr-1 rounded border border-dashed border-amber-500 px-1 text-xs text-amber-700">仮</span>}
                      {it.href ? (
                        <Link href={it.href} className="hover:underline">
                          {it.title}
                        </Link>
                      ) : (
                        it.title
                      )}
                    </p>
                    {it.note && <p className="text-xs text-zinc-500">{it.note}</p>}
                  </div>
                  <span className="text-xs text-zinc-400">{SOURCE_LABELS[it.source]}</span>
                  {it.source === "event" && it.sourceId && <DeleteEventButton id={it.sourceId} />}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-zinc-500">
            日历汇总了：手动添加的日程、有截止日期的 Todo、教授清单里的跟进日、关注研究科的募集要项日程。标“仮”的是按往年要项推算的，新要项公开后会自动更新并邮件通知你。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium">添加日程</h2>
          <AddEventForm defaultDate={month === today.slice(0, 7) ? today : `${month}-01`} />
        </section>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";

// 日历并进了主页。旧链接（如募集要项更新邮件里的）跳到主页，保留月份
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const m = (await searchParams).m;
  redirect(typeof m === "string" ? `/workbench?m=${encodeURIComponent(m)}` : "/workbench");
}

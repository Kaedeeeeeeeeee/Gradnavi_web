import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  if (await getSession()) redirect("/workbench");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-semibold">GradNavi 修考工作台</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        从找教授、写研究计划书到出愿考试，AI 和你一起把每一步拆成具体的下一步动作。
      </p>
      <Link
        href="/login"
        className="rounded-lg bg-zinc-900 px-6 py-2.5 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
      >
        登录 / 注册
      </Link>
    </main>
  );
}

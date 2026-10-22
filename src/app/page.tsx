import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  if (await getSession()) redirect("/workbench");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="page-title text-4xl">GradNavi 修考工作台</h1>
      <p className="max-w-md text-muted">
        从找教授、写研究计划书到出愿考试，AI 和你一起把每一步拆成具体的下一步动作。
      </p>
      <Link
        href="/login"
        className="btn-primary px-6 py-2.5"
      >
        登录 / 注册
      </Link>
    </main>
  );
}

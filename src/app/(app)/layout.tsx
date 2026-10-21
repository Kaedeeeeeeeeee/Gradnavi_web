import Link from "next/link";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

// 登录后的所有页面共用：顶栏 + 主体。AI 侧边栏在第 2 步加入。
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Link href="/workbench" className="font-semibold">
          GradNavi
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-500">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

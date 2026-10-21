import Link from "next/link";
import { AiSidebar } from "@/components/ai/ai-sidebar";
import { AiPageContextProvider } from "@/components/ai/page-context";
import { isDemoMode } from "@/lib/ai/model";
import { requireUser } from "@/lib/session";
import { isAdminEmail } from "@/server/beta";
import { getLatestConversation, loadMessages } from "@/server/conversations";
import { getBalance } from "@/server/credits";
import { SignOutButton } from "./sign-out-button";

// 登录后的所有页面共用：顶栏 + 主体 + 右侧 AI 侧边栏
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const conversation = await getLatestConversation(user.id);
  const messages = conversation ? await loadMessages(conversation.id) : [];
  const balance = await getBalance(user.id);

  return (
    <AiPageContextProvider>
      <div className="flex min-h-full flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/workbench" className="text-base font-semibold">
                GradNavi
              </Link>
              <Link href="/workbench" className="text-zinc-500 hover:text-foreground">
                工作台
              </Link>
              <Link href="/professors" className="text-zinc-500 hover:text-foreground">
                找教授
              </Link>
              <Link href="/documents" className="text-zinc-500 hover:text-foreground">
                文书
              </Link>
              <Link href="/calendar" className="text-zinc-500 hover:text-foreground">
                日历
              </Link>
              <Link href="/schools" className="text-zinc-500 hover:text-foreground">
                目标研究科
              </Link>
              <Link href="/profile" className="text-zinc-500 hover:text-foreground">
                我的档案
              </Link>
              <Link href="/feedback" className="text-zinc-500 hover:text-foreground">
                反馈
              </Link>
              {isAdminEmail(user.email) && (
                <Link href="/admin" className="text-zinc-500 hover:text-foreground">
                  管理
                </Link>
              )}
            </nav>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/credits" className={`tabular-nums hover:text-foreground ${balance <= 0 ? "text-red-600" : "text-zinc-500"}`}>
                {balance.toLocaleString()} credit
              </Link>
              <span className="hidden text-zinc-500 sm:inline">{user.email}</span>
              <SignOutButton />
            </div>
          </header>
          <main className="flex-1 px-4 py-6">{children}</main>
        </div>
        <AiSidebar initialConversationId={conversation?.id ?? null} initialMessages={messages} demo={isDemoMode()} initialBalance={balance} />
      </div>
    </AiPageContextProvider>
  );
}

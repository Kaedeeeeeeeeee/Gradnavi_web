import Link from "next/link";
import { AiSidebar } from "@/components/ai/ai-sidebar";
import { AiPageContextProvider } from "@/components/ai/page-context";
import { isDemoMode } from "@/lib/ai/model";
import { requireUser } from "@/lib/session";
import { getLatestConversation, loadMessages } from "@/server/conversations";
import { SignOutButton } from "./sign-out-button";

// 登录后的所有页面共用：顶栏 + 主体 + 右侧 AI 侧边栏
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const conversation = await getLatestConversation(user.id);
  const messages = conversation ? await loadMessages(conversation.id) : [];

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
              <Link href="/profile" className="text-zinc-500 hover:text-foreground">
                我的档案
              </Link>
            </nav>
            <div className="flex items-center gap-4 text-sm">
              <span className="hidden text-zinc-500 sm:inline">{user.email}</span>
              <SignOutButton />
            </div>
          </header>
          <main className="flex-1 px-4 py-6">{children}</main>
        </div>
        <AiSidebar initialConversationId={conversation?.id ?? null} initialMessages={messages} demo={isDemoMode()} />
      </div>
    </AiPageContextProvider>
  );
}

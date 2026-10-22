import { cookies } from "next/headers";
import Link from "next/link";
import { AiPane } from "@/components/ai/ai-pane";
import { AiPageContextProvider } from "@/components/ai/page-context";
import { AppShell } from "@/components/shell/app-shell";
import { renderDocTab } from "@/components/shell/doc-tab";
import { UserMenu } from "@/components/shell/user-menu";
import { isDemoMode } from "@/lib/ai/model";
import { requireUser } from "@/lib/session";
import { activeTab, LAYOUT_COOKIE, parseLayout, parseTabs, TABS_COOKIE } from "@/lib/shell";
import { isAdminEmail } from "@/server/beta";
import { getLatestConversation, loadMessages } from "@/server/conversations";
import { getBalance } from "@/server/credits";
import { listProposedEvents } from "@/server/calendar";
import { syncNextSteps } from "@/server/next-steps";
import { listFollowUpProposals } from "@/server/professors";
import { listTodos } from "@/server/todos";
import { countAwaiting } from "@/lib/tasks";
import { SignOutButton } from "./sign-out-button";

// 登录后的所有页面共用三栏外壳：工作台（各页面）| 文稿/浏览（多标签，打开时才出现）| AI 对话
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const jar = await cookies();
  const tabs = parseTabs(jar.get(TABS_COOKIE)?.value);
  const layout = parseLayout(jar.get(LAYOUT_COOKIE)?.value, tabs.tabs.length > 0);
  // 先按进度对账流程任务，工作台竖条上「待你确认」的数量才是最新的
  await syncNextSteps(user.id);
  const [conversation, balance, doc, todos, proposedEvents, followUps] = await Promise.all([
    getLatestConversation(user.id),
    getBalance(user.id),
    renderDocTab(user.id, activeTab(tabs)),
    listTodos(user.id),
    listProposedEvents(user.id),
    listFollowUpProposals(user.id),
  ]);
  const messages = conversation ? await loadMessages(conversation.id) : [];

  // 顶栏右边：credit 和「我的」菜单（AI 对你的了解、反馈、退出登录等）；宽屏上前两个也直接显示
  const topRight = (
    <>
      <Link
        href="/credits"
        className={`shrink-0 rounded-md px-2 py-1 tabular-nums hover:bg-subtle hover:text-foreground ${balance <= 0 ? "text-danger" : "text-muted"}`}
      >
        {balance.toLocaleString()}
        <span className="max-sm:hidden"> credit</span>
      </Link>
      <UserMenu
        email={user.email}
        items={[
          { href: "/profile", label: "AI 对你的了解", inline: true },
          { href: "/feedback", label: "反馈", inline: true },
          { href: "/credits", label: "credit 明细" },
          ...(isAdminEmail(user.email) ? [{ href: "/admin", label: "管理" }] : []),
        ]}
        signOut={<SignOutButton />}
      />
    </>
  );

  return (
    <AiPageContextProvider>
      <AppShell
        initialLayout={layout}
        initialTabs={tabs}
        docKey={tabs.active}
        docTitle={doc.title}
        doc={doc.node}
        topRight={topRight}
        awaiting={countAwaiting(todos, proposedEvents.length + followUps.length)}
        ai={<AiPane initialConversationId={conversation?.id ?? null} initialMessages={messages} demo={isDemoMode()} initialBalance={balance} />}
      >
        {children}
      </AppShell>
    </AiPageContextProvider>
  );
}

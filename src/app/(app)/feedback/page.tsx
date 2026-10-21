import { requireUser } from "@/lib/session";
import { sendFeedbackAction } from "./actions";

export const metadata = { title: "反馈 · GradNavi" };

export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  await requireUser();
  const { sent, from } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">内测反馈</h1>
        <p className="text-sm text-zinc-500">
          遇到 bug、哪里不好用、打开很慢、收不到验证码邮件、credit 不够用……都可以写在这里，我们会逐条看。
        </p>
      </div>
      {sent ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">已收到，谢谢！</p> : null}
      <form action={sendFeedbackAction} className="space-y-3">
        <input type="hidden" name="page" value={typeof from === "string" ? from : ""} />
        <textarea
          name="message"
          required
          rows={8}
          maxLength={5000}
          placeholder="请尽量写清楚：在哪个页面、做了什么、看到了什么。"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <button type="submit" className="rounded-md bg-foreground px-4 py-2 text-sm text-background">
          提交反馈
        </button>
      </form>
    </div>
  );
}

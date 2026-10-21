import { requireUser } from "@/lib/session";

export const metadata = { title: "工作台 · GradNavi" };

export default async function WorkbenchPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <h1 className="text-2xl font-semibold">工作台</h1>
      <p className="text-zinc-500">欢迎，{user.email}。下一步动作、Todo 和日程会显示在这里。</p>
    </div>
  );
}

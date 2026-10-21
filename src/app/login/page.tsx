import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录 · GradNavi" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // 只允许站内相对路径，防止开放重定向
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/workbench";
  if (await getSession()) redirect(target);

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">登录 GradNavi</h1>
          <p className="text-sm text-zinc-500">输入邮箱获取验证码，新邮箱会自动注册</p>
        </div>
        <LoginForm redirectTo={target} />
      </div>
    </main>
  );
}

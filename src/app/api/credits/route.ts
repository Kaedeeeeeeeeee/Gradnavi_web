import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getBalance } from "@/server/credits";

// AI 侧边栏每轮对话结束后来取一次余额
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  return Response.json({ balance: await getBalance(session.user.id) });
}

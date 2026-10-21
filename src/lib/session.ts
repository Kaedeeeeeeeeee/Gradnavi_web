import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isAdminEmail } from "@/server/beta";
import { auth } from "./auth";

/** 读取当前会话；同一次请求内只查一次数据库 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** 需要登录的页面调用：未登录直接跳转到登录页 */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

/** 管理员页面调用：邮箱不在 ADMIN_EMAILS 里时返回 404 */
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

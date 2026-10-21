import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { betaInvite, feedback, user } from "@/db/schema";
import { env } from "@/lib/env";

// 内测：邀请制注册 + 用户反馈

export const isAdminEmail = (email: string) => env.ADMIN_EMAILS.includes(email.trim().toLowerCase());

/** 这个邮箱能否登录/注册：开放注册、管理员、已注册用户、在邀请名单内，满足其一即可 */
export async function canSignIn(email: string): Promise<boolean> {
  if (env.SIGNUP_MODE === "open") return true;
  const e = email.trim().toLowerCase();
  if (isAdminEmail(e)) return true;
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, e)).limit(1);
  if (existing) return true;
  const [invited] = await db.select({ email: betaInvite.email }).from(betaInvite).where(eq(betaInvite.email, e)).limit(1);
  return Boolean(invited);
}

export async function addInvites(emails: string[], note: string | null, invitedBy: string) {
  if (!emails.length) return 0;
  const rows = await db
    .insert(betaInvite)
    .values(emails.map((email) => ({ email, note, invitedBy })))
    .onConflictDoNothing()
    .returning({ email: betaInvite.email });
  return rows.length;
}

export async function removeInvite(email: string) {
  await db.delete(betaInvite).where(eq(betaInvite.email, email));
}

/** 邀请名单，并标出谁已经注册 */
export async function listInvites() {
  const invites = await db.select().from(betaInvite).orderBy(desc(betaInvite.createdAt));
  const joined = invites.length
    ? await db
        .select({ email: user.email })
        .from(user)
        .where(
          inArray(
            user.email,
            invites.map((i) => i.email),
          ),
        )
    : [];
  const set = new Set(joined.map((j) => j.email));
  return invites.map((i) => ({ ...i, joined: set.has(i.email) }));
}

export async function addFeedback(userId: string, message: string, page: string | null) {
  await db.insert(feedback).values({ id: crypto.randomUUID(), userId, message, page });
}

export async function listFeedback(limit = 100) {
  return db
    .select({ id: feedback.id, message: feedback.message, page: feedback.page, createdAt: feedback.createdAt, email: user.email })
    .from(feedback)
    .innerJoin(user, eq(feedback.userId, user.id))
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
}

import "server-only";
import { desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, creditAccount, creditLedger, user } from "@/db/schema";
import type { Feature } from "@/lib/credits";

// 管理视图用的统计：我们付出的成本（含系统任务）和 credit 发放/消耗

export type CostRow = { feature: Feature; calls: number; costUsd: number; credits: number; inputTokens: number; outputTokens: number; searchCalls: number; fetchCalls: number };

/** 按功能汇总；since 为空时统计全部 */
export async function costByFeature(since?: Date): Promise<CostRow[]> {
  const rows = await db
    .select({
      feature: aiUsage.feature,
      calls: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float8`,
      credits: sql<number>`coalesce(sum(${aiUsage.credits}), 0)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      searchCalls: sql<number>`coalesce(sum(${aiUsage.searchCalls}), 0)::int`,
      fetchCalls: sql<number>`coalesce(sum(${aiUsage.fetchCalls}), 0)::int`,
    })
    .from(aiUsage)
    .where(since ? gte(aiUsage.createdAt, since) : undefined)
    .groupBy(aiUsage.feature);
  return rows;
}

export async function recentUsage(limit = 100) {
  return db
    .select({
      id: aiUsage.id,
      createdAt: aiUsage.createdAt,
      email: user.email,
      feature: aiUsage.feature,
      model: aiUsage.model,
      inputTokens: aiUsage.inputTokens,
      cachedInputTokens: aiUsage.cachedInputTokens,
      outputTokens: aiUsage.outputTokens,
      searchCalls: aiUsage.searchCalls,
      fetchCalls: aiUsage.fetchCalls,
      costUsd: aiUsage.costUsd,
      credits: aiUsage.credits,
    })
    .from(aiUsage)
    .leftJoin(user, eq(aiUsage.userId, user.id))
    .orderBy(desc(aiUsage.createdAt))
    .limit(limit);
}

/** 每个用户：余额、累计发放、累计消耗、我们为他付出的成本 */
export async function userStats() {
  const granted = db
    .select({ userId: creditLedger.userId, granted: sql<number>`sum(${creditLedger.delta})`.as("granted") })
    .from(creditLedger)
    .where(sql`${creditLedger.delta} > 0`)
    .groupBy(creditLedger.userId)
    .as("granted");
  const usage = db
    .select({
      userId: aiUsage.userId,
      calls: sql<number>`count(*)`.as("calls"),
      cost: sql<number>`sum(${aiUsage.costUsd})`.as("cost"),
      credits: sql<number>`sum(${aiUsage.credits})`.as("credits"),
      lastUsed: sql<Date>`max(${aiUsage.createdAt})`.as("last_used"),
    })
    .from(aiUsage)
    .groupBy(aiUsage.userId)
    .as("usage");
  return db
    .select({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      balance: creditAccount.balance,
      granted: sql<number>`coalesce(${granted.granted}, 0)::int`,
      calls: sql<number>`coalesce(${usage.calls}, 0)::int`,
      costUsd: sql<number>`coalesce(${usage.cost}, 0)::float8`,
      credits: sql<number>`coalesce(${usage.credits}, 0)::int`,
      lastUsed: sql<string | null>`${usage.lastUsed}`,
    })
    .from(user)
    .leftJoin(creditAccount, eq(creditAccount.userId, user.id))
    .leftJoin(granted, eq(granted.userId, user.id))
    .leftJoin(usage, eq(usage.userId, user.id))
    .orderBy(desc(user.createdAt));
}

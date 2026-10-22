import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, creditAccount, creditLedger } from "@/db/schema";
import { isDemoMode } from "@/lib/ai/model";
import { costUsd, creditsFor, isEmptyUsage, type Feature, type LedgerKind, type UsageMeter } from "@/lib/credits";
import { env } from "@/lib/env";

// Credit 账本。余额存在 credit_account，每次变动在同一事务里写一笔 credit_ledger。
// 扣费方式：开始前检查余额 > 0，结束后按实际用量扣（可能扣到略低于 0，下次就不能再用了）。

export class InsufficientCreditsError extends Error {
  constructor() {
    super("credit 余额不足，暂时不能使用 AI 功能。内测期间请联系管理员补充。");
    this.name = "InsufficientCreditsError";
  }
}

/** 取余额；第一次调用时开户并发放注册赠送（只会发一次） */
export async function getBalance(userId: string): Promise<number> {
  const [row] = await db.select({ balance: creditAccount.balance }).from(creditAccount).where(eq(creditAccount.userId, userId));
  if (row) return row.balance;
  return openAccount(userId);
}

async function openAccount(userId: string): Promise<number> {
  const grant = env.SIGNUP_CREDITS;
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(creditAccount)
      .values({ userId, balance: grant })
      .onConflictDoNothing()
      .returning({ balance: creditAccount.balance });
    if (!created) {
      const [row] = await tx.select({ balance: creditAccount.balance }).from(creditAccount).where(eq(creditAccount.userId, userId));
      return row?.balance ?? 0;
    }
    if (grant > 0) {
      await tx.insert(creditLedger).values({ id: crypto.randomUUID(), userId, kind: "signup_grant", delta: grant, balanceAfter: grant, note: "内测注册赠送" });
    }
    return created.balance;
  });
}

/** AI 操作开始前调用：余额用完时抛 InsufficientCreditsError */
export async function assertCanSpend(userId: string) {
  if ((await getBalance(userId)) <= 0) throw new InsufficientCreditsError();
}

/** 增减余额并记流水（管理员发放、以后的充值/退还都走这里） */
export async function adjustCredits(userId: string, delta: number, kind: LedgerKind, note?: string, externalRef?: string) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("credit 数量必须是非零整数");
  await getBalance(userId);
  return db.transaction(async (tx) => {
    const [acc] = await tx
      .update(creditAccount)
      .set({ balance: sql`${creditAccount.balance} + ${delta}`, updatedAt: new Date() })
      .where(eq(creditAccount.userId, userId))
      .returning({ balance: creditAccount.balance });
    await tx.insert(creditLedger).values({ id: crypto.randomUUID(), userId, kind, delta, balanceAfter: acc.balance, note, externalRef });
    return acc.balance;
  });
}

export type RecordUsageInput = {
  /** null = 系统任务，只记成本不扣 credit（目前没有；募集要项监控按用户扣） */
  userId: string | null;
  feature: Feature;
  meter: UsageMeter;
  refId?: string;
  note?: string;
};

/** 结算 meter 里尚未结算的用量：记 ai_usage，用户操作同时扣 credit。可对同一个 meter 多次调用 */
export async function recordUsage({ userId, feature, meter, refId, note }: RecordUsageInput) {
  const usage = meter.take();
  if (isEmptyUsage(usage)) return null;
  const pricing = env.PRICING;
  const cost = costUsd(usage, pricing);
  const credits = userId ? creditsFor(cost, pricing) : 0;
  if (userId) await getBalance(userId);

  return db.transaction(async (tx) => {
    const usageId = crypto.randomUUID();
    await tx.insert(aiUsage).values({
      id: usageId,
      userId,
      feature,
      model: isDemoMode() ? "demo" : env.DEEPSEEK_MODEL,
      refId,
      ...usage,
      costUsd: cost,
      credits,
    });
    if (userId && credits > 0) {
      const [acc] = await tx
        .update(creditAccount)
        .set({ balance: sql`${creditAccount.balance} - ${credits}`, updatedAt: new Date() })
        .where(eq(creditAccount.userId, userId))
        .returning({ balance: creditAccount.balance });
      await tx
        .insert(creditLedger)
        .values({ id: crypto.randomUUID(), userId, kind: "usage", delta: -credits, balanceAfter: acc.balance, note, usageId });
    }
    return { usageId, cost, credits };
  });
}

/** 结算时出错只记日志，不影响用户已经拿到的结果 */
export async function recordUsageSafe(input: RecordUsageInput) {
  try {
    return await recordUsage(input);
  } catch (error) {
    console.error("[credits] 记账失败", input.feature, input.userId, error);
    return null;
  }
}

/** 用户自己的流水（含对应的用量，方便显示 token 数） */
export async function listLedger(userId: string, limit = 100) {
  return db
    .select({
      id: creditLedger.id,
      kind: creditLedger.kind,
      delta: creditLedger.delta,
      balanceAfter: creditLedger.balanceAfter,
      note: creditLedger.note,
      createdAt: creditLedger.createdAt,
      feature: aiUsage.feature,
      inputTokens: aiUsage.inputTokens,
      outputTokens: aiUsage.outputTokens,
      searchCalls: aiUsage.searchCalls,
      fetchCalls: aiUsage.fetchCalls,
    })
    .from(creditLedger)
    .leftJoin(aiUsage, eq(creditLedger.usageId, aiUsage.id))
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}

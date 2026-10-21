// Credit 计量（纯函数，前后端和测试共用）。
// 每次 AI 操作先用 UsageMeter 累计 token 和检索/抓取次数，结束时按价格表算出“我们的成本”（美元），
// 再按 creditsPerUsd × markup 换算成要扣的 credit。成本和扣费都记进 ai_usage，方便真实 key 测试后调价。

export const FEATURES = ["chat", "professor_search", "admission_monitor"] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  chat: "AI 对话",
  professor_search: "找教授检索",
  admission_monitor: "募集要项监控（系统）",
};

export const LEDGER_KINDS = ["signup_grant", "admin_grant", "usage", "topup", "refund"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  signup_grant: "注册赠送",
  admin_grant: "管理员发放",
  usage: "使用",
  topup: "充值",
  refund: "退还",
};

/** 价格表，单位美元。token 价格按每百万 token */
export type Pricing = {
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  searchPerCall: number;
  fetchPerCall: number;
  /** 1 美元成本折合多少 credit */
  creditsPerUsd: number;
  /** 在成本上加价的倍数，1 = 按成本收 */
  markup: number;
};

export type UsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  searchCalls: number;
  fetchCalls: number;
};

/** AI SDK 的 LanguageModelUsage 里我们用到的字段 */
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
};

const zero = (): UsageTotals => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searchCalls: 0, fetchCalls: 0 });

export const isEmptyUsage = (u: UsageTotals) => !u.inputTokens && !u.outputTokens && !u.searchCalls && !u.fetchCalls;

/** 一次用户操作的用量累加器。take() 取走尚未结算的部分，可多次调用（流式对话中断后续步骤仍能补扣） */
export class UsageMeter {
  private pending = zero();

  addTokens(usage: TokenUsage | undefined) {
    if (!usage) return;
    this.pending.inputTokens += usage.inputTokens ?? 0;
    this.pending.outputTokens += usage.outputTokens ?? 0;
    this.pending.cachedInputTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0;
  }

  addSearch(n = 1) {
    this.pending.searchCalls += n;
  }

  addFetch(n = 1) {
    this.pending.fetchCalls += n;
  }

  take(): UsageTotals {
    const out = this.pending;
    this.pending = zero();
    return out;
  }
}

/** 我们付给 DeepSeek 的成本（美元）。缓存命中的输入按缓存价，其余按原价 */
export function costUsd(u: UsageTotals, p: Pricing): number {
  const cached = Math.min(u.cachedInputTokens, u.inputTokens);
  const tokens = ((u.inputTokens - cached) * p.inputPerM + cached * p.cachedInputPerM + u.outputTokens * p.outputPerM) / 1_000_000;
  return tokens + u.searchCalls * p.searchPerCall + u.fetchCalls * p.fetchPerCall;
}

/** 成本换算成要扣的 credit：向上取整，有成本时至少 1 */
export function creditsFor(cost: number, p: Pricing): number {
  if (cost <= 0) return 0;
  return Math.max(1, Math.ceil(cost * p.creditsPerUsd * p.markup - 1e-9));
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

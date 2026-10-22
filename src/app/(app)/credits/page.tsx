import { FEATURE_LABELS, LEDGER_KIND_LABELS } from "@/lib/credits";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { getBalance, listLedger } from "@/server/credits";

export const metadata = { title: "Credit · GradNavi" };

const time = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" });

export default async function CreditsPage() {
  const user = await requireUser();
  const balance = await getBalance(user.id);
  const ledger = await listLedger(user.id);
  // 1 credit 约合多少人民币，给用户一个直观感受（按 1 美元 ≈ 7.2 元粗算）
  const pricing = env.PRICING;
  const yuanPer100 = (100 / (pricing.creditsPerUsd * pricing.markup)) * 7.2;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="page-title">Credit</h1>
        <p className="text-sm text-muted">
          AI 对话、找教授检索、联网搜索和读取网页会按实际用量消耗 credit。内测期间注册即赠送，暂不支持充值；用完后请通过「反馈」联系我们补充。
        </p>
      </div>

      <section className="rounded-lg border border-line p-5">
        <p className="text-sm text-muted">当前余额</p>
        <p className={`text-3xl font-semibold tabular-nums ${balance <= 0 ? "text-danger" : ""}`}>{balance.toLocaleString()}</p>
        <p className="mt-2 text-xs text-muted">
          参考：100 credit ≈ {yuanPer100.toFixed(2)} 元的 AI 费用。一次普通对话通常消耗个位数到几十 credit，一次找教授检索约 5–15 credit。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">使用记录</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted">还没有记录。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-normal">时间</th>
                  <th className="py-2 pr-3 font-normal">项目</th>
                  <th className="py-2 pr-3 font-normal">用量</th>
                  <th className="py-2 pr-3 text-right font-normal">变动</th>
                  <th className="py-2 text-right font-normal">余额</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="border-b border-line">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">{time.format(r.createdAt)}</td>
                    <td className="py-2 pr-3">
                      {r.kind === "usage" && r.feature ? FEATURE_LABELS[r.feature] : LEDGER_KIND_LABELS[r.kind]}
                      {r.note && r.kind !== "usage" && <span className="ml-2 text-xs text-muted">{r.note}</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">{r.feature ? usageText(r) : ""}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${r.delta > 0 ? "text-ok" : ""}`}>
                      {r.delta > 0 ? `+${r.delta}` : r.delta}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function usageText(r: { inputTokens: number | null; outputTokens: number | null; searchCalls: number | null; fetchCalls: number | null }) {
  const parts: string[] = [];
  const tokens = (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
  if (tokens) parts.push(`${tokens.toLocaleString()} token`);
  if (r.searchCalls) parts.push(`检索 ${r.searchCalls} 次`);
  if (r.fetchCalls) parts.push(`读网页 ${r.fetchCalls} 次`);
  return parts.join(" · ");
}

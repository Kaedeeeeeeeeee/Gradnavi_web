import { addDays, todayJst } from "@/lib/calendar";
import { FEATURE_LABELS, FEATURES, formatUsd, type Feature } from "@/lib/credits";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { costByFeature, recentUsage, userStats, type CostRow } from "@/server/admin";
import { listFeedback, listInvites } from "@/server/beta";
import { addInvitesAction, grantCreditsAction, removeInviteAction } from "./actions";

export const metadata = { title: "管理 · GradNavi" };

const time = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" });
const input = "input px-2 py-1 text-sm";
const button = "btn px-2 py-1 text-sm";

// 内测管理：我们为每次 AI 调用付出的成本、credit 发放与消耗、邀请名单、反馈。仅 ADMIN_EMAILS 可见
export default async function AdminPage() {
  await requireAdmin();
  const today = todayJst();
  const startOf = (d: string) => new Date(`${d}T00:00:00+09:00`);
  const [costToday, cost7d, costAll, users, usage, invites, feedback] = await Promise.all([
    costByFeature(startOf(today)),
    costByFeature(startOf(addDays(today, -6))),
    costByFeature(),
    userStats(),
    recentUsage(100),
    listInvites(),
    listFeedback(50),
  ]);
  const pricing = env.PRICING;

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <div className="space-y-2">
        <h1 className="page-title">内测管理</h1>
        <p className="text-sm text-muted">
          注册模式：{env.SIGNUP_MODE === "invite" ? "邀请制" : "开放注册"} · 注册赠送 {env.SIGNUP_CREDITS} credit · 成本按下方价格表估算（单位美元），和 DeepSeek
          后台账单核对后可通过环境变量调整
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="section-title">我们的成本</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <CostCard title="今天（日本时间）" rows={costToday} />
          <CostCard title="近 7 天" rows={cost7d} />
          <CostCard title="全部" rows={costAll} />
        </div>
        <p className="text-xs text-muted">
          价格表：输入 ${pricing.inputPerM}/百万 token（缓存命中 ${pricing.cachedInputPerM}）· 输出 ${pricing.outputPerM}/百万 token · 检索 $
          {pricing.searchPerCall}/次 · 读网页 ${pricing.fetchPerCall}/次 · 1 美元 = {pricing.creditsPerUsd} credit × 加价 {pricing.markup}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">用户（{users.length}）</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <Th>邮箱</Th>
                <Th>注册</Th>
                <Th right>余额</Th>
                <Th right>累计获得</Th>
                <Th right>已消耗</Th>
                <Th right>调用次数</Th>
                <Th right>我们的成本</Th>
                <Th>最近使用</Th>
                <Th>发放 credit</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line">
                  <Td>{u.email}</Td>
                  <Td muted>{time.format(u.createdAt)}</Td>
                  <Td right className={(u.balance ?? 0) <= 0 && u.balance !== null ? "text-danger" : ""}>
                    {u.balance ?? "未开户"}
                  </Td>
                  <Td right>{u.granted}</Td>
                  <Td right>{u.credits}</Td>
                  <Td right>{u.calls}</Td>
                  <Td right>{formatUsd(u.costUsd)}</Td>
                  <Td muted>{u.lastUsed ? time.format(new Date(u.lastUsed)) : ""}</Td>
                  <Td>
                    <form action={grantCreditsAction} className="flex gap-1">
                      <input type="hidden" name="userId" value={u.id} />
                      <input name="amount" type="number" step={1} placeholder="数量" required className={`${input} w-20`} />
                      <input name="note" placeholder="备注" className={`${input} w-24`} />
                      <button className={button}>发放</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">邀请名单（{invites.length}）</h2>
        <p className="text-xs text-muted">邀请制下只有名单内的新邮箱（以及 ADMIN_EMAILS）能注册；已注册的用户不受影响。</p>
        <form action={addInvitesAction} className="flex flex-wrap items-start gap-2">
          <textarea name="emails" rows={2} required placeholder="邮箱，可一次粘贴多个（逗号/换行分隔）" className={`${input} w-96`} />
          <input name="note" placeholder="备注（如：在国内、文科）" className={`${input} w-48`} />
          <button className={button}>加入名单</button>
        </form>
        {invites.length > 0 && (
          <ul className="space-y-1 text-sm">
            {invites.map((i) => (
              <li key={i.email} className="flex items-center gap-3">
                <span>{i.email}</span>
                <span className={`text-xs ${i.joined ? "text-ok" : "text-muted"}`}>{i.joined ? "已注册" : "未注册"}</span>
                {i.note && <span className="text-xs text-muted">{i.note}</span>}
                <form action={removeInviteAction}>
                  <input type="hidden" name="email" value={i.email} />
                  <button className="text-xs text-muted hover:text-danger">移除</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="section-title">最近的 AI 调用</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <Th>时间</Th>
                <Th>用户</Th>
                <Th>功能</Th>
                <Th>模型</Th>
                <Th right>输入（缓存）</Th>
                <Th right>输出</Th>
                <Th right>检索</Th>
                <Th right>读网页</Th>
                <Th right>成本</Th>
                <Th right>扣 credit</Th>
              </tr>
            </thead>
            <tbody>
              {usage.map((r) => (
                <tr key={r.id} className="border-b border-line">
                  <Td muted>{time.format(r.createdAt)}</Td>
                  <Td>{r.email ?? "系统"}</Td>
                  <Td>{FEATURE_LABELS[r.feature]}</Td>
                  <Td muted>{r.model}</Td>
                  <Td right>
                    {r.inputTokens.toLocaleString()}
                    {r.cachedInputTokens > 0 && <span className="text-muted">（{r.cachedInputTokens.toLocaleString()}）</span>}
                  </Td>
                  <Td right>{r.outputTokens.toLocaleString()}</Td>
                  <Td right>{r.searchCalls || ""}</Td>
                  <Td right>{r.fetchCalls || ""}</Td>
                  <Td right>{formatUsd(r.costUsd)}</Td>
                  <Td right>{r.credits}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">反馈（最近 {feedback.length} 条）</h2>
        {feedback.length === 0 ? (
          <p className="text-sm text-muted">还没有反馈。</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {feedback.map((f) => (
              <li key={f.id} className="rounded-md border border-line p-3">
                <p className="text-xs text-muted">
                  {time.format(f.createdAt)} · {f.email}
                  {f.page && ` · ${f.page}`}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{f.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CostCard({ title, rows }: { title: string; rows: CostRow[] }) {
  const byFeature = new Map<Feature, CostRow>(rows.map((r) => [r.feature, r]));
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  const credits = rows.reduce((s, r) => s + r.credits, 0);
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-sm text-muted">{title}</p>
      <p className="text-2xl font-semibold tabular-nums">{formatUsd(total)}</p>
      <p className="text-xs text-muted">向用户扣 {credits.toLocaleString()} credit</p>
      <ul className="mt-3 space-y-1 text-xs">
        {FEATURES.map((f) => {
          const r = byFeature.get(f);
          return (
            <li key={f} className="flex justify-between gap-2">
              <span className="text-muted">{FEATURE_LABELS[f]}</span>
              <span className="tabular-nums">
                {r ? `${r.calls} 次 · ${formatUsd(r.costUsd)}` : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`py-2 pr-3 font-normal whitespace-nowrap ${right ? "text-right" : ""}`}>{children}</th>;
}

function Td({ children, right, muted, className = "" }: { children: React.ReactNode; right?: boolean; muted?: boolean; className?: string }) {
  return (
    <td className={`py-2 pr-3 whitespace-nowrap ${right ? "text-right tabular-nums" : ""} ${muted ? "text-muted" : ""} ${className}`}>{children}</td>
  );
}

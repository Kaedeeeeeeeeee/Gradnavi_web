import "server-only";
import type { Pricing } from "./credits";

// `next build` 会加载路由模块，但构建阶段不会真正连库或签名，用占位值即可
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

function required(name: string): string {
  const value = process.env[name];
  if (!value && isBuild) return name === "DATABASE_URL" ? "postgres://build@localhost/build" : "build-placeholder";
  if (!value) throw new Error(`缺少环境变量 ${name}，请参考 .env.example`);
  return value;
}

// 通过 getter 在运行时读取，同一个镜像可用于不同环境
export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get BETTER_AUTH_SECRET() {
    return required("BETTER_AUTH_SECRET");
  },
  get APP_URL() {
    return process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  },
  /** 形如 smtps://user:pass@smtpdm.aliyun.com:465；未设置时验证码只打印到服务器日志 */
  get SMTP_URL() {
    return process.env.SMTP_URL;
  },
  get MAIL_FROM() {
    return process.env.MAIL_FROM ?? "GradNavi <no-reply@localhost>";
  },
  /** 未设置时 AI 使用演示模型（固定回复，不调用 API） */
  get DEEPSEEK_API_KEY() {
    return process.env.DEEPSEEK_API_KEY || undefined;
  },
  get DEEPSEEK_MODEL() {
    return process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  },
  /** 看图片的模型（扫描版募集要项 PDF 转成图片后交给它读） */
  get DEEPSEEK_VISION_MODEL() {
    return process.env.DEEPSEEK_VISION_MODEL || "deepseek-flash";
  },
  get DEEPSEEK_BASE_URL() {
    return process.env.DEEPSEEK_BASE_URL || undefined;
  },
  /** DeepSeek 检索/抓取服务（search、fetch），和对话共用 DEEPSEEK_API_KEY */
  get DEEPSEEK_TOOLS_URL() {
    return process.env.DEEPSEEK_TOOLS_URL || "https://api.deepseek.com/v1/tools";
  },
  // ---- credit 计量（第 6 步）。价格单位美元，⚠️ 默认值按 DeepSeek 公开价估算，接真实 key 后核对 ----
  /** 新用户注册赠送的 credit */
  get SIGNUP_CREDITS() {
    return num("SIGNUP_CREDITS", 3000);
  },
  get PRICING(): Pricing {
    return {
      inputPerM: num("AI_PRICE_INPUT_PER_M", 0.28),
      cachedInputPerM: num("AI_PRICE_CACHED_INPUT_PER_M", 0.028),
      outputPerM: num("AI_PRICE_OUTPUT_PER_M", 0.42),
      searchPerCall: num("SEARCH_PRICE_PER_CALL", 0.00075),
      fetchPerCall: num("FETCH_PRICE_PER_CALL", 0.00075),
      creditsPerUsd: num("CREDITS_PER_USD", 1000),
      markup: num("CREDIT_MARKUP", 1),
    };
  },
  // ---- 内测 ----
  /** 逗号分隔，能打开 /admin 的邮箱；这些邮箱在邀请制下也总能注册 */
  get ADMIN_EMAILS(): string[] {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  /** open = 任何邮箱都能注册；invite = 只有邀请名单内的新邮箱能注册（已注册用户不受影响） */
  get SIGNUP_MODE(): "open" | "invite" {
    return process.env.SIGNUP_MODE === "invite" ? "invite" : "open";
  },
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) throw new Error(`环境变量 ${name} 必须是非负数字`);
  return v;
}

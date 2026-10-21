import "server-only";

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
  get DEEPSEEK_BASE_URL() {
    return process.env.DEEPSEEK_BASE_URL || undefined;
  },
};

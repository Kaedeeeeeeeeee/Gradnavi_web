import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { canSignIn } from "@/server/beta";
import { env } from "./env";
import { sendMail } from "./mail";

const OTP_MINUTES = 10;

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.APP_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 天
    updateAge: 60 * 60 * 24, // 每天续期一次
  },
  hooks: {
    // 内测邀请制：发验证码和用验证码登录前都检查邮箱（SIGNUP_MODE=open 时不限制）
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/email-otp/send-verification-otp" && ctx.path !== "/sign-in/email-otp") return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      if (email && !(await canSignIn(email))) {
        throw new APIError("FORBIDDEN", { message: "GradNavi 正在内测，目前仅限受邀邮箱注册。" });
      }
    }),
  },
  plugins: [
    // 邮箱验证码登录：首次登录即自动注册，无需密码
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_MINUTES * 60,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp }) {
        await sendMail(
          email,
          `GradNavi 登录验证码：${otp}`,
          `你的登录验证码是 ${otp}，${OTP_MINUTES} 分钟内有效。\n\n如果不是你本人操作，请忽略这封邮件。`,
        );
      },
    }),
    nextCookies(), // 必须放在最后
  ],
});

export type Session = typeof auth.$Infer.Session;

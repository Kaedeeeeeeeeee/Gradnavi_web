import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transporter: Transporter | null = null;

export async function sendMail(to: string, subject: string, text: string) {
  if (!env.SMTP_URL) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境未配置 SMTP_URL，无法发送邮件");
    }
    console.info(`[mail:dev] to=${to} subject=${subject}\n${text}`);
    return;
  }
  transporter ??= nodemailer.createTransport(env.SMTP_URL);
  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text });
}

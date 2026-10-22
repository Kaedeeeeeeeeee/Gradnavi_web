"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

const inputClass =
  "input w-full px-3 py-2";
const buttonClass =
  "btn-primary w-full px-3 py-2";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setPending(false);
    if (error) {
      setError(error.status === 429 ? "发送太频繁，请稍后再试" : error.status === 403 && error.message ? error.message : "验证码发送失败，请检查邮箱地址");
      return;
    }
    setStep("otp");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.emailOtp({ email, otp });
    if (error) {
      setPending(false);
      setError("验证码错误或已过期");
      return;
    }
    router.replace(redirectTo);
    router.refresh();
  }

  if (step === "email") {
    return (
      <form onSubmit={sendCode} className="space-y-3">
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
          className={inputClass}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "发送中…" : "获取验证码"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3">
      <p className="text-sm text-muted">
        验证码已发送至 <span className="text-foreground">{email}</span>，10 分钟内有效。没收到请检查垃圾邮件。
      </p>
      <input
        inputMode="numeric"
        required
        autoFocus
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        placeholder="6 位验证码"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
        className={`${inputClass} tracking-widest`}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending || otp.length !== 6} className={buttonClass}>
        {pending ? "登录中…" : "登录"}
      </button>
      <div className="flex justify-between text-sm text-muted">
        <button type="button" onClick={() => { setStep("email"); setOtp(""); setError(null); }}>
          换个邮箱
        </button>
        <button type="button" disabled={pending} onClick={() => sendCode()}>
          重新发送
        </button>
      </div>
    </form>
  );
}

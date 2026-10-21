"use client";

import { useState, useTransition } from "react";
import { submitOnboarding } from "@/app/(app)/actions";
import type { OnboardingAnswers, Question, QuestionKey } from "@/lib/onboarding";

type Answers = Pick<OnboardingAnswers, QuestionKey | "fieldDetail">;

const EMPTY: Answers = { status: "", major: "", field: "humanities", fieldDetail: "", planStatus: "none", targetEntry: "" };

/** 当前是否选的“自己填写”，是的话返回填写内容 */
function otherText(q: Question, answers: Answers): string | null {
  if (!q.other) return null;
  const value = String(answers[q.key] ?? "");
  if (q.other.detailKey) return value === q.other.value ? String(answers[q.other.detailKey] ?? "") : null;
  return value && !q.options.some((o) => o.value === value) ? value : null;
}

function display(q: Question, answers: Answers) {
  const value = String(answers[q.key] ?? "");
  return otherText(q, answers) ?? q.options.find((o) => o.value === value)?.label ?? value;
}

export function OnboardingWizard({ questions }: { questions: Question[] }) {
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [step, setStep] = useState(0);
  // 回头修改某个回答后，直接跳回之前到过的最远一题
  const [reached, setReached] = useState(0);
  // “自己填写”的输入框是否展开、内容
  const [otherOpen, setOtherOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const current = questions[step];
  const done = step >= questions.length;

  function answer(value: string, extra: Partial<Answers> = {}) {
    if (!current) return;
    setAnswers({ ...answers, ...extra, [current.key]: value.trim() });
    const nextStep = Math.max(step + 1, reached);
    setStep(nextStep);
    setReached(nextStep);
    setOtherOpen(false);
    setDraft("");
  }

  function goBack(to: number) {
    setReached(Math.max(reached, step));
    setStep(to);
    const text = otherText(questions[to], answers);
    setOtherOpen(text !== null);
    setDraft(text ?? "");
  }

  function submit() {
    setError("");
    startTransition(async () => {
      try {
        await submitOnboarding(answers);
      } catch (e) {
        // redirect() 会以异常形式抛出，交给 Next.js 处理
        if (e && typeof e === "object" && "digest" in e && String(e.digest).startsWith("NEXT_REDIRECT")) throw e;
        setError("提交失败，请稍后再试");
      }
    });
  }

  return (
    <div className="space-y-4">
      {questions.slice(0, step).map((q, i) => (
        <div key={q.key} className="space-y-1.5">
          <p className="text-sm text-zinc-500">{q.title}</p>
          <button
            onClick={() => goBack(i)}
            title="修改这个回答"
            className="ml-auto block rounded-lg bg-zinc-100 px-3 py-2 text-left text-sm hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            {display(q, answers)}
          </button>
        </div>
      ))}

      {current && (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <p className="font-medium">
              {current.title}
              <span className="ml-2 text-xs font-normal text-zinc-400">
                {step + 1}/{questions.length}
              </span>
            </p>
            {current.hint && <p className="mt-1 text-sm text-zinc-500">{current.hint}</p>}
          </div>

          <div className="grid gap-2">
            {current.options.map((o) => (
              <button
                key={o.value}
                onClick={() => answer(o.value, current.other?.detailKey ? { [current.other.detailKey]: "" } : {})}
                className={`rounded-md border px-3 py-2 text-left text-sm hover:border-zinc-500 ${
                  step < reached && answers[current.key] === o.value ? "border-zinc-500" : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {o.label}
                {o.hint && <span className="block text-xs text-zinc-500">{o.hint}</span>}
              </button>
            ))}
            {current.other &&
              (otherOpen ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const { value, detailKey } = current.other!;
                    const text = draft.trim().slice(0, 100);
                    if (!text) return;
                    if (detailKey) answer(value ?? "other", { [detailKey]: text });
                    else answer(text);
                  }}
                  className="flex gap-2"
                >
                  <input
                    autoFocus
                    value={draft}
                    maxLength={100}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={current.other.placeholder}
                    className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                  />
                  <button type="submit" disabled={!draft.trim()} className="rounded-md bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40">
                    下一步
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setOtherOpen(true)}
                  className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-left text-sm hover:border-zinc-500 dark:border-zinc-700"
                >
                  {current.other.label}
                </button>
              ))}
          </div>
        </div>
      )}

      {done && (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="font-medium">好了。进去后 AI 已经在右边等你，主页上也有第一批任务。</p>
          <p className="text-sm text-zinc-500">想改哪个回答，点一下上面对应的气泡就行。</p>
          <button onClick={submit} disabled={pending} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">
            {pending ? "准备中…" : "开始"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

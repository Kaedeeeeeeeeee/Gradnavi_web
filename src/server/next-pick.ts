import "server-only";
import { generateText } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { nextPick, todo } from "@/db/schema";
import { getChatModel, isDemoMode } from "@/lib/ai/model";
import type { CalendarItem } from "@/lib/calendar";
import { UsageMeter } from "@/lib/credits";
import { calendarText, guardPick, parsePick, pickInputKey, pickPrompt, prepEstimates, rulePick, taskFacts, type NextPick, type PickProfessor } from "@/lib/next-pick";
import type { TaskView } from "@/lib/tasks";
import { assertCanSpend, recordUsageSafe } from "./credits";

// 主页「下一件事」：输入（任务事实、日程、user.md、日期）没变就用存着的结果；变了才让 AI 重新判断，按用量扣 credit。
// 演示模式、credit 用完、AI 出错时用规则结果（不存，下次再试 AI）。

type Input = {
  userId: string;
  today: string;
  userMd: string;
  profileLine: string;
  intakeYear: number | null;
  tasks: TaskView[];
  professors: PickProfessor[];
  calendar: CalendarItem[];
};

/** 同一个用户同时打开两次主页，只判断一次 */
const running = new Map<string, Promise<NextPick | null>>();

export async function getNextPick(input: Input): Promise<NextPick | null> {
  const facts = taskFacts(input.tasks, input.professors);
  if (!facts.some((f) => !f.blockedBy)) return null;
  const calendar = calendarText(input.calendar, input.today, input.intakeYear);
  const key = pickInputKey({ today: input.today, userMd: input.userMd, facts, calendar });

  const [saved] = await db.select().from(nextPick).where(eq(nextPick.userId, input.userId));
  if (saved?.inputKey === key) return saved.pick;
  if (isDemoMode()) return rulePick(facts, input.tasks, input.today);

  const inflight = running.get(input.userId);
  if (inflight) return inflight;
  const job = judge(input, facts, calendar).finally(() => running.delete(input.userId));
  running.set(input.userId, job);
  return job;
}

async function judge(input: Input, facts: ReturnType<typeof taskFacts>, calendar: string): Promise<NextPick | null> {
  const fallback = () => rulePick(facts, input.tasks, input.today);
  try {
    await assertCanSpend(input.userId);
  } catch {
    return fallback();
  }
  const meter = new UsageMeter();
  let text: string;
  try {
    const result = await generateText({ model: getChatModel(), prompt: pickPrompt({ today: input.today, userMd: input.userMd, profileLine: input.profileLine, facts, calendar }) });
    meter.addTokens(result.totalUsage);
    text = result.text;
  } catch (error) {
    console.error("[next-pick] AI 判断失败", input.userId, error);
    return fallback();
  } finally {
    await recordUsageSafe({ userId: input.userId, feature: "next_pick", meter });
  }

  const raw = parsePick(text);
  const pick = guardPick(raw, facts, input.tasks, input.today, calendar);
  if (!pick) return null;

  // 已经扣过费了，AI 的回答不能用（退回规则结果）也存下来，输入没变就不再重试。AI 估的准备天数存回任务上（只补没估过的），存的结果按补完之后的输入记 key，下次打开不会因为这一步又判断一遍
  const prep = prepEstimates(raw, facts);
  for (const [id, days] of Object.entries(prep)) {
    await db
      .update(todo)
      .set({ prepDays: days })
      .where(and(eq(todo.id, id), eq(todo.userId, input.userId), isNull(todo.prepDays)));
  }
  const tasks = input.tasks.map((t) => (prep[t.id] && t.prepDays == null ? { ...t, prepDays: prep[t.id] } : t));
  const key = pickInputKey({ today: input.today, userMd: input.userMd, facts: taskFacts(tasks, input.professors), calendar });
  await db
    .insert(nextPick)
    .values({ userId: input.userId, inputKey: key, pick })
    .onConflictDoUpdate({ target: nextPick.userId, set: { inputKey: key, pick, createdAt: new Date() } });
  return pick;
}

/** 存着的判断结果（任务对话开场时补上理由用） */
export async function getSavedPick(userId: string): Promise<NextPick | null> {
  const [row] = await db.select({ pick: nextPick.pick }).from(nextPick).where(eq(nextPick.userId, userId));
  return row?.pick ?? null;
}

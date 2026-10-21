"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { buildUserMd, openingMessage, type OnboardingAnswers } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { startConversation } from "@/server/conversations";
import { completeOnboarding, getProfile, saveUserMd, undoUserMdChange } from "@/server/profile";

// 用户在页面上的操作。与 AI 工具调用同一套 src/server 函数。

// 新问卷只有 5 道点选题；其余信息之后在聊天里由 AI 记进 user.md
const answersSchema = z.object({
  status: z.string().min(1).max(100),
  major: z.string().min(1).max(100),
  field: z.enum(["humanities", "sciences", "other"]),
  fieldDetail: z.string().max(100).optional(),
  planStatus: z.enum(["none", "rough", "clear"]),
  targetEntry: z.string().min(1).max(100),
});

export async function submitOnboarding(answers: z.input<typeof answersSchema>) {
  const user = await requireUser();
  // 已经做过问卷（包括旧的 13 题问卷）的用户不再重做，档案里的内容由用户和 AI 继续维护
  if ((await getProfile(user.id))?.onboardedAt) redirect("/workbench");
  const parsed = answersSchema.parse(answers);
  if (parsed.field === "other" && !parsed.fieldDetail?.trim()) throw new Error("请填写具体领域");
  const data: OnboardingAnswers = { ...parsed, path: "unsure" };
  await completeOnboarding(user.id, data, buildUserMd(data));
  // AI 栏里的开场消息按模板生成，不调用 AI；主页上的流程任务在加载时按进度生成（src/server/next-steps.ts）
  await startConversation(user.id, openingMessage(data));
  redirect("/workbench");
}

export async function saveProfileMarkdown(markdown: string) {
  const user = await requireUser();
  await saveUserMd(user.id, markdown);
  revalidatePath("/profile");
}

const changeSchema = z.object({
  section: z.string().min(1).max(30),
  before: z.string().max(20_000).nullable(),
  after: z.string().max(20_000),
  content: z.string().max(3000),
});

/** 聊天里「已记住：…」旁边的「撤销」 */
export async function undoMemory(change: z.input<typeof changeSchema>) {
  const user = await requireUser();
  const ok = await undoUserMdChange(user.id, changeSchema.parse(change));
  revalidatePath("/", "layout");
  return ok;
}

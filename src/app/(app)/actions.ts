"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { buildUserMd, type OnboardingAnswers } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { completeOnboarding, saveUserMd } from "@/server/profile";

// 用户在页面上的操作。与 AI 工具调用同一套 src/server 函数。

const answersSchema = z.object({
  status: z.string().min(1).max(100),
  education: z.string().min(1).max(200),
  major: z.string().min(1).max(100),
  gpa: z.string().max(50),
  field: z.enum(["humanities", "sciences", "other"]),
  fieldDetail: z.string().max(100).optional(),
  path: z.enum(["kenkyusei", "master", "doctor", "unsure"]),
  planStatus: z.enum(["none", "rough", "clear"]),
  direction: z.string().max(1000),
  targetSchools: z.string().max(300),
  japanese: z.string().min(1).max(100),
  english: z.string().max(100),
  targetEntry: z.string().min(1).max(100),
  notes: z.string().max(1000),
}) satisfies z.ZodType<OnboardingAnswers>;

export async function submitOnboarding(answers: OnboardingAnswers) {
  const user = await requireUser();
  const data = answersSchema.parse(answers);
  if (data.field === "other" && !data.fieldDetail?.trim()) throw new Error("请填写具体领域");
  await completeOnboarding(user.id, data, buildUserMd(data));
  // 主页上的流程任务在加载时按进度生成（src/server/next-steps.ts）
  redirect("/workbench");
}

export async function saveProfileMarkdown(markdown: string) {
  const user = await requireUser();
  await saveUserMd(user.id, markdown);
  revalidatePath("/profile");
}

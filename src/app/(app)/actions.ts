"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { buildRoadmap, buildUserMd, type OnboardingAnswers } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { completeOnboarding, getProfile, saveUserMd } from "@/server/profile";
import { addTodos, deleteTodo, updateTodo } from "@/server/todos";

// 用户在页面上的操作。与 AI 工具调用同一套 src/server 函数。

const answersSchema = z.object({
  status: z.string().min(1).max(100),
  education: z.string().min(1).max(200),
  major: z.string().min(1).max(100),
  gpa: z.string().max(50),
  field: z.enum(["humanities", "sciences"]),
  path: z.enum(["kenkyusei", "master", "doctor", "unsure"]),
  planStatus: z.enum(["none", "rough", "clear"]),
  direction: z.string().max(1000),
  targetSchools: z.string().max(300),
  japanese: z.string().min(1).max(100),
  english: z.string().max(100),
  targetEntry: z.string().min(1).max(20),
  notes: z.string().max(1000),
}) satisfies z.ZodType<OnboardingAnswers>;

export async function submitOnboarding(answers: OnboardingAnswers) {
  const user = await requireUser();
  const data = answersSchema.parse(answers);
  const firstTime = !(await getProfile(user.id))?.onboardedAt;
  await completeOnboarding(user.id, data, buildUserMd(data));
  // 重新填写问卷时不重复生成路线图
  if (firstTime) await addTodos(user.id, buildRoadmap(data), "system");
  redirect("/workbench");
}

export async function saveProfileMarkdown(markdown: string) {
  const user = await requireUser();
  await saveUserMd(user.id, markdown);
  revalidatePath("/profile");
}

export async function addTodoAction(title: string) {
  const user = await requireUser();
  const t = title.trim();
  if (!t) return;
  await addTodos(user.id, [{ title: t.slice(0, 100) }], "user");
  revalidatePath("/workbench");
}

export async function toggleTodoAction(id: string, done: boolean) {
  const user = await requireUser();
  await updateTodo(user.id, id, { done });
  revalidatePath("/workbench");
}

export async function deleteTodoAction(id: string) {
  const user = await requireUser();
  await deleteTodo(user.id, id);
  revalidatePath("/workbench");
}

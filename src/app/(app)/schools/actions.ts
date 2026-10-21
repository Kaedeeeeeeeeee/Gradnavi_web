"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { requestSchoolCheck, unwatchSchool, watchSchool } from "@/server/schools";

// 目标研究科页面上的用户操作。与 AI 工具调用同一套 src/server 函数。

const watchSchema = z.object({
  university: z.string().trim().min(1, "请填写大学").max(100),
  name: z.string().trim().min(1, "请填写研究科").max(100),
  url: z.string().trim().url("请填写完整网址（https://…）").max(500),
});

export async function watchSchoolAction(input: z.input<typeof watchSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = watchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "输入有误" };
  try {
    await watchSchool(user.id, parsed.data);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "关注失败" };
  }
  revalidatePath("/schools");
  return { ok: true };
}

export async function unwatchSchoolAction(schoolId: string) {
  const user = await requireUser();
  await unwatchSchool(user.id, schoolId);
  revalidatePath("/schools");
}

export async function checkNowAction(schoolId: string) {
  const user = await requireUser();
  await requestSchoolCheck(user.id, schoolId);
  revalidatePath("/schools");
}

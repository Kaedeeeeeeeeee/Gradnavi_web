"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { requestSchoolCheck, unwatchSchool, watchSchool } from "@/server/schools";

// 志愿里研究科的用户操作（从研究科开始的志愿、立即检查、取消关注）。与 AI 工具调用同一套 src/server 函数。

const refresh = () => revalidatePath("/", "layout");

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
  refresh();
  return { ok: true };
}

export async function unwatchSchoolAction(schoolId: string) {
  const user = await requireUser();
  await unwatchSchool(user.id, schoolId);
  refresh();
}

export async function checkNowAction(schoolId: string) {
  const user = await requireUser();
  await requestSchoolCheck(user.id, schoolId);
  refresh();
}

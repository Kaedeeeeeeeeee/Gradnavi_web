"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CALENDAR_KINDS } from "@/lib/calendar";
import { requireUser } from "@/lib/session";
import { addCalendarEvent, deleteCalendarEvent } from "@/server/calendar";

// 日历页面上的用户操作。与 AI 工具调用同一套 src/server 函数。

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不对");

const eventSchema = z.object({
  title: z.string().trim().min(1, "请填写标题").max(100),
  date,
  endDate: date.or(z.literal("")).optional(),
  kind: z.enum(CALENDAR_KINDS),
  note: z.string().trim().max(500).optional(),
});

export async function addEventAction(input: z.input<typeof eventSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "输入有误" };
  try {
    await addCalendarEvent(user.id, parsed.data, "user");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "添加失败" };
  }
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteEventAction(id: string) {
  const user = await requireUser();
  await deleteCalendarEvent(user.id, id);
  revalidatePath("/calendar");
}

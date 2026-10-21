"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { parseEmails } from "@/lib/beta";
import { addInvites, removeInvite } from "@/server/beta";
import { adjustCredits } from "@/server/credits";

// 管理员操作（内测期间）：发放 credit、管理邀请名单

export async function grantCreditsAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const amount = Number(formData.get("amount"));
  if (!userId || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) return;
  const note = String(formData.get("note") ?? "").trim().slice(0, 200) || `由 ${admin.email} 发放`;
  await adjustCredits(userId, amount, "admin_grant", note);
  revalidatePath("/admin");
}

export async function addInvitesAction(formData: FormData) {
  const admin = await requireAdmin();
  const emails = parseEmails(String(formData.get("emails") ?? ""));
  const note = String(formData.get("note") ?? "").trim().slice(0, 200) || null;
  await addInvites(emails, note, admin.email);
  revalidatePath("/admin");
}

export async function removeInviteAction(formData: FormData) {
  await requireAdmin();
  await removeInvite(String(formData.get("email") ?? ""));
  revalidatePath("/admin");
}

"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { addFeedback } from "@/server/beta";

export async function sendFeedbackAction(formData: FormData) {
  const user = await requireUser();
  const message = String(formData.get("message") ?? "").trim().slice(0, 5000);
  const page = String(formData.get("page") ?? "").slice(0, 200) || null;
  if (!message) redirect("/feedback");
  await addFeedback(user.id, message, page);
  redirect("/feedback?sent=1");
}

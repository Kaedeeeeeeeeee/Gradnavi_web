import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProfile } from "@/db/schema";
import { getSection, listSections, undoSectionChange, upsertSection, type SectionChange } from "@/lib/md-sections";
import type { OnboardingAnswers } from "@/lib/onboarding";

// user.md 的读写。页面（用户）和 AI 工具都走这里，保证两边行为一致。

const MAX_LENGTH = 20_000;

export async function getProfile(userId: string) {
  const [row] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
  return row ?? null;
}

export async function getUserMd(userId: string) {
  return (await getProfile(userId))?.markdown ?? "";
}

export async function saveUserMd(userId: string, markdown: string) {
  if (markdown.length > MAX_LENGTH) throw new Error(`user.md 不能超过 ${MAX_LENGTH} 字`);
  await db
    .insert(userProfile)
    .values({ userId, markdown })
    .onConflictDoUpdate({ target: userProfile.userId, set: { markdown, updatedAt: new Date() } });
}

/** 改 user.md 的某一节，返回新全文和这一节的前后内容（聊天里的「撤销」用） */
export async function updateUserMdSection(userId: string, heading: string, content: string, mode: "replace" | "append") {
  const md = await getUserMd(userId);
  const before = listSections(md).includes(heading.trim()) ? getSection(md, heading) : null;
  const next = upsertSection(md, heading, content, mode);
  await saveUserMd(userId, next);
  const change: SectionChange = { section: heading.trim(), before, after: getSection(next, heading), content };
  return { markdown: next, change };
}

/** 撤销 AI 记下的一条信息。这条已经不在档案里（撤销过、或用户自己改掉了）时返回 false */
export async function undoUserMdChange(userId: string, change: SectionChange) {
  const next = undoSectionChange(await getUserMd(userId), change);
  if (next === null) return false;
  await saveUserMd(userId, next);
  return true;
}

export async function completeOnboarding(userId: string, answers: OnboardingAnswers, markdown: string) {
  const now = new Date();
  await db
    .insert(userProfile)
    .values({ userId, markdown, onboarding: answers, onboardedAt: now })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: { markdown, onboarding: answers, onboardedAt: now, updatedAt: now },
    });
}

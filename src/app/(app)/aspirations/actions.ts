"use server";

import { revalidatePath } from "next/cache";
import { candidateKey } from "@/lib/professors";
import { requireUser } from "@/lib/session";
import { getUserMd, saveUserMd, updateUserMdSection } from "@/server/profile";
import { getProfessorSearch, rejectCandidate, undoRejectCandidate } from "@/server/professor-search";
import { saveProfessor } from "@/server/professors";

// 找教授候选卡片上的操作：加入志愿 / 不合适（原因记进 user.md，下次找得更准）。
// 候选信息从服务器保存的检索结果里取，不信任页面传来的内容。

const refresh = () => revalidatePath("/", "layout");

/** user.md 里记录「不合适」的那一节，AI 找教授时会读到 */
const PREFERENCE_SECTION = "找教授偏好";

const rejectLine = (c: { name: string; university: string }, reason: string) => `- 不考虑 ${c.name}（${c.university}）：${reason.trim() || "没说原因"}`;

export async function addCandidateAction(searchId: string, key: string) {
  const user = await requireUser();
  const search = await getProfessorSearch(user.id, searchId);
  const c = search?.candidates.find((x) => candidateKey(x) === key);
  if (!c) throw new Error("找不到这位候选教授");
  const row = await saveProfessor(user.id, c);
  // 之前点过「不合适」又改主意了：撤掉记录
  if (search!.rejected[key] !== undefined) await undoReject(user.id, searchId, key);
  refresh();
  return { id: row.id, name: row.name, university: row.university, schoolLinked: !!row.schoolId };
}

export async function rejectCandidateAction(searchId: string, key: string, reason: string) {
  const user = await requireUser();
  const c = await rejectCandidate(user.id, searchId, key, reason);
  if (c) await updateUserMdSection(user.id, PREFERENCE_SECTION, rejectLine(c, reason.slice(0, 200)), "append");
  refresh();
}

async function undoReject(userId: string, searchId: string, key: string) {
  const search = await getProfessorSearch(userId, searchId);
  const c = search?.candidates.find((x) => candidateKey(x) === key);
  await undoRejectCandidate(userId, searchId, key);
  if (!c) return;
  const prefix = `- 不考虑 ${c.name}（${c.university}）：`;
  const md = await getUserMd(userId);
  const next = md
    .split("\n")
    .filter((l) => !l.startsWith(prefix))
    .join("\n");
  if (next !== md) await saveUserMd(userId, next);
}

export async function undoRejectAction(searchId: string, key: string) {
  const user = await requireUser();
  await undoReject(user.id, searchId, key);
  refresh();
}

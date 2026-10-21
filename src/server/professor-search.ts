import "server-only";
import { generateText } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { professorSearch } from "@/db/schema";
import { getChatModel, isDemoMode } from "@/lib/ai/model";
import {
  buildPaperQueries,
  buildSearchQueries,
  candidateCount,
  candidateKey,
  demoCandidates,
  mergePaperReply,
  parseCandidates,
  type ProfessorCandidate,
  type SearchInput,
} from "@/lib/professors";
import type { UsageMeter } from "@/lib/credits";
import type { SearchResult } from "@/lib/search";
import { webSearch } from "./search";

// 找教授：按方向 + 目标校检索 researchmap、大学官网、KAKEN 等，再让 AI 整理成教授候选清单；
// 然后每位候选单独再搜一次论文（教员名单页上通常没有论文），让 AI 挑出近期论文、改写「为什么适合」。
// 共两次 AI 调用；来源和论文链接必须来自检索结果（见 parseCandidates / mergePaperReply），防止编造教授和论文。
// 在对话里找：AI 调 search_professors，每一轮结果存进 professor_search，在文稿栏以候选卡片显示；用户说「更偏应用」AI 就再搜一轮。

export type ProfessorSearchResult = { candidates: ProfessorCandidate[]; demo: boolean; searched: number };

const PER_QUERY = 8;
const MAX_RESULTS_FOR_AI = 40;
const PAPER_PER_QUERY = 6;
const PAPER_RESULTS_PER_CANDIDATE = 10;

const NO_FIELD_NAMES = "- 给用户看的文字（research、fit、acceptsInternational）是写给用户的自然中文：不要提 JSON 字段名（papers、sources 等）、不要写「null」「为空」「检索结果里没有」这类话，查不到的就不提。";

function formatResults(results: SearchResult[]) {
  return results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}${r.date ? `\n日期: ${r.date}` : ""}\n${r.snippet}`).join("\n\n");
}

function userContext(input: SearchInput) {
  return `研究方向：${input.keywords}
目标校：${input.schools.join("、") || "不限"}
学科：${input.field === "sciences" ? "理科" : input.field === "humanities" ? "文科" : "未指定"}
${input.preference ? `用户追加的要求：${input.preference}\n` : ""}${input.profile ? `\n用户档案摘要（user.md，含用户说过不合适的教授和原因，请避开同类）：\n${input.profile}\n` : ""}`;
}

function buildPrompt(input: SearchInput, results: SearchResult[], count: number) {
  return `用户想申请日本大学院，正在找导师。
${userContext(input)}
下面是检索结果。请从中找出与研究方向相关、在目标校任职、能指导研究生的教员（教授、准教授、讲师），最多 ${count} 位（用户要的就是这么多，不要多给），按适合程度排序。

要求：
- 只根据检索结果写，不要补充检索结果里没有的信息；查不到的字段留空（null）。
- name 用检索结果里的写法（日文汉字姓名），university 写大学名，department 写研究科・専攻。
- research 用简体中文写 1–2 句研究方向摘要。
- fit 用简体中文写 1–2 句「为什么适合这位用户」，结合研究方向说明和用户方向的关联；也说明不太合适的地方（如偏理论、偏应用）。
- papers 列检索结果里出现过的近两三年论文或著作，最多 3 篇，每篇 {"title":"","year":2025,"url":null}；url 只能填上面检索结果里逐字出现的 URL，没有就 null；一篇都没有就给空数组（之后会单独再搜论文）。
- acceptsInternational：检索结果里明确提到是否接收留学生、有没有研究生（研究生=旁听生）制度时用中文简述，否则 null。
- sources 填支撑该教员信息的检索结果 URL（必须逐字来自上面的 URL）。
${NO_FIELD_NAMES}

只输出 JSON，格式：
{"candidates":[{"name":"","university":"","department":null,"lab":null,"research":"","fit":"","papers":[{"title":"","year":null,"url":null}],"acceptsInternational":null,"sources":[""]}]}

检索结果：
${formatResults(results)}`;
}

function buildPaperPrompt(input: SearchInput, candidates: ProfessorCandidate[], results: SearchResult[][]) {
  const blocks = candidates
    .map(
      (c, i) => `## 候选 ${i + 1}：${c.name}（${[c.university, c.department].filter(Boolean).join(" ")}）
研究方向：${c.research || "未知"}
${results[i].length ? formatResults(results[i]) : "（没有检索结果）"}`,
    )
    .join("\n\n");
  return `用户想申请日本大学院，正在找导师。
${userContext(input)}
下面是每位候选教员单独检索论文的结果。请为每位候选：
- papers：挑出确实是这位教员（同名同校）的近两三年论文或著作，最多 3 篇，越新越好，每篇 {"title":"","year":2025,"url":null}。title 用原文；url 只能填该候选检索结果里逐字出现的 URL（论文页、researchmap 业绩页、CiNii、KAKEN 等），没有就 null。拿不准是不是本人的不要写；一篇都找不到就给空数组。
- fit：用简体中文写 1–2 句「为什么适合这位用户」，具体引用其中的论文（写论文主题，不用写全标题）说明和用户方向的关联；也说明不太合适的地方。找不到论文时根据研究方向写。
${NO_FIELD_NAMES}

只输出 JSON，index 是候选编号：
{"candidates":[{"index":1,"papers":[{"title":"","year":null,"url":null}],"fit":""}]}

${blocks}`;
}

/** 每位候选单独搜论文，再用一次 AI 调用挑出近期论文、改写 fit。失败时保留第一轮结果 */
async function addRecentPapers(input: SearchInput, candidates: ProfessorCandidate[], meter?: UsageMeter): Promise<ProfessorCandidate[]> {
  if (!candidates.length) return candidates;
  const perCandidate = await Promise.all(
    candidates.map(async (c) => {
      const settled = await Promise.allSettled(buildPaperQueries(c).map((q) => webSearch(q, PAPER_PER_QUERY, meter)));
      return dedupe(settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))).slice(0, PAPER_RESULTS_PER_CANDIDATE);
    }),
  );
  if (!perCandidate.some((r) => r.length)) return candidates;
  try {
    const { text, totalUsage } = await generateText({ model: getChatModel(), prompt: buildPaperPrompt(input, candidates, perCandidate) });
    meter?.addTokens(totalUsage);
    return mergePaperReply(
      text,
      candidates,
      perCandidate.flat().map((r) => ({ title: r.title, url: r.url })),
    );
  } catch (error) {
    console.warn("[professor-search] 论文检索失败", error);
    return candidates;
  }
}

function dedupe(results: SearchResult[]) {
  const seen = new Set<string>();
  return results.filter((r) => !seen.has(r.url) && !!seen.add(r.url));
}

/** meter：记录检索次数和 token，调用方负责结算（recordUsage） */
export async function searchProfessors(input: SearchInput, meter?: UsageMeter): Promise<ProfessorSearchResult> {
  if (isDemoMode()) return { candidates: demoCandidates(input).slice(0, candidateCount(input)), demo: true, searched: 0 };

  const count = candidateCount(input);
  const queries = buildSearchQueries(input);
  const settled = await Promise.allSettled(queries.map((q) => webSearch(q, PER_QUERY, meter)));
  const results = dedupe(settled.flatMap((s) => (s.status === "fulfilled" ? s.value : [])));
  if (!results.length) {
    const failed = settled.find((s) => s.status === "rejected");
    if (failed) throw failed.reason;
    return { candidates: [], demo: false, searched: queries.length };
  }

  const top = results.slice(0, MAX_RESULTS_FOR_AI);
  const { text, totalUsage } = await generateText({ model: getChatModel(), prompt: buildPrompt(input, top, count) });
  meter?.addTokens(totalUsage);
  const candidates = parseCandidates(
    text,
    top.map((r) => ({ title: r.title, url: r.url })),
    count,
  );
  return { candidates: await addRecentPapers(input, candidates, meter), demo: false, searched: queries.length + candidates.flatMap(buildPaperQueries).length };
}

export type SearchRow = typeof professorSearch.$inferSelect;

/** 检索并保存这一轮结果（文稿栏的候选卡片读这里） */
export async function runProfessorSearch(userId: string, input: SearchInput, meter?: UsageMeter) {
  const result = await searchProfessors(input, meter);
  const [row] = await db
    .insert(professorSearch)
    .values({
      id: crypto.randomUUID(),
      userId,
      keywords: input.keywords.trim(),
      schools: input.schools,
      preference: input.preference?.trim() || null,
      candidates: result.candidates,
      demo: result.demo,
    })
    .returning();
  return { ...result, searchId: row.id };
}

export async function getProfessorSearch(userId: string, id: string): Promise<SearchRow | null> {
  const [row] = await db
    .select()
    .from(professorSearch)
    .where(and(eq(professorSearch.id, id), eq(professorSearch.userId, userId)));
  return row ?? null;
}

export async function latestProfessorSearch(userId: string): Promise<SearchRow | null> {
  const [row] = await db.select().from(professorSearch).where(eq(professorSearch.userId, userId)).orderBy(desc(professorSearch.createdAt)).limit(1);
  return row ?? null;
}

/** 用户点「不合适」：记在这一轮结果里；原因写进 user.md 由调用方处理 */
export async function rejectCandidate(userId: string, id: string, key: string, reason: string) {
  const row = await getProfessorSearch(userId, id);
  if (!row) throw new Error("找不到这次检索结果");
  await db
    .update(professorSearch)
    .set({ rejected: { ...row.rejected, [key]: reason.trim().slice(0, 200) } })
    .where(eq(professorSearch.id, id));
  return row.candidates.find((c) => candidateKey(c) === key) ?? null;
}

export async function undoRejectCandidate(userId: string, id: string, key: string) {
  const row = await getProfessorSearch(userId, id);
  if (!row) return;
  const rest = { ...row.rejected };
  delete rest[key];
  await db.update(professorSearch).set({ rejected: rest }).where(eq(professorSearch.id, id));
}

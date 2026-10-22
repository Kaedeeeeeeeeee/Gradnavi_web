import "server-only";
import { generateText } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { professorSearch } from "@/db/schema";
import { getChatModel, isDemoMode } from "@/lib/ai/model";
import {
  buildAdmissionQuery,
  buildMoreQueries,
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
import { fetchPage, webSearch } from "./search";

// 找教授：按方向 + 目标校检索 researchmap、大学官网、KAKEN 等，再让 AI 整理成教授候选清单；
// 然后每位候选单独再检索一次（论文、researchmap、KAKEN、研究室主页，读一下 researchmap 个人页，再加所在研究科的招生页），
// 让 AI 挑出近期论文、改写「为什么适合」，补上职位、链接、科研费课题、留学生情况、联系方式、事前联系规定。
// 共两次 AI 调用；来源和链接必须来自检索结果（见 parseCandidates / mergePaperReply），防止编造教授、论文和链接。
// 在对话里找：AI 调 search_professors，每一轮结果存进 professor_search，在文稿栏以候选卡片显示；用户说「更偏应用」AI 就再搜一轮。

export type ProfessorSearchResult = { candidates: ProfessorCandidate[]; demo: boolean; searched: number };

const PER_QUERY = 8;
const MAX_RESULTS_FOR_AI = 40;
const PAPER_PER_QUERY = 6;
const PAPER_RESULTS_PER_CANDIDATE = 14;
const ADMISSION_PER_QUERY = 4;
/** researchmap 个人页、大学教员页各读多少字 */
const PROFILE_PAGE_LIMIT = 6000;

const NO_FIELD_NAMES = "- 给用户看的文字（research、fit、acceptsInternational 等）是写给用户的自然中文：不要提 JSON 字段名（papers、sources 等）、不要写「null」「为空」「检索结果里没有」这类话，查不到的就不提。";

function formatResults(results: SearchResult[]) {
  return results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}${r.date ? `\n日期: ${r.date}` : ""}\n${r.snippet}`).join("\n\n");
}

function userContext(input: SearchInput) {
  return `研究方向：${input.keywords}
目标校：${input.schools.join("、") || "不限"}
学科：${input.field === "sciences" ? "理科" : input.field === "humanities" ? "文科" : "未指定"}
${input.preference ? `用户追加的要求：${input.preference}\n` : ""}${input.profile ? `\n用户档案摘要（user.md，含用户说过不合适的教授和原因，请避开同类）：\n${input.profile}\n` : ""}`;
}

function buildPrompt(input: SearchInput, results: SearchResult[], count: number, exclude: ProfessorCandidate[]) {
  return `用户想申请日本大学院，正在找导师。
${userContext(input)}
下面是检索结果。请从中找出与研究方向相关、在目标校任职、能指导研究生的教员（教授、准教授、讲师），${count} 位（用户要的就是这么多：符合条件的尽量给满，但不要多给，也不要硬凑不相关的人），按适合程度排序。${
    exclude.length ? `\n已经选出的这几位不要再列：${exclude.map((c) => `${c.name}（${c.university}）`).join("、")}` : ""
  }

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

type FetchedPage = { url: string; content: string };
type CandidateSources = { results: SearchResult[]; pages: FetchedPage[]; admission: SearchResult[] };

function buildPaperPrompt(input: SearchInput, candidates: ProfessorCandidate[], sources: CandidateSources[]) {
  const blocks = candidates
    .map((c, i) => {
      const { results, pages, admission } = sources[i];
      return `## 候选 ${i + 1}：${c.name}（${[c.university, c.department].filter(Boolean).join(" ")}）
研究方向：${c.research || "未知"}
${results.length ? formatResults(results) : "（没有检索结果）"}${pages.map((p) => `\n\n### 页面全文 ${p.url}\n${p.content}`).join("")}${
        admission.length ? `\n\n### 所在研究科的入试页检索结果\n${formatResults(admission)}` : ""
      }`;
    })
    .join("\n\n");
  return `用户想申请日本大学院，正在找导师。
${userContext(input)}
下面是每位候选教员单独检索的结果（论文、researchmap、KAKEN、研究室主页、所在研究科的入试页）。请为每位候选整理：
- papers：挑出确实是这位教员（同名同校）的近两三年论文或著作，最多 3 篇，越新越好，每篇 {"title":"","year":2025,"url":null}。title 用原文；url 只能填该候选检索结果里逐字出现的 URL，没有就 null。拿不准是不是本人的不要写；一篇都找不到就给空数组。
- fit：用简体中文写 1–2 句「为什么适合这位用户」，具体引用其中的论文（写论文主题，不用写全标题）说明和用户方向的关联；也说明不太合适的地方。找不到论文时根据研究方向写。
- position：职位，用中文写「教授」「准教授」「讲师」「助教」「特任教授」等；查不到 null。
- links：{"researchmap":null,"lab":null,"homepage":null,"kaken":null,"admission":null}，分别是 researchmap 个人页、研究室主页、个人主页、KAKEN 研究者页或课题页、所在研究科的入试/募集要项页。只能填上面检索结果或 researchmap 个人页里逐字出现的 URL，没有就 null；不要拼凑网址。
- birthYear：来源里明确写了出生年时填西历年份（数字），否则 null。不要根据学历推算。
- retirementNote：来源里明确提到退休/定年（如「2027年3月定年退職予定」「名誉教授」）时用中文简述，否则 null。
- grants：近年（越新越好）作为代表者的科研费（KAKEN）课题，最多 3 个，每个 {"title":"课题名原文","years":"2023–2026","url":null}；url 规则同上。没有就空数组。
- acceptsInternational：明确提到是否接收留学生、有没有研究生（研究生=旁听生）制度时用中文简述，否则 null。
- chineseStudents：研究室成员页等明确写了有中国留学生（或人数）时用中文简述，否则 null。不要根据姓名猜。
- contact：公开的联系方式（页面上写的邮箱、联系表单、「请先联系研究科教务」等），用中文简述并保留邮箱原文；没有 null。
- contactRule：所在研究科对「出愿前要不要联系指导教员」的规定（如「出願前に指導予定教員の内諾が必要」），用中文简述；入试页结果里没提到 null。
- photo：「页面全文」里能确认是这位教员本人的照片时填 {"url":"图片网址","source":"照片所在页面的网址"}；图片网址必须逐字出现在该页面全文里（researchmap 头像、大学或研究室主页上的本人照片），拿不准是不是本人（合影、logo、别人的照片）就 null。
- 只根据给出的内容写，不要补充没有的信息。
${NO_FIELD_NAMES}

只输出 JSON，index 是候选编号：
{"candidates":[{"index":1,"papers":[{"title":"","year":null,"url":null}],"fit":"","position":null,"links":{"researchmap":null,"lab":null,"homepage":null,"kaken":null,"admission":null},"birthYear":null,"retirementNote":null,"grants":[],"acceptsInternational":null,"chineseStudents":null,"contact":null,"contactRule":null,"photo":null}]}

${blocks}`;
}

const RESEARCHMAP_PROFILE = /^https:\/\/researchmap\.jp\/[^/?#]+\/?$/;
const RESEARCHMAP_PAGES = /^https:\/\/researchmap\.jp\/(researchers|search|community|public|achievements)\/?$/;

/**
 * 读两页全文：researchmap 个人页（职位、科研费、主页链接、头像都在上面，检索摘要里常常没有），
 * 和标题里有教员姓名的大学页面（教员介绍 / 研究室主页，常有本人照片和联系方式）
 */
async function readPages(c: ProfessorCandidate, results: SearchResult[], meter?: UsageMeter): Promise<FetchedPage[]> {
  const name = c.name.replace(/[\s　]/g, "");
  const surname = c.name.trim().split(/[\s　]/)[0];
  const profile = results.find((r) => RESEARCHMAP_PROFILE.test(r.url) && !RESEARCHMAP_PAGES.test(r.url))?.url;
  const official = results.find((r) => {
    try {
      return new URL(r.url).hostname.endsWith(".ac.jp") && !/\.pdf($|\?)/i.test(r.url) && (r.title.replace(/[\s　]/g, "").includes(name) || r.title.includes(surname));
    } catch {
      return false;
    }
  })?.url;
  const urls = [profile, official].filter((u): u is string => !!u);
  const pages = await Promise.all(
    urls.map((url) =>
      fetchPage(url, meter, PROFILE_PAGE_LIMIT).catch((error) => {
        console.warn(`[professor-search] 页面读取失败 ${url}`, error);
        return null;
      }),
    ),
  );
  return pages.filter((p): p is FetchedPage => !!p);
}

/** 每位候选单独检索（论文、KAKEN、研究室、研究科招生页），再用一次 AI 调用整理。失败时保留第一轮结果 */
async function addRecentPapers(input: SearchInput, candidates: ProfessorCandidate[], meter?: UsageMeter): Promise<ProfessorCandidate[]> {
  if (!candidates.length) return candidates;
  const admissionQueries = [...new Set(candidates.flatMap((c) => buildAdmissionQuery(c) ?? []))];
  const [perCandidate, admissionResults] = await Promise.all([
    Promise.all(
      candidates.map(async (c) => {
        const settled = await Promise.allSettled(buildPaperQueries(c).map((q) => webSearch(q, PAPER_PER_QUERY, meter)));
        const results = dedupe(settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))).slice(0, PAPER_RESULTS_PER_CANDIDATE);
        return { results, pages: await readPages(c, results, meter) };
      }),
    ),
    Promise.all(admissionQueries.map((q) => webSearch(q, ADMISSION_PER_QUERY, meter).catch(() => [] as SearchResult[]))),
  ]);
  const admissionBy = new Map(admissionQueries.map((q, i) => [q, admissionResults[i]]));
  const sources: CandidateSources[] = candidates.map((c, i) => ({ ...perCandidate[i], admission: admissionBy.get(buildAdmissionQuery(c) ?? "") ?? [] }));
  if (!sources.some((s) => s.results.length || s.admission.length)) return candidates;
  try {
    const { text, totalUsage } = await generateText({ model: getChatModel(), prompt: buildPaperPrompt(input, candidates, sources) });
    meter?.addTokens(totalUsage);
    return mergePaperReply(
      text,
      candidates,
      sources.flatMap((s) => [...s.results, ...s.admission]).map((r) => ({ title: r.title, url: r.url })),
      sources.flatMap((s) => s.pages.map((p) => p.content)),
    );
  } catch (error) {
    console.warn("[professor-search] 单独检索整理失败", error);
    return candidates;
  }
}

function dedupe(results: SearchResult[]) {
  const seen = new Set<string>();
  return results.filter((r) => !seen.has(r.url) && !!seen.add(r.url));
}

async function searchAll(queries: string[], meter?: UsageMeter) {
  const settled = await Promise.allSettled(queries.map((q) => webSearch(q, PER_QUERY, meter)));
  const results = dedupe(settled.flatMap((s) => (s.status === "fulfilled" ? s.value : [])));
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  return { results, failed };
}

async function pickCandidates(input: SearchInput, results: SearchResult[], count: number, exclude: ProfessorCandidate[], meter?: UsageMeter) {
  const top = results.slice(0, MAX_RESULTS_FOR_AI);
  const { text, totalUsage } = await generateText({ model: getChatModel(), prompt: buildPrompt(input, top, count, exclude) });
  meter?.addTokens(totalUsage);
  const taken = new Set(exclude.map(candidateKey));
  return parseCandidates(
    text,
    top.map((r) => ({ title: r.title, url: r.url })),
    count + exclude.length,
  )
    .filter((c) => !taken.has(candidateKey(c)))
    .slice(0, count);
}

/**
 * meter：记录检索次数和 token，调用方负责结算（recordUsage）。
 * 第一轮凑不够用户要的人数时，换一组更宽的检索词再找一次（只补差的人数）。
 */
export async function searchProfessors(input: SearchInput, meter?: UsageMeter): Promise<ProfessorSearchResult> {
  if (isDemoMode()) return { candidates: demoCandidates(input).slice(0, candidateCount(input)), demo: true, searched: 0 };

  const count = candidateCount(input);
  const queries = buildSearchQueries(input);
  const first = await searchAll(queries, meter);
  let searched = queries.length;
  let candidates = first.results.length ? await pickCandidates(input, first.results, count, [], meter) : [];

  if (candidates.length < count) {
    const more = buildMoreQueries(input);
    const second = await searchAll(more, meter);
    searched += more.length;
    const seen = new Set(first.results.map((r) => r.url));
    const fresh = [...second.results.filter((r) => !seen.has(r.url)), ...first.results];
    if (second.results.length) candidates = [...candidates, ...(await pickCandidates(input, fresh, count - candidates.length, candidates, meter))];
    if (!first.results.length && !second.results.length && (first.failed || second.failed)) throw (first.failed ?? second.failed)!.reason;
  }

  searched += candidates.flatMap(buildPaperQueries).length + new Set(candidates.flatMap((c) => buildAdmissionQuery(c) ?? [])).size;
  return { candidates: await addRecentPapers(input, candidates, meter), demo: false, searched };
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

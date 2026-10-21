import "server-only";
import { generateText } from "ai";
import { getChatModel, isDemoMode } from "@/lib/ai/model";
import { buildSearchQueries, demoCandidates, MAX_CANDIDATES, parseCandidates, type ProfessorCandidate, type SearchInput } from "@/lib/professors";
import type { SearchResult } from "@/lib/search";
import { webSearch } from "./search";

// 找教授：按方向 + 目标校检索 researchmap、大学官网、KAKEN 等，再让 AI 整理成教授候选清单。
// 只花一次 AI 调用；来源链接必须来自检索结果（见 parseCandidates），防止编造教授。

export type ProfessorSearchResult = { candidates: ProfessorCandidate[]; demo: boolean; searched: number };

const PER_QUERY = 8;
const MAX_RESULTS_FOR_AI = 40;

function buildPrompt(input: SearchInput, results: SearchResult[]) {
  const list = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}${r.date ? `\n日期: ${r.date}` : ""}\n${r.snippet}`)
    .join("\n\n");
  return `用户想申请日本大学院，正在找导师。
研究方向：${input.keywords}
目标校：${input.schools.join("、") || "不限"}
学科：${input.field === "sciences" ? "理科" : input.field === "humanities" ? "文科" : "未指定"}

下面是检索结果。请从中找出与研究方向相关、在目标校任职、能指导研究生的教员（教授、准教授、讲师），最多 ${MAX_CANDIDATES} 位，按相关度排序。

要求：
- 只根据检索结果写，不要补充检索结果里没有的信息；查不到的字段留空（null）。
- name 用检索结果里的写法（日文汉字姓名），university 写大学名，department 写研究科・専攻。
- research 用简体中文写 1–3 句研究方向摘要，说明和用户方向的关联。
- papers 只列检索结果里出现过的论文或著作标题，最多 3 篇。
- acceptsInternational：检索结果里明确提到是否接收留学生/研究生时用中文简述，否则 null。
- sources 填支撑该教员信息的检索结果 URL（必须逐字来自上面的 URL）。

只输出 JSON，格式：
{"candidates":[{"name":"","university":"","department":null,"lab":null,"research":"","papers":[],"acceptsInternational":null,"sources":[""]}]}

检索结果：
${list}`;
}

export async function searchProfessors(input: SearchInput): Promise<ProfessorSearchResult> {
  if (isDemoMode()) return { candidates: demoCandidates(input), demo: true, searched: 0 };

  const queries = buildSearchQueries(input);
  const settled = await Promise.allSettled(queries.map((q) => webSearch(q, PER_QUERY)));
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const r of s.value) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push(r);
    }
  }
  if (!results.length) {
    const failed = settled.find((s) => s.status === "rejected");
    if (failed) throw failed.reason;
    return { candidates: [], demo: false, searched: queries.length };
  }

  const top = results.slice(0, MAX_RESULTS_FOR_AI);
  const { text } = await generateText({ model: getChatModel(), prompt: buildPrompt(input, top) });
  return {
    candidates: parseCandidates(
      text,
      top.map((r) => ({ title: r.title, url: r.url })),
    ),
    demo: false,
    searched: queries.length,
  };
}

// 找教授：类型、检索词、AI 结果解析、套磁信模板（纯函数，前后端共用）

import { z } from "zod";
import type { TargetProfessor } from "./documents";
import type { Field } from "./onboarding";

/** 联系状态：未联系 → 已发信 → 已回复 → 面谈过 → 同意接收；dropped = 不再考虑（排在志愿列表最后） */
export const PROFESSOR_STATUSES = ["to_contact", "contacted", "replied", "interview", "accepted", "dropped"] as const;

export type ProfessorStatus = (typeof PROFESSOR_STATUSES)[number];

export const PROFESSOR_STATUS_LABELS: Record<ProfessorStatus, string> = {
  to_contact: "未联系",
  contacted: "已发信",
  replied: "已回复",
  interview: "面谈过",
  accepted: "同意接收",
  dropped: "放弃",
};

/** 志愿卡片上的联系进度条（不含放弃） */
export const CONTACT_FLOW = PROFESSOR_STATUSES.filter((s) => s !== "dropped");

export type SourceLink = { title: string; url: string };

/** 教授近期论文：链接必须来自检索结果，查不到就只有标题 */
export type PaperRef = { title: string; year?: number; url?: string };

export type SearchInput = {
  keywords: string;
  schools: string[];
  field?: Field;
  /** 用户在对话里追加的要求（如「更偏应用」「只要关东的」） */
  preference?: string;
  /** user.md 摘要：让 AI 说明「为什么适合你」，并避开用户说过不合适的教授 */
  profile?: string;
  /** 用户要几位（「找两三位」= 3）；没说时 DEFAULT_CANDIDATES */
  count?: number;
};

/** 检索候选（还没收藏） */
export type ProfessorCandidate = {
  name: string;
  university: string;
  department?: string;
  lab?: string;
  research: string;
  /** 为什么适合这位用户（引用论文说明） */
  fit?: string;
  papers: string[];
  /** 近两三年的 2–3 篇论文，带链接 */
  paperRefs?: PaperRef[];
  acceptsInternational?: string;
  sources: SourceLink[];
};

export const MAX_SCHOOLS = 5;
export const MAX_CANDIDATES = 8;
export const DEFAULT_CANDIDATES = 5;

/** 这一轮要几位候选 */
export function candidateCount(input: Pick<SearchInput, "count">) {
  const n = Math.round(input.count ?? DEFAULT_CANDIDATES);
  return Math.min(Math.max(Number.isFinite(n) ? n : DEFAULT_CANDIDATES, 1), MAX_CANDIDATES);
}

/** 把用户填的“目标校”拆成列表：逗号、顿号、空格、换行都算分隔 */
export function splitSchools(text: string): string[] {
  const list = text
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(list)].slice(0, MAX_SCHOOLS);
}

/**
 * 生成检索词。每所学校两条：researchmap（研究者数据库，信息规整）+ 大学官网的研究室/教员页。
 * 没填学校时搜全日本。检索服务支持 site: 语法。
 */
export function buildSearchQueries({ keywords, schools }: SearchInput): string[] {
  const kw = keywords.trim();
  if (!schools.length) return [`${kw} 教授 site:researchmap.jp`, `${kw} 研究室 大学院 教員`, `${kw} 研究者 site:nrid.nii.ac.jp`];
  return schools.flatMap((s) => [`${s} ${kw} site:researchmap.jp`, `${s} ${kw} 研究室 教員`]);
}

/**
 * 每位候选再单独搜一次论文：教员名单和个人页上通常没有论文，researchmap 的业绩页、CiNii、KAKEN 才有。
 * 姓名加引号精确匹配，带上大学避免同名。
 */
export function buildPaperQueries(c: Pick<ProfessorCandidate, "name" | "university">): string[] {
  const name = c.name.replace(/[\s　]/g, "");
  return [`"${name}" ${c.university} 論文`, `${name} 論文 業績 site:researchmap.jp`];
}

// 模型偶尔把 JSON 字段名、「null」写进给用户看的文字（如「papers为空」）。含这些词的半句整句去掉
const INTERNAL_WORDS = /\b(?:papers?|paperRefs|sources|acceptsInternational|candidates|json|null|undefined)\b|字段|为空|為空/i;

/** 给用户看的文字：去掉提到内部字段名的半句 */
export function cleanCopy(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.split(/(?<=[。；！？!?;])/);
  const kept = parts.flatMap((part) => {
    if (!INTERNAL_WORDS.test(part)) return [part];
    // 开头就在说字段（「papers为空，无法引用论文。」）整句去掉；否则只去掉提到字段名的小句
    const clauses = part.split(/(?<=[，,])/);
    if (INTERNAL_WORDS.test(clauses[0])) return [];
    return [clauses.filter((c) => !INTERNAL_WORDS.test(c)).join("").replace(/[，,]$/, "。")];
  });
  const out = kept.join("").trim();
  return out || undefined;
}

const text = (max: number) => z.string().trim().max(max);

const paperSchema = z.union([
  text(300).transform((title) => ({ title, year: null, url: null })),
  z.object({ title: text(300), year: z.coerce.number().int().min(1950).max(2100).nullish().catch(null), url: z.string().nullish() }),
]);

const candidateSchema = z.object({
  name: text(100).min(1),
  university: text(100).min(1),
  department: text(200).nullish(),
  lab: text(200).nullish(),
  research: text(1000).default(""),
  fit: text(1000).nullish(),
  papers: z.array(paperSchema).max(5).default([]),
  acceptsInternational: text(200).nullish(),
  sources: z.array(z.string()).default([]),
});

/** 从模型回复里取出 JSON（允许包在 ```json 代码块里，或前后有说明文字） */
function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1];
  const body = (fenced ?? reply).trim();
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析 AI 整理出的教授候选。只保留检索结果里真实出现过的来源链接，
 * 没有任何有效来源的候选直接丢掉——宁可少，不要编造的教授。
 */
export function parseCandidates(reply: string, sources: SourceLink[], limit = MAX_CANDIDATES): ProfessorCandidate[] {
  const json = extractJson(reply);
  const raw = Array.isArray(json) ? json : json && typeof json === "object" && "candidates" in json ? (json as { candidates: unknown }).candidates : null;
  if (!Array.isArray(raw)) return [];
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  const seen = new Set<string>();
  const result: ProfessorCandidate[] = [];
  for (const item of raw) {
    const parsed = candidateSchema.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    const links = [...new Set(c.sources)].flatMap((u) => (byUrl.has(u) ? [byUrl.get(u)!] : []));
    const key = candidateKey(c);
    if (!links.length || seen.has(key)) continue;
    seen.add(key);
    // 论文链接同样只认检索结果里的 URL，编造的链接去掉、标题保留
    const paperRefs = toPaperRefs(c.papers, byUrl);
    result.push({
      name: c.name,
      university: c.university,
      department: c.department || undefined,
      lab: c.lab || undefined,
      research: cleanCopy(c.research) ?? "",
      fit: cleanCopy(c.fit),
      papers: paperRefs.map(paperLabel),
      paperRefs,
      acceptsInternational: cleanCopy(c.acceptsInternational),
      sources: links,
    });
    if (result.length >= limit) break;
  }
  return result;
}

function toPaperRefs(papers: z.infer<typeof paperSchema>[], byUrl: Map<string, SourceLink>): PaperRef[] {
  return papers
    .filter((p) => p.title)
    .slice(0, 3)
    .map((p) => ({ title: p.title, ...(p.year ? { year: p.year } : {}), ...(p.url && byUrl.has(p.url) ? { url: p.url } : {}) }));
}

const paperReplySchema = z.object({
  index: z.coerce.number().int(),
  papers: z.array(paperSchema).max(5).default([]),
  fit: text(1000).nullish(),
});

/**
 * 第二轮（按教授单独搜论文）的结果合并进候选：查到论文就换上（链接同样只认检索结果里的 URL），
 * fit 换成引用这些论文的说法。index 从 1 开始，对应传给 AI 的候选顺序。
 */
export function mergePaperReply(reply: string, candidates: ProfessorCandidate[], sources: SourceLink[]): ProfessorCandidate[] {
  const json = extractJson(reply);
  const raw = Array.isArray(json) ? json : json && typeof json === "object" && "candidates" in json ? (json as { candidates: unknown }).candidates : null;
  if (!Array.isArray(raw)) return candidates;
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  const out = [...candidates];
  for (const item of raw) {
    const parsed = paperReplySchema.safeParse(item);
    if (!parsed.success) continue;
    const i = parsed.data.index - 1;
    if (!out[i]) continue;
    const paperRefs = toPaperRefs(parsed.data.papers, byUrl);
    const fit = cleanCopy(parsed.data.fit);
    out[i] = {
      ...out[i],
      ...(paperRefs.length ? { paperRefs, papers: paperRefs.map(paperLabel) } : {}),
      ...(fit ? { fit } : {}),
    };
  }
  return out;
}

/** 同一位教授的判定：去掉姓名里的空格 + 大学 */
export function candidateKey(p: { name: string; university: string }) {
  return `${p.name.replace(/[\s　]/g, "")}@${p.university.trim()}`;
}

export function paperLabel(p: PaperRef) {
  return p.year && !p.title.includes(String(p.year)) ? `${p.title}（${p.year}）` : p.title;
}

type ProfessorInfo = {
  name: string;
  university: string;
  department?: string | null;
  lab?: string | null;
  research?: string | null;
  papers?: string[];
};

export function professorAffiliation(p: ProfessorInfo) {
  return [p.university, p.department, p.lab].filter(Boolean).join(" ");
}

/** 收藏的教授 → 文书的目标教授（计划书贴合、套磁信收件人） */
export function professorToTarget(p: ProfessorInfo & { id: string }): TargetProfessor {
  const research = [p.research, p.papers?.length ? `代表论文：\n${p.papers.map((t) => `- ${t}`).join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return { professorId: p.id, name: p.name, affiliation: professorAffiliation(p) || undefined, research: research.slice(0, 3000) || undefined };
}

/** 套磁信初稿骨架：填好收件人，正文由 AI 按 user.md 和教授研究方向来写 */
export function letterSkeleton(p: ProfessorInfo) {
  return [
    "件名：研究生受け入れのお願い（氏名）",
    "",
    [p.university, p.department].filter(Boolean).join(" ") || "〇〇大学大学院〇〇研究科",
    `${p.name} 先生`,
    "",
    "突然のご連絡失礼いたします。",
    "",
    "（自己紹介・先生の研究に関心を持った理由・研究計画の概要・お願い）",
    "",
    "ご多忙のところ恐縮ですが、ご検討いただけますと幸いです。",
    "何卒よろしくお願い申し上げます。",
    "",
    "氏名",
    "メールアドレス",
    "",
  ].join("\n");
}

/** 给 AI 和页面用的一行摘要 */
export function describeProfessor(
  p: ProfessorInfo & { id?: string; status?: ProfessorStatus; note?: string | null; followUpDate?: string | null; fit?: string | null },
) {
  const parts = [`${p.name}（${professorAffiliation(p)}）`];
  if (p.id) parts.push(`ID：${p.id}`);
  if (p.status) parts.push(`联系状态：${PROFESSOR_STATUS_LABELS[p.status]}`);
  if (p.followUpDate) parts.push(`跟进：${p.followUpDate}`);
  if (p.research) parts.push(`研究：${p.research.slice(0, 200)}`);
  if (p.fit) parts.push(`为什么适合：${p.fit.slice(0, 200)}`);
  if (p.note) parts.push(`备注：${p.note.slice(0, 100)}`);
  return parts.join("；");
}

/** 演示模式（没有 DEEPSEEK_API_KEY）的检索结果：明确标注是示例，不是真实教授 */
export function demoCandidates({ keywords, schools }: SearchInput): ProfessorCandidate[] {
  const kw = keywords.trim() || "研究方向";
  const univs = schools.length ? schools : ["示例大学"];
  return univs.slice(0, 2).flatMap((u, i) => [
    {
      name: `山田 太郎（示例${i * 2 + 1}）`,
      university: u,
      department: "大学院〇〇研究科",
      lab: "山田研究室",
      research: `（演示数据，非真实教授）主要研究「${kw}」相关课题，近年关注方法论与跨学科应用。`,
      fit: `（演示）近两年的论文都在做「${kw}」的实证研究，和你的方向最接近。`,
      papers: [`${kw}に関する実証的研究（2025）`, `${kw}の新たな展開（2024）`],
      paperRefs: [
        { title: `${kw}に関する実証的研究`, year: 2025, url: "https://researchmap.jp/" },
        { title: `${kw}の新たな展開`, year: 2024 },
      ],
      acceptsInternational: "研究室主页写明接收留学生，有研究生制度（演示）",
      sources: [{ title: "示例来源（演示模式）", url: "https://researchmap.jp/" }],
    },
    {
      name: `佐藤 花子（示例${i * 2 + 2}）`,
      university: u,
      department: "大学院〇〇学府",
      research: `（演示数据，非真实教授）研究「${kw}」的理论与实践，指导过多名中国留学生。`,
      fit: "（演示）偏理论，适合想先打基础、再找具体课题的你。",
      papers: [`${kw}をめぐる比較分析（2025）`],
      paperRefs: [{ title: `${kw}をめぐる比較分析`, year: 2025, url: "https://nrid.nii.ac.jp/" }],
      sources: [{ title: "示例来源（演示模式）", url: "https://nrid.nii.ac.jp/" }],
    },
  ]);
}

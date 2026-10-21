// 找教授：类型、检索词、AI 结果解析、套磁信模板（纯函数，前后端共用）

import { z } from "zod";
import type { TargetProfessor } from "./documents";
import type { Field } from "./onboarding";

export const PROFESSOR_STATUSES = ["to_contact", "contacted", "replied", "interview", "dropped"] as const;

export type ProfessorStatus = (typeof PROFESSOR_STATUSES)[number];

export const PROFESSOR_STATUS_LABELS: Record<ProfessorStatus, string> = {
  to_contact: "待联系",
  contacted: "已发套磁",
  replied: "已回复",
  interview: "面谈",
  dropped: "放弃",
};

export type SourceLink = { title: string; url: string };

export type SearchInput = { keywords: string; schools: string[]; field?: Field };

/** 检索候选（还没收藏） */
export type ProfessorCandidate = {
  name: string;
  university: string;
  department?: string;
  lab?: string;
  research: string;
  papers: string[];
  acceptsInternational?: string;
  sources: SourceLink[];
};

export const MAX_SCHOOLS = 5;
export const MAX_CANDIDATES = 12;

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

const text = (max: number) => z.string().trim().max(max);

const candidateSchema = z.object({
  name: text(100).min(1),
  university: text(100).min(1),
  department: text(200).nullish(),
  lab: text(200).nullish(),
  research: text(1000).default(""),
  papers: z.array(text(300)).max(5).default([]),
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
export function parseCandidates(reply: string, sources: SourceLink[]): ProfessorCandidate[] {
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
    const key = `${c.name.replace(/\s/g, "")}@${c.university}`;
    if (!links.length || seen.has(key)) continue;
    seen.add(key);
    result.push({
      name: c.name,
      university: c.university,
      department: c.department || undefined,
      lab: c.lab || undefined,
      research: c.research,
      papers: c.papers.filter(Boolean),
      acceptsInternational: c.acceptsInternational || undefined,
      sources: links,
    });
    if (result.length >= MAX_CANDIDATES) break;
  }
  return result;
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
export function describeProfessor(p: ProfessorInfo & { id?: string; status?: ProfessorStatus; note?: string | null; followUpDate?: string | null }) {
  const parts = [`${p.name}（${professorAffiliation(p)}）`];
  if (p.id) parts.push(`ID：${p.id}`);
  if (p.status) parts.push(`状态：${PROFESSOR_STATUS_LABELS[p.status]}`);
  if (p.followUpDate) parts.push(`跟进：${p.followUpDate}`);
  if (p.research) parts.push(`研究：${p.research.slice(0, 200)}`);
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
      papers: [`${kw}に関する実証的研究（2025）`, `${kw}の新たな展開（2024）`],
      acceptsInternational: "研究室主页写明接收留学生（演示）",
      sources: [{ title: "示例来源（演示模式）", url: "https://researchmap.jp/" }],
    },
    {
      name: `佐藤 花子（示例${i * 2 + 2}）`,
      university: u,
      department: "大学院〇〇学府",
      research: `（演示数据，非真实教授）研究「${kw}」的理论与实践，指导过多名中国留学生。`,
      papers: [`${kw}をめぐる比較分析（2025）`],
      sources: [{ title: "示例来源（演示模式）", url: "https://nrid.nii.ac.jp/" }],
    },
  ]);
}

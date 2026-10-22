// 募集要项监控：网页正文提取、变化指纹、AI 解析结果校验、仮日程推算（纯函数）

import { z } from "zod";
import { addDays, isIsoDate, shiftYears, type CalendarItem } from "./calendar";

/** 募集要项里的一个日程（出愿期间、考试日、合格发表……） */
export type GuideEvent = { label: string; date: string; endDate?: string | null; kind: "deadline" | "exam" | "other" };

export type PageLink = { text: string; url: string };

/** 要不要出愿前先联系指导教员 */
export const CONTACT_RULES = ["required", "recommended", "not_required"] as const;
export type ContactRule = (typeof CONTACT_RULES)[number];

export const CONTACT_RULE_LABELS: Record<ContactRule, string> = {
  required: "必须先联系教授",
  recommended: "建议先联系教授",
  not_required: "不需要事先联系",
};

/**
 * 研究科的入试要点（志愿列表里「研究科这边」的信息），每个用户自己的一份（监控解析或 AI 在对话里查到）。
 * 募集要项监控解析出来的 source = monitor；监控还没解析到时，AI 在对话里查到的先填上（source = ai），之后被监控结果覆盖。
 */
export type AdmissionRequirements = {
  contact: ContactRule | null;
  /** 原文里关于事先联系的说法（简短） */
  contactNote: string | null;
  /** 考试科目（笔试、口试、面接、小论文……） */
  subjects: string[];
  /** 语言要求原文简述 */
  english: string | null;
  japanese: string | null;
  /** 数字化的最低分（只在要项写明时填），用于和用户成绩对照 */
  toefl: number | null;
  toeic: number | null;
  ielts: number | null;
  /** JLPT 级别：1 = N1 */
  jlpt: number | null;
  notes: string | null;
  sourceUrl: string | null;
  source: "monitor" | "ai";
  updatedAt: string;
};

/** 只允许公网网址：worker 会去抓这个链接，不能让它访问服务器内网（数据库、云厂商元数据等） */
export function assertPublicUrl(url: string) {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("链接格式不对");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("只支持 http(s) 链接");
  const host = u.hostname.toLowerCase();
  const privateIp = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host.startsWith("[");
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost" || privateIp) {
    throw new Error("请填写大学官网的公开网址");
  }
  return u;
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → 按行的纯文本（去掉脚本、样式、导航外壳之类的标签，保留换行结构） */
export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|dt|dd|section|article|table|ul|ol)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function extractLinks(html: string, baseUrl: string): PageLink[] {
  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try {
      url = new URL(decodeEntities(m[1]), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: htmlToText(m[2]).replace(/\n/g, " ").slice(0, 120) });
  }
  return links;
}

const KEYWORDS = /募集|要項|要綱|入試|入学試験|出願|試験|選抜|日程|年度|合格|発表|口述|面接|admission|application|deadline/i;
const DATE_LIKE = /(\d{4}\s*[年./-]|令和\s*\d+\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日)/;

/** 和入试相关的行：含关键词或日期。指纹只看这些，避免“最近更新”“新闻”之类的变动触发 AI 解析 */
export function relevantLines(text: string) {
  return text.split("\n").filter((l) => KEYWORDS.test(l) || DATE_LIKE.test(l));
}

/** 可能是募集要项文件的链接（PDF，或链接文字提到募集要项/入试） */
export function relevantLinks(links: PageLink[]) {
  return links.filter((l) => /\.pdf($|\?)/i.test(l.url) || /募集|要項|要綱|入試|出願|admission/i.test(l.text));
}

/** 变化检测用的原文：相关行 + 相关链接（排序后），由服务端算哈希 */
export function fingerprintSource(text: string, links: PageLink[]) {
  const urls = relevantLinks(links)
    .map((l) => l.url)
    .sort();
  return [...relevantLines(text), "--", ...urls].join("\n");
}

const eventSchema = z.object({
  label: z.string().trim().min(1).max(100),
  date: z.string(),
  endDate: z.string().nullish(),
  kind: z.enum(["deadline", "exam", "other"]).catch("other"),
});

const guideSchema = z.object({
  admissionYear: z.number().int().min(2000).max(2100).nullish(),
  title: z.string().trim().max(200).nullish(),
  events: z.array(z.unknown()).default([]),
  pdfUrl: z.string().nullish(),
  requirements: z.unknown().optional(),
});

export type ParsedGuide = {
  admissionYear: number | null;
  title: string | null;
  events: GuideEvent[];
  pdfUrl: string | null;
  requirements: Omit<AdmissionRequirements, "source" | "updatedAt" | "sourceUrl"> | null;
};

const opt = (max: number) => z.string().trim().max(max).nullish().catch(null);
const score = (min: number, max: number) => z.coerce.number().min(min).max(max).nullish().catch(null);

export const requirementsSchema = z.object({
  contact: z.enum(CONTACT_RULES).nullish().catch(null),
  contactNote: opt(300),
  subjects: z.array(z.string().trim().min(1).max(100)).max(12).default([]).catch([]),
  english: opt(300),
  japanese: opt(300),
  toefl: score(1, 120),
  toeic: score(10, 990),
  ielts: score(1, 9),
  jlpt: z.coerce.number().int().min(1).max(5).nullish().catch(null),
  notes: opt(500),
});

/** 校验 AI 抽出的入试要点；什么都没有时返回 null */
export function parseRequirements(raw: unknown): ParsedGuide["requirements"] {
  const parsed = requirementsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const req = {
    contact: r.contact ?? null,
    contactNote: r.contactNote || null,
    subjects: r.subjects,
    english: r.english || null,
    japanese: r.japanese || null,
    toefl: r.toefl ?? null,
    toeic: r.toeic ?? null,
    ielts: r.ielts ?? null,
    jlpt: r.jlpt ?? null,
    notes: r.notes || null,
  };
  const empty = !req.contact && !req.contactNote && !req.subjects.length && !req.english && !req.japanese && !req.notes && req.toefl === null && req.jlpt === null;
  return empty ? null : req;
}

type Requirements = NonNullable<ParsedGuide["requirements"]>;

/** 入试要点还缺关键项（考试科目、要不要先联系教授）：这时再去读要项全文 */
export function requirementsIncomplete(req: ParsedGuide["requirements"]) {
  return !req || !req.subjects.length || !req.contact;
}

/** 合并两次抽取的入试要点：要项全文（detail）里有的优先，没有的沿用页面上的 */
export function mergeRequirements(page: ParsedGuide["requirements"], detail: ParsedGuide["requirements"]): ParsedGuide["requirements"] {
  if (!page || !detail) return detail ?? page;
  const pick = <K extends keyof Requirements>(k: K): Requirements[K] => {
    const v = detail[k];
    return (Array.isArray(v) ? v.length : v !== null) ? v : page[k];
  };
  return {
    contact: pick("contact"),
    contactNote: pick("contactNote"),
    subjects: pick("subjects"),
    english: pick("english"),
    japanese: pick("japanese"),
    toefl: pick("toefl"),
    toeic: pick("toeic"),
    ielts: pick("ielts"),
    jlpt: pick("jlpt"),
    notes: pick("notes"),
  };
}

/**
 * 要项全文在哪：AI 指出的链接（必须是页面上真有的），否则按链接文字找「募集要項」，PDF 优先。
 * 防止 worker 去抓 AI 编出来的网址。
 */
export function guideDocumentUrl(pdfUrl: string | null, links: PageLink[]): string | null {
  if (pdfUrl && links.some((l) => l.url === pdfUrl)) return pdfUrl;
  const named = links.filter((l) => /募集要[項项]|学生募集|要[項綱]|入試案内|入学試験/.test(l.text));
  const pdf = named.find((l) => /\.pdf($|\?)/i.test(l.url));
  return (pdf ?? named[0])?.url ?? null;
}

function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1];
  const body = (fenced ?? reply).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 校验 AI 从募集要项里抽出的日程：日期格式不对的丢掉，最多 30 条，按日期排序 */
export function parseGuideReply(reply: string): ParsedGuide | null {
  const parsed = guideSchema.safeParse(extractJson(reply));
  if (!parsed.success) return null;
  const events: GuideEvent[] = [];
  for (const raw of parsed.data.events) {
    const e = eventSchema.safeParse(raw);
    if (!e.success || !isIsoDate(e.data.date)) continue;
    const endDate = isIsoDate(e.data.endDate) && e.data.endDate > e.data.date ? e.data.endDate : null;
    events.push({ label: e.data.label, date: e.data.date, endDate, kind: e.data.kind });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  const pdfUrl = parsed.data.pdfUrl && /^https?:\/\//.test(parsed.data.pdfUrl) ? parsed.data.pdfUrl : null;
  return {
    admissionYear: parsed.data.admissionYear ?? null,
    title: parsed.data.title || null,
    events: events.slice(0, 30),
    pdfUrl,
    requirements: parseRequirements(parsed.data.requirements),
  };
}

/** 两份日程是否不同（顺序无关） */
export function eventsChanged(a: GuideEvent[], b: GuideEvent[]) {
  const key = (list: GuideEvent[]) =>
    list
      .map((e) => `${e.date}|${e.endDate ?? ""}|${e.label}`)
      .sort()
      .join("\n");
  return key(a) !== key(b);
}

export function formatGuideEvents(events: GuideEvent[]) {
  return events.map((e) => `- ${e.date}${e.endDate ? `〜${e.endDate}` : ""} ${e.label}`).join("\n");
}

export type GuideInfo = { schoolId: string; schoolName: string; admissionYear: number; events: GuideEvent[]; sourceUrl?: string };

/**
 * 研究科的最新募集要项 → 日历项。
 * 要项里的日程都已经过去（说明是往年的），就整体顺延一年作为“仮”日程，
 * 标注“仮・基于 X 年度”；新要项公开、worker 解析后自动变为正式日程。
 */
export function projectGuide(guide: GuideInfo, today: string): { tentative: boolean; items: CalendarItem[] } {
  if (!guide.events.length) return { tentative: false, items: [] };
  const last = guide.events.reduce((max, e) => ((e.endDate ?? e.date) > max ? (e.endDate ?? e.date) : max), "");
  // 最后一个日程过去一周以上才算“往年”，避免刚结束的当年日程被提前顺延
  const tentative = last < addDays(today, -7);
  const items = guide.events.map((e, i) => ({
    key: `guide:${guide.schoolId}:${i}`,
    source: "guide" as const,
    title: `${guide.schoolName} ${e.label}`,
    date: tentative ? shiftYears(e.date, 1) : e.date,
    endDate: e.endDate ? (tentative ? shiftYears(e.endDate, 1) : e.endDate) : null,
    kind: e.kind,
    tentative,
    note: tentative ? `仮・基于 ${guide.admissionYear} 年度募集要项推算，以新要项为准` : `${guide.admissionYear} 年度募集要项`,
    href: "/aspirations",
    sourceUrl: guide.sourceUrl,
  }));
  return { tentative, items };
}

export type GuideChange = GuideEvent & { before: { date: string; endDate: string | null } | null };

/** 新要项和之前日历上的日程（仮）对照：同名的日程标出原来的日期，没变的 before 为空 */
export function diffGuideEvents(previous: GuideEvent[], next: GuideEvent[]): GuideChange[] {
  const byLabel = new Map(previous.map((e) => [e.label, e]));
  return next.map((e) => {
    const old = byLabel.get(e.label);
    const changed = old && (old.date !== e.date || (old.endDate ?? null) !== (e.endDate ?? null));
    return { ...e, before: changed ? { date: old.date, endDate: old.endDate ?? null } : null };
  });
}

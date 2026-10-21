import "server-only";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import { and, desc, eq, exists, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { admissionGuide, graduateSchool, schoolWatch, user } from "@/db/schema";
import { getChatModel, isDemoMode } from "@/lib/ai/model";
import {
  assertPublicUrl,
  eventsChanged,
  extractLinks,
  fingerprintSource,
  formatGuideEvents,
  htmlToText,
  parseGuideReply,
  relevantLinks,
  type GuideEvent,
  type PageLink,
  type ParsedGuide,
} from "@/lib/admissions";
import { todayJst } from "@/lib/calendar";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { fetchPage } from "./search";
import { addTodos } from "./todos";

// 募集要项监控（由 worker 进程调用，系统任务，不扣用户 credit）。
// 每个研究科：直接抓页面（免费）→ 只对入试相关的行和链接算指纹 → 没变就结束；
// 变了才调用一次 AI 抽取日程（必要时再抓一次要项 PDF），日程有变化时邮件 + Todo 通知关注的用户。

type School = typeof graduateSchool.$inferSelect;

export type CheckResult = { status: "unchanged" | "updated" | "new_year" | "baseline" | "no_dates" | "skipped" | "error"; message?: string };

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 3_000_000;
const PROMPT_TEXT_LIMIT = 12_000;

type LoadedPage = { kind: "html"; text: string; links: PageLink[]; fingerprint: string } | { kind: "pdf"; fingerprint: string };

function charsetOf(contentType: string, head: string) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  return (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
}

async function loadPage(url: string): Promise<LoadedPage> {
  assertPublicUrl(url);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GradNaviBot/1.0; admission schedule monitor)", "Accept-Language": "ja,en;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`页面打不开（HTTP ${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("页面太大");
  const contentType = res.headers.get("content-type") ?? "";
  if (/pdf/i.test(contentType) || buf.subarray(0, 5).toString() === "%PDF-") {
    return { kind: "pdf", fingerprint: createHash("sha256").update(buf).digest("hex") };
  }
  const head = buf.subarray(0, 2048).toString("latin1");
  let html: string;
  try {
    html = new TextDecoder(charsetOf(contentType, head)).decode(buf);
  } catch {
    html = buf.toString("utf8");
  }
  const text = htmlToText(html);
  const links = extractLinks(html, res.url || url);
  return { kind: "html", text, links, fingerprint: createHash("sha256").update(fingerprintSource(text, links)).digest("hex") };
}

function extractionPrompt(school: School, source: string, links: PageLink[]) {
  const linkList = relevantLinks(links)
    .slice(0, 40)
    .map((l) => `- ${l.text || "(无文字)"} ${l.url}`)
    .join("\n");
  return `下面是日本大学院「${school.university} ${school.name}」的入试/募集要项页面内容。今天是 ${todayJst()}。
请抽取最新一份（年度最新的）学生募集要项里的日程：出愿期间、考试日、口述/面接日、合格发表、入学手续等。修士、博士、研究生（研究生=旁听生）的日程都要；不同课程或批次（夏季/冬季、4月入学/10月入学）在 label 里写清楚。

要求：
- 只根据给出的内容，不要推测；没有明确日期的日程不要写。
- date / endDate 用 YYYY-MM-DD（令和换算成西历，令和 N 年 = 2018+N 年）；期间类（出愿期间）写起止，单日的 endDate 为 null。
- label 用日文原文的简短说法，如「出願期間（一般選抜・夏季）」。
- kind：出愿截止/提交材料类为 "deadline"，考试/面接为 "exam"，其他为 "other"。
- admissionYear：这份要项对应的入学年度（标题里的「20XX年度」；只写了入学年月时用 4 月入学的年份）。
- 页面上没有日程、但有募集要项 PDF 链接时，events 留空，pdfUrl 填最可能是最新募集要项的链接（必须逐字来自下面的链接列表）。

只输出 JSON：
{"admissionYear":2027,"title":"","events":[{"label":"","date":"","endDate":null,"kind":"deadline"}],"pdfUrl":null}

页面内容：
${source.slice(0, PROMPT_TEXT_LIMIT)}
${linkList ? `\n链接：\n${linkList}` : ""}`;
}

async function askGuide(school: School, source: string, links: PageLink[]): Promise<ParsedGuide | null> {
  const { text } = await generateText({ model: getChatModel(), prompt: extractionPrompt(school, source, links) });
  return parseGuideReply(text);
}

/** AI 抽取日程。页面上没有日期时，再读一次要项 PDF（DeepSeek 抓取服务） */
async function extractGuide(school: School, page: LoadedPage): Promise<ParsedGuide | null> {
  if (page.kind === "pdf") {
    const { content } = await fetchPage(school.url);
    return askGuide(school, content, []);
  }
  const first = await askGuide(school, page.text, page.links);
  if (first?.events.length || !first?.pdfUrl) return first;
  if (!page.links.some((l) => l.url === first.pdfUrl)) return first;
  const { content } = await fetchPage(first.pdfUrl);
  const second = await askGuide(school, content, []);
  return second && second.events.length ? { ...second, pdfUrl: first.pdfUrl } : first;
}

async function notifyWatchers(school: School, kind: "new_year" | "updated", admissionYear: number, events: GuideEvent[]) {
  const watchers = await db
    .select({ id: user.id, email: user.email })
    .from(schoolWatch)
    .innerJoin(user, eq(schoolWatch.userId, user.id))
    .where(eq(schoolWatch.schoolId, school.id));
  const label = `${school.university} ${school.name}`;
  const headline = kind === "new_year" ? `${admissionYear} 年度募集要项已发布` : `${admissionYear} 年度募集要项日程有更新`;
  const body = [
    `你关注的「${label}」${headline}。日历里的日程已经自动更新为：`,
    "",
    formatGuideEvents(events),
    "",
    `来源：${school.url}`,
    `查看日历：${env.APP_URL}/calendar`,
    "",
    "日程由 AI 从官网页面整理，出愿前请务必以募集要项原文为准。",
    "—— GradNavi（修考工作台）",
  ].join("\n");
  for (const w of watchers) {
    await addTodos(w.id, [{ title: `查看「${label}」${headline}`, note: `核对出愿日程和材料要求：${school.url}` }], "system");
    try {
      await sendMail(w.email, `【GradNavi】${label} ${headline}`, body);
    } catch (error) {
      console.error(`[monitor] 邮件发送失败 ${w.email}`, error);
    }
  }
  return watchers.length;
}

async function saveGuide(school: School, parsed: ParsedGuide & { admissionYear: number }): Promise<CheckResult["status"]> {
  const [latest] = await db
    .select()
    .from(admissionGuide)
    .where(eq(admissionGuide.schoolId, school.id))
    .orderBy(desc(admissionGuide.admissionYear))
    .limit(1);
  const [same] = await db
    .select()
    .from(admissionGuide)
    .where(and(eq(admissionGuide.schoolId, school.id), eq(admissionGuide.admissionYear, parsed.admissionYear)));
  const values = { title: parsed.title, events: parsed.events, sourceUrl: parsed.pdfUrl ?? school.url, updatedAt: new Date() };

  if (same) {
    if (!eventsChanged(same.events, parsed.events)) return "unchanged";
    await db.update(admissionGuide).set(values).where(eq(admissionGuide.id, same.id));
    if (same.id === latest?.id) await notifyWatchers(school, "updated", parsed.admissionYear, parsed.events);
    return "updated";
  }
  await db.insert(admissionGuide).values({ id: crypto.randomUUID(), schoolId: school.id, admissionYear: parsed.admissionYear, ...values });
  if (!latest) return "baseline"; // 第一次检查：作为基准（多半是往年要项），日历显示仮日程，不发通知
  if (parsed.admissionYear > latest.admissionYear) {
    await notifyWatchers(school, "new_year", parsed.admissionYear, parsed.events);
    return "new_year";
  }
  return "unchanged";
}

export async function checkSchool(school: School): Promise<CheckResult> {
  const done = (patch: Partial<School>) =>
    db
      .update(graduateSchool)
      .set({ checkedAt: new Date(), checkRequestedAt: null, ...patch })
      .where(eq(graduateSchool.id, school.id));
  try {
    const page = await loadPage(school.url);
    if (page.fingerprint === school.contentHash) {
      await done({ lastError: null });
      return { status: "unchanged" };
    }
    if (isDemoMode()) {
      // 不记指纹：配置 key 后下次检查会重新解析
      await done({ lastError: "页面有变化，但服务器未配置 DEEPSEEK_API_KEY，暂时无法解析日程" });
      return { status: "skipped" };
    }
    const parsed = await extractGuide(school, page);
    if (!parsed?.admissionYear || !parsed.events.length) {
      await done({ contentHash: page.fingerprint, changedAt: new Date(), lastError: "页面上没有找到明确的入试日程（要项可能还没公开，或链接不是募集要项页面）" });
      return { status: "no_dates" };
    }
    const status = await saveGuide(school, { ...parsed, admissionYear: parsed.admissionYear });
    await done({ contentHash: page.fingerprint, changedAt: new Date(), lastError: null });
    return { status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await done({ lastError: `检查失败：${message}`.slice(0, 300) });
    return { status: "error", message };
  }
}

/**
 * 检查一批研究科。mode：
 * - "daily"：所有至少有一人关注的研究科（每天一次）
 * - "requested"：刚被关注或用户点了“立即检查”的研究科（每几分钟一次）
 */
export async function runAdmissionChecks(mode: "daily" | "requested") {
  const watched = exists(db.select().from(schoolWatch).where(eq(schoolWatch.schoolId, graduateSchool.id)));
  const schools = await db
    .select()
    .from(graduateSchool)
    .where(mode === "daily" ? watched : and(watched, isNotNull(graduateSchool.checkRequestedAt)));
  const results: Record<string, number> = {};
  for (const school of schools) {
    const r = await checkSchool(school);
    results[r.status] = (results[r.status] ?? 0) + 1;
    if (r.status === "error") console.warn(`[monitor] ${school.university} ${school.name}: ${r.message}`);
    // 同一批里错开请求，对大学网站友好一点
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { checked: schools.length, results };
}

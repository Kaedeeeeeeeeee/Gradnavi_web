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
  guideDocumentUrl,
  htmlToText,
  mergeRequirements,
  parseGuideReply,
  relevantLinks,
  requirementsIncomplete,
  type AdmissionRequirements,
  type GuideEvent,
  type PageLink,
  type ParsedGuide,
} from "@/lib/admissions";
import { shiftYears, todayJst } from "@/lib/calendar";
import { UsageMeter } from "@/lib/credits";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { recordUsageSafe } from "./credits";
import { pdfToText } from "./pdf-text";
import { fetchPage } from "./search";
import { addTodos } from "./todos";

// 募集要项监控（由 worker 进程调用，系统任务，不扣用户 credit）。
// 每个研究科：直接抓页面（免费）→ 只对入试相关的行和链接算指纹 → 没变就结束；
// 变了才调用一次 AI 抽取日程（必要时再抓一次要项 PDF），日程有变化时邮件 + Todo 通知关注的用户。

type School = typeof graduateSchool.$inferSelect;

export type CheckResult = { status: "unchanged" | "updated" | "new_year" | "baseline" | "no_dates" | "skipped" | "error"; message?: string };

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 3_000_000;
/** 募集要项 PDF 常有几 MB */
const MAX_PDF_BYTES = 20_000_000;
const PROMPT_TEXT_LIMIT = 12_000;
/** 募集要项全文（PDF 常有几十页，考试科目、事先联系的要求在中间）：读得多一些，只在页面有变化时读一次 */
const GUIDE_TEXT_LIMIT = 45_000;

type LoadedPage = { kind: "html"; text: string; links: PageLink[]; fingerprint: string } | { kind: "pdf"; data: Buffer; fingerprint: string };

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
  const contentType = res.headers.get("content-type") ?? "";
  if (/pdf/i.test(contentType) || buf.subarray(0, 5).toString() === "%PDF-") {
    if (buf.length > MAX_PDF_BYTES) throw new Error("PDF 太大");
    return { kind: "pdf", data: buf, fingerprint: createHash("sha256").update(buf).digest("hex") };
  }
  if (buf.length > MAX_BYTES) throw new Error("页面太大");
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

function extractionPrompt(school: School, source: string, links: PageLink[], limit: number) {
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
- pdfUrl：有链接列表时，填最可能是最新募集要项全文（PDF 或详细的募集要项页面）的链接，必须逐字来自链接列表；页面上已有日程也要填。没有就 null。
- requirements：修士课程（一般选抜、外国人留学生选抜）的入试要点，没写的字段填 null / 空数组：
  - contact：出愿前是否要联系指导予定教员。看「出願資格」「出願前の事前相談」「指導教員」「志望指導教員との連絡」「出願資格審査」等处。明确要求（「事前に連絡を取ること」「内諾を得ること」「事前相談が必要」）为 "required"，建议（「望ましい」「推奨」）为 "recommended"，明确不需要为 "not_required"，没提到为 null；contactNote 用中文简述原文说法。
  - subjects：考试科目，看「試験科目」「選抜方法」「学力検査」「選考方法」等处（専門科目、外国語、小論文、口述試験、面接、書類審査都算），中文简写，如「专业笔试」「外语（TOEFL 代替）」「口试・面接」「小论文」「研究计划书审查」。
  - english / japanese：语言要求的中文简述（如「TOEFL iBT 成绩代替英语笔试」「JLPT N1 或同等」）。toefl / toeic / ielts / jlpt：只在写明最低分时填数字（jlpt 填级别数字，N1 = 1）。
  - notes：其他重要的要求（如出愿资格审查、需提前申请），中文一句，没有为 null。

只输出 JSON：
{"admissionYear":2027,"title":"","events":[{"label":"","date":"","endDate":null,"kind":"deadline"}],"pdfUrl":null,"requirements":{"contact":null,"contactNote":null,"subjects":[],"english":null,"japanese":null,"toefl":null,"toeic":null,"ielts":null,"jlpt":null,"notes":null}}

页面内容：
${source.slice(0, limit)}
${linkList ? `\n链接：\n${linkList}` : ""}`;
}

async function askGuide(school: School, source: string, links: PageLink[], meter: UsageMeter, limit = PROMPT_TEXT_LIMIT): Promise<ParsedGuide | null> {
  const { text, totalUsage } = await generateText({ model: getChatModel(), prompt: extractionPrompt(school, source, links, limit) });
  meter.addTokens(totalUsage);
  return parseGuideReply(text);
}

/**
 * 读募集要项全文：先直接下载（PDF 在本地取文字，网页去掉标签），读不到（扫描版 PDF、网站拒绝直接访问）
 * 再用 DeepSeek 抓取服务。都失败时返回 null，由调用方沿用页面上抽到的结果。
 */
async function readGuideDocument(url: string, meter: UsageMeter, loaded?: LoadedPage): Promise<string | null> {
  try {
    const page = loaded ?? (await loadPage(url));
    const text = page.kind === "pdf" ? await pdfToText(page.data) : page.text;
    if (text.trim().length > 200) return text;
  } catch (error) {
    console.warn(`[monitor] 直接读取失败 ${url}`, error);
  }
  try {
    return (await fetchPage(url, meter, GUIDE_TEXT_LIMIT)).content;
  } catch (error) {
    console.warn(`[monitor] 抓取服务读取失败 ${url}`, error);
    return null;
  }
}

/**
 * AI 抽取日程和入试要点。入试页面上通常只有日程和要项链接，考试科目、要不要先联系教授写在要项全文里：
 * 页面上缺日程或缺这些要点时，再读一次要项全文（PDF 或详细页面）。全文读不到就用页面上抽到的。
 */
async function extractGuide(school: School, page: LoadedPage, meter: UsageMeter): Promise<ParsedGuide | null> {
  if (page.kind === "pdf") {
    const content = await readGuideDocument(school.url, meter, page);
    if (!content) throw new Error("募集要项 PDF 读不出文字");
    return askGuide(school, content, [], meter, GUIDE_TEXT_LIMIT);
  }
  const first = await askGuide(school, page.text, page.links, meter);
  if (first?.events.length && !requirementsIncomplete(first.requirements)) return first;
  const docUrl = guideDocumentUrl(first?.pdfUrl ?? null, page.links);
  if (!docUrl || docUrl === school.url) return first;
  const content = await readGuideDocument(docUrl, meter);
  if (!content) return first;
  const detail = await askGuide(school, content, [], meter, GUIDE_TEXT_LIMIT).catch((error) => {
    console.warn(`[monitor] 要项全文解析失败 ${docUrl}`, error);
    return null;
  });
  if (!detail) return first;
  // 日程以入试页面为准（页面上没有才用全文里的），入试要点以全文为准
  const schedule = first?.events.length ? first : detail.events.length ? { ...detail, pdfUrl: docUrl } : first;
  return {
    admissionYear: schedule?.admissionYear ?? null,
    title: schedule?.title ?? null,
    events: schedule?.events ?? [],
    pdfUrl: schedule?.pdfUrl ?? docUrl,
    requirements: mergeRequirements(first?.requirements ?? null, detail.requirements),
  };
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
    `查看主页：${env.APP_URL}/workbench（AI 可以帮你对照新日程，提议调整你的安排）`,
    "",
    "日程由 AI 从官网页面整理，出愿前请务必以募集要项原文为准。",
    "—— GradNavi（修考工作台）",
  ].join("\n");
  for (const w of watchers) {
    await addTodos(w.id, [{ title: `查看「${label}」${headline}`, note: `核对出愿日程和材料要求：${school.url}`, schoolId: school.id }], "system");
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
  const now = new Date();
  const values = { title: parsed.title, events: parsed.events, sourceUrl: parsed.pdfUrl ?? school.url, updatedAt: now };

  if (same) {
    if (!eventsChanged(same.events, parsed.events)) return "unchanged";
    const announce = same.id === latest?.id ? { announcedAt: now, previousEvents: same.events } : {};
    await db.update(admissionGuide).set({ ...values, ...announce }).where(eq(admissionGuide.id, same.id));
    if (same.id === latest?.id) await notifyWatchers(school, "updated", parsed.admissionYear, parsed.events);
    return "updated";
  }
  const isNewYear = !!latest && parsed.admissionYear > latest.admissionYear;
  // 新年度要项公布：之前日历上是往年要项顺延出来的仮日程，记下来在主页提醒里对照
  const announce = isNewYear
    ? {
        announcedAt: now,
        previousEvents: latest.events.map((e) => {
          const years = parsed.admissionYear - latest.admissionYear;
          return { ...e, date: shiftYears(e.date, years), endDate: e.endDate ? shiftYears(e.endDate, years) : null };
        }),
      }
    : {};
  await db.insert(admissionGuide).values({ id: crypto.randomUUID(), schoolId: school.id, admissionYear: parsed.admissionYear, ...values, ...announce });
  if (!latest) return "baseline"; // 第一次检查：作为基准（多半是往年要项），日历显示仮日程，不发通知
  if (isNewYear) {
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
    // 系统任务：只记成本（ai_usage，userId 为空），不扣任何用户的 credit
    const meter = new UsageMeter();
    const parsed = await extractGuide(school, page, meter).finally(() =>
      recordUsageSafe({ userId: null, feature: "admission_monitor", meter, refId: school.id }),
    );
    // 入试要点（要不要先联系教授、考试科目、语言要求）：解析到就更新，覆盖 AI 在对话里查的
    if (parsed?.requirements) {
      const requirements: AdmissionRequirements = { ...parsed.requirements, sourceUrl: parsed.pdfUrl ?? school.url, source: "monitor", updatedAt: new Date().toISOString() };
      await db.update(graduateSchool).set({ requirements }).where(eq(graduateSchool.id, school.id));
    }
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

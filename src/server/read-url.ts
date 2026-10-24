import "server-only";
import { generateText } from "ai";
import { assertPublicUrl, htmlToText } from "@/lib/admissions";
import { getVisionModel } from "@/lib/ai/model";
import type { UsageMeter } from "@/lib/credits";
import { pdfPageImages, pdfPageTexts } from "./pdf-text";
import { fetchPage } from "./search";

// 聊天里 fetch_page 的实现。DeepSeek 抓取服务读不了不少大学的 PDF 募集要项（学芸大的就是），
// 所以先直接下载：PDF 在本地按页取文字，扫描版转成图片交给 flash 转写；网页仍优先用抓取服务（Markdown 更干净），
// 抓取服务失败时用直接下载到的 HTML 去标签。直接下载不了（网站拒绝）再整个交给抓取服务。

const TIMEOUT_MS = 20_000;
const MAX_PDF_BYTES = 20_000_000;
const MAX_HTML_BYTES = 3_000_000;
const PAGE_LIMIT = 15_000;
/** 募集要项 PDF 常有十几到几十页，考试科目、面接一览在中间，读多一些 */
const PDF_LIMIT = 50_000;
/** 扫描版最多转写前几页；每次给 flash 几页，避免一次输出太长被截断 */
const SCAN_MAX_PAGES = 20;
const SCAN_BATCH = 4;

type Direct = { kind: "pdf"; data: Uint8Array } | { kind: "html"; html: string };

export async function download(url: string): Promise<Direct> {
  assertPublicUrl(url);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept-Language": "ja,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.url) assertPublicUrl(res.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  if (/pdf/i.test(contentType) || new TextDecoder().decode(buf.subarray(0, 5)) === "%PDF-") {
    if (buf.length > MAX_PDF_BYTES) throw new Error("PDF 太大");
    return { kind: "pdf", data: buf };
  }
  if (buf.length > MAX_HTML_BYTES) throw new Error("页面太大");
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(buf.subarray(0, 2048)))?.[1];
  let html: string;
  try {
    html = new TextDecoder(charset ?? "utf-8").decode(buf);
  } catch {
    html = new TextDecoder().decode(buf);
  }
  return { kind: "html", html };
}

function clip(content: string, limit: number) {
  return content.length > limit ? `${content.slice(0, limit)}\n\n（后文省略）` : content;
}

/** 扫描版 PDF：页面图片分批交给 flash 转写成文字 */
async function transcribeScanned(data: Uint8Array, meter?: UsageMeter): Promise<string[]> {
  const images = await pdfPageImages(data, { maxPages: SCAN_MAX_PAGES });
  const batches: Uint8Array[][] = [];
  for (let i = 0; i < images.length; i += SCAN_BATCH) batches.push(images.slice(i, i + SCAN_BATCH));
  const results = await Promise.all(
    batches.map(async (batch, b) => {
      const first = b * SCAN_BATCH + 1;
      const { text, totalUsage } = await generateText({
        model: getVisionModel(),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `下面是一份扫描版 PDF 的第 ${first}–${first + batch.length - 1} 页图片。请按原文逐页转写成文字（日文保持日文，表格用 Markdown 表格），不要总结、不要省略、不要加解释。每页开头写一行「--- 第 N 页 ---」。`,
              },
              ...batch.map((img) => ({ type: "file" as const, data: img, mediaType: "image/jpeg" })),
            ],
          },
        ],
      });
      meter?.addTokens(totalUsage);
      return text.trim();
    }),
  );
  return results;
}

/** 有文字层的 PDF：按页标出页码；几乎没有文字（扫描版）返回 null */
export function pdfTextContent(pages: string[]): string | null {
  if (pages.join("").trim().length <= 200) return null;
  return `（PDF，共 ${pages.length} 页）\n\n${pages.map((t, i) => `--- 第 ${i + 1} 页 ---\n${t}`).join("\n\n")}`;
}

/** PDF 的文字：有文字层直接取，扫描版转写（看图模型的用量记在 meter 上） */
export async function readPdf(data: Uint8Array, meter?: UsageMeter): Promise<string> {
  const pages = await pdfPageTexts(data);
  const text = pdfTextContent(pages);
  if (text) return text;
  const parts = await transcribeScanned(data, meter);
  const note = pages.length > SCAN_MAX_PAGES ? `，扫描版，转写了前 ${SCAN_MAX_PAGES} 页` : "，扫描版，已转写";
  return `（PDF，共 ${pages.length} 页${note}）\n\n${parts.join("\n\n")}`;
}

/** 读取网页或 PDF 的正文，截断以控制 token */
export async function readUrl(url: string, meter?: UsageMeter): Promise<{ url: string; content: string }> {
  let direct: Direct | null = null;
  try {
    direct = await download(url);
  } catch (error) {
    console.warn(`[read-url] 直接下载失败 ${url}`, error);
  }
  if (direct?.kind === "pdf") return { url, content: clip(await readPdf(direct.data, meter), PDF_LIMIT) };
  try {
    return await fetchPage(url, meter, PAGE_LIMIT);
  } catch (error) {
    if (direct?.kind !== "html") throw error;
    const text = htmlToText(direct.html);
    if (!text.trim()) throw error;
    return { url, content: clip(text, PAGE_LIMIT) };
  }
}

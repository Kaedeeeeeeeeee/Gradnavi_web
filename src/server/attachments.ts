import "server-only";
import { generateText } from "ai";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { chatAttachment } from "@/db/schema";
import { getVisionModel } from "@/lib/ai/model";
import { attachmentKind, clipContent, cleanFileName, normalizedType, uploadProblem, type AttachmentRef } from "@/lib/attachments";
import type { UsageMeter } from "@/lib/credits";
import { docxToText } from "./docx-text";
import { pdfPageTexts } from "./pdf-text";
import { pdfTextContent, readPdf } from "./read-url";

// 聊天附件的存取和取文字（说明见 src/lib/attachments.ts）。

/** 给用户看的上传错误 */
export class UploadError extends Error {}

/** 文件头和声称的类型对得上（防止把别的文件改个扩展名传上来） */
function looksLike(kind: string, mediaType: string, b: Uint8Array): boolean {
  const ascii = (from: number, to: number) => new TextDecoder("latin1").decode(b.subarray(from, to));
  if (kind === "pdf") return ascii(0, 1024).includes("%PDF-");
  if (kind === "docx") return b[0] === 0x50 && b[1] === 0x4b;
  if (kind === "image") {
    if (mediaType === "image/png") return b[0] === 0x89 && ascii(1, 4) === "PNG";
    if (mediaType === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8;
    if (mediaType === "image/gif") return ascii(0, 4) === "GIF8";
    if (mediaType === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    return false;
  }
  return true;
}

/** 文本文件：先按 UTF-8，不是的话按 GB18030（国内 Windows 存的 txt 常是 GBK） */
function decodeText(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("gb18030").decode(b);
  }
}

/** 保存上传的文件；PDF（有文字层）、Word、文本当场取好文字 */
export async function saveAttachment(userId: string, file: File): Promise<AttachmentRef> {
  const problem = uploadProblem(file);
  if (problem) throw new UploadError(problem);
  const name = cleanFileName(file.name);
  const kind = attachmentKind(file.type, name)!;
  const mediaType = normalizedType(kind, file.type, name);
  const data = new Uint8Array(await file.arrayBuffer());
  if (!looksLike(kind, mediaType, data)) throw new UploadError(`「${name}」的内容和文件格式对不上，可能已损坏`);

  let content: string | null = null;
  let pages: number | null = null;
  try {
    if (kind === "pdf") {
      const texts = await pdfPageTexts(data);
      pages = texts.length;
      content = pdfTextContent(texts);
    } else if (kind === "docx") content = docxToText(data);
    else if (kind === "text") content = decodeText(data).replace(/^﻿/, "");
  } catch (error) {
    console.warn(`[attachments] 读取失败 ${name}`, error);
    throw new UploadError(kind === "pdf" ? `「${name}」打不开，可能加了密码或已损坏` : `「${name}」读不出内容，请另存为 PDF 再发`);
  }

  const id = crypto.randomUUID();
  await db.insert(chatAttachment).values({ id, userId, name, mediaType, size: data.length, data, content: content === null ? null : clipContent(content), pages });
  return { id, name, mediaType, size: data.length };
}

/** 下载 / 预览用：只能取自己的文件 */
export async function getAttachmentFile(userId: string, id: string) {
  const [row] = await db
    .select({ name: chatAttachment.name, mediaType: chatAttachment.mediaType, data: chatAttachment.data })
    .from(chatAttachment)
    .where(and(eq(chatAttachment.id, id), eq(chatAttachment.userId, userId)));
  return row ?? null;
}

/** 发出消息后把附件归到这段对话（对话删了附件一起删） */
export async function claimAttachments(userId: string, conversationId: string, ids: string[]) {
  if (!ids.length) return;
  await db
    .update(chatAttachment)
    .set({ conversationId })
    .where(and(eq(chatAttachment.userId, userId), inArray(chatAttachment.id, ids), isNull(chatAttachment.conversationId)));
}

/** 这个用户的哪些附件存在（客户端发来的 id 只认自己的） */
export async function ownedAttachmentIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: chatAttachment.id })
    .from(chatAttachment)
    .where(and(eq(chatAttachment.userId, userId), inArray(chatAttachment.id, ids)));
  return new Set(rows.map((r) => r.id));
}

const IMAGE_PROMPT =
  "这是用户发给留学申请助手的一张图片（可能是简历、成绩单、证书、录取通知、网页或聊天截图，也可能是普通照片）。如果图里有文字，按原样逐字转写（保持原来的语言，表格用 Markdown 表格，不要省略、不要总结）；最后用一两句话说明这是什么图片。没有文字的图片，就描述画面内容。不要加评论或建议。";

/** 图片交给看图模型：先统一转成不超过 2000 像素的 JPEG（WebP、GIF 也能读，太大的照片缩小省 token） */
async function transcribeImage(data: Uint8Array, meter: UsageMeter): Promise<string> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(data));
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = await canvas.encode("jpeg", 85);
  const { text, totalUsage } = await generateText({
    model: getVisionModel(),
    messages: [{ role: "user", content: [{ type: "text", text: IMAGE_PROMPT }, { type: "file", data: jpeg, mediaType: "image/jpeg" }] }],
  });
  meter.addTokens(totalUsage);
  return text.trim();
}

/**
 * 发给模型前取出附件的文字。还没有文字的（图片、扫描版 PDF）这时转写并存下来，用量记在本轮对话的 meter 上；
 * 失败的记下来，之后不再重试（发给模型时说明没读出来）。
 */
export async function attachmentContents(userId: string, ids: string[], meter: UsageMeter): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  const rows = await db
    .select({ id: chatAttachment.id, name: chatAttachment.name, mediaType: chatAttachment.mediaType, content: chatAttachment.content, failed: chatAttachment.failed })
    .from(chatAttachment)
    .where(and(eq(chatAttachment.userId, userId), inArray(chatAttachment.id, ids)));
  await Promise.all(
    rows.map(async (row) => {
      if (row.content !== null || row.failed) {
        out.set(row.id, row.content);
        return;
      }
      const [{ data }] = await db.select({ data: chatAttachment.data }).from(chatAttachment).where(eq(chatAttachment.id, row.id));
      try {
        const kind = attachmentKind(row.mediaType, row.name);
        const text = clipContent(kind === "pdf" ? await readPdf(data, meter) : await transcribeImage(data, meter));
        await db.update(chatAttachment).set({ content: text }).where(eq(chatAttachment.id, row.id));
        out.set(row.id, text);
      } catch (error) {
        console.warn(`[attachments] 转写失败 ${row.name}`, error);
        await db.update(chatAttachment).set({ failed: true }).where(eq(chatAttachment.id, row.id));
        out.set(row.id, null);
      }
    }),
  );
  return out;
}

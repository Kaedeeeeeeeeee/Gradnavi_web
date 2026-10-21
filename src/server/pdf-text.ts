import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

// 募集要项 PDF 的文字：直接下载后在本地用 pdf.js（unpdf）取出，不经过 DeepSeek 抓取服务
// （有些大学的 PDF 抓取服务拿不到，但直接下载是好的）。扫描版 PDF 没有文字层，返回空字符串。

export async function pdfToText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

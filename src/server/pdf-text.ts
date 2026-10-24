import "server-only";
import { createIsomorphicCanvasFactory, extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

// 募集要项 PDF 的文字：直接下载后在本地用 pdf.js（unpdf）取出，不经过 DeepSeek 抓取服务
// （有些大学的 PDF 抓取服务拿不到，但直接下载是好的）。扫描版 PDF 没有文字层，返回空字符串，
// 这时用 pdfPageImages 把页面转成图片交给 DeepSeek flash 看。

export async function pdfToText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 按页取文字（聊天里读 PDF 用：标出页码，AI 才能说「见 p.15」） */
export async function pdfPageTexts(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((t) => t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
}

const canvasImport = () => import("@napi-rs/canvas");

/**
 * 扫描版 PDF 的前 maxPages 页转成 JPEG（白底，宽 width 像素）。DeepSeek 每张图最多算 1024 个 token，
 * 再大也不会更清楚；JPEG 比 PNG 小得多，几十页也不会超过请求大小上限。
 */
export async function pdfPageImages(data: Uint8Array, { maxPages = 30, width = 1240 } = {}): Promise<Uint8Array[]> {
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  const { createCanvas, loadImage } = await canvasImport();
  const pdf = await getDocumentProxy(new Uint8Array(data), { CanvasFactory });
  try {
    const images: Uint8Array[] = [];
    for (let page = 1; page <= Math.min(pdf.numPages, maxPages); page++) {
      const png = await renderPageAsImage(pdf, page, { canvasImport, width });
      const img = await loadImage(Buffer.from(png));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);
      images.push(await canvas.encode("jpeg", 80));
    }
    return images;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** 一页转成 JPEG（申请表预览的底图） */
export async function pdfPageImage(data: Uint8Array, page: number, width = 1240): Promise<Uint8Array> {
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  const { createCanvas, loadImage } = await canvasImport();
  const pdf = await getDocumentProxy(new Uint8Array(data), { CanvasFactory });
  try {
    const png = await renderPageAsImage(pdf, page, { canvasImport, width });
    const img = await loadImage(Buffer.from(png));
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    return await canvas.encode("jpeg", 85);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

import "server-only";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { concatTransformationMatrix, drawObject, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFRadioGroup, PDFRef, PDFTextField, popGraphicsState, pushGraphicsState } from "pdf-lib";
import puppeteer from "puppeteer-core";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import {
  cellsFromSegments,
  fitText,
  labelCells,
  MAX_FORM_PAGES,
  parsePages,
  round,
  type AcroField,
  type FormField,
  type FormLayout,
  type FormMode,
  type FormPage,
  type Segment,
  type TextItem,
} from "@/lib/forms";
import { chromiumPath, loadFontCss } from "./pdf";

// 申请表 PDF 的读取和生成。
// 读取：pdf.js（unpdf）取文字和表格线（算格子），pdf-lib 取 AcroForm 填写栏；只留下要填的那几页存起来。
// 生成：每页用 Chromium 排一张透明的「字层」PDF（日文字体和文书导出用的同一套 Noto Serif JP），
// 再用 pdf-lib 盖到原页面上；原来的填写栏去掉（不依赖阅读器的字体，打印出来和预览一致）。

type Matrix = [number, number, number, number, number, number];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;
function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

const FORM_WORDS = /氏\s*名|フリガナ|ふりがな|生年月日|現住所|入学願書|願書|様式|履歴書|志望|記入|Name|Date of Birth/i;

type PageScan = { page: FormPage; texts: Omit<TextItem, "id">[]; segments: Segment[]; matrix: Matrix };

/** 一页的文字段（同一行挨着的合成一段）和表格线，坐标换成显示方向、左上角为原点 */
async function scanPage(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, index: number): Promise<PageScan> {
  const { OPS, Util } = await getResolvedPDFJS();
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const vt = viewport.transform as Matrix;

  const raw: Omit<TextItem, "id">[] = [];
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const tx = Util.transform(vt, item.transform) as Matrix;
    const size = Math.hypot(tx[2], tx[3]);
    // 只处理横排文字
    if (Math.abs(tx[1]) > 0.01 * size || size <= 0) continue;
    const scale = Math.hypot(tx[0], tx[1]) / Math.hypot(item.transform[0], item.transform[1]);
    raw.push({ page: index, text: item.str, x: tx[4], y: tx[5] - size * 0.88, w: item.width * scale, h: size });
  }
  raw.sort((a, b) => a.y - b.y || a.x - b.x);
  const texts: Omit<TextItem, "id">[] = [];
  for (const t of raw) {
    const last = texts.at(-1);
    if (last && Math.abs(last.y - t.y) < t.h * 0.3 && Math.abs(last.h - t.h) < t.h * 0.3 && t.x >= last.x + last.w - 1 && t.x - (last.x + last.w) < t.h * 0.25) {
      last.text += t.text;
      last.w = t.x + t.w - last.x;
    } else texts.push({ ...t });
  }

  // 表格线：线段，以及很细的填充矩形（Word、Chromium 生成的表格边框常是这种）
  const segments: Segment[] = [];
  const ops = await page.getOperatorList();
  let ctm: Matrix = vt;
  const stack: Matrix[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? vt;
    else if (fn === OPS.transform) ctm = mul(ctm, args as Matrix);
    else if (fn === OPS.constructPath && segments.length < 5000) {
      const [paint, [data]] = args as [number, [ArrayLike<number> | null]];
      if (paint < OPS.stroke || paint > OPS.closeEOFillStroke || !data) continue;
      collectSegments(data, ctm, paint === OPS.stroke || paint === OPS.closeStroke, segments);
    }
  }
  page.cleanup();
  return { page: { w: viewport.width, h: viewport.height }, texts, segments, matrix: vt };
}

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

function collectSegments(data: ArrayLike<number>, ctm: Matrix, stroked: boolean, out: Segment[]) {
  // 拆成子路径，每个子路径是一串点
  const paths: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < data.length; ) {
    const op = data[i];
    if (op === DRAW.moveTo) {
      if (cur.length) paths.push(cur);
      cur = [[data[i + 1], data[i + 2]]];
      i += 3;
    } else if (op === DRAW.lineTo) {
      cur.push([data[i + 1], data[i + 2]]);
      i += 3;
    } else if (op === DRAW.curveTo) {
      // 曲线不是表格线，断开
      if (cur.length) paths.push(cur);
      cur = [[data[i + 5], data[i + 6]]];
      i += 7;
    } else if (op === DRAW.quadraticCurveTo) {
      if (cur.length) paths.push(cur);
      cur = [[data[i + 3], data[i + 4]]];
      i += 5;
    } else if (op === DRAW.closePath) {
      if (cur.length) cur.push(cur[0]);
      i += 1;
    } else break;
  }
  if (cur.length) paths.push(cur);
  for (const p of paths) {
    const pts = p.map(([x, y]) => apply(ctm, x, y));
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    // 细长矩形 = 一条线
    if (!stroked && pts.length >= 4 && (w <= 2.5 || h <= 2.5)) {
      if (w <= 2.5 && h > 2.5) out.push({ x1: Math.min(...xs) + w / 2, y1: Math.min(...ys), x2: Math.min(...xs) + w / 2, y2: Math.max(...ys) });
      else if (h <= 2.5 && w > 2.5) out.push({ x1: Math.min(...xs), y1: Math.min(...ys) + h / 2, x2: Math.max(...xs), y2: Math.min(...ys) + h / 2 });
      continue;
    }
    for (let k = 1; k < pts.length; k++) out.push({ x1: pts[k - 1][0], y1: pts[k - 1][1], x2: pts[k][0], y2: pts[k][1] });
  }
}

/** PDF 自带的填写栏（只取选中的页上的），坐标换成显示方向 */
function acroFields(doc: PDFDocument, pageIndexes: number[], matrices: Map<number, Matrix>): Omit<AcroField, "id">[] {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const pageRefs = doc.getPages().map((p) => p.ref);
  const out: Omit<AcroField, "id">[] = [];
  for (const field of form.getFields()) {
    const kind = field instanceof PDFTextField ? "text" : field instanceof PDFCheckBox ? "checkbox" : field instanceof PDFRadioGroup ? "radio" : field instanceof PDFDropdown ? "dropdown" : null;
    if (!kind) continue;
    const options = field instanceof PDFRadioGroup || field instanceof PDFDropdown ? field.getOptions() : undefined;
    for (const widget of field.acroField.getWidgets()) {
      const pRef = widget.P();
      let pageIndex = pRef ? pageRefs.findIndex((r) => r === pRef || (r instanceof PDFRef && pRef instanceof PDFRef && r.objectNumber === pRef.objectNumber)) : -1;
      if (pageIndex < 0) pageIndex = doc.getPages().findIndex((p) => (p.node.Annots()?.asArray() ?? []).some((a) => a === widget.dict || doc.context.lookup(a) === widget.dict));
      const at = pageIndexes.indexOf(pageIndex);
      const m = matrices.get(pageIndex);
      if (at < 0 || !m) continue;
      const r = widget.getRectangle();
      const [x1, y1] = apply(m, r.x, r.y);
      const [x2, y2] = apply(m, r.x + r.width, r.y + r.height);
      out.push({ page: at, name: field.getName(), kind, options, ...round({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }) });
    }
  }
  return out;
}

export type AnalyzedForm = {
  /** 只含要填的几页、去掉了填写栏的 PDF（存进数据库，生成和预览都用它） */
  pdf: Uint8Array;
  layout: FormLayout;
  mode: FormMode;
  /** 原 PDF 里的第几页（从 1 起） */
  sourcePages: number[];
  totalPages: number;
  /** 表上所有文字（找「手書き」这类要求用） */
  text: string;
};

export class FormPdfError extends Error {}

/**
 * 读一份申请表 PDF。pagesSpec 指定要填的页（募集要项里夹着的様式）；不指定时：不超过 MAX_FORM_PAGES 页就全要，
 * 否则挑像表格的页（有「氏名」「様式」之类的字、格子多）。
 */
export async function analyzeFormPdf(data: Uint8Array, pagesSpec?: string): Promise<AnalyzedForm> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new FormPdfError("这个 PDF 打不开（可能损坏或加了密码）");
  }
  if (src.isEncrypted) throw new FormPdfError("这个 PDF 加了密码保护，没法直接填写");
  const proxy = await getDocumentProxy(new Uint8Array(data));
  try {
    const total = proxy.numPages;
    let indexes = parsePages(pagesSpec, total);
    const scans = new Map<number, PageScan>();
    const scan = async (i: number) => {
      if (!scans.has(i)) scans.set(i, await scanPage(proxy, i));
      return scans.get(i)!;
    };
    if (!indexes.length) {
      if (total <= MAX_FORM_PAGES) indexes = Array.from({ length: total }, (_, i) => i);
      else {
        const scored: { i: number; score: number }[] = [];
        for (let i = 0; i < Math.min(total, 60); i++) {
          const s = await scan(i);
          const text = s.texts.map((t) => t.text).join("");
          const score = (FORM_WORDS.test(text) ? 10 : 0) + Math.min(10, cellsFromSegments(s.segments).length / 4);
          if (score >= 12) scored.push({ i, score });
        }
        indexes = scored.slice(0, MAX_FORM_PAGES).map((s) => s.i);
        if (!indexes.length) throw new FormPdfError(`这个 PDF 有 ${total} 页，没认出哪几页是要填的表，请告诉我页码（比如 12-13）`);
      }
    }
    if (indexes.length > MAX_FORM_PAGES) throw new FormPdfError(`一次最多填 ${MAX_FORM_PAGES} 页，请缩小页码范围`);

    const pages: FormPage[] = [];
    const texts: TextItem[] = [];
    const cells: FormLayout["cells"] = [];
    const matrices = new Map<number, Matrix>();
    for (const [at, i] of indexes.entries()) {
      const s = await scan(i);
      matrices.set(i, s.matrix);
      pages.push({ w: s.page.w, h: s.page.h });
      const pageTexts = s.texts.map((t, k) => ({ ...t, ...round(t), page: at, id: `t${texts.length + k + 1}` }));
      texts.push(...pageTexts);
      cells.push(...labelCells(at, cellsFromSegments(s.segments), pageTexts, cells.length + 1));
    }
    const acro = acroFields(src, indexes, matrices).map((a, k) => ({ ...a, id: `a${k + 1}` }));
    const mode: FormMode = acro.length ? "acroform" : texts.length < 5 ? "scanned" : "overlay";

    // 只留下这几页，去掉填写栏（widget 注释），之后字直接印在原位置
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indexes);
    for (const p of copied) {
      out.addPage(p);
      const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (annots) {
        const keep = annots.asArray().filter((a) => {
          const d = out.context.lookupMaybe(a, PDFDict);
          return d?.get(PDFName.of("Subtype"))?.toString() !== "/Widget";
        });
        p.node.set(PDFName.of("Annots"), out.context.obj(keep));
      }
    }
    const pdf = await out.save();
    return { pdf, layout: { pages, texts, cells, acro }, mode, sourcePages: indexes.map((i) => i + 1), totalPages: total, text: texts.map((t) => t.text).join(" ") };
  } finally {
    await proxy.loadingTask.destroy();
  }
}

// ---------- 生成 ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 一栏的 HTML（预览组件用同样的样式，见 form-view.tsx） */
export function fieldHtml(f: FormField): string {
  const value = f.value;
  if (!value) return "";
  const box = `left:${f.x}pt;top:${f.y}pt;width:${f.w}pt;height:${f.h}pt`;
  if (f.kind === "mark") {
    if (f.mark === "circle") return `<div class="m c" style="${box}"></div>`;
    const size = Math.min(f.w, f.h) * 0.9;
    return `<div class="m k" style="${box};font-size:${size}pt;line-height:${f.h}pt">✓</div>`;
  }
  const { size } = fitText(value, f, f.multiline);
  const align = f.align ?? "left";
  const vertical = f.multiline ? "flex-start" : "center";
  return `<div class="t${f.multiline ? "" : " s"}" style="${box};font-size:${size}pt;justify-content:${vertical};text-align:${align}"><span>${esc(value)}</span></div>`;
}

const REFERENCE_NOTE = "参照用（記入見本）：この内容を見ながら、原本に手書きで記入してください。このまま提出しないでください。";

function overlayHtml(page: FormPage, fields: FormField[], fontCss: string, reference: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
@page { size: ${page.w}pt ${page.h}pt; margin: 0 }
html, body { margin: 0; padding: 0; background: transparent }
body { position: relative; width: ${page.w}pt; height: ${page.h}pt; overflow: hidden; font-family: "Noto Serif JP", serif; color: #111 }
.t, .m { position: absolute; box-sizing: border-box }
.t { display: flex; flex-direction: column; line-height: 1.25; white-space: pre-wrap; word-break: break-all; overflow: hidden }
.s { white-space: pre }
.c { border: 1pt solid #111; border-radius: 50% }
.k { text-align: center }
.ref { position: absolute; left: 0; right: 0; top: 4pt; text-align: center; font-size: 7.5pt; color: #b91c1c }
</style></head><body>${reference ? `<div class="ref">${REFERENCE_NOTE}</div>` : ""}${fields.map(fieldHtml).join("")}</body></html>`;
}

/** 填好的 PDF：原页面 + 印上的字。reference = 学校要求手写，页顶印上「参照用」 */
export async function renderFilledPdf(source: Uint8Array, layout: FormLayout, fields: FormField[], reference: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  const fontCss = await loadFontCss();
  const dir = await mkdtemp(path.join(tmpdir(), "gradnavi-form-"));
  const browser = await puppeteer.launch({ executablePath: chromiumPath(), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  try {
    const tab = await browser.newPage();
    await tab.setJavaScriptEnabled(false);
    await tab.setRequestInterception(true);
    tab.on("request", (req) => (req.url().startsWith("file://") ? req.continue() : req.abort()));
    const proxy = await getDocumentProxy(new Uint8Array(source));
    try {
      for (const [i, page] of doc.getPages().entries()) {
        const info = layout.pages[i];
        const onPage = fields.filter((f) => f.page === i && f.value);
        if (!info || (!onPage.length && !reference)) continue;
        const file = path.join(dir, `p${i}.html`);
        await writeFile(file, overlayHtml(info, onPage, fontCss, reference));
        await tab.goto(pathToFileURL(file).href, { waitUntil: "networkidle0", timeout: 30_000 });
        const overlay = await tab.pdf({ width: `${(info.w * 4) / 3}px`, height: `${(info.h * 4) / 3}px`, printBackground: false, omitBackground: true, pageRanges: "1" });
        const [embedded] = await doc.embedPdf(overlay, [0]);
        // 字层的坐标（左下原点、显示方向）→ 原页面的用户坐标：先翻成左上原点，再用 pdf.js 视口变换的逆
        const vt = (await proxy.getPage(i + 1)).getViewport({ scale: 1 }).transform as Matrix;
        const m = mul(invert(vt), [1, 0, 0, -1, 0, info.h]);
        // 字层 PDF 的页面可能被 Chromium 取整，按实际大小缩放回去
        const sx = info.w / embedded.width;
        const sy = info.h / embedded.height;
        const name = page.node.newXObject("GnFill", embedded.ref);
        // 原页面的内容流可能改了坐标系没有还原，先用 q … Q 包起来
        const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]));
        const end = doc.context.register(doc.context.contentStream([popGraphicsState()]));
        page.node.wrapContentStreams(start, end);
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]), drawObject(name), popGraphicsState());
      }
    } finally {
      await proxy.loadingTask.destroy();
    }
    return await doc.save();
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}

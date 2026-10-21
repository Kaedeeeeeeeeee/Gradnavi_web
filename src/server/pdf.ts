import "server-only";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { buildPrintHtml } from "@/lib/doc-html";

// 服务器端用 Chromium 把文书渲染成 A4 PDF。
// 字体：@fontsource/noto-serif-jp（随应用打包，不访问外网），只用 400/700 两个字重。
// Chromium：环境变量 CHROMIUM_PATH，或常见安装位置（Docker 镜像里是 apk 装的 chromium）。

const FONT_DIR = path.join(process.cwd(), "node_modules/@fontsource/noto-serif-jp");
const CHROMIUM_CANDIDATES = ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/opt/pw-browsers/chromium"];

function chromiumPath() {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  const found = CHROMIUM_CANDIDATES.find((p) => existsSync(p));
  if (found) return found;
  throw new Error("找不到 Chromium，请设置 CHROMIUM_PATH");
}

let fontCss: Promise<string> | null = null;

/** fontsource 的 CSS 用相对路径引用字体文件，改成绝对 file:// 地址 */
function loadFontCss() {
  fontCss ??= Promise.all(["400.css", "700.css"].map((f) => readFile(path.join(FONT_DIR, f), "utf8"))).then((parts) =>
    parts
      .join("\n")
      // 只保留 woff2，不带 woff 备选（文件更小，Chromium 都支持）
      .replace(/, url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/g, "")
      .replace(/url\(\.\/files\//g, `url(${pathToFileURL(path.join(FONT_DIR, "files"))}/`),
  );
  return fontCss;
}

export async function renderDocumentPdf(title: string, markdown: string): Promise<Uint8Array> {
  const html = buildPrintHtml({ title, markdown, fontCss: await loadFontCss() });
  // 写成本地文件再打开，页面才能加载 file:// 字体
  const dir = await mkdtemp(path.join(tmpdir(), "gradnavi-pdf-"));
  const file = path.join(dir, "doc.html");
  await writeFile(file, html);
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    // 只允许加载本地文件（文档本身和字体），屏蔽一切网络请求
    await page.setRequestInterception(true);
    page.on("request", (req) => (req.url().startsWith("file://") ? req.continue() : req.abort()));
    // 等字体分片都加载完（networkidle0 = 没有进行中的请求）
    await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle0", timeout: 30_000 });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}

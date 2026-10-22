import { Marked, type TokenizerAndRendererExtension } from "marked";
import { colorSpanStart, matchColorSpan, PRINT_COLORS, type ColorKind, type DocColor } from "./doc-color";

// 文书 Markdown → 打印用 HTML（A4，日文明朝体），供服务器端 Chromium 生成 PDF。

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// 文字颜色、背景色：{color:red}…{/color}、{bg:yellow}…{/bg}（见 doc-color.ts）
const colorSpan: TokenizerAndRendererExtension = {
  name: "docColor",
  level: "inline",
  start: colorSpanStart,
  tokenizer(src) {
    const m = matchColorSpan(src);
    if (!m) return;
    return { type: "docColor", raw: m.raw, kind: m.kind, color: m.color, tokens: this.lexer.inlineTokens(m.inner) };
  },
  renderer(token) {
    const c = PRINT_COLORS[token.color as DocColor];
    const style = (token.kind as ColorKind) === "color" ? `color:${c.text}` : `background-color:${c.bg}`;
    return `<span style="${style}">${this.parser.parseInline(token.tokens ?? [])}</span>`;
  },
};

// 原样 HTML 一律转义，只渲染 Markdown 语法
const marked = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
  extensions: [colorSpan],
});

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false });
}

/** fontCss：@font-face 声明（字体文件本地加载），title 用于 PDF 元数据 */
export function buildPrintHtml(opts: { title: string; markdown: string; fontCss: string }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
${opts.fontCss}
@page { size: A4; margin: 25mm 22mm; }
html { font-family: "Noto Serif JP", serif; font-size: 10.5pt; line-height: 1.8; color: #000; }
body { margin: 0; }
h1 { font-size: 16pt; text-align: center; margin: 0 0 1.2em; }
h2 { font-size: 12pt; margin: 1.4em 0 0.4em; break-after: avoid; }
h3 { font-size: 11pt; margin: 1.2em 0 0.3em; break-after: avoid; }
p { margin: 0 0 0.6em; text-align: justify; text-indent: 1em; }
li > p, blockquote p { text-indent: 0; }
ul, ol { margin: 0 0 0.6em; padding-left: 1.6em; }
blockquote { margin: 0 0 0.6em; padding-left: 1em; border-left: 2px solid #999; color: #333; }
code { font-size: 0.9em; }
hr { border: 0; border-top: 1px solid #999; margin: 1em 0; }
table { border-collapse: collapse; margin: 0 0 0.6em; }
th, td { border: 1px solid #999; padding: 0.2em 0.5em; }
</style>
</head>
<body>
${markdownToHtml(opts.markdown)}
</body>
</html>`;
}

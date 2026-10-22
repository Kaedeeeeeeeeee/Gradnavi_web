import { Marked } from "marked";

// AI 回答的 Markdown → HTML（对话面板里显示）。流式输出时每次都整段重新解析，半截的语法也能正常显示。
// 原样 HTML 一律转义；链接只放行 http(s) 和 mailto，新标签页打开；图片只显示成链接，不加载外部图片。

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null);

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = safeHref(href);
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    },
    image({ href, text }) {
      const url = safeHref(href);
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text || url)}</a>` : escapeHtml(text);
    },
    table(token) {
      // 宽表格在窄面板里横向滚动
      const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</th>`).join("");
      const rows = token.rows
        .map((r) => `<tr>${r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`)
        .join("");
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    },
  },
});

export function chatMarkdownToHtml(md: string): string {
  return marked.parse(md, { async: false });
}

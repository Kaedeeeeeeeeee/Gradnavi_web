// 「加入对话」：用户在 AI 回复、文稿、页面里选中一段文字加进输入框，随下一条消息一起发给 AI。
// 用户可以给每段写一句评论（可不填），和原文一起发。
// 前端把引用放在用户消息的 data-quotes 部分里（聊天记录里也显示），发给模型时转成一段文字放在用户的话前面。

export type Quote = { text: string; source: string; comment?: string };

export const MAX_QUOTES = 10;
const MAX_TEXT = 2000;
const MAX_SOURCE = 80;
const MAX_COMMENT = 1000;

/** 选中的文字：去掉首尾空白，多个空行压成一个，太长截断 */
export function cleanQuoteText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** 校验客户端发来的引用（不合格的丢掉） */
export function parseQuotes(data: unknown): Quote[] {
  if (!Array.isArray(data)) return [];
  return data
    .flatMap((q) => {
      if (!q || typeof q !== "object") return [];
      const { text, source, comment } = q as Record<string, unknown>;
      if (typeof text !== "string") return [];
      const clean = cleanQuoteText(text);
      if (!clean) return [];
      const note = typeof comment === "string" ? comment.trim().slice(0, MAX_COMMENT) : "";
      return [{ text: clean, source: typeof source === "string" && source.trim() ? source.trim().slice(0, MAX_SOURCE) : "对话", ...(note ? { comment: note } : {}) }];
    })
    .slice(0, MAX_QUOTES);
}

/** 发给模型的文字：编号和输入框里的标签一致，用户说「1」就是第 1 段 */
export function quotesForModel(quotes: Quote[]): string {
  if (!quotes.length) return "";
  const lines = quotes.map((q, i) => `[${i + 1}] 出自${q.source}：\n${q.text.replace(/^/gm, "> ")}${q.comment ? `\n用户对这段的评论：${q.comment}` : ""}`);
  return `用户选中了下面 ${quotes.length} 段内容，加进了这条消息（编号 [1]、[2]… 对应用户说的「1」「2」或「这段」）：\n\n${lines.join("\n\n")}\n\n（以上是引用。下面是用户这条消息的正文；没有正文时，就根据引用和用户的评论回应。）`;
}

/** 输入框标签上的简短文字 */
export function quoteSnippet(text: string, max = 24): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

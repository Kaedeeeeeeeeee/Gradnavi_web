// 纯文本里的网址拆出来，显示时做成可点的链接（子步骤这类用户和 AI 写的短文本）。

export type TextPart = { text: string; url?: undefined } | { url: string; text?: undefined };

/** 网址后面紧跟的中文标点、括号不算网址的一部分 */
const URL_RE = /https?:\/\/[^\s<>"'（）「」『』，。、；：！？]+/g;

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    const start = m.index!;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

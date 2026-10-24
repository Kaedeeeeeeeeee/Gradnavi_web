// 套磁信「用邮箱打开」：在用户自己的邮箱里打开一封写好的信（收件人、标题、正文都填好），由用户检查后自己点发送。
// GradNavi 不代发邮件。日文正文编码后很长，链接放不下时只带收件人和标题，正文靠剪贴板粘贴。

export type LetterMail = { to: string; subject: string; body: string };

/** 第一行「件名：…」是邮件标题，其余是正文 */
export function splitLetter(text: string): { subject: string; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim());
  const m = first >= 0 ? lines[first].trim().match(/^(?:件名|标题|標題|主题|主題|subject)\s*[:：]\s*(.*)$/i) : null;
  if (!m) return { subject: "", body: text.trim() };
  return { subject: m[1].trim(), body: lines.slice(first + 1).join("\n").trim() };
}

const EMAIL = /^[^\s@<>()（）,，;；]+@[^\s@<>()（）,，;；]+\.[^\s@<>()（）,，;；]+$/;

export function isEmail(value: string) {
  return EMAIL.test(value.trim());
}

/** 链接最长多少字符还带正文：系统邮件应用（Windows 上一些客户端会截断太长的 mailto）、网页邮箱 */
export const MAILTO_LIMIT = 8000;
export const WEBMAIL_LIMIT = 16000;

export type MailClient = "default" | "gmail" | "outlook" | "qq" | "163";

export const MAIL_CLIENTS: { id: MailClient; label: string }[] = [
  { id: "default", label: "电脑上的邮件应用" },
  { id: "gmail", label: "Gmail 网页版" },
  { id: "outlook", label: "Outlook 网页版" },
  { id: "qq", label: "QQ 邮箱网页版" },
  { id: "163", label: "163 邮箱网页版" },
];

const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, "\r\n"));

function query(params: [string, string][]) {
  return params
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${enc(v)}`)
    .join("&");
}

function build(client: MailClient, { to, subject, body }: LetterMail): string {
  switch (client) {
    case "default": {
      const q = query([["subject", subject], ["body", body]]);
      return `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, "@")}${q ? `?${q}` : ""}`;
    }
    case "gmail":
      return `https://mail.google.com/mail/?${query([["view", "cm"], ["fs", "1"], ["to", to.trim()], ["su", subject], ["body", body]])}`;
    case "outlook":
      return `https://outlook.live.com/mail/0/deeplink/compose?${query([["to", to.trim()], ["subject", subject], ["body", body]])}`;
    // QQ、163 网页版没有公开的「带正文写信」链接：打开邮箱首页，标题正文从剪贴板粘贴
    case "qq":
      return "https://mail.qq.com/";
    case "163":
      return "https://mail.163.com/";
  }
}

/**
 * 打开哪个链接，正文有没有带进去。正文带不进去时（链接太长、QQ/163）调用方要先把信复制到剪贴板。
 */
export function composeLink(client: MailClient, mail: LetterMail): { url: string; prefilled: "all" | "no-body" | "none" } {
  if (client === "qq" || client === "163") return { url: build(client, mail), prefilled: "none" };
  const limit = client === "default" ? MAILTO_LIMIT : WEBMAIL_LIMIT;
  const full = build(client, mail);
  if (full.length <= limit) return { url: full, prefilled: "all" };
  return { url: build(client, { ...mail, body: "" }), prefilled: "no-body" };
}

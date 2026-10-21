// 内测相关的纯函数

/** 从一段文本里拆出邮箱（逗号、空格、换行分隔都行） */
export function parseEmails(text: string): string[] {
  const found = text
    .split(/[\s,，;；]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return [...new Set(found)];
}

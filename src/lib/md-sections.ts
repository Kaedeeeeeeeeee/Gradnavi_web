// 按 “## 标题” 读写 Markdown 的某一节，供 AI 精确修改 user.md 而不必整篇重写

const HEADING = /^##\s+(.+?)\s*$/;

function findSection(lines: string[], heading: string) {
  const start = lines.findIndex((l) => HEADING.exec(l)?.[1] === heading.trim());
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  return { start, end };
}

export function listSections(md: string): string[] {
  return md.split("\n").flatMap((l) => {
    const m = HEADING.exec(l);
    return m ? [m[1]] : [];
  });
}

/**
 * replace：用 content 替换该节正文；append：追加到该节末尾。
 * 节不存在时在文末新建。
 */
export function upsertSection(md: string, heading: string, content: string, mode: "replace" | "append" = "replace"): string {
  const lines = md.replace(/\s+$/, "").split("\n");
  const body = content.trim().split("\n");
  const found = findSection(lines, heading);

  if (!found) {
    const prefix = lines.length === 1 && lines[0] === "" ? [] : [...lines, ""];
    return [...prefix, `## ${heading.trim()}`, ...body].join("\n") + "\n";
  }

  const old = lines.slice(found.start + 1, found.end);
  while (old.length && old[old.length - 1].trim() === "") old.pop();
  const next = mode === "append" ? [...old, ...body] : body;
  const tail = lines.slice(found.end);
  return [...lines.slice(0, found.start + 1), ...next, ...(tail.length ? ["", ...tail] : [])].join("\n") + "\n";
}

/** 某一节的正文（不含标题行），没有这一节时返回空字符串 */
export function getSection(md: string, heading: string): string {
  const lines = md.split("\n");
  const found = findSection(lines, heading);
  return found ? lines.slice(found.start + 1, found.end).join("\n").trim() : "";
}

/** 删掉整节（含标题行），没有这一节时原样返回 */
export function removeSection(md: string, heading: string): string {
  const lines = md.split("\n");
  const found = findSection(lines, heading);
  if (!found) return md;
  const rest = [...lines.slice(0, found.start), ...lines.slice(found.end)];
  return rest.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** 一次修改某节前后的内容，用于撤销（before 为 null 表示这一节原来不存在） */
export type SectionChange = { section: string; before: string | null; after: string; content: string };

/**
 * 撤销一次分节修改：这一节没再被改过就恢复原样；改过的话只删掉这次写入的内容。
 * 这次写入的内容已经不在了返回 null。
 */
export function undoSectionChange(md: string, change: SectionChange): string | null {
  const exists = listSections(md).includes(change.section.trim());
  const current = getSection(md, change.section);
  if (exists && current === change.after.trim()) {
    return change.before === null ? removeSection(md, change.section) : upsertSection(md, change.section, change.before, "replace");
  }
  const content = change.content.trim();
  if (!exists || !content || !current.includes(content)) return null;
  const rest = current.replace(content, "").replace(/\n{3,}/g, "\n\n").trim();
  return rest ? upsertSection(md, change.section, rest, "replace") : removeSection(md, change.section);
}

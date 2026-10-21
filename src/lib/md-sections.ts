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

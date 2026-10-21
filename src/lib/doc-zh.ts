// 文书的中文对照（纯函数，服务器和编辑器共用）。
// 日文正文按段落（Markdown 里空行分隔的块）对应一段中文。对应关系用段落的“指纹”（去掉 Markdown 符号和空白的纯文字）：
//   - 指纹一致 → 中文是最新的
//   - 用户改了这段日文 → 指纹变了，沿用原位置的旧中文并标「待更新」，点一下重新翻译
// 标题不需要中文对照，不参与对应。

export type ZhEntry = { key: string; zh: string };
/** 一段日文对应的中文；null 表示还没有中文 */
export type ZhCell = { zh: string; stale: boolean; key: string } | null;

/** 按空行切成段落块 */
export function splitBlocks(md: string): string[] {
  return md
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

export const isHeadingBlock = (block: string) => /^#{1,6}\s/.test(block);

/** 段落指纹：去掉行首的 Markdown 标记、强调符号、转义和所有空白 */
export function blockKey(text: string): string {
  return text
    .replace(/^[ \t]*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, "")
    .replace(/[\\*_`~]/g, "")
    .replace(/\s+/g, "");
}

/** Markdown 里需要中文对照的段落（不含标题）的指纹，顺序与正文一致 */
export function translatableKeys(md: string): string[] {
  return splitBlocks(md)
    .filter((b) => !isHeadingBlock(b))
    .map(blockKey)
    .filter(Boolean);
}

/** 两段文字有多像（字的二元组 Dice 系数，0–1）。用来判断「这段是改过的那段」还是全新的一段 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

const STALE_MIN_SIMILARITY = 0.3;

/** 把已存的中文对应到当前段落上 */
export function alignZh(keys: string[], stored: ZhEntry[]): ZhCell[] {
  const used = new Set<number>();
  const match: number[] = keys.map(() => -1);
  const cells: ZhCell[] = keys.map(() => null);
  // 先按指纹精确匹配（尽量保持顺序）
  let from = 0;
  keys.forEach((k, i) => {
    const find = (start: number) => stored.findIndex((e, j) => j >= start && !used.has(j) && e.key === k);
    let j = find(from);
    if (j === -1) j = find(0);
    if (j === -1) return;
    used.add(j);
    match[i] = j;
    from = j + 1;
    cells[i] = { zh: stored[j].zh, stale: false, key: k };
  });
  // 改过的段落：沿用前一段之后那条没被用掉、内容相近的旧中文
  keys.forEach((k, i) => {
    if (match[i] !== -1) return;
    const j = (i === 0 ? -1 : match[i - 1]) + 1;
    if (j < 0 || j >= stored.length || used.has(j)) return;
    if (similarity(k, stored[j].key) < STALE_MIN_SIMILARITY) return;
    used.add(j);
    match[i] = j;
    cells[i] = { zh: stored[j].zh, stale: true, key: stored[j].key };
  });
  return cells;
}

/** 正文变了之后重新整理要保存的中文：精确匹配的保留，改过的段落保留旧中文（仍为待更新），删掉的段落丢弃 */
export function realignZh(md: string, stored: ZhEntry[]): ZhEntry[] {
  return alignZh(translatableKeys(md), stored).flatMap((c) => (c ? [{ key: c.key, zh: c.zh }] : []));
}

/** 把新中文写进去（按指纹覆盖），再按正文整理 */
export function withZh(md: string, stored: ZhEntry[], fresh: ZhEntry[]): ZhEntry[] {
  const freshKeys = new Set(fresh.map((e) => e.key));
  const keys = translatableKeys(md);
  // 新中文放在对应段落的位置上，旧的同指纹条目去掉
  const merged = [...stored.filter((e) => !freshKeys.has(e.key))];
  const aligned = alignZh(keys, merged);
  const out: ZhEntry[] = [];
  keys.forEach((k, i) => {
    const f = fresh.find((e) => e.key === k);
    if (f) out.push(f);
    else if (aligned[i]) out.push({ key: aligned[i]!.key, zh: aligned[i]!.zh });
  });
  return out;
}

/** AI 给的中文（空行分段）和它写的日文段落一一配对；段数对不上时按顺序配，多出来的忽略 */
export function pairZh(jaMarkdown: string, zh: string | string[]): ZhEntry[] {
  const ja = splitBlocks(jaMarkdown).filter((b) => !isHeadingBlock(b));
  const zhParas = (Array.isArray(zh) ? zh : splitBlocks(zh)).map((s) => s.trim()).filter((s) => s && !isHeadingBlock(s));
  return ja.slice(0, zhParas.length).flatMap((b, i) => {
    const key = blockKey(b);
    return key ? [{ key, zh: zhParas[i] }] : [];
  });
}

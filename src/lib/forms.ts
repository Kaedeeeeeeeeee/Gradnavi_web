// 申请表 PDF（入学願書、研究生出願票、履歴書等）：AI 下载学校的 PDF，按用户的资料填好，放在文书里查看、修改、下载。
// 这里是纯函数（服务器和浏览器共用）：版面描述、AI 回答的解析、字号排版。PDF 的读取和生成在 src/server/form-pdf.ts。
//
// 填法统一是「按位置印字」：
// - 有填写栏的 PDF（AcroForm）：用填写栏的位置，生成时把填写栏去掉、字印在原位置（日文字体不依赖 PDF 阅读器）
// - 没有填写栏的 PDF：从 PDF 里取出文字和表格线，算出一个个格子，AI 选「把什么填进哪个格子 / 哪个字的右边」
// - 扫描版（没有文字层）：AI 看页面图片估计位置，可能不准，用户在预览里拖动调整
// 坐标一律是 PDF 点（1/72 英寸），原点在页面左上角（显示方向，已考虑页面旋转）。

export type Box = { x: number; y: number; w: number; h: number };

export type FormPage = { w: number; h: number };

/** PDF 里的一段文字 */
export type TextItem = Box & { id: string; page: number; text: string };

/** 表格线围成的格子；text = 格子里原有的文字（空格子通常就是要填的地方） */
export type Cell = Box & { id: string; page: number; text: string };

/** PDF 自带的填写栏 */
export type AcroField = Box & { id: string; page: number; name: string; kind: "text" | "checkbox" | "radio" | "dropdown"; options?: string[] };

export type FormLayout = { pages: FormPage[]; texts: TextItem[]; cells: Cell[]; acro: AcroField[] };

export type FormMode = "acroform" | "overlay" | "scanned";

/**
 * 表上的一栏。kind：text = 印文字；mark = 圈出 / 勾选一个选项（value 非空 = 画上）。
 * value 是生效的内容；proposed 是 AI 提议、还没被用户接受的内容（null = 没有提议）。
 */
export type FormField = Box & {
  id: string;
  page: number;
  label: string;
  kind: "text" | "mark";
  /** mark 的画法：circle = 圈住选项文字，check = 在框里打 ✓ */
  mark?: "circle" | "check";
  /** 对齐：before 目标（年/月/日前面的数字）右对齐 */
  align?: "left" | "right" | "center";
  multiline?: boolean;
  /** 对应的 AcroForm 填写栏 */
  acroName?: string;
  value: string;
  proposed: string | null;
  /** AI 的说明（中文），如「按 user.md 里的毕业时间填的」「还不知道，先空着」 */
  note?: string;
};

export type Handwriting = { required: boolean; reason: string };

/** 一次填写结果里 AI 说还缺的信息，聊天里的 AI 拿去问用户 */
export type MissingInfo = { label: string; question: string };

export const MAX_FORM_PAGES = 8;
export const MAX_FIELDS = 200;

/** "3-5,7" → [2,3,4,6]（从 0 起），超出页数的忽略 */
export function parsePages(spec: string | undefined, numPages: number): number[] {
  if (!spec?.trim()) return [];
  const out = new Set<number>();
  for (const part of spec.split(/[,，、\s]+/)) {
    const m = /^(\d+)(?:\s*[-–~〜]\s*(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b) && out.size < 50; p++) if (p >= 1 && p <= numPages) out.add(p - 1);
  }
  return [...out].sort((x, y) => x - y);
}

// ---------- 表格线 → 格子 ----------

export type Segment = { x1: number; y1: number; x2: number; y2: number };

const TOL = 2;

type Line = { at: number; from: number; to: number };

/** 横线、竖线各自按坐标归并：同一高度（误差 TOL）、首尾相接的线段合成一条 */
function mergeLines(lines: Line[]): Line[] {
  const sorted = [...lines].sort((a, b) => a.at - b.at || a.from - b.from);
  const out: Line[] = [];
  for (const l of sorted) {
    const last = out.findLast((o) => Math.abs(o.at - l.at) <= TOL && l.from <= o.to + TOL);
    if (last) {
      last.to = Math.max(last.to, l.to);
      last.at = (last.at + l.at) / 2;
    } else out.push({ ...l });
  }
  return out;
}

const covers = (lines: Line[], at: number, from: number, to: number) => lines.some((l) => Math.abs(l.at - at) <= TOL && l.from <= from + TOL && l.to >= to - TOL);

/**
 * 从横竖线段算出最小的格子：以每个「横线和竖线相交」的点为左上角，向右找最近的、上边和右边都有线的竖线，
 * 再向下找最近的、四边都有线的横线。表格里套表格也能得到最小的那一格。
 */
export function cellsFromSegments(segments: Segment[], minSize = 6): Box[] {
  const h: Line[] = [];
  const v: Line[] = [];
  for (const s of segments) {
    if (Math.abs(s.y1 - s.y2) <= 1 && Math.abs(s.x1 - s.x2) > minSize) h.push({ at: (s.y1 + s.y2) / 2, from: Math.min(s.x1, s.x2), to: Math.max(s.x1, s.x2) });
    else if (Math.abs(s.x1 - s.x2) <= 1 && Math.abs(s.y1 - s.y2) > minSize) v.push({ at: (s.x1 + s.x2) / 2, from: Math.min(s.y1, s.y2), to: Math.max(s.y1, s.y2) });
  }
  const H = mergeLines(h);
  const V = mergeLines(v);
  if (H.length > 400 || V.length > 400) return [];
  const xs = [...new Set(V.map((l) => Math.round(l.at * 10) / 10))].sort((a, b) => a - b);
  const ys = [...new Set(H.map((l) => Math.round(l.at * 10) / 10))].sort((a, b) => a - b);
  const cells: Box[] = [];
  for (const top of ys) {
    for (const left of xs) {
      if (!covers(H, top, left, left + 0.1) || !covers(V, left, top, top + 0.1)) continue;
      let found: Box | null = null;
      for (const right of xs) {
        if (right - left < minSize) continue;
        if (!covers(H, top, left, right)) break;
        if (!covers(V, right, top, top + 0.1)) continue;
        for (const bottom of ys) {
          if (bottom - top < minSize) continue;
          if (!covers(V, left, top, bottom) || !covers(V, right, top, bottom)) break;
          if (covers(H, bottom, left, right)) {
            found = { x: left, y: top, w: right - left, h: bottom - top };
            break;
          }
        }
        if (found) break;
      }
      if (found && !cells.some((c) => near(c, found))) cells.push(found);
    }
  }
  return cells;
}

const near = (a: Box, b: Box) => Math.abs(a.x - b.x) <= TOL && Math.abs(a.y - b.y) <= TOL && Math.abs(a.w - b.w) <= TOL && Math.abs(a.h - b.h) <= TOL;

const center = (b: Box) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
export const inside = (outer: Box, inner: Box) => {
  const { cx, cy } = center(inner);
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
};

/** 给格子标上里面原有的文字（多段按阅读顺序拼起来） */
export function labelCells(page: number, boxes: Box[], texts: TextItem[], startId = 1): Cell[] {
  const onPage = texts.filter((t) => t.page === page);
  return boxes
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((b, i) => ({
      ...round(b),
      id: `c${startId + i}`,
      page,
      text: onPage
        .filter((t) => inside(b, t))
        .sort((p, q) => p.y - q.y || p.x - q.x)
        .map((t) => t.text)
        .join(" ")
        .trim(),
    }));
}

export const round = (b: Box): Box => ({ x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) });
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------- 给 AI 看的版面 ----------

const fmtBox = (b: Box) => `[x${Math.round(b.x)} y${Math.round(b.y)} w${Math.round(b.w)} h${Math.round(b.h)}]`;

/** 版面写成文字给 AI：每页的文字段（t 编号）、格子（c 编号）、填写栏（a 编号） */
export function layoutForModel(layout: FormLayout, limit = 60_000): string {
  const parts: string[] = [];
  layout.pages.forEach((p, i) => {
    parts.push(`=== 第 ${i + 1} 页（宽 ${Math.round(p.w)} × 高 ${Math.round(p.h)}）===`);
    const acro = layout.acro.filter((a) => a.page === i);
    if (acro.length) {
      parts.push("填写栏：");
      for (const a of acro) parts.push(`${a.id} ${fmtBox(a)} ${a.kind} 名称「${a.name}」${a.options?.length ? ` 选项：${a.options.join(" / ")}` : ""}`);
    }
    const cells = layout.cells.filter((c) => c.page === i);
    if (cells.length) {
      parts.push("格子：");
      for (const c of cells) parts.push(`${c.id} ${fmtBox(c)} ${c.text ? `「${c.text.slice(0, 60)}」` : "（空）"}`);
    }
    parts.push("文字：");
    for (const t of layout.texts.filter((t) => t.page === i)) parts.push(`${t.id} ${fmtBox(t)} ${t.text}`);
  });
  const text = parts.join("\n");
  return text.length > limit ? `${text.slice(0, limit)}\n（后面省略）` : text;
}

/** 表上写着要亲笔填写 */
const HANDWRITING_RE = /手書き|自筆|直筆|自署|楷書で|ボールペンで|黒インク|ペン書き|手書/;

export function detectHandwriting(text: string): Handwriting | null {
  const m = HANDWRITING_RE.exec(text);
  if (!m) return null;
  // 取包含这个词的那一句（到前后的句号、※ 或换行为止）
  const before = text.slice(Math.max(0, m.index - 40), m.index);
  const after = text.slice(m.index, m.index + 40);
  const head = before.slice(Math.max(before.lastIndexOf("。"), before.lastIndexOf("※"), before.lastIndexOf("\n")) + 1);
  const end = after.search(/[。\n]/);
  const sentence = `${head}${end < 0 ? after : after.slice(0, end + 1)}`.replace(/\s+/g, " ").trim();
  return { required: true, reason: `表上写着「${sentence}」` };
}

// ---------- AI 的回答 ----------

/**
 * AI 指定一栏写在哪里：
 * - {cell} 写进格子；{acro} 写进填写栏
 * - {text, place:"right"} 写在一段文字的右边（「氏名：＿＿＿」这类下划线表）
 * - {text, before:"年"} 写在这段文字里某个字的前面（「　年　月　日」）
 * - {text, circle:"男"} 圈出选项；{text, on:"□"} 在这个字上打勾（value 写 ✓）
 * - {page, box:[x,y,w,h]} 直接给坐标（扫描版）
 */
export type FieldTarget = {
  cell?: string;
  acro?: string;
  text?: string;
  place?: "right" | "below";
  before?: string;
  circle?: string;
  on?: string;
  page?: number;
  box?: number[];
};

export type AiField = { field?: string; label?: string; target?: FieldTarget; value?: string; note?: string; multiline?: boolean };

export type AiFill = { handwriting?: { required?: boolean; reason?: string }; fields: AiField[]; missing: MissingInfo[]; summary: string };

/** 从模型回答里取出 JSON（可能包在 ```json 里，前后有说明文字） */
export function parseAiFill(text: string): AiFill | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const raw = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const fields = Array.isArray(o.fields) ? o.fields : [];
  const missing = Array.isArray(o.missing) ? o.missing : [];
  const hw = o.handwriting && typeof o.handwriting === "object" ? (o.handwriting as Record<string, unknown>) : null;
  return {
    handwriting: hw ? { required: hw.required === true, reason: str(hw.reason, 200) } : undefined,
    summary: str(o.summary, 300) ?? "",
    fields: fields.slice(0, MAX_FIELDS).flatMap((f): AiField[] => {
      if (!f || typeof f !== "object") return [];
      const r = f as Record<string, unknown>;
      const t = r.target && typeof r.target === "object" ? (r.target as Record<string, unknown>) : undefined;
      return [
        {
          field: str(r.field, 20),
          label: str(r.label, 60),
          value: typeof r.value === "string" ? r.value.slice(0, 2000) : typeof r.value === "number" ? String(r.value) : typeof r.value === "boolean" ? (r.value ? "✓" : "") : undefined,
          note: str(r.note, 200),
          multiline: r.multiline === true,
          target: t
            ? {
                cell: str(t.cell, 20),
                acro: str(t.acro, 20),
                text: str(t.text, 20),
                place: t.place === "right" || t.place === "below" ? t.place : undefined,
                before: str(t.before, 10),
                circle: str(t.circle, 40),
                on: str(t.on, 10),
                page: typeof t.page === "number" ? t.page : undefined,
                box: Array.isArray(t.box) && t.box.length === 4 && t.box.every((n) => typeof n === "number") ? (t.box as number[]) : undefined,
              }
            : undefined,
        },
      ];
    }),
    missing: missing.slice(0, 30).flatMap((m): MissingInfo[] => {
      if (!m || typeof m !== "object") return [];
      const r = m as Record<string, unknown>;
      const label = str(r.label, 60);
      return label ? [{ label, question: str(r.question, 200) ?? "" }] : [];
    }),
  };
}

/** 一段文字里第 index 个字开始、长 len 个字的位置（按字数等分估计；日文等宽字体下够准） */
export function substringBox(t: Box, text: string, index: number, len: number): Box {
  const chars = [...text];
  const weights = chars.map(charWidth);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const before = weights.slice(0, index).reduce((a, b) => a + b, 0);
  const width = weights.slice(index, index + len).reduce((a, b) => a + b, 0);
  return { x: t.x + (t.w * before) / total, y: t.y, w: (t.w * width) / total, h: t.h };
}

/** 半角字约占全角的六成 */
const charWidth = (c: string) => (/[\u0000-\u00ff\uff61-\uff9f]/.test(c) ? 0.6 : 1);

const charIndex = (text: string, sub: string) => {
  const i = text.indexOf(sub);
  return i < 0 ? -1 : [...text.slice(0, i)].length;
};

/**
 * AI 的位置描述换算成页面上的框。找不到目标（编号写错、字不在那段文字里）返回 null。
 * 「写在右边」的宽度：到同一行下一段文字、所在格子的右边或页边为止。
 */
export function resolveTarget(target: FieldTarget, layout: FormLayout): (Box & { page: number; kind: FormField["kind"]; mark?: FormField["mark"]; align?: FormField["align"]; acroName?: string }) | null {
  if (target.acro) {
    const a = layout.acro.find((x) => x.id === target.acro);
    if (!a) return null;
    const mark = a.kind === "checkbox" || a.kind === "radio";
    return { ...pick(a), page: a.page, kind: mark ? "mark" : "text", mark: mark ? "check" : undefined, acroName: a.name };
  }
  if (target.cell) {
    const c = layout.cells.find((x) => x.id === target.cell);
    if (!c) return null;
    return { ...inset(c, 2), page: c.page, kind: "text" };
  }
  if (target.text) {
    const t = layout.texts.find((x) => x.id === target.text);
    if (!t) return null;
    const chars = [...t.text];
    if (target.circle) {
      const i = charIndex(t.text, target.circle);
      const b = i < 0 ? pick(t) : substringBox(t, t.text, i, [...target.circle].length);
      return { ...pad(b, 2), page: t.page, kind: "mark", mark: "circle" };
    }
    if (target.on) {
      const i = charIndex(t.text, target.on);
      if (i < 0) return null;
      return { ...substringBox(t, t.text, i, [...target.on].length), page: t.page, kind: "mark", mark: "check" };
    }
    if (target.before) {
      const i = charIndex(t.text, target.before);
      if (i < 0) return null;
      const at = substringBox(t, t.text, i, 1);
      // 往左到前一个非空白字（「　　年　　月」里年前面的空白就是写数字的地方）
      let j = i - 1;
      while (j >= 0 && /\s|　/.test(chars[j])) j--;
      let left: number;
      if (j >= 0) {
        const prev = substringBox(t, t.text, j, 1);
        left = prev.x + prev.w;
      } else {
        // 这个字是一段的开头：左边到同一行前一段文字为止
        const prev = layout.texts.filter((o) => o.page === t.page && o.id !== t.id && o.x + o.w <= at.x + 1 && Math.abs(o.y + o.h / 2 - (t.y + t.h / 2)) < t.h / 2);
        left = Math.max(at.x - 4 * at.h, ...prev.map((o) => o.x + o.w));
      }
      const cell = layout.cells.find((c) => c.page === t.page && inside(c, t));
      const minX = (cell ? Math.max(left, cell.x + 2) : left) + 1;
      const x = Math.min(minX, at.x - at.h * 1.2);
      return { x, y: t.y - 1, w: at.x - x - 1, h: t.h + 2, page: t.page, kind: "text", align: "right" };
    }
    const cell = layout.cells.find((c) => c.page === t.page && inside(c, t));
    if (target.place === "below") {
      const bottom = cell ? cell.y + cell.h - 2 : t.y + t.h * 3;
      const w = cell ? cell.x + cell.w - 2 - t.x : layout.pages[t.page].w - 30 - t.x;
      return { x: t.x, y: t.y + t.h + 2, w, h: Math.max(t.h, bottom - t.y - t.h - 2), page: t.page, kind: "text" };
    }
    const x = t.x + t.w + 3;
    const sameLine = layout.texts.filter((o) => o.page === t.page && o.id !== t.id && o.x > t.x + t.w - 1 && Math.abs(o.y + o.h / 2 - (t.y + t.h / 2)) < t.h / 2);
    const limits = [layout.pages[t.page].w - 20, ...sameLine.map((o) => o.x - 3), ...(cell ? [cell.x + cell.w - 2] : [])];
    const right = Math.min(...limits.filter((l) => l > x + 4));
    const top = cell ? Math.max(cell.y + 1, t.y - t.h * 0.4) : t.y - t.h * 0.3;
    const bottom = cell ? Math.min(cell.y + cell.h - 1, t.y + t.h * 1.4) : t.y + t.h * 1.3;
    return { x, y: top, w: Math.max(10, right - x), h: Math.max(t.h, bottom - top), page: t.page, kind: "text" };
  }
  if (target.box && target.page !== undefined) {
    const page = target.page - 1;
    const p = layout.pages[page];
    if (!p) return null;
    const [x, y, w, h] = target.box;
    const b = { x: (x / 1000) * p.w, y: (y / 1000) * p.h, w: (w / 1000) * p.w, h: (h / 1000) * p.h };
    if (b.w <= 0 || b.h <= 0) return null;
    return { ...b, page, kind: "text" };
  }
  return null;
}

const pick = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const inset = (b: Box, d: number): Box => ({ x: b.x + d, y: b.y + d, w: Math.max(4, b.w - 2 * d), h: Math.max(4, b.h - 2 * d) });
const pad = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/**
 * AI 这次填写的结果合进已有的栏：
 * - 指了已有栏（field = 栏 ID）就更新那一栏的提议；AI 给的和现在一样就不算提议
 * - 新的位置生成新栏，位置和已有栏重合时当作同一栏
 * value 为空的新栏（AI 不知道填什么）也保留，方便用户自己填。
 */
export function mergeAiFields(existing: FormField[], ai: AiField[], layout: FormLayout, newId: () => string): { fields: FormField[]; changed: number; skipped: number } {
  const fields = existing.map((f) => ({ ...f }));
  let changed = 0;
  let skipped = 0;
  const propose = (f: FormField, value: string, note?: string) => {
    if (note) f.note = note;
    if (value === f.value) {
      f.proposed = null;
      return;
    }
    if (f.proposed === value) return;
    f.proposed = value;
    changed++;
  };
  for (const a of ai) {
    const value = (a.value ?? "").trim();
    const known = a.field ? fields.find((f) => f.id === a.field) : undefined;
    if (known) {
      propose(known, known.kind === "mark" ? (value ? "✓" : "") : value, a.note);
      continue;
    }
    const at = a.target ? resolveTarget(a.target, layout) : null;
    if (!at) {
      skipped++;
      continue;
    }
    const same = fields.find((f) => f.page === at.page && f.kind === at.kind && overlap(f, at) > 0.6);
    if (same) {
      propose(same, same.kind === "mark" ? (value ? "✓" : "") : value, a.note);
      continue;
    }
    if (fields.length >= MAX_FIELDS) break;
    const f: FormField = {
      id: newId(),
      page: at.page,
      x: r1(at.x),
      y: r1(at.y),
      w: r1(at.w),
      h: r1(at.h),
      label: (a.label ?? "").trim() || "（未命名）",
      kind: at.kind,
      ...(at.mark ? { mark: at.mark } : {}),
      ...(at.align ? { align: at.align } : {}),
      ...(at.acroName ? { acroName: at.acroName } : {}),
      ...(a.multiline || (at.kind === "text" && at.h > 34) ? { multiline: true } : {}),
      value: "",
      proposed: null,
      ...(a.note ? { note: a.note } : {}),
    };
    propose(f, at.kind === "mark" ? (value ? "✓" : "") : value);
    fields.push(f);
  }
  return { fields, changed, skipped };
}

/** 两个框重合的部分占小框面积的比例 */
export function overlap(a: Box, b: Box) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

// ---------- 排版（预览和生成的 PDF 用同一套） ----------

const MAX_SIZE = 10.5;
const MIN_SIZE = 5;
const LINE = 1.25;

const textEm = (s: string) => [...s].reduce((a, c) => a + charWidth(c), 0);

/** 估算一栏文字的字号：单行按高度和宽度取小；多行按能放下所有行取最大的字号 */
export function fitText(value: string, box: Box, multiline = false): { size: number; lines: number } {
  const lines = value.split("\n");
  if (!multiline) {
    const em = Math.max(...lines.map(textEm), 1);
    const size = Math.min(MAX_SIZE, (box.h * 0.8) / LINE, (box.w - 1) / em);
    return { size: Math.max(MIN_SIZE, r1(size)), lines: 1 };
  }
  for (let size = MAX_SIZE; size > MIN_SIZE; size -= 0.5) {
    const perLine = Math.max(1, Math.floor((box.w - 1) / size));
    const count = lines.reduce((n, l) => n + Math.max(1, Math.ceil(textEm(l) / perLine)), 0);
    if (count * size * LINE <= box.h) return { size, lines: count };
  }
  return { size: MIN_SIZE, lines: Math.ceil((textEm(value) * MIN_SIZE) / Math.max(1, box.w)) };
}

/** 现在会印出来的内容：只用已接受的值（AI 的提议接受后才算） */
export const printedValue = (f: FormField) => f.value;

export const pendingCount = (fields: FormField[]) => fields.filter((f) => f.proposed !== null).length;

/** 给聊天里的 AI 看的一份表的状况 */
export function describeForm(form: { id: string; title: string; sourceUrl: string | null; mode: FormMode; handwriting: Handwriting | null; fields: FormField[] }): string {
  const lines = form.fields.map((f) => {
    const v = f.kind === "mark" ? (f.value ? "已圈/勾" : "未圈/勾") : f.value ? `「${f.value.slice(0, 80)}」` : "（空）";
    const p = f.proposed === null ? "" : `；AI 提议「${f.proposed.slice(0, 80)}」待用户确认`;
    return `- ${f.id} 第${f.page + 1}页 ${f.label}：${v}${p}`;
  });
  return [
    `申请表「${form.title}」（ID ${form.id}）${form.sourceUrl ? `，原文 ${form.sourceUrl}` : ""}`,
    form.handwriting?.required ? `学校要求亲笔填写（${form.handwriting.reason}），这份是参照版` : "可以打印后直接提交",
    `填法：${{ acroform: "PDF 自带填写栏", overlay: "按位置印字", scanned: "扫描版，按估计位置印字" }[form.mode]}`,
    "栏目：",
    ...lines,
  ].join("\n");
}

// 文书里的文字颜色和背景色（Notion 式的 9 种颜色）。
// Markdown 里存成 {color:red}文字{/color} 和 {bg:yellow}文字{/bg}：编辑器、PDF 导出都按这个格式解析，
// 不用原样 HTML（PDF 导出会把 HTML 转义掉）。

export const DOC_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type DocColor = (typeof DOC_COLORS)[number];

export const DOC_COLOR_LABELS: Record<DocColor, string> = {
  gray: "灰色",
  brown: "棕色",
  orange: "橙色",
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  purple: "紫色",
  pink: "粉色",
  red: "红色",
};

/** PDF（白底打印）用的色值；编辑器里的颜色在 globals.css（深色模式另有一套） */
export const PRINT_COLORS: Record<DocColor, { text: string; bg: string }> = {
  gray: { text: "#787774", bg: "#f1f1ef" },
  brown: { text: "#9f6b53", bg: "#f4eeee" },
  orange: { text: "#d9730d", bg: "#fbecdd" },
  yellow: { text: "#cb912f", bg: "#fbf3db" },
  green: { text: "#448361", bg: "#edf3ec" },
  blue: { text: "#337ea9", bg: "#e7f3f8" },
  purple: { text: "#9065b0", bg: "#f6f3f9" },
  pink: { text: "#c14c8a", bg: "#faf1f5" },
  red: { text: "#d44c47", bg: "#fdebec" },
};

export type ColorKind = "color" | "bg";

export const isDocColor = (c: string): c is DocColor => (DOC_COLORS as readonly string[]).includes(c);

const TAG = /^\{(color|bg):([a-z]+)\}([\s\S]+?)\{\/\1\}/;

/** 行内开头是不是一段带颜色的文字：返回种类、颜色、里面的文字和整段长度 */
export function matchColorSpan(src: string): { kind: ColorKind; color: DocColor; inner: string; raw: string } | null {
  const m = TAG.exec(src);
  if (!m || !isDocColor(m[2])) return null;
  return { kind: m[1] as ColorKind, color: m[2], inner: m[3], raw: m[0] };
}

export const colorSpanStart = (src: string) => {
  const i = src.search(/\{(?:color|bg):/);
  return i === -1 ? undefined : i;
};

/** 去掉颜色标记，只留文字（算段落指纹、给 AI 看纯文字时用） */
export const stripColorTags = (s: string) => s.replace(/\{(?:color|bg):[a-z]+\}|\{\/(?:color|bg)\}/g, "");

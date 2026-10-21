// 文书（研究计划书、套磁信、自我介绍）的类型、模板和带写步骤（纯函数，前后端共用）
// 界面用中文；文书正文用日文，所以模板标题是日文。

import type { Field } from "./onboarding";

export type DocKind = "plan" | "letter" | "intro" | "other";

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  plan: "研究计划书",
  letter: "套磁信",
  intro: "自我介绍",
  other: "其他",
};

/**
 * 计划书要贴合的目标教授（主线 A：方向未定 → 先找教授 → 按教授近期论文写计划书）。
 * 第 4 步“找教授”上线后由教授清单关联填入（professorId 指向 saved_professor），现在用户可手填。
 */
export type TargetProfessor = {
  professorId?: string;
  name: string;
  affiliation?: string;
  /** 研究方向、近期论文等，AI 写计划书时据此贴合 */
  research?: string;
};

export const MAX_DOC_LENGTH = 50_000;

type Template = { title: string; markdown: string };

const section = (headings: string[]) => headings.map((h) => `## ${h}\n`).join("\n");

/** 计划书各节标题；带写步骤按这些标题判断进度 */
export const PLAN_HEADINGS: Record<Field, string[]> = {
  humanities: ["研究題目", "研究背景と問題意識", "先行研究", "研究目的", "研究方法", "期待される成果と意義", "参考文献"],
  sciences: ["研究題目", "研究背景", "関連研究", "研究目的", "研究方法・実験計画", "期待される成果", "参考文献"],
};

export function docTemplate(kind: DocKind, field: Field = "humanities"): Template {
  switch (kind) {
    case "plan":
      return { title: "研究计划书", markdown: `# 研究計画書\n\n${section(PLAN_HEADINGS[field])}` };
    case "letter":
      return {
        title: "套磁信",
        markdown: [
          "件名：研究生受け入れのお願い（氏名）",
          "",
          "〇〇大学大学院〇〇研究科",
          "〇〇 〇〇 先生",
          "",
          "突然のご連絡失礼いたします。",
          "",
          "（自己紹介・先生の研究に関心を持った理由・研究計画の概要・お願い）",
          "",
          "ご多忙のところ恐縮ですが、ご検討いただけますと幸いです。",
          "何卒よろしくお願い申し上げます。",
          "",
          "氏名",
          "メールアドレス",
          "",
        ].join("\n"),
      };
    case "intro":
      return { title: "自我介绍", markdown: `# 自己紹介\n\n${section(["学歴", "研究関心", "日本留学の動機", "将来の目標"])}` };
    default:
      return { title: "未命名文书", markdown: "" };
  }
}

/** 计划书带写的四步：先定题目和问题意识 → 先行研究 → 目的与方法 → 成稿 */
export type PlanStep = { key: string; label: string; headings: string[] };

export function planSteps(field: Field): PlanStep[] {
  const h = PLAN_HEADINGS[field];
  return [
    { key: "question", label: "题目与问题意识", headings: [h[0], h[1]] },
    { key: "literature", label: "先行研究", headings: [h[2]] },
    { key: "method", label: "研究目的与方法", headings: [h[3], h[4]] },
    { key: "finish", label: "成稿", headings: [h[5], h[6]] },
  ];
}

/** 读出每个 “## 标题” 下的正文（去掉首尾空白） */
export function sectionBodies(md: string): Map<string, string> {
  const result = new Map<string, string>();
  let current: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (current !== null) result.set(current, body.join("\n").trim());
  };
  for (const line of md.split("\n")) {
    const m = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1] === "##" ? m[2] : null;
      body = [];
    } else if (current !== null) body.push(line);
  }
  flush();
  return result;
}

/** 根据计划书内容判断学科模板（看用了哪套标题），判断不出时用 fallback */
export function detectPlanField(md: string, fallback: Field): Field {
  const headings = new Set(sectionBodies(md).keys());
  if (headings.has("関連研究") || headings.has("研究方法・実験計画")) return "sciences";
  if (headings.has("先行研究") || headings.has("研究背景と問題意識")) return "humanities";
  return fallback;
}

/** 每一步是否已写（对应各节都有正文），以及下一步该写什么 */
export function planProgress(md: string, field: Field) {
  const bodies = sectionBodies(md);
  const steps = planSteps(field).map((s) => ({ ...s, done: s.headings.every((h) => (bodies.get(h) ?? "").length > 0) }));
  return { steps, next: steps.find((s) => !s.done) ?? null };
}

/** 把文中唯一的一处 find 替换为 replace。找不到或不唯一时报错，让 AI 给出更长的原文片段 */
export function replaceTextOnce(md: string, find: string, replace: string): string {
  if (!find) throw new Error("原文片段不能为空");
  const first = md.indexOf(find);
  if (first === -1) throw new Error("文档里找不到这段原文，请先 read_document 确认原文（需逐字一致）");
  if (md.indexOf(find, first + 1) !== -1) throw new Error("这段原文在文档里出现了多次，请提供更长、唯一的片段");
  return md.slice(0, first) + replace + md.slice(first + find.length);
}

/** 给 AI 看的文档摘要头：ID、类型、标题、目标教授 */
export function describeDocument(doc: { id: string; kind: DocKind; title: string; targetProfessor: TargetProfessor | null }) {
  const lines = [`文档 ID：${doc.id}`, `类型：${DOC_KIND_LABELS[doc.kind]}`, `标题：${doc.title}`];
  const p = doc.targetProfessor;
  if (p) {
    lines.push(`目标教授：${p.name}${p.affiliation ? `（${p.affiliation}）` : ""}`);
    if (p.research) lines.push(`教授研究方向与近期论文：${p.research}`);
  } else if (doc.kind === "plan") {
    lines.push("目标教授：未设定");
  }
  return lines.join("\n");
}

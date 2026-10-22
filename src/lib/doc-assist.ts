// 编辑器里的一次性 AI 操作（不进聊天）：选中改写/解释/翻译、重新翻译段落、教授视角审阅、按批注改。
// 这里只放提示词、结果解析和演示模式的固定结果（纯函数，方便测试）；调用模型和读写数据在 src/server/doc-assist.ts。

import { z } from "zod";
import { COMMENT_CATEGORIES, type CommentCategory, type TargetProfessor } from "./documents";
import { isHeadingBlock, splitBlocks } from "./doc-zh";

export const SELECTION_ACTIONS = ["natural", "shorter", "longer", "explain", "translate"] as const;
/** custom：用户自己写要求（「让 AI 改…」） */
export type SelectionAction = (typeof SELECTION_ACTIONS)[number] | "custom";

export const SELECTION_ACTION_LABELS: Record<SelectionAction, string> = {
  natural: "改得更自然",
  shorter: "更简短",
  longer: "扩写",
  explain: "解释这句",
  translate: "翻成中文",
  custom: "按你的要求改",
};

/** 改写类的操作会生成修改建议，其余只显示结果 */
export const isRewrite = (a: SelectionAction) => a === "natural" || a === "shorter" || a === "longer" || a === "custom";

export const MAX_REVIEW_COMMENTS = 8;
export const MAX_TRANSLATE_BLOCKS = 40;

/** 从模型回复里取出 JSON（允许包在 ```json 代码块里，或前后有说明文字） */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply)?.[1];
  const body = (fenced ?? reply).trim();
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const docContext = (title: string, markdown: string) => `文书标题：${title}\n\n--- 正文开始 ---\n${markdown.slice(0, 16000)}\n--- 正文结束 ---`;

export function selectionPrompt(action: SelectionAction, text: string, title: string, markdown: string, instruction = "") {
  const ask: Record<SelectionAction, string> = {
    custom: `按用户的要求修改下面这段日文：「${instruction}」。保持文书原有的文体（である体；套磁信用敬语），只改这段。只输出 JSON：{"ja": "改好的日文", "zh": "改好的日文对应的中文意思"}`,
    longer: '把下面这段日文扩写得更充实（补充具体说明、理由或例子，但不要编造经历、数据或文献），保持原有文体。只输出 JSON：{"ja": "改好的日文", "zh": "改好的日文对应的中文意思"}',
    natural:
      '把下面这段日文改得更自然、更符合日本学术文书的习惯（である体；套磁信用敬语），保持原意，不要添加新内容。只输出 JSON：{"ja": "改好的日文", "zh": "改好的日文对应的中文意思"}',
    shorter: '把下面这段日文改得更简短（删掉重复和冗余，保留关键信息和原有文体）。只输出 JSON：{"ja": "改好的日文", "zh": "改好的日文对应的中文意思"}',
    explain: "用简体中文解释下面这段日文：意思、在文中的作用，以及值得注意的表达（如敬语、学术用语）。三四句话以内，直接输出解释。",
    translate: "把下面这段日文翻译成自然的简体中文，直接输出译文。",
  };
  return `你在帮一位中国学生写申请日本大学院的文书。${ask[action]}\n\n要处理的原文：\n「${text}」\n\n（上下文）\n${docContext(title, markdown)}`;
}

/** 光标处让 AI 写（空白行按空格、斜杠菜单）：before/after 是光标前后的正文，heading 是所在小节的标题 */
export function writePrompt(p: { instruction: string; before: string; after: string; heading: string }, title: string) {
  const task = p.instruction || (p.before.trim() ? "接着上文往下写一段" : "写这份文书的开头一段");
  return `你在帮一位中国学生写申请日本大学院的文书。要在光标处插入新的日文内容。用户的要求：「${task}」。
要求：日文，和上下文衔接，保持文书原有的文体（研究计划书用である体；套磁信用敬语）；不要重复上下文已有的内容；不要编造学生的经历、成绩、数据或文献，需要学生补充的地方写成【　】让学生自己填。
${p.heading ? `光标所在的小节：${p.heading}\n` : ""}可以写多段（段落之间空一行），可以用 Markdown 列表，不要写标题。
只输出 JSON：{"ja": "要插入的日文", "zh": "对应的中文意思"}

文书标题：${title}
--- 光标前 ---
${p.before.slice(-6000)}
--- 光标后 ---
${p.after.slice(0, 3000)}`;
}

export const demoWrite = (instruction: string) => ({
  ja: `（演示）${instruction ? `「${instruction.slice(0, 20)}」について` : "ここに続きの文章が入ります。"}本研究では【　】を対象に、具体的な課題を明らかにする。`,
  zh: "（演示）这里是 AI 写的中文意思。",
});

export const rewriteSchema = z.object({ ja: z.string().min(1).max(5000), zh: z.string().max(5000).default("") });

export function parseRewrite(reply: string) {
  const parsed = rewriteSchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new Error("AI 的回复格式不对，请再试一次");
  return parsed.data;
}

export function translatePrompt(paragraphs: string[]) {
  return `把下面这些日文段落逐段翻译成简体中文（意思准确、读起来自然）。按原顺序输出一个 JSON 字符串数组，数组长度必须是 ${paragraphs.length}，不要输出别的内容。\n\n${JSON.stringify(paragraphs, null, 0)}`;
}

export function parseTranslations(reply: string, count: number): string[] {
  const json = extractJson(reply);
  const arr = z.array(z.string()).safeParse(Array.isArray(json) ? json : (json as { items?: unknown } | null)?.items);
  if (!arr.success || arr.data.length !== count) throw new Error("AI 的翻译段数对不上，请再试一次");
  return arr.data;
}

export function reviewPrompt(title: string, markdown: string, professor: TargetProfessor | null) {
  const who = professor
    ? `你是 ${professor.name}${professor.affiliation ? `（${professor.affiliation}）` : ""}。你的研究方向和近期论文：\n${professor.research ?? "（未提供）"}\n请站在你自己的研究立场审阅，涉及与你研究的关系时可以具体引用你的论文。`
    : "你是一位日本大学院的指导教授，正在审阅想报考你研究室的留学生寄来的文书。";
  return `${who}

请通读下面的文书，像在页边写批注一样指出最重要的问题（最多 ${MAX_REVIEW_COMMENTS} 条），重点看：逻辑是否连贯、问题意识和新颖性、研究方法是否可行具体、与教授研究方向是否契合、日文表达。
- 只写批注，不要改写原文。
- 每条批注用简体中文写，具体指出问题和改进方向（两三句以内）。
- quote 必须逐字摘自原文（一句话或一个短语，不含 Markdown 符号），用来在原文中定位。
- category 取值：${COMMENT_CATEGORIES.join(" / ")}（逻辑 / 新颖性 / 可行性 / 与教授方向 / 表达）。
只输出 JSON 数组：[{"quote": "...", "body": "...", "category": "logic"}]

${docContext(title, markdown)}`;
}

const commentSchema = z.object({
  quote: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(1000),
  category: z.string(),
});

export function parseReview(reply: string): { quote: string; body: string; category: CommentCategory }[] {
  const json = extractJson(reply);
  const raw = Array.isArray(json) ? json : ((json as { comments?: unknown } | null)?.comments ?? null);
  if (!Array.isArray(raw)) throw new Error("AI 的审阅结果格式不对，请再试一次");
  return raw.flatMap((item) => {
    const c = commentSchema.safeParse(item);
    if (!c.success) return [];
    const category = (COMMENT_CATEGORIES as readonly string[]).includes(c.data.category) ? (c.data.category as CommentCategory) : "logic";
    return [{ quote: c.data.quote, body: c.data.body, category }];
  }).slice(0, MAX_REVIEW_COMMENTS);
}

export function applyCommentPrompt(title: string, markdown: string, comment: { quote: string; body: string }) {
  return `你在帮一位中国学生修改申请日本大学院的文书。教授在页边对「${comment.quote}」写了批注：${comment.body}

请按这条批注修改原文。要求：
- find：要替换的原文，必须逐字摘自正文、在正文中只出现一次，不含 Markdown 标题行；可以是一句或一整段。
- replace：改好的日文（保持原文的文体）。
- zh：replace 的中文意思（多段时用空行分段，和日文段落一一对应）。
- summary：一句中文说明改了什么（20 字以内）。
- 内容必须真实，不要编造经历、成绩或文献；需要用户补充的信息用「〇〇」占位。
只输出 JSON：{"find": "...", "replace": "...", "zh": "...", "summary": "..."}

${docContext(title, markdown)}`;
}

const applySchema = z.object({
  find: z.string().min(1).max(20000),
  replace: z.string().max(20000),
  zh: z.string().max(20000).default(""),
  summary: z.string().max(200).default("按批注修改"),
});

export function parseApplyComment(reply: string) {
  const parsed = applySchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new Error("AI 的回复格式不对，请再试一次");
  return parsed.data;
}

// ---------- 演示模式（没有配置 DEEPSEEK_API_KEY）：固定结果，不花钱 ----------

export function demoSelection(action: SelectionAction, text: string): { ja: string; zh: string } | string {
  if (action === "natural") return { ja: `${text.replace(/[。．]$/, "")}（演示：已润色）。`, zh: `（演示）这句话的中文意思` };
  if (action === "longer" || action === "custom") return { ja: `${text.replace(/[。．]$/, "")}。（演示：已${action === "longer" ? "扩写" : "按要求修改"}）`, zh: "（演示）修改后的中文意思" };
  if (action === "shorter") return { ja: text.slice(0, Math.max(1, Math.ceil(text.length * 0.6))), zh: "（演示）缩短后的中文意思" };
  if (action === "explain") return `（演示模式）这句话的意思是「${text.slice(0, 20)}…」，在文中用来说明研究动机。正式环境下这里会是 AI 的中文解释。`;
  return `（演示模式）中文翻译：${text.slice(0, 30)}…`;
}

export const demoTranslation = (paragraph: string) => `（演示译文）${paragraph.replace(/\s+/g, " ").slice(0, 40)}…`;

/** 取正文前几段的第一句做批注 */
export function demoReview(markdown: string): { quote: string; body: string; category: CommentCategory }[] {
  const bodies: Record<number, [string, CommentCategory]> = {
    0: ["（演示批注）这里的问题意识还不够具体：想解决的到底是什么问题？建议用一两句话点明。", "logic"],
    1: ["（演示批注）方法部分缺少数据来源和分析步骤，可行性看不出来。", "feasibility"],
    2: ["（演示批注）和已有研究相比新在哪里？建议补充与先行研究的区别。", "novelty"],
  };
  return splitBlocks(markdown)
    .filter((b) => !isHeadingBlock(b) && !/^[-*+>]|^\d+\./.test(b))
    .slice(0, 3)
    .map((b, i) => {
      const sentence = /^[^。！？\n]+[。！？]?/.exec(b)?.[0] ?? b;
      return { quote: sentence.slice(0, 120), body: bodies[i][0], category: bodies[i][1] };
    });
}

export const demoApplyComment = (quote: string) => ({
  find: quote,
  replace: `${quote.replace(/[。．]$/, "")}（演示：按批注补充了具体说明）。`,
  zh: "（演示）按批注修改后的中文意思",
  summary: "按批注补充说明",
});

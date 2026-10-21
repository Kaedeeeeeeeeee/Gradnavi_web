import "server-only";
import { z } from "zod";
import { docTemplate, type DocKind } from "@/lib/documents";
import { pairZh } from "@/lib/doc-zh";
import { listSections } from "@/lib/md-sections";
import {
  createDocument,
  createSuggestion,
  createTailoredCopy,
  getDocument,
  listActiveComments,
  listDocuments,
  listPendingSuggestions,
  proposeOutline,
  updateDocument,
} from "@/server/documents";
import { professorToTarget } from "@/lib/professors";
import { answerField } from "@/lib/onboarding";
import { getProfile } from "@/server/profile";
import { getSavedProfessor } from "@/server/professors";
import { defineTool } from "./registry";

const docId = z.string().describe("文书 ID。用户正在编辑的文书 ID 在“页面内容”里，其他文书先用 list_documents 查");
const kindSchema = z.enum(["plan", "letter", "intro", "other"]);

const professorSchema = z.object({
  name: z.string().min(1).max(100),
  affiliation: z.string().max(200).optional().describe("大学・研究科・研究室"),
  research: z.string().max(3000).optional().describe("研究方向、近期论文"),
});

const savedProfessorId = z
  .string()
  .optional()
  .describe("志愿里的教授 ID（list_aspirations 查）。传了就用清单里的信息作为目标教授，不用再填 targetProfessor");

/** 优先用志愿里的教授；否则用 AI 手填的信息 */
async function resolveTarget(userId: string, professorId: string | undefined, manual: z.infer<typeof professorSchema> | null | undefined) {
  if (!professorId) return manual;
  const p = await getSavedProfessor(userId, professorId);
  if (!p) throw new Error("志愿里没有这位教授，请先用 list_aspirations 确认 ID");
  return professorToTarget(p);
}

const summary = (doc: { id: string; title: string; markdown: string; version: number }) => ({
  id: doc.id,
  title: doc.title,
  sections: listSections(doc.markdown),
  length: doc.markdown.length,
});

export const listDocumentsTool = defineTool({
  name: "list_documents",
  description: "列出用户的所有文书（研究计划书、套磁信、自我介绍等）。",
  inputSchema: z.object({}),
  execute: async (_input, { userId }) => {
    const rows = await listDocuments(userId);
    return rows.map((d) => ({ id: d.id, kind: d.kind, title: d.title, updatedAt: d.updatedAt.toISOString() }));
  },
});

export const readDocumentTool = defineTool({
  name: "read_document",
  description: "读取一份文书的完整 Markdown。改写前如果不确定原文，先读一遍。",
  inputSchema: z.object({ id: docId }),
  execute: async ({ id }, { userId }) => {
    const doc = await getDocument(userId, id);
    if (!doc) throw new Error("找不到这份文书");
    const [pending, comments] = await Promise.all([listPendingSuggestions(id), listActiveComments(id)]);
    return {
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      targetProfessor: doc.targetProfessor,
      outline: doc.outline,
      writeMode: doc.writeMode,
      markdown: doc.markdown,
      pendingSuggestions: pending.map((p) => p.summary),
      openComments: comments.map((c) => ({ quote: c.quote, body: c.body })),
    };
  },
});

export const createDocumentTool = defineTool({
  name: "create_document",
  description:
    "新建一份文书。不传 markdown 时使用模板（计划书按文科/理科分节）。主线 A（先找教授）写计划书、给某位教授写套磁信时，传 professorId（志愿里的教授）或 targetProfessor。传了 markdown 就同时传 zh（中文对照）。",
  inputSchema: z.object({
    kind: kindSchema,
    title: z.string().max(100).optional(),
    markdown: z.string().max(50000).optional(),
    zh: z.string().max(50000).optional().describe("markdown 正文的中文意思，按段落用空行分隔，和日文段落一一对应（标题不用翻）"),
    targetProfessor: professorSchema.optional(),
    professorId: savedProfessorId,
  }),
  execute: async ({ kind, title, markdown, zh, targetProfessor: manual, professorId }, { userId }) => {
    const targetProfessor = await resolveTarget(userId, professorId, manual);
    const field = answerField((await getProfile(userId))?.onboarding);
    const template = docTemplate(kind as DocKind, field);
    const doc = await createDocument(userId, {
      kind,
      title: title ?? template.title,
      markdown: markdown ?? template.markdown,
      zh: markdown && zh ? pairZh(markdown, zh) : [],
      targetProfessor,
    });
    return { ...summary(doc), url: `/documents/${doc.id}` };
  },
});

const zhParam = z
  .string()
  .max(20000)
  .describe("新写的日文的中文意思：按段落用空行分隔，和日文段落一一对应（标题不用翻）。编辑器的中文对照会同时更新");
const summaryParam = z.string().min(1).max(60).describe("一句中文说明这次改了什么，如「补充研究背景里的问题意识」，显示在修改建议卡片上");

const SUGGESTED = "已作为修改建议显示在编辑器里，用户接受后才会写进正文。";

const suggestion = (s: { id: string; summary: string }) => ({ suggestionId: s.id, summary: s.summary, note: SUGGESTED });

export const updateDocumentSectionTool = defineTool({
  name: "update_document_section",
  description:
    "写一节文书（以“## 标题”分节），以修改建议的形式给用户确认。按提纲一节一节起草时用它：replace 替换整节正文，append 在节末追加。节不存在时在文末新建。",
  inputSchema: z.object({
    id: docId,
    section: z.string().min(1).max(50).describe("节标题（不含 ##），如 研究背景と問題意識"),
    content: z.string().min(1).max(20000).describe("该节正文 Markdown，不含标题行"),
    mode: z.enum(["replace", "append"]).default("replace"),
    zh: zhParam,
    summary: summaryParam,
  }),
  execute: async ({ id, section, content, mode, zh, summary }, { userId }) =>
    suggestion(await createSuggestion(userId, id, { op: { type: "section", heading: section, content, mode }, zh, summary, source: "chat" })),
});

export const replaceDocumentTextTool = defineTool({
  name: "replace_document_text",
  description:
    "把文书里的一段原文换成新文本（改写段落、修改措辞、敬语修正），以修改建议的形式给用户确认。find 必须与原文逐字一致且在文中唯一。",
  inputSchema: z.object({
    id: docId,
    find: z.string().min(1).max(20000),
    replace: z.string().max(20000),
    zh: zhParam,
    summary: summaryParam,
  }),
  execute: async ({ id, find, replace, zh, summary }, { userId }) =>
    suggestion(await createSuggestion(userId, id, { op: { type: "replace", find, replace }, zh, summary, source: "chat" })),
});

export const updateDocumentTool = defineTool({
  name: "update_document",
  description:
    "修改文书标题、目标教授（professorId 或 targetProfessor，直接生效），或用新 Markdown 整篇替换正文（以修改建议给用户确认，需同时传 zh 和 summary）。整篇替换只在写套磁信初稿、用户要求重写或大幅调整结构时使用，局部修改用 update_document_section / replace_document_text。",
  inputSchema: z.object({
    id: docId,
    title: z.string().min(1).max(100).optional(),
    markdown: z.string().max(50000).optional(),
    zh: zhParam.optional(),
    summary: summaryParam.optional(),
    targetProfessor: professorSchema.nullable().optional(),
    professorId: savedProfessorId,
  }),
  execute: async ({ id, professorId, targetProfessor, markdown, zh, summary: note, title }, { userId }) => {
    const target = await resolveTarget(userId, professorId, targetProfessor);
    const patch = { ...(title ? { title } : {}), ...(target === undefined ? {} : { targetProfessor: target }) };
    const result = Object.keys(patch).length ? (await updateDocument(userId, id, patch)).doc : await getDocument(userId, id);
    if (!result) throw new Error("找不到这份文书");
    if (markdown === undefined) return summary(result);
    const s = await createSuggestion(userId, id, { op: { type: "full", markdown }, zh, summary: note ?? "整篇改写", source: "chat" });
    return { ...summary(result), ...suggestion(s) };
  },
});

export const proposeOutlineTool = defineTool({
  name: "propose_outline",
  description:
    "给文书提出提纲（在对话里问完关键问题之后）。提纲显示在编辑器顶部，用户点「同意」后才按提纲生成各节，你再一节一节起草。用户要求调整时再次调用覆盖。",
  inputSchema: z.object({
    id: docId,
    sections: z
      .array(
        z.object({
          heading: z.string().min(1).max(50).describe("节标题（日文），如 研究背景と問題意識"),
          points: z.array(z.string().min(1).max(200)).max(6).describe("这一节要写的要点（中文），来自用户的回答"),
        }),
      )
      .min(2)
      .max(12),
  }),
  execute: async ({ id, sections }, { userId }) => {
    const doc = await proposeOutline(userId, id, sections);
    return { id: doc.id, title: doc.title, note: "提纲已显示在编辑器顶部，等用户同意。" };
  },
});

export const createTailoredCopyTool = defineTool({
  name: "create_tailored_copy",
  description:
    "为志愿里的某位教授复制一份定制版研究计划书（从通用版复制，会标明复制自第几版），之后按这位教授的论文调整定制版。",
  inputSchema: z.object({
    id: docId.describe("通用版计划书的文书 ID"),
    professorId: z.string().describe("志愿里的教授 ID（list_aspirations 查）"),
  }),
  execute: async ({ id, professorId }, { userId }) => {
    const copy = await createTailoredCopy(userId, id, professorId);
    return { ...summary(copy), parentVersion: copy.parentVersion };
  },
});

export const DOCUMENT_TOOLS = [
  listDocumentsTool,
  readDocumentTool,
  createDocumentTool,
  updateDocumentSectionTool,
  replaceDocumentTextTool,
  updateDocumentTool,
  proposeOutlineTool,
  createTailoredCopyTool,
];

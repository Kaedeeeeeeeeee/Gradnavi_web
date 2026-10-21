import "server-only";
import { z } from "zod";
import { docTemplate, type DocKind } from "@/lib/documents";
import { listSections } from "@/lib/md-sections";
import {
  createDocument,
  getDocument,
  listDocuments,
  replaceDocumentText,
  updateDocument,
  updateDocumentSection,
} from "@/server/documents";
import { getProfile } from "@/server/profile";
import { defineTool } from "./registry";

const docId = z.string().describe("文书 ID。用户正在编辑的文书 ID 在“页面内容”里，其他文书先用 list_documents 查");
const kindSchema = z.enum(["plan", "letter", "intro", "other"]);

const professorSchema = z.object({
  name: z.string().min(1).max(100),
  affiliation: z.string().max(200).optional().describe("大学・研究科・研究室"),
  research: z.string().max(3000).optional().describe("研究方向、近期论文"),
});

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
    return { id: doc.id, kind: doc.kind, title: doc.title, targetProfessor: doc.targetProfessor, markdown: doc.markdown };
  },
});

export const createDocumentTool = defineTool({
  name: "create_document",
  description:
    "新建一份文书。不传 markdown 时使用模板（计划书按文科/理科分节）。主线 A（先找教授）写计划书时，把目标教授信息填进 targetProfessor。",
  inputSchema: z.object({
    kind: kindSchema,
    title: z.string().max(100).optional(),
    markdown: z.string().max(50000).optional(),
    targetProfessor: professorSchema.optional(),
  }),
  execute: async ({ kind, title, markdown, targetProfessor }, { userId }) => {
    const field = (await getProfile(userId))?.onboarding?.field;
    const template = docTemplate(kind as DocKind, field);
    const doc = await createDocument(userId, {
      kind,
      title: title ?? template.title,
      markdown: markdown ?? template.markdown,
      targetProfessor,
    });
    return { ...summary(doc), url: `/documents/${doc.id}` };
  },
});

export const updateDocumentSectionTool = defineTool({
  name: "update_document_section",
  description:
    "写入文书的某一节（以“## 标题”分节）。带写计划书时一节一节写：replace 替换整节正文，append 在节末追加。节不存在时在文末新建。",
  inputSchema: z.object({
    id: docId,
    section: z.string().min(1).max(50).describe("节标题（不含 ##），如 研究背景と問題意識"),
    content: z.string().min(1).max(20000).describe("该节正文 Markdown，不含标题行"),
    mode: z.enum(["replace", "append"]).default("replace"),
  }),
  execute: async ({ id, section, content, mode }, { userId }) => summary(await updateDocumentSection(userId, id, section, content, mode)),
});

export const replaceDocumentTextTool = defineTool({
  name: "replace_document_text",
  description: "把文书里的一段原文替换成新文本（改写选中段落、修改措辞、敬语修正）。find 必须与原文逐字一致且在文中唯一。",
  inputSchema: z.object({
    id: docId,
    find: z.string().min(1).max(20000),
    replace: z.string().max(20000),
  }),
  execute: async ({ id, find, replace }, { userId }) => summary(await replaceDocumentText(userId, id, find, replace)),
});

export const updateDocumentTool = defineTool({
  name: "update_document",
  description:
    "修改文书标题、目标教授，或用新 Markdown 整篇替换正文。整篇替换只在用户要求重写或大幅调整结构时使用，局部修改用 update_document_section / replace_document_text。",
  inputSchema: z.object({
    id: docId,
    title: z.string().min(1).max(100).optional(),
    markdown: z.string().max(50000).optional(),
    targetProfessor: professorSchema.nullable().optional(),
  }),
  execute: async ({ id, ...patch }, { userId }) => {
    const result = await updateDocument(userId, id, patch);
    return summary(result.doc);
  },
});

export const DOCUMENT_TOOLS = [
  listDocumentsTool,
  readDocumentTool,
  createDocumentTool,
  updateDocumentSectionTool,
  replaceDocumentTextTool,
  updateDocumentTool,
];

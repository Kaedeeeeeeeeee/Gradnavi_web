import "server-only";
import { z } from "zod";
import { describeForm } from "@/lib/forms";
import { createFormFromUrl, getForm, listForms, proposeFieldValues, refillForm, type FillResult } from "@/server/forms";
import { defineTool } from "./registry";

const formId = z.string().describe("申请表 ID（list_application_forms 查；用户正在看的申请表 ID 在“页面内容”里）");

const NOTE = "AI 填的内容是提议，显示在文书里的申请表预览上（虚线框），用户接受后才印进 PDF。";

const result = (r: FillResult) => ({
  id: r.form.id,
  title: r.form.title,
  url: `/documents/forms/${r.form.id}`,
  mode: r.form.mode,
  handwriting: r.form.handwriting,
  proposedNow: r.changed,
  pendingTotal: r.pending,
  unplaced: r.skipped || undefined,
  missing: r.missing,
  summary: r.summary,
  note: `${NOTE}${r.form.handwriting?.required ? "学校要求亲笔填写，下载的是参照版（页顶印着「参照用」），让用户照着手抄。" : ""}missing 里的信息在对话里问用户，问到后用 update_application_form 填上（顺手用 update_user_md 记下来）。`,
});

export const fillApplicationFormTool = defineTool({
  name: "fill_application_form",
  description:
    "下载学校的申请表 PDF（入学願書、研究生出願票、履歴書、研究計画書様式等），按用户的资料（user.md、申请概况、目标教授和研究科、计划书）填好，放进文书里。有填写栏的 PDF 和普通表格都能填。只给 PDF 的直接链接（先用 web_search / fetch_page 在募集要项页面找到様式的链接）。募集要项是一整份 PDF、申请表夹在中间时，用 pages 指定页码。",
  inputSchema: z.object({
    url: z.string().url().max(500).describe("申请表 PDF 的链接"),
    pages: z.string().max(40).optional().describe("要填的页码，如 \"12-14\" 或 \"3,5\"（从 1 起，最多 8 页）。整份 PDF 就是申请表时不填"),
    title: z.string().max(80).optional().describe("中文或日文标题，如「東京学芸大学 研究生出願票」"),
    professorId: z.string().optional().describe("志愿里的教授 ID（志望指導教員、研究计划从这位教授对应的资料取）"),
    schoolId: z.string().optional().describe("研究科 ID（list_watched_schools 查）"),
    handwritten: z.boolean().optional().describe("募集要项写明要亲笔填写（原則手書き等）时传 true，下载的是参照版"),
    instructions: z.string().max(1000).optional().describe("给填写的额外要求（中文），如「研究题目用计划书的标题」"),
  }),
  execute: async (input, { userId, meter }) => result(await createFormFromUrl(userId, input, meter)),
});

export const refillApplicationFormTool = defineTool({
  name: "refill_application_form",
  description: "让 AI 按最新的资料再填一遍申请表（用户补充了很多信息、改了计划书，或者要求「这几栏重新写」）。已有内容不同的地方变成新的提议。",
  inputSchema: z.object({
    id: formId,
    instructions: z.string().max(1000).optional().describe("这次的要求（中文），如「志望理由写短一点」"),
    handwritten: z.boolean().optional().describe("改是否要求手写（用户或募集要项说明了时）"),
  }),
  execute: async ({ id, instructions, handwritten }, { userId, meter }) => result(await refillForm(userId, id, instructions ?? "", meter, handwritten)),
});

export const updateApplicationFormTool = defineTool({
  name: "update_application_form",
  description: "给申请表的某几栏提议新内容（用户在对话里告诉了住址、电话、学历等之后）。栏目 ID 用 read_application_form 查。",
  inputSchema: z.object({
    id: formId,
    values: z
      .array(
        z.object({
          fieldId: z.string().max(40),
          value: z.string().max(2000).describe("填进表里的内容（日文）；勾选 / 圈选的栏写 ✓，取消写空字符串"),
          note: z.string().max(200).optional(),
        }),
      )
      .min(1)
      .max(60),
  }),
  execute: async ({ id, values }, { userId }) => {
    const r = await proposeFieldValues(userId, id, values);
    return { id, proposedNow: r.changed, pendingTotal: r.pending, note: NOTE };
  },
});

export const readApplicationFormTool = defineTool({
  name: "read_application_form",
  description: "查看一份申请表现在每一栏填了什么、哪些还空着、哪些是待用户确认的提议。",
  inputSchema: z.object({ id: formId }),
  execute: async ({ id }, { userId }) => {
    const form = await getForm(userId, id);
    if (!form) throw new Error("找不到这份申请表");
    return { text: describeForm(form), missing: form.missing };
  },
});

export const listApplicationFormsTool = defineTool({
  name: "list_application_forms",
  description: "列出用户已经填过的申请表。",
  inputSchema: z.object({}),
  execute: async (_input, { userId }) =>
    (await listForms(userId)).map((f) => ({
      id: f.id,
      title: f.title,
      sourceUrl: f.sourceUrl,
      handwriting: !!f.handwriting?.required,
      filled: f.fields.filter((x) => x.value).length,
      pending: f.fields.filter((x) => x.proposed !== null).length,
      updatedAt: f.updatedAt.toISOString(),
    })),
});

export const FORM_TOOLS = [fillApplicationFormTool, refillApplicationFormTool, updateApplicationFormTool, readApplicationFormTool, listApplicationFormsTool];

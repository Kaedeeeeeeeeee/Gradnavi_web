import "server-only";
import { z } from "zod";
import { MAX_SCHOOLS, PROFESSOR_STATUSES } from "@/lib/professors";
import { getProfile } from "@/server/profile";
import { searchProfessors } from "@/server/professor-search";
import { listSavedProfessors, saveProfessor, updateSavedProfessor } from "@/server/professors";
import { fetchPage, webSearch } from "@/server/search";
import { defineTool } from "./registry";

const professorId = z.string().describe("教授清单里的 ID，用 list_saved_professors 查");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式 YYYY-MM-DD");

export const searchProfessorsTool = defineTool({
  name: "search_professors",
  description:
    "按研究方向和目标校检索日本大学的教授候选（researchmap、大学官网、KAKEN 等），返回研究方向摘要、代表论文和来源链接。结果不会自动收藏：给用户简要介绍后，用户想收藏的再用 save_professor。",
  inputSchema: z.object({
    keywords: z.string().min(1).max(200).describe("研究方向关键词，日文效果最好，如 第二言語習得 / 強化学習"),
    schools: z.array(z.string().min(1).max(50)).max(MAX_SCHOOLS).default([]).describe("目标大学名，日文，如 東京大学"),
    field: z.enum(["humanities", "sciences"]).optional(),
  }),
  execute: async ({ keywords, schools, field }, { userId, meter }) => {
    const f = field ?? (await getProfile(userId))?.onboarding?.field;
    return searchProfessors({ keywords, schools, field: f }, meter);
  },
});

export const listSavedProfessorsTool = defineTool({
  name: "list_saved_professors",
  description: "列出用户教授清单（收藏的教授）里的所有教授，含联系状态、备注、跟进日期。",
  inputSchema: z.object({}),
  execute: async (_input, { userId }) => {
    const rows = await listSavedProfessors(userId);
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      university: p.university,
      department: p.department,
      lab: p.lab,
      research: p.research,
      papers: p.papers,
      acceptsInternational: p.acceptsInternational,
      sources: p.sources,
      status: p.status,
      note: p.note,
      followUpDate: p.followUpDate,
    }));
  },
});

export const saveProfessorTool = defineTool({
  name: "save_professor",
  description: "把一位教授加入用户的教授清单（同名同校会更新信息，保留状态和备注）。只在用户同意收藏时调用。",
  inputSchema: z.object({
    name: z.string().min(1).max(100),
    university: z.string().min(1).max(100),
    department: z.string().max(200).optional().describe("研究科・専攻"),
    lab: z.string().max(200).optional(),
    research: z.string().max(1000).optional().describe("研究方向摘要（中文）"),
    papers: z.array(z.string().max(300)).max(5).optional(),
    acceptsInternational: z.string().max(200).optional(),
    sources: z.array(z.object({ title: z.string().max(200), url: z.string().url().max(500) })).max(5).optional(),
    note: z.string().max(1000).optional(),
  }),
  execute: async (input, { userId }) => {
    const row = await saveProfessor(userId, input);
    return { id: row.id, name: row.name, university: row.university, url: "/professors" };
  },
});

export const updateSavedProfessorTool = defineTool({
  name: "update_saved_professor",
  description:
    "修改教授清单里的一位教授：联系状态（to_contact 待联系 / contacted 已发套磁 / replied 已回复 / interview 面谈 / dropped 放弃）、备注、跟进日期，或补充研究信息。",
  inputSchema: z.object({
    id: professorId,
    status: z.enum(PROFESSOR_STATUSES).optional(),
    note: z.string().max(1000).nullable().optional(),
    followUpDate: dateSchema.nullable().optional(),
    research: z.string().max(1000).optional(),
    papers: z.array(z.string().max(300)).max(5).optional(),
    acceptsInternational: z.string().max(200).nullable().optional(),
  }),
  execute: async ({ id, ...patch }, { userId }) => {
    const row = await updateSavedProfessor(userId, id, patch);
    return { id: row.id, name: row.name, status: row.status, followUpDate: row.followUpDate, note: row.note };
  },
});

export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "联网检索。用于查教授近期论文、研究室主页、募集要项等事实信息，优先权威来源（大学官网、researchmap、KAKEN、CiNii）。支持 site: 语法。回答时附上来源链接。",
  inputSchema: z.object({ query: z.string().min(1).max(200), count: z.number().int().min(1).max(10).default(6) }),
  execute: async ({ query, count }, { meter }) => webSearch(query, count, meter),
});

export const fetchPageTool = defineTool({
  name: "fetch_page",
  description: "读取一个网页的正文（如教授的研究室主页、researchmap 页面、论文摘要页）。",
  inputSchema: z.object({ url: z.string().url().max(500) }),
  execute: async ({ url }, { meter }) => fetchPage(url, meter),
});

export const PROFESSOR_TOOLS = [
  searchProfessorsTool,
  listSavedProfessorsTool,
  saveProfessorTool,
  updateSavedProfessorTool,
  webSearchTool,
  fetchPageTool,
];

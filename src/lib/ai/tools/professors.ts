import "server-only";
import { z } from "zod";
import { CONTACT_RULES } from "@/lib/admissions";
import { describeRequirements } from "@/lib/aspirations";
import { todayJst } from "@/lib/calendar";
import { DEFAULT_CANDIDATES, describeProfessor, MAX_CANDIDATES, MAX_SCHOOLS, paperLabel, PROFESSOR_STATUSES } from "@/lib/professors";
import { answerField } from "@/lib/onboarding";
import { listAspirations } from "@/server/aspirations";
import { getProfile } from "@/server/profile";
import { runProfessorSearch } from "@/server/professor-search";
import { saveProfessor, updateSavedProfessor } from "@/server/professors";
import { updateSchoolRequirements } from "@/server/schools";
import { fetchPage, webSearch } from "@/server/search";
import { defineTool } from "./registry";

const professorId = z.string().describe("志愿里教授的 ID，用 list_aspirations 查");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式 YYYY-MM-DD");

const paperRef = z.object({ title: z.string().max(300), year: z.number().int().min(1950).max(2100).optional(), url: z.string().url().max(500).optional() });

export const searchProfessorsTool = defineTool({
  name: "search_professors",
  description:
    "按研究方向和目标校检索日本大学的教授候选（researchmap、大学官网、KAKEN 等）。结果会以候选卡片显示在用户的文稿栏（为什么适合、近期论文和链接、是否收留学生），用户在卡片上点「加入志愿」或「不合适」。" +
    "用户说「更偏应用一点」「只要关东的」时，调整 keywords / schools / preference 再检索一轮。返回的是摘要，不要在对话里逐个重复卡片内容，只说整体情况和你的推荐。",
  inputSchema: z.object({
    keywords: z.string().min(1).max(200).describe("研究方向关键词，日文效果最好，如 第二言語習得 / 強化学習"),
    schools: z.array(z.string().min(1).max(50)).max(MAX_SCHOOLS).default([]).describe("目标大学名，日文，如 東京大学；地区要求（如关东）请换成具体大学"),
    preference: z.string().max(300).optional().describe("用户追加的要求，如：更偏应用、要有研究生制度"),
    field: z.enum(["humanities", "sciences"]).optional(),
    count: z
      .number()
      .int()
      .min(1)
      .max(MAX_CANDIDATES)
      .optional()
      .describe(`要几位候选：用户说了数量就照着填（「两三位」填 3，「一位」填 1）；没说就不填（默认 ${DEFAULT_CANDIDATES} 位）`),
  }),
  execute: async ({ keywords, schools, preference, field, count }, { userId, meter }) => {
    const profile = await getProfile(userId);
    const f = field ?? answerField(profile?.onboarding);
    const res = await runProfessorSearch(userId, { keywords, schools, preference, field: f, count, profile: profile?.markdown.slice(0, 2500) }, meter);
    return {
      searchId: res.searchId,
      demo: res.demo,
      shown: "候选卡片已显示在文稿栏",
      candidates: res.candidates.map((c) => ({
        name: c.name,
        university: c.university,
        department: c.department,
        fit: c.fit ?? c.research,
        papers: c.papers,
        acceptsInternational: c.acceptsInternational,
      })),
    };
  },
});

export const listAspirationsTool = defineTool({
  name: "list_aspirations",
  description:
    "列出用户的志愿：每条 = 一位教授 + 教授所在的研究科（也有只有研究科的）。含教授的联系状态、为什么适合、跟进日期，研究科的入试要点、出愿截止、和用户档案的差距。",
  inputSchema: z.object({}),
  execute: async (_input, { userId }) => {
    const list = await listAspirations(userId, todayJst());
    if (!list.length) return "志愿还是空的";
    return list.map((a) => ({
      professor: a.professor
        ? {
            id: a.professor.id,
            summary: describeProfessor(a.professor),
            papers: a.professor.papers,
            proposedFollowUp: a.professor.proposedFollowUp ? `AI 提议的跟进日 ${a.professor.proposedFollowUp.date ?? "（取消）"}，等用户同意` : undefined,
          }
        : null,
      school: a.school
        ? {
            id: a.school.id,
            name: `${a.school.university} ${a.school.name}`,
            requirements: describeRequirements(a.school.requirements),
            deadline: a.school.deadline ? `${a.school.deadline.label} ${a.school.deadline.date}${a.school.deadline.tentative ? "（仮）" : ""}` : "还没有日程",
          }
        : "还没关联研究科（查到入试页面后用 watch_school 带 professorId 关联）",
      gaps: a.gaps,
    }));
  },
});

export const saveProfessorTool = defineTool({
  name: "save_professor",
  description:
    "把一位教授加入志愿（同名同校会更新信息，保留联系状态和备注）。只在用户同意时调用（用户在候选卡片上点「加入志愿」时系统会自动加入，不用你再调用）。教授所在的研究科系统里已有时会自动关联。",
  inputSchema: z.object({
    name: z.string().min(1).max(100),
    university: z.string().min(1).max(100),
    department: z.string().max(200).optional().describe("研究科・専攻"),
    lab: z.string().max(200).optional(),
    research: z.string().max(1000).optional().describe("研究方向摘要（中文）"),
    fit: z.string().max(1000).optional().describe("为什么适合用户（中文）"),
    papers: z.array(z.string().max(300)).max(5).optional(),
    paperRefs: z.array(paperRef).max(5).optional().describe("近期论文，带检索到的链接"),
    acceptsInternational: z.string().max(200).optional(),
    sources: z.array(z.object({ title: z.string().max(200), url: z.string().url().max(500) })).max(5).optional(),
    note: z.string().max(1000).optional(),
  }),
  execute: async (input, { userId }) => {
    const row = await saveProfessor(userId, { ...input, papers: input.papers ?? input.paperRefs?.map(paperLabel) });
    return { id: row.id, name: row.name, university: row.university, schoolLinked: !!row.schoolId, url: "/aspirations" };
  },
});

export const updateSavedProfessorTool = defineTool({
  name: "update_saved_professor",
  description:
    "修改志愿里的一位教授：联系状态（to_contact 未联系 / contacted 已发信 / replied 已回复 / interview 面谈过 / accepted 同意接收 / dropped 放弃）、备注、跟进日期，或补充研究信息。" +
    "用户贴来教授回信时，读懂后用它更新状态、把要点记进备注。跟进日期是提议：日历上虚线显示，用户同意后才生效。",
  inputSchema: z.object({
    id: professorId,
    status: z.enum(PROFESSOR_STATUSES).optional(),
    note: z.string().max(1000).nullable().optional(),
    followUpDate: dateSchema.nullable().optional(),
    research: z.string().max(1000).optional(),
    fit: z.string().max(1000).optional(),
    papers: z.array(z.string().max(300)).max(5).optional(),
    acceptsInternational: z.string().max(200).nullable().optional(),
  }),
  execute: async ({ id, ...patch }, { userId }) => {
    const row = await updateSavedProfessor(userId, id, patch, "ai");
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      followUpDate: row.followUpDate,
      proposedFollowUp: row.proposedFollowUp ? `${row.proposedFollowUp.date ?? "取消跟进日"}（已提议，等用户在主页同意）` : null,
      note: row.note,
    };
  },
});

export const updateSchoolRequirementsTool = defineTool({
  name: "update_school_requirements",
  description:
    "记下一个已关注研究科的入试要点（要不要先联系教授、考试科目、语言要求），志愿列表里会显示并和用户成绩对照。只写从官网募集要项 / 入试页面查到的事实，sourceUrl 填来源。募集要项监控已解析过的不会被覆盖。",
  inputSchema: z.object({
    schoolId: z.string().max(64).describe("研究科 ID（list_watched_schools / list_aspirations 查）"),
    contact: z.enum(CONTACT_RULES).nullable().optional().describe("required 必须先联系 / recommended 建议先联系 / not_required 不需要"),
    contactNote: z.string().max(300).optional().describe("原文关于事先联系的说法，中文简述"),
    subjects: z.array(z.string().max(100)).max(12).optional().describe("考试科目，中文简写"),
    english: z.string().max(300).optional().describe("英语要求简述"),
    japanese: z.string().max(300).optional().describe("日语要求简述"),
    toefl: z.number().min(1).max(120).optional().describe("写明的 TOEFL iBT 最低分"),
    toeic: z.number().min(10).max(990).optional(),
    ielts: z.number().min(1).max(9).optional(),
    jlpt: z.number().int().min(1).max(5).optional().describe("要求的 JLPT 级别，N1 = 1"),
    notes: z.string().max(500).optional(),
    sourceUrl: z.string().url().max(500),
  }),
  execute: async ({ schoolId, sourceUrl, ...req }, { userId }) => {
    const res = await updateSchoolRequirements(userId, schoolId, req, sourceUrl);
    return { saved: res.saved, reason: "reason" in res ? res.reason : undefined, requirements: describeRequirements(res.requirements) };
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
  listAspirationsTool,
  saveProfessorTool,
  updateSavedProfessorTool,
  updateSchoolRequirementsTool,
  webSearchTool,
  fetchPageTool,
];

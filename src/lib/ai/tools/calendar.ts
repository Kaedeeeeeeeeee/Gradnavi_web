import "server-only";
import { z } from "zod";
import { addDays, CALENDAR_KINDS, describeItem, todayJst } from "@/lib/calendar";
import { addCalendarEvent, deleteCalendarEvent, listCalendar, updateCalendarEvent } from "@/server/calendar";
import { describeRequirements } from "@/lib/aspirations";
import { listWatchedSchools, unwatchSchool, watchSchool } from "@/server/schools";
import { defineTool } from "./registry";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listCalendarTool = defineTool({
  name: "list_calendar",
  description:
    "查看用户日历：手动日程、有截止日期的任务、教授跟进日、关注研究科的募集要项日程（标“仮”的是按往年要项推算的；标“AI 提议”的是你提议、用户还没同意的）。默认从今天起 60 天。",
  inputSchema: z.object({
    from: dateSchema.optional().describe("开始日期 YYYY-MM-DD，默认今天"),
    days: z.number().int().min(1).max(400).default(60),
  }),
  execute: async ({ from, days }, { userId }) => {
    const today = todayJst();
    const start = from ?? today;
    const items = await listCalendar(userId, start, addDays(start, days - 1), today);
    return items.length ? items.map(describeItem) : "这段时间没有日程";
  },
});

export const addCalendarEventTool = defineTool({
  name: "add_calendar_event",
  description:
    "在用户日历里提议一条日程（截止日、考试/面谈、跟进、某天做某事等）。添加的日程是提议：日历上虚线显示，用户同意后才变成正式日程。先和用户商量好日期再写，不要从截止日往回倒推，不要编造日期。教授跟进日请用 update_saved_professor 的 followUpDate。",
  inputSchema: z.object({
    title: z.string().min(1).max(100),
    date: dateSchema.describe("日期 YYYY-MM-DD"),
    endDate: dateSchema.optional().describe("多天的日程填结束日期"),
    kind: z.enum(CALENDAR_KINDS).default("other").describe("deadline 截止 / exam 考试面试 / followup 跟进 / other"),
    note: z.string().max(500).optional(),
  }),
  execute: async (input, { userId }) => {
    const row = await addCalendarEvent(userId, input, "ai");
    return { id: row.id, title: row.title, date: row.date, note: "已作为提议加到日历，等用户同意" };
  },
});

export const updateCalendarEventTool = defineTool({
  name: "update_calendar_event",
  description:
    "修改手动日程（list_calendar 里来源为 event 的项）。改已同意日程的日期会变成改期提议，用户同意后才生效。任务截止日用 update_todo 改，教授跟进日用 update_saved_professor 改。",
  inputSchema: z.object({
    id: z.string(),
    title: z.string().min(1).max(100).optional(),
    date: dateSchema.optional(),
    endDate: dateSchema.nullable().optional(),
    kind: z.enum(CALENDAR_KINDS).optional(),
    note: z.string().max(500).nullable().optional(),
  }),
  execute: async ({ id, ...patch }, { userId }) => {
    const row = await updateCalendarEvent(userId, id, patch, "ai");
    return { id: row.id, title: row.title, date: row.date, ...(row.proposedChange ? { proposedDate: row.proposedChange.date, note: "改期已作为提议，等用户同意" } : {}) };
  },
});

export const deleteCalendarEventTool = defineTool({
  name: "delete_calendar_event",
  description: "删除一条手动日程。只在用户明确要求、或撤回你自己的提议时使用。",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }, { userId }) => {
    if (!(await deleteCalendarEvent(userId, id))) throw new Error("找不到这条日程");
    return { deleted: id };
  },
});

export const listWatchedSchoolsTool = defineTool({
  name: "list_watched_schools",
  description: "查看用户关注的研究科（志愿的研究科这边，募集要项监控）：入试要点、最近检查时间、最新要项年度和日程、是否为仮日程。",
  inputSchema: z.object({}),
  execute: async (_input, { userId }) => {
    const rows = await listWatchedSchools(userId, todayJst());
    if (!rows.length) return "还没有关注任何研究科";
    return rows.map(({ school, guide, tentative, calendar }) => ({
      id: school.id,
      name: `${school.university} ${school.name}`,
      url: school.url,
      checkedAt: school.checkedAt?.toISOString() ?? "等待首次检查（几分钟内）",
      problem: school.lastError,
      requirements: describeRequirements(school.requirements),
      guide: guide ? `${guide.admissionYear} 年度${tentative ? "（已过期，日历里是顺延一年的仮日程）" : ""}` : "还没有解析出要项",
      schedule: calendar.map(describeItem),
    }));
  },
});

export const watchSchoolTool = defineTool({
  name: "watch_school",
  description:
    "关注一个研究科（加进志愿的研究科这边）：系统每天检查它的募集要项页面，解析日程和入试要点，新要项公开前按往年日程在日历里排仮日程，公开后自动更新并邮件通知。页面有变化时 AI 解析的费用从用户的 credit 扣（一般不到 1 美分），没变化不花钱。" +
    "是志愿里某位教授所在的研究科时，填 professorId 把两者关联成一条志愿。url 必须是该研究科入试/募集要项页面的官网地址：不确定时先用 web_search 查到官网页面再关注，不要编造网址。",
  inputSchema: z.object({
    university: z.string().min(1).max(100).describe("大学名，如 東京大学"),
    name: z.string().min(1).max(100).describe("研究科名，如 教育学研究科"),
    url: z.string().url().max(500).describe("入试信息 / 募集要项页面的网址"),
    professorId: z.string().max(64).optional().describe("志愿里教授的 ID（list_aspirations 查），这个研究科是教授所在的研究科时填"),
  }),
  execute: async ({ professorId, ...input }, { userId }) => {
    const school = await watchSchool(userId, input, professorId);
    return {
      id: school.id,
      name: `${school.university} ${school.name}`,
      url: school.url,
      requirements: describeRequirements(school.requirements),
      note: `已关注${professorId ? "并关联到教授" : ""}，几分钟内完成首次检查。入试要点还没有时，可以把查到的要点用 update_school_requirements 先记下来`,
    };
  },
});

export const unwatchSchoolTool = defineTool({
  name: "unwatch_school",
  description: "取消关注一个研究科（id 用 list_watched_schools 查）。只在用户明确要求时使用。",
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }, { userId }) => {
    if (!(await unwatchSchool(userId, id))) throw new Error("没有关注这个研究科");
    return { unwatched: id };
  },
});

export const CALENDAR_TOOLS = [
  listCalendarTool,
  addCalendarEventTool,
  updateCalendarEventTool,
  deleteCalendarEventTool,
  listWatchedSchoolsTool,
  watchSchoolTool,
  unwatchSchoolTool,
];

import "server-only";
import { z } from "zod";
import { listSections } from "@/lib/md-sections";
import { getUserMd, updateUserMdSection } from "@/server/profile";
import { defineTool } from "./registry";

export const readUserMd = defineTool({
  name: "read_user_md",
  description: "读取用户档案 user.md 的完整内容（系统提示里已附带，一般无需调用，除非刚修改过需要确认）。",
  inputSchema: z.object({}),
  execute: async (_input, { userId }) => ({ markdown: await getUserMd(userId) }),
});

export const updateUserMd = defineTool({
  name: "update_user_md",
  description:
    "修改用户档案 user.md 的某一节（以“## 标题”分节）。用户告诉你新的背景、成绩、目标、偏好或进度时调用，" +
    "让以后的对话都能记住。replace 替换整节正文，append 在节末追加。节不存在时自动新建。只写用户明确说过的事实，不要猜测。" +
    "聊天里会显示一行「已记住：{note}」，用户可以撤销，所以一次只记一件事，不用再在回复里重复说记住了什么。",
  inputSchema: z.object({
    section: z.string().min(1).max(30).describe("节标题，例如：背景、语言成绩、目标、研究方向、当前路线、偏好与备注、进度"),
    content: z.string().min(1).max(3000).describe("该节的 Markdown 正文，不含标题行"),
    mode: z.enum(["replace", "append"]).default("append"),
    note: z.string().max(60).optional().describe("给用户看的一句话，说明记住了什么，如「TOEFL 72 分」「想去关西的学校」"),
  }),
  execute: async ({ section, content, mode }, { userId }) => {
    const { markdown, change } = await updateUserMdSection(userId, section, content, mode);
    // change 是这一节修改前后的内容，聊天里的「撤销」用
    return { ok: true, sections: listSections(markdown), change };
  },
});

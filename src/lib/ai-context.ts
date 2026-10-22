// AI 对话栏的「当前在看什么」：用户换了打开的东西时在通用对话里插一行分隔，
// 快捷回复按当前打开的东西换（按模板生成，不调 AI）。任务对话不受影响（一个任务一段对话）。

import type { DocTab } from "./shell";

export type QuickReply = { label: string; text: string };

export type AiFocus = {
  /** 变了就插分隔 */
  key: string;
  /** 「你打开了 …」里显示的名字 */
  label: string;
  /** 输入框上面「AI 能看到」的小标签 */
  pill: string;
  replies: QuickReply[];
};

const WORK_PAGES: [string, string, QuickReply[]][] = [
  ["/workbench", "主页", [{ label: "我下一步该做什么？", text: "看看我现在的进度，我下一步该做什么？" }]],
  [
    "/aspirations",
    "志愿",
    [
      { label: "比较我的几条志愿", text: "帮我比较一下志愿里的几条：各自的难度、和我的匹配度、时间上哪条最急。" },
      { label: "再找几位教授", text: "再帮我找几位合适的教授，先问我一两个问题。" },
    ],
  ],
  ["/documents", "文书列表", [{ label: "我该先写哪份？", text: "看看我的文书，我现在该先写哪一份？" }]],
  ["/profile", "AI 对你的了解", [{ label: "还缺哪些信息？", text: "看看你对我的了解，还缺哪些申请时重要的信息？" }]],
];

export function workFocus(pathname: string): AiFocus {
  const hit = WORK_PAGES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  const label = hit?.[1] ?? "工作台";
  return { key: `work:${hit?.[0] ?? pathname}`, label, pill: `页面 · ${label}`, replies: hit?.[2] ?? [] };
}

/** 文稿栏打开的标签（任务标签不算：任务有自己的对话） */
export function tabFocus(tab: DocTab): AiFocus | null {
  const title = tab.title || "（无标题）";
  const key = tab.kind === "web" ? `web:${tab.url}` : `${tab.kind}:${tab.id}`;
  switch (tab.kind) {
    case "professor": {
      const who = `${title}教授（教授 ID：${tab.id}）`;
      return {
        key,
        label: title,
        pill: `志愿 · ${title}`,
        replies: [
          { label: "讲解他的代表论文", text: `用中文讲解${who}近几年的代表论文，告诉我和我的方向有什么交集。` },
          { label: "起草给他的邮件", text: `看一下我和${who}的联系进度，起草下一封该发的日文邮件（套磁信或跟进）。` },
          { label: "他所在研究科怎么考", text: `查清${who}所在研究科怎么考：要不要先联系教授、考试科目、语言要求，再对照我的档案说说差距。` },
        ],
      };
    }
    case "school":
      return {
        key,
        label: title,
        pill: `志愿 · ${title}`,
        replies: [
          { label: "这个研究科怎么考", text: `${title}怎么考？要不要先联系教授、考试科目、语言要求分别是什么？` },
          { label: "我和要求差在哪", text: `对照我的档案，看看我离${title}的要求还差什么，按急的程度排。` },
        ],
      };
    case "doc":
      return {
        key,
        label: `「${title}」`,
        pill: `文书 · ${title}`,
        replies: [
          { label: "接着写下一节", text: `接着写「${title}」还没写的下一节，信息不够先问我。` },
          { label: "哪里最需要改", text: `读一下「${title}」，告诉我最需要改的三处，按重要程度排。` },
          { label: "用中文讲讲这份写了什么", text: `用中文概括「${title}」现在每一部分在说什么。` },
        ],
      };
    case "search":
      return {
        key,
        label: "找教授的结果",
        pill: "找教授的结果",
        replies: [
          { label: "你最推荐谁？", text: "这一轮找到的教授里，你最推荐哪几位？说说理由。" },
          { label: "换个方向再找", text: "换个角度再找几位，先问我想怎么调整。" },
        ],
      };
    case "compare":
      return {
        key,
        label: "志愿并排对比",
        pill: "志愿对比",
        replies: [{ label: "给个优先顺序", text: "结合我的档案，给这几条志愿一个建议的优先顺序，说明取舍（最后我来决定）。" }],
      };
    case "web":
      return { key, label: title, pill: `网页 · ${title}`, replies: [{ label: "总结这个网页", text: `用中文总结这个网页（${tab.url}）里和我申请有关的要点。` }] };
    case "task":
      return null;
  }
}

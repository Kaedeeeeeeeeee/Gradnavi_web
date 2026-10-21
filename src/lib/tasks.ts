// 任务（主页待办）：状态、子步骤、本周/之后分组、今日简报、「让 AI 开始」的开场消息（纯函数，前后端共用）。
// 不设「阶段」：长期视角靠「之后」的里程碑列表、日历和关键日期倒计时。

import { addDays, daysBetween, type CalendarItem } from "./calendar";

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "未开始",
  doing: "进行中",
  review: "待你确认",
  done: "完成",
};

/** AI 能设的状态：只有用户能标「完成」，AI 认为做完了就设成「待你确认」 */
export const AI_TASK_STATUSES = ["todo", "doing", "review"] as const;

/** 任务内的小清单 */
export type TaskStep = { id: string; title: string; done: boolean };

/** AI 对已有任务截止日的修改提议（同意后才生效） */
export type TaskChange = { dueDate: string | null };

/** 主页和任务详情用到的任务字段 */
export type TaskView = {
  id: string;
  title: string;
  note: string | null;
  status: TaskStatus;
  dueDate: string | null;
  steps: TaskStep[];
  /** AI 新建、用户还没同意的任务 */
  proposed: boolean;
  proposedChange: TaskChange | null;
  stepKey: string | null;
  professorId: string | null;
  documentId: string | null;
  schoolId: string | null;
  sortOrder: number;
};

/** 这一周的最后一天（周日），日本时间 */
export function weekEnd(today: string) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 周一 = 0
  return addDays(today, 6 - weekday);
}

const STATUS_ORDER: Record<TaskStatus, number> = { review: 0, doing: 1, todo: 2, done: 3 };

/** 待确认的排最前，其次进行中；同状态按截止日（没有的排后）、再按添加顺序 */
export function compareTasks(a: TaskView, b: TaskView) {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    a.sortOrder - b.sortOrder
  );
}

/**
 * 主页待办分组：
 * - week「本周」：没有截止日、或截止日在本周日之前（含已过期）的未完成任务
 * - later「之后」：截止日在下周及以后的任务，按日期
 * - done：已完成
 * AI 提议的新任务单独放在 proposals，同意后才进入上面三组。
 */
export function groupTasks(tasks: TaskView[], today: string) {
  const end = weekEnd(today);
  const proposals = tasks.filter((t) => t.proposed);
  const real = tasks.filter((t) => !t.proposed);
  const open = real.filter((t) => t.status !== "done");
  return {
    proposals,
    week: open.filter((t) => !t.dueDate || t.dueDate <= end).sort(compareTasks),
    later: open.filter((t) => t.dueDate && t.dueDate > end).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || compareTasks(a, b)),
    done: real.filter((t) => t.status === "done"),
  };
}

/** 需要用户处理的数量：待你确认的任务 + AI 的提议（主页竖条上的标记） */
export function countAwaiting(tasks: Pick<TaskView, "status" | "proposed" | "proposedChange">[], proposedEvents: number) {
  return tasks.filter((t) => t.proposed || t.proposedChange || t.status === "review").length + proposedEvents;
}

/** 关键日期倒计时：最近的出愿截止和考试日（来自募集要项，含仮日程） */
export type Countdown = { label: string; date: string; days: number; tentative: boolean; sourceUrl?: string };

export function keyDates(items: CalendarItem[], today: string): Countdown[] {
  const upcoming = items.filter((it) => it.source === "guide" && (it.endDate ?? it.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
  const out: Countdown[] = [];
  for (const kind of ["deadline", "exam"] as const) {
    const it = upcoming.find((i) => i.kind === kind);
    if (!it) continue;
    // 出愿期间这类跨天的日程，倒计时数到最后一天
    const date = kind === "deadline" && it.endDate ? it.endDate : it.date;
    out.push({ label: it.title, date, days: daysBetween(today, date), tentative: !!it.tentative, sourceUrl: it.sourceUrl });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 今日简报：一两句今天该做什么（按规则生成，不调用 AI） */
export function briefing(tasks: TaskView[], proposedEvents: number, today: string): string[] {
  const { proposals, week } = groupTasks(tasks, today);
  const review = tasks.filter((t) => !t.proposed && t.status === "review").length;
  const changes = tasks.filter((t) => t.proposedChange && !t.proposed).length;
  const proposalCount = proposals.length + changes + proposedEvents;
  const overdue = week.filter((t) => t.status !== "review" && t.dueDate && t.dueDate < today).length;

  const notes = [
    review > 0 && `${review} 件事待你确认`,
    proposalCount > 0 && `AI 提了 ${proposalCount} 项安排等你同意`,
    overdue > 0 && `${overdue} 件已过截止日`,
  ].filter(Boolean);
  const lines: string[] = [];
  if (notes.length) lines.push(`${notes.join("，")}。`);

  const next = week.find((t) => t.status === "doing") ?? week.find((t) => t.status === "todo");
  if (next) {
    const due = next.dueDate ? (next.dueDate === today ? "（今天截止）" : next.dueDate < today ? "（已过截止日）" : `（${next.dueDate.slice(5).replace("-", "/")} 截止）`) : "";
    lines.push(`${next.status === "doing" ? "接着做" : "今天建议先做"}：「${next.title}」${due}。`);
  } else if (!notes.length) {
    lines.push("这周的事都做完了，可以问问右边的 AI 接下来做什么。");
  }
  return lines;
}

/** 新的子步骤（标题去重、去空，最多 20 条）；同名的保留原来的勾选状态 */
export function buildSteps(input: { title: string; done?: boolean }[], previous: TaskStep[] = [], newId: () => string = () => crypto.randomUUID()): TaskStep[] {
  const seen = new Set<string>();
  const out: TaskStep[] = [];
  for (const s of input) {
    const title = s.title.trim().slice(0, 100);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const old = previous.find((p) => p.title === title);
    out.push({ id: old?.id ?? newId(), title, done: s.done ?? old?.done ?? false });
    if (out.length >= 20) break;
  }
  return out;
}

/** 给 AI 看的任务描述（任务对话的系统提示、任务详情页） */
export function describeTask(t: TaskView, links: { professor?: string; document?: string; school?: string } = {}) {
  const lines = [
    `任务：${t.title}（ID：${t.id}）`,
    `状态：${TASK_STATUS_LABELS[t.status]}${t.proposed ? "（AI 提议，用户还没同意）" : ""}`,
    t.dueDate ? `截止：${t.dueDate}` : "截止：未定",
    t.proposedChange ? `AI 提议改截止日为：${t.proposedChange.dueDate ?? "不设截止日"}（等用户同意）` : "",
    t.note ? `说明：${t.note}` : "",
    links.professor ? `关联教授：${links.professor}（教授 ID：${t.professorId}）` : "",
    links.document ? `关联文书：${links.document}（文书 ID：${t.documentId}）` : "",
    links.school ? `关联研究科：${links.school}` : "",
    t.steps.length ? `子步骤：\n${t.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`).join("\n")}` : "子步骤：还没有",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * 「让 AI 开始」：任务对话里代用户发出的第一条消息。流程任务按类型给具体的开场；
 * 用户和 AI 加的任务用通用开场。只有用户能做的事（报名、发邮件），AI 的开场是查流程、列步骤，不是替用户做。
 */
export function kickoffPrompt(t: Pick<TaskView, "stepKey" | "title" | "note" | "professorId" | "documentId">, professorName?: string): string {
  const who = professorName ? `${professorName}教授` : "这位教授";
  const pid = t.professorId ? `（教授 ID：${t.professorId}）` : "";
  const step = t.stepKey?.startsWith("prof:") ? t.stepKey.split(":")[2] : t.stepKey;
  switch (step) {
    case "confirm_path":
      return "帮我确认申请路径：根据我的档案比较「先读研究生再考修士」「直考修士」「博士」哪条更适合我，说明理由。我确认后帮我更新 user.md。";
    case "pick_schools":
      return "帮我确定目标大学和研究科：先根据我的档案（研究方向、成绩、日语水平、偏好）问我两三个关键问题，再推荐 3–5 个合适的研究科并说明理由。我选定后，帮我找到它们官网的入试信息页面并关注。";
    case "write_plan":
      return "帮我把现有研究计划整理成计划书初稿：新建一份研究计划书，然后按带写步骤从第 1 步开始问我。";
    case "find_professors":
      return "帮我在已关注的研究科里找 3–5 位候选教授：先看我关注了哪些研究科，按我的研究方向检索，介绍每位教授和我方向的关联。我挑中的再收藏。";
    case "japanese":
      return "帮我制定日语学习计划：根据我现在的日语水平和目标入学时间，和我商量到 N2 / N1 的安排和考试日期。商量好后把子步骤和日程写进来，我在主页确认。";
    case "english":
      return "帮我准备英语成绩：根据我的目标研究科说明 TOEFL 和 TOEIC 该考哪个、要多少分，和我商量备考安排和考试日期。商量好后把子步骤和日程写进来，我在主页确认。";
    case "achievements":
      return "帮我整理已有研究成果（硕士论文、发表论文、学会报告）：先问我有哪些，再整理成申请博士时能用的清单，记进 user.md。";
    case "application":
      return "帮我准备出愿材料：查看我关注研究科的募集要项，列出需要的材料和截止日期，拆成这个任务的子步骤。报名要我自己操作的地方，告诉我具体流程。";
    case "plan":
      return `帮我结合${who}${pid}的研究方向写研究计划书草稿：先查教授近几年的论文，告诉我可以从哪些角度贴合；然后新建一份关联这位教授的研究计划书，按带写步骤从第 1 步开始问我。`;
    case "letter":
      if (t.documentId)
        return `帮我给${who}${pid}写套磁信：套磁信已经建好（文书 ID：${t.documentId}），按我的档案、计划书和教授的研究方向把日文初稿直接写进去（整篇替换）。缺少关键信息先用占位符，写完告诉我要补充什么。`;
      return `帮我给${who}${pid}写套磁信：新建一份关联这位教授的套磁信，按我的档案、计划书和教授的研究方向写日文初稿。`;
    case "followup":
      return `我给${who}${pid}发了套磁信，还没收到回复。帮我判断什么时候跟进合适，和我商量好跟进日期，再写一封简短礼貌的日文跟进邮件。`;
    case "reply":
      return `${who}${pid}回复我了。我先把教授的回信贴给你，请帮我理解内容，再写日文回复、约面谈时间。`;
    case "interview":
      return `帮我准备和${who}${pid}的面谈：整理教授近期研究、可能被问到的问题和我的回答要点，然后和我做一次模拟问答。`;
    default:
      return `我想开始做这件事：「${t.title}」${t.note ? `（${t.note}）` : ""}。先帮我拆成具体的子步骤；能直接用工具帮我做的就做，需要我决定或只能我自己操作的，告诉我怎么做。`;
  }
}

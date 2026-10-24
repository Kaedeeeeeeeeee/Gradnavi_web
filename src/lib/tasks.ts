// 任务（主页待办）：状态、子步骤、本周/之后分组、待办和日程列表、主页「今天」、「让 AI 开始」的开场消息（纯函数，前后端共用）。
// 不设「阶段」：长期视角靠待办和日程里展开的更远条目、日历和关键日期倒计时。

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

/**
 * 任务分类（主页「待办和日程」按这个分组）。挂在教授、研究科下的任务按教授 / 研究科分组，不用这个字段。
 * 用户和 AI 可以手动设；没设的按流程 key 和标题自动归类（taskGroup）。
 */
export const TASK_AREAS = ["language", "study", "prep", "other"] as const;
export type TaskArea = (typeof TASK_AREAS)[number];

export const TASK_AREA_LABELS: Record<TaskArea, string> = {
  language: "语言考试",
  study: "专业课和备考",
  prep: "申请准备",
  other: "其他",
};

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
  area: TaskArea | null;
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

/** 主页「待办和日程」默认显示几天内的（含今天） */
export const AGENDA_DAYS = 7;

export type AgendaRow<T extends TaskView> = { date: string | null } & ({ task: T; item?: undefined } | { item: CalendarItem; task?: undefined });

/**
 * 主页「待办和日程」：任务和日程合成一个按日期排的列表。
 * - near：有日期的，今天起 AGENDA_DAYS 天内（含已过期的任务），按日期排在最上面
 * - rest：没有截止日、或截止日在 AGENDA_DAYS 天以后的任务，在下面按教授 / 研究科 / 分类分组
 * - far：更远的日程（不限天数），默认折叠
 * 待你确认的任务放在上面的「等你处理」里，不在这里重复；日程里由任务截止日生成的条目（source = todo）不重复列；
 * 已完成的任务和 AI 提议的新任务也不在这里。
 */
export function agenda<T extends TaskView>(tasks: T[], items: CalendarItem[], today: string, days = AGENDA_DAYS) {
  const last = addDays(today, days - 1);
  const open = tasks.filter((t) => !t.proposed && t.status !== "done" && t.status !== "review");
  const rows: AgendaRow<T>[] = [
    ...open.filter((t) => t.dueDate).map((task) => ({ date: task.dueDate, task })),
    ...items.filter((it) => it.source !== "todo" && !it.done && (it.endDate ?? it.date) >= today).map((item) => ({ date: item.date, item })),
  ];
  // 同一天任务在前（按状态），日程在后
  rows.sort((a, b) => a.date!.localeCompare(b.date!) || (a.task ? 0 : 1) - (b.task ? 0 : 1) || (a.task && b.task ? compareTasks(a.task, b.task) : 0));
  return {
    near: rows.filter((r) => r.date! <= last),
    rest: open.filter((t) => !t.dueDate || t.dueDate > last).sort(compareTasks),
    far: rows.filter((r) => r.date! > last && !r.task),
  };
}

/**
 * 按教授分组时组里显示的短标题：组名已经是教授，标题里不再重复。
 * 「查清藤本 徹教授所在研究科怎么考」→「查清研究科怎么考」，「给藤本 徹教授写套磁信并发送」→「写套磁信并发送」，
 * 「结合…教授的研究方向写计划书草稿」→「结合研究方向写计划书草稿」，其余的「藤本 徹教授」换成「教授」。
 */
export function shortTitle(title: string, professorName: string) {
  const who = `${professorName.trim()}教授`;
  if (!professorName.trim() || !title.includes(who)) return title;
  const short = title
    .replace(`给${who}`, "")
    .replace(`${who}所在`, "")
    .replace(`结合${who}的`, "结合")
    .replaceAll(who, "教授")
    .trim();
  return short || title;
}

const STEP_AREAS: Record<string, TaskArea> = {
  japanese: "language",
  english: "language",
  confirm_path: "prep",
  pick_schools: "prep",
  find_professors: "prep",
  write_plan: "prep",
  achievements: "prep",
  application: "prep",
};

/** 按标题猜分类（用户自己加的、AI 没给分类的任务） */
const AREA_GUESS: [TaskArea, RegExp][] = [
  ["language", /JLPT|日语|日本语|N[1-3]\b|TOEFL|TOEIC|IELTS|托福|雅思|英语|托业/i],
  ["study", /复习|笔试|口试|专业课|课程|过去问|往年|真题|备考|刷题|数学|统计|线代|网课|学习/],
  ["prep", /计划书|套磁|出愿|推荐信|成绩单|申请材料|研究成果|选校|研究科|志愿|找教授/],
];

export type TaskGroupKey = { kind: "professor"; id: string } | { kind: "school"; id: string } | { kind: "area"; area: TaskArea };

/** 任务归到哪一组：教授 > 研究科 > 手动设的分类 > 流程 key > 按标题猜 > 其他 */
export function taskGroup(t: Pick<TaskView, "professorId" | "schoolId" | "area" | "stepKey" | "title">): TaskGroupKey {
  if (t.professorId) return { kind: "professor", id: t.professorId };
  if (t.schoolId) return { kind: "school", id: t.schoolId };
  const area = t.area ?? (t.stepKey ? STEP_AREAS[t.stepKey] : undefined) ?? AREA_GUESS.find(([, re]) => re.test(t.title))?.[0] ?? "other";
  return { kind: "area", area };
}

const groupId = (g: TaskGroupKey) => (g.kind === "area" ? `area:${g.area}` : `${g.kind}:${g.id}`);

/**
 * 主页「待办和日程」下半部分的分组：每位教授一组、每个研究科一组、再按分类各一组。
 * 组按里面最靠前的任务排（进行中、快到期的在前），「其他」总在最后。
 */
export function groupTasksByProject<T extends TaskView>(tasks: T[]) {
  const groups = new Map<string, { key: TaskGroupKey; tasks: T[] }>();
  for (const t of [...tasks].sort(compareTasks)) {
    const key = taskGroup(t);
    const id = groupId(key);
    groups.set(id, { key, tasks: [...(groups.get(id)?.tasks ?? []), t] });
  }
  const isOther = (g: { key: TaskGroupKey }) => g.key.kind === "area" && g.key.area === "other";
  return [...groups.values()].sort((a, b) => Number(isOther(a)) - Number(isOther(b)));
}

/** 等你处理：待你确认的任务（快到期的在前） */
export function awaitingReview<T extends TaskView>(tasks: T[]) {
  return tasks.filter((t) => !t.proposed && t.status === "review").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.sortOrder - b.sortOrder);
}

/** 需要用户处理的数量：待你确认的任务 + AI 的提议（主页竖条上的标记） */
export function countAwaiting(tasks: Pick<TaskView, "status" | "proposed" | "proposedChange">[], otherProposals: number) {
  return tasks.filter((t) => t.proposed || t.proposedChange || t.status === "review").length + otherProposals;
}

/** 关键日期倒计时：每个研究科最近的一个出愿 / 考试日（来自募集要项，含仮日程）。label 是日程名（含「开始 / 截止」），school 是研究科名 */
export type Countdown = { label: string; school?: string; date: string; days: number; tentative: boolean; sourceUrl?: string };

/** 每个研究科（每条志愿）最多一条，按天数排，最多 MAX_COUNTDOWN 条 */
export const MAX_COUNTDOWN = 4;

export function keyDates(items: CalendarItem[], today: string): Countdown[] {
  const bySchool = new Map<string, Countdown>();
  for (const it of items) {
    if (it.source !== "guide" || it.kind === "other" || (it.endDate ?? it.date) < today) continue;
    // 出愿期间这类跨天的：还没开始数到第一天（「开始」），开始了数到最后一天（「截止」）
    const range = it.kind === "deadline" && it.endDate && it.endDate !== it.date;
    const started = it.date <= today;
    const date = range && started ? it.endDate! : it.date;
    const name = it.label ?? it.title;
    const label = range ? `${name} ${started ? "截止" : "开始"}` : name;
    const school = it.key.split(":")[1] ?? it.key;
    const prev = bySchool.get(school);
    if (!prev || date < prev.date) bySchool.set(school, { label, school: it.school, date, days: daysBetween(today, date), tentative: !!it.tentative, sourceUrl: it.sourceUrl });
  }
  return [...bySchool.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_COUNTDOWN);
}

/**
 * 主页「今天」的规则部分（不调用 AI）：只数已过截止日的，再从自己手上的任务（待办 / 进行中）里挑一个「今天先做」（在待办里标出来）：先挑最近到期的，再挑没有日期的流程任务。
 */
export function briefing<T extends TaskView>(tasks: T[], today: string): { overdue: number; next: T | null } {
  const open = tasks.filter((t) => !t.proposed && (t.status === "todo" || t.status === "doing"));
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;
  const dated = open.filter((t) => t.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || compareTasks(a, b));
  const undated = open.filter((t) => !t.dueDate).sort(compareTasks);
  return { overdue, next: dated[0] ?? undated[0] ?? null };
}

/** 新的子步骤（标题去重、去空，每条最多 200 字，最多 20 条）；同名的保留原来的勾选状态 */
export function buildSteps(input: { title: string; done?: boolean }[], previous: TaskStep[] = [], newId: () => string = () => crypto.randomUUID()): TaskStep[] {
  const seen = new Set<string>();
  const out: TaskStep[] = [];
  for (const s of input) {
    const title = s.title.trim().slice(0, 200);
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
  // 监控发现新募集要项时系统加的任务（见 admission-monitor）
  if (!step && /^查看「.+」.*募集要项/.test(t.title))
    return `${t.title.replace(/^查看/, "")}。帮我对照新要项的日程和之前的仮日程，看看我的任务、日程和截止日要不要调整；需要调整的直接用工具提议（我在主页同意），再告诉我出愿材料有没有变化。`;
  switch (step) {
    case "confirm_path":
      return "帮我确认申请路径：根据我的档案比较「先读研究生再考修士」「直考修士」「博士」哪条更适合我，说明理由。我确认后帮我更新 user.md。";
    case "pick_schools":
      return "帮我确定目标大学和研究科：先根据我的档案（研究方向、成绩、日语水平、偏好）问我两三个关键问题，再推荐 3–5 个合适的研究科并说明理由。我选定后，帮我找到它们官网的入试信息页面并关注。";
    case "write_plan":
      return "帮我把现有研究计划整理成计划书初稿：新建一份研究计划书，然后按带写步骤从第 1 步开始问我。";
    case "find_professors":
      return "帮我找 3–5 位合适的教授：先根据我的档案问我一两个关键问题（研究兴趣、想去的地区或学校），再检索。找到后推荐给我，问我要不要加入志愿，再按我的反馈调整。";
    case "school":
      return `帮我查清${who}${pid}所在研究科怎么考：找到官网的入试信息 / 募集要项页面并关注（关联到这位教授），记下要不要先联系教授、考试科目、语言要求，再对照我的档案说说差距。`;
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
      return `${who}${pid}回复我了。我先把教授的回信贴给你，请帮我理解内容、更新联系状态，再写日文回复、约面谈时间（时间定了提议写进日历）。`;
    case "interview":
      return `帮我准备和${who}${pid}的面谈：整理教授近期研究、可能被问到的问题和我的回答要点，然后和我做一次模拟问答。`;
    default:
      return `我想开始做这件事：「${t.title}」${t.note ? `（${t.note}）` : ""}。先帮我拆成具体的子步骤；能直接用工具帮我做的就做，需要我决定或只能我自己操作的，告诉我怎么做。`;
  }
}

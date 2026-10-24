import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarItem } from "../calendar";
import { professorStepKey } from "../next-steps";
import { agenda, briefing, buildSteps, countAwaiting, groupTasks, groupTasksByProject, keyDates, kickoffPrompt, shortTitle, taskGroup, weekEnd, type TaskView } from "../tasks";

const TODAY = "2026-10-21"; // 周三

let n = 0;
const task = (patch: Partial<TaskView> = {}): TaskView => ({
  id: `t${++n}`,
  title: "任务",
  note: null,
  status: "todo",
  dueDate: null,
  steps: [],
  proposed: false,
  proposedChange: null,
  stepKey: null,
  professorId: null,
  documentId: null,
  schoolId: null,
  area: null,
  sortOrder: n,
  ...patch,
});

test("weekEnd 是本周日", () => {
  assert.equal(weekEnd("2026-10-21"), "2026-10-25");
  assert.equal(weekEnd("2026-10-25"), "2026-10-25");
  assert.equal(weekEnd("2026-10-26"), "2026-11-01");
});

test("本周 / 之后 / 已完成分组；AI 提议单独放", () => {
  const noDate = task({ title: "没有截止日" });
  const overdue = task({ title: "过期", dueDate: "2026-10-01" });
  const sunday = task({ title: "周日截止", dueDate: "2026-10-25" });
  const next = task({ title: "下周", dueDate: "2026-10-28" });
  const review = task({ title: "待确认", status: "review" });
  const done = task({ title: "完成", status: "done" });
  const proposed = task({ title: "AI 提议", proposed: true });
  const g = groupTasks([noDate, overdue, sunday, next, review, done, proposed], TODAY);
  assert.deepEqual(
    g.week.map((t) => t.title),
    ["待确认", "过期", "周日截止", "没有截止日"],
  );
  assert.deepEqual(g.later.map((t) => t.title), ["下周"]);
  assert.deepEqual(g.done.map((t) => t.title), ["完成"]);
  assert.deepEqual(g.proposals.map((t) => t.title), ["AI 提议"]);
});

test("待办和日程：有日期的 7 天内在前，没日期和更远的任务另列（分组），更远的日程折叠；待你确认和任务截止日生成的日程不重复", () => {
  const ev = (patch: Partial<CalendarItem>): CalendarItem => ({ key: `e${++n}`, source: "event", title: "日程", date: TODAY, kind: "other", ...patch });
  const noDate = task({ title: "没有截止日" });
  const overdue = task({ title: "过期", dueDate: "2026-10-01" });
  const doing = task({ title: "进行中", status: "doing", dueDate: "2026-10-27" });
  const far = task({ title: "下个月", dueDate: "2026-11-20" });
  const done = task({ title: "完成", status: "done", dueDate: "2026-10-22" });
  const proposed = task({ title: "AI 提议", proposed: true });
  const items = [
    ev({ title: "TOEFL", date: "2026-10-22", kind: "exam" }),
    ev({ title: "出愿截止", date: "2027-01-08", source: "guide", kind: "deadline" }),
    ev({ title: "过去的", date: "2026-10-10" }),
    ev({ title: "做完的跟进", date: "2026-10-23", done: true }),
    ev({ title: "进行中", date: "2026-10-27", source: "todo" }),
  ];
  const review = task({ title: "待确认", status: "review", dueDate: "2026-10-22" });
  const a = agenda([noDate, overdue, doing, far, done, proposed, review], items, TODAY);
  const titles = (rows: typeof a.near) => rows.map((r) => r.task?.title ?? r.item!.title);
  assert.deepEqual(titles(a.near), ["过期", "TOEFL", "进行中"]);
  assert.deepEqual(a.rest.map((t) => t.title), ["下个月", "没有截止日"]);
  assert.deepEqual(titles(a.far), ["出愿截止"]);
});

test("待处理数量 = 待你确认 + AI 提议（任务、改期、日程）", () => {
  const tasks = [task({ status: "review" }), task({ proposed: true }), task({ proposedChange: { dueDate: "2026-11-01" } }), task()];
  assert.equal(countAwaiting(tasks, 2), 5);
});

test("今日简报：只数已过期的，今天先做从自己手上的任务里挑", () => {
  // 待你确认的、AI 提议的不在简报里（下面「等你处理」已经有了），只从自己手上的任务里挑
  const review = task({ title: "套磁信", status: "review", dueDate: "2026-10-22" });
  const proposed = task({ proposed: true, dueDate: "2026-10-21" });
  const late = task({ title: "联系教授", dueDate: "2026-10-20" });
  assert.deepEqual(briefing([review, proposed, late, task({ title: "报名 TOEFL", dueDate: "2026-10-30" })], TODAY), { overdue: 1, next: late });
  // 先挑有日期的，再挑没日期的流程任务
  const toefl = task({ title: "报名 TOEFL", dueDate: "2026-10-30" });
  assert.equal(briefing([task({ title: "确认申请路径" }), toefl], TODAY).next, toefl);
  const doing = task({ title: "写计划书", status: "doing" });
  assert.equal(briefing([doing], TODAY).next, doing);
  assert.deepEqual(briefing([review], TODAY), { overdue: 0, next: null });
});

test("关键日期倒计时：每个研究科一条，出愿期间没开始数到开始、开始了数到截止，按天数排", () => {
  const guide = (school: string, patch: Partial<CalendarItem>): CalendarItem => ({ key: `guide:${school}:${++n}`, source: "guide", title: "", date: "", kind: "other", ...patch });
  const items = [
    guide("todai", { title: "東大 出願期間", date: "2026-10-15", endDate: "2026-11-05", kind: "deadline", tentative: true, sourceUrl: "https://example.ac.jp" }),
    guide("todai", { title: "東大 筆記試験", date: "2027-02-01", kind: "exam" }),
    guide("hit", { title: "一橋 経済学研究科 出願期間", school: "一橋 経済学研究科", label: "出願期間", date: "2026-12-01", endDate: "2026-12-08", kind: "deadline" }),
    guide("hit", { title: "一橋 説明会", date: "2026-10-25", kind: "other" }),
    guide("old", { title: "去年的截止", date: "2026-10-01", kind: "deadline" }),
    { key: "todo:x", source: "todo", title: "自己的任务", date: "2026-10-30", kind: "deadline" } satisfies CalendarItem,
  ];
  assert.deepEqual(keyDates(items, TODAY), [
    { label: "東大 出願期間 截止", school: undefined, date: "2026-11-05", days: 15, tentative: true, sourceUrl: "https://example.ac.jp" },
    { label: "出願期間 开始", school: "一橋 経済学研究科", date: "2026-12-01", days: 41, tentative: false, sourceUrl: undefined },
  ]);
});

test("子步骤：去空去重，同名保留勾选", () => {
  let i = 0;
  const id = () => `s${++i}`;
  const prev = buildSteps([{ title: "查要项" }, { title: "写邮件", done: true }], [], id);
  const next = buildSteps([{ title: "写邮件" }, { title: " " }, { title: "查要项" }, { title: "查要项" }, { title: "发邮件" }], prev, id);
  assert.deepEqual(next, [
    { id: "s2", title: "写邮件", done: true },
    { id: "s1", title: "查要项", done: false },
    { id: "s3", title: "发邮件", done: false },
  ]);
});

test("「让 AI 开始」按任务类型给开场消息", () => {
  const t = { stepKey: "pick_schools", title: "确定目标大学和研究科", note: null, professorId: null, documentId: null };
  assert.ok(kickoffPrompt(t).includes("研究科"));
  const letter = { ...t, stepKey: professorStepKey("p1", "letter"), professorId: "p1" };
  assert.ok(kickoffPrompt({ ...letter, documentId: "d1" }, "山田太郎").includes("文书 ID：d1"));
  const k = kickoffPrompt(letter, "山田太郎");
  assert.ok(k.includes("山田太郎教授") && k.includes("p1"));
  // 用户自己加的任务：先拆子步骤，只能用户做的告诉怎么做
  const custom = kickoffPrompt({ ...t, stepKey: null, title: "缴纳报名费" });
  assert.ok(custom.includes("「缴纳报名费」") && custom.includes("子步骤"));
});

test("按教授分组时的短标题：去掉重复的教授名", () => {
  assert.equal(shortTitle("查清藤本 徹教授所在研究科怎么考", "藤本 徹"), "查清研究科怎么考");
  assert.equal(shortTitle("结合藤本 徹教授的研究方向写计划书草稿", "藤本 徹"), "结合研究方向写计划书草稿");
  assert.equal(shortTitle("给藤本 徹教授写套磁信并发送", "藤本 徹"), "写套磁信并发送");
  assert.equal(shortTitle("等藤本 徹教授回复，到期没回就礼貌跟进", "藤本 徹"), "等教授回复，到期没回就礼貌跟进");
  assert.equal(shortTitle("准备和藤本 徹教授的面谈", "藤本 徹"), "准备和教授的面谈");
  assert.equal(shortTitle("读论文", "藤本 徹"), "读论文");
  assert.equal(shortTitle("查清藤本 徹教授所在研究科怎么考", ""), "查清藤本 徹教授所在研究科怎么考");
});

test("任务归类：教授 > 研究科 > 手动分类 > 流程 key > 按标题猜 > 其他", () => {
  assert.deepEqual(taskGroup(task({ professorId: "p1", schoolId: "s1", area: "study" })), { kind: "professor", id: "p1" });
  assert.deepEqual(taskGroup(task({ schoolId: "s1" })), { kind: "school", id: "s1" });
  assert.deepEqual(taskGroup(task({ title: "报名 TOEFL", area: "study" })), { kind: "area", area: "study" });
  assert.deepEqual(taskGroup(task({ stepKey: "japanese", title: "日语学习计划" })), { kind: "area", area: "language" });
  assert.deepEqual(taskGroup(task({ stepKey: "pick_schools", title: "确定目标大学和研究科" })), { kind: "area", area: "prep" });
  assert.deepEqual(taskGroup(task({ title: "报名 12 月 JLPT N1" })), { kind: "area", area: "language" });
  assert.deepEqual(taskGroup(task({ title: "toefl 刷到 80 分" })), { kind: "area", area: "language" });
  assert.deepEqual(taskGroup(task({ title: "复习统计学" })), { kind: "area", area: "study" });
  assert.deepEqual(taskGroup(task({ title: "办签证" })), { kind: "area", area: "other" });
});

test("按项目分组：进行中的组排前面，其他总在最后", () => {
  const o = task({ title: "办签证", status: "doing" });
  const a1 = task({ title: "a1", professorId: "pa" });
  const b1 = task({ title: "b1", professorId: "pb", status: "doing" });
  const a2 = task({ title: "a2", professorId: "pa" });
  const l = task({ title: "报名 JLPT" });
  const groups = groupTasksByProject([a1, o, b1, a2, l]);
  assert.deepEqual(
    groups.map((g) => g.tasks.map((t) => t.title)),
    [["b1"], ["a1", "a2"], ["报名 JLPT"], ["办签证"]],
  );
});

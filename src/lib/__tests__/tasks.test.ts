import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarItem } from "../calendar";
import { professorStepKey } from "../next-steps";
import { briefing, buildSteps, countAwaiting, groupTasks, keyDates, kickoffPrompt, weekEnd, type TaskView } from "../tasks";

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

test("待处理数量 = 待你确认 + AI 提议（任务、改期、日程）", () => {
  const tasks = [task({ status: "review" }), task({ proposed: true }), task({ proposedChange: { dueDate: "2026-11-01" } }), task()];
  assert.equal(countAwaiting(tasks, 2), 5);
});

test("今日简报：先说要处理的，再建议今天先做哪件", () => {
  const lines = briefing([task({ status: "review" }), task({ proposed: true }), task({ title: "联系教授", dueDate: "2026-10-21" })], 1, TODAY);
  assert.deepEqual(lines, ["1 件事待你确认，AI 提了 2 项安排等你同意。", "今天建议先做：「联系教授」（今天截止）。"]);
  assert.deepEqual(briefing([task({ title: "写计划书", status: "doing" })], 0, TODAY), ["接着做：「写计划书」。"]);
  assert.match(briefing([], 0, TODAY)[0], /都做完了/);
});

test("关键日期倒计时：最近的出愿截止（数到最后一天）和考试", () => {
  const guide = (patch: Partial<CalendarItem>): CalendarItem => ({ key: Math.random().toString(), source: "guide", title: "", date: "", kind: "other", ...patch });
  const items = [
    guide({ title: "東大 出願期間", date: "2026-12-20", endDate: "2027-01-05", kind: "deadline", tentative: true, sourceUrl: "https://example.ac.jp" }),
    guide({ title: "東大 筆記試験", date: "2027-02-01", kind: "exam" }),
    guide({ title: "去年的截止", date: "2026-10-01", kind: "deadline" }),
    { key: "todo:x", source: "todo", title: "自己的任务", date: "2026-10-30", kind: "deadline" } satisfies CalendarItem,
  ];
  assert.deepEqual(keyDates(items, TODAY), [
    { label: "東大 出願期間", date: "2027-01-05", days: 76, tentative: true, sourceUrl: "https://example.ac.jp" },
    { label: "東大 筆記試験", date: "2027-02-01", days: 103, tentative: false, sourceUrl: undefined },
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

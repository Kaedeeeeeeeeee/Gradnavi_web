import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarItem } from "../calendar";
import { professorStepKey } from "../next-steps";
import { calendarText, guardPick, intakeYear, parsePick, pickInputKey, pickKickoffNote, prepEstimates, rulePick, taskFacts } from "../next-pick";
import type { TaskView } from "../tasks";

const TODAY = "2026-10-24";

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
  prepDays: null,
  sortOrder: n,
  ...patch,
});

const prof = { id: "p1", name: "藤本 徹", status: "未联系", followUpDate: null };

test("事实：最晚开始日 = 截止日 − 准备天数；联系信被计划书卡住；没估过的用默认值", () => {
  const plan = task({ title: "写计划书草稿", stepKey: professorStepKey("p1", "plan"), professorId: "p1", dueDate: "2026-11-06" });
  const letter = task({ title: "写联系信", stepKey: professorStepKey("p1", "letter"), professorId: "p1" });
  const signup = task({ title: "报名说明会", dueDate: "2026-11-06", prepDays: 1 });
  const [fp, fl, fs] = taskFacts([plan, letter, signup, task({ proposed: true }), task({ status: "review" })], [prof]);
  assert.equal(fp.latestStart, "2026-10-27");
  assert.equal(fp.guessed, true);
  assert.equal(fl.blockedBy, "写计划书草稿");
  assert.equal(fs.latestStart, "2026-11-05");
  assert.equal(fs.guessed, false);
});

test("规则排序：最晚开始日已到的先做，被卡住的不选", () => {
  const plan = task({ title: "写计划书草稿", stepKey: professorStepKey("p1", "plan"), professorId: "p1", dueDate: "2026-11-02" }); // 最晚 10/23，已到
  const signup = task({ title: "报名说明会", dueDate: "2026-10-30", prepDays: 1 });
  const letter = task({ title: "写联系信", stepKey: professorStepKey("p1", "letter"), professorId: "p1" });
  const tasks = [signup, letter, plan];
  const pick = rulePick(taskFacts(tasks, [prof]), tasks, TODAY)!;
  assert.equal(pick.taskId, plan.id);
  assert.match(pick.reasons[0], /今天就该开始/);
  assert.ok(!pick.alternatives.some((a) => a.taskId === letter.id));
});

test("检查 AI 的选择：不在候选里退回规则；必须先做的不能跳过；编的日期去掉", () => {
  const urgent = task({ title: "交成绩证明", dueDate: "2026-10-25", prepDays: 3 });
  const other = task({ title: "查研究科怎么考" });
  const tasks = [urgent, other];
  const facts = taskFacts(tasks, []);
  // AI 选了不存在的任务 → 规则结果
  assert.equal(guardPick({ pick: "nope" }, facts, tasks, TODAY, "")!.source, "rule");
  // AI 没选必须先做的 → 换成它，理由用规则的
  const forced = guardPick({ pick: other.id, reasons: ["5 分钟就能查完"] }, facts, tasks, TODAY, "")!;
  assert.equal(forced.taskId, urgent.id);
  assert.match(forced.reasons[0], /截止 10\/25/);
  // 没有必须先做的时，AI 的选择生效；理由里事实没有的日期（11/1）去掉
  const calm = [task({ title: "写计划书", dueDate: "2026-12-01" }), task({ title: "查研究科怎么考" })];
  const ok = guardPick(
    { pick: calm[1].id, reasons: ["报名 11/1 截止", "能决定要不要继续跟这位教授"], alternatives: [{ id: calm[0].id, reason: "12/1 截止" }], quick: calm[1].id },
    taskFacts(calm, []),
    calm,
    TODAY,
    "",
  )!;
  assert.equal(ok.source, "ai");
  assert.equal(ok.taskId, calm[1].id);
  assert.deepEqual(ok.reasons, ["能决定要不要继续跟这位教授"]);
  assert.deepEqual(ok.alternatives, [{ taskId: calm[0].id, reason: "12/1 截止" }]);
  assert.equal(ok.quickId, calm[1].id);
});

test("解析 AI 回答、准备天数只收没估过的", () => {
  const raw = parsePick('好的：\n{"pick":"a","reasons":["x"],"prep":{"t1":10,"t2":999,"t3":5}}');
  assert.equal(raw?.pick, "a");
  assert.equal(parsePick("没有 JSON"), null);
  const facts = taskFacts([task({ id: "t1" }), task({ id: "t2" }), task({ id: "t3", prepDays: 2 })], []);
  assert.deepEqual(prepEstimates(raw, facts), { t1: 10 });
});

test("年度：4 月起算；别人那届的要项日程不给 AI 看", () => {
  assert.equal(intakeYear("2028年4月"), 2028);
  assert.equal(intakeYear("2027年10月"), 2027);
  assert.equal(intakeYear("2028年1月"), 2027);
  assert.equal(intakeYear("未定"), null);
  const item = (year: number, label: string): CalendarItem => ({ key: `guide:s:${year}`, source: "guide", title: label, date: "2026-11-16", kind: "deadline", admissionYear: year });
  const text = calendarText([item(2027, "入学手続"), item(2028, "出愿")], TODAY, 2028);
  assert.match(text, /出愿/);
  assert.doesNotMatch(text, /入学手続/);
});

test("任务对话开场带上理由", () => {
  const pick = { taskId: "a", reasons: ["最晚 10/27 开始"], alternatives: [{ taskId: "b", reason: "5 分钟" }], quickId: null, source: "ai" as const };
  assert.match(pickKickoffNote(pick, "a")!, /最晚 10\/27 开始/);
  assert.match(pickKickoffNote(pick, "b")!, /5 分钟/);
  assert.equal(pickKickoffNote(pick, "c"), null);
});

test("开始做、勾子步骤不触发重新判断；做完才算", () => {
  const a = task({ title: "写计划书" });
  const b = task({ title: "查研究科" });
  const key = (tasks: TaskView[]) => pickInputKey({ today: TODAY, userMd: "", facts: taskFacts(tasks, []), calendar: "" });
  const base = key([a, b]);
  assert.equal(key([{ ...a, status: "doing", steps: [{ id: "s", title: "x", done: true }] }, b]), base);
  assert.notEqual(key([{ ...a, status: "done" }, b]), base);
});

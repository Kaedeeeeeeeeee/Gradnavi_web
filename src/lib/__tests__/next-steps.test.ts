import assert from "node:assert/strict";
import { test } from "node:test";
import { planNextSteps, professorStepKey, type StepState } from "../next-steps";
import type { OnboardingAnswers } from "../onboarding";

const answers: OnboardingAnswers = {
  status: "国内本科在读",
  major: "日语",
  field: "humanities",
  path: "master",
  planStatus: "none",
  targetEntry: "2027年4月",
};

const state = (patch: Partial<StepState> = {}): StepState => ({
  answers,
  scores: { jlpt: 1 },
  schoolCount: 0,
  professors: [],
  documents: [],
  doneKeys: new Set(),
  ...patch,
});
const openKeys = (s: StepState) => planNextSteps(s).open.map((t) => t.key);

test("教授优先：一开始就是和 AI 一起找教授", () => {
  assert.deepEqual(openKeys(state()), ["find_professors"]);
  assert.deepEqual(openKeys(state({ answers: { ...answers, path: "unsure" } })), ["confirm_path", "find_professors"]);
  // 已有明确计划的先写计划书
  assert.deepEqual(openKeys(state({ answers: { ...answers, planStatus: "clear" } })), ["write_plan"]);
});

test("有了志愿（教授或研究科）才出现语言准备", () => {
  const a = { ...answers, field: "sciences" as const };
  assert.deepEqual(openKeys(state({ answers: a, scores: {} })), ["find_professors"]);
  assert.deepEqual(openKeys(state({ answers: a, scores: {}, schoolCount: 1 })), ["find_professors", "japanese", "english"]);
  // 成绩在聊天里记进 user.md 之后，对应的准备任务就不再出现
  assert.deepEqual(openKeys(state({ answers: a, scores: { jlpt: 2, toefl: 72 }, schoolCount: 1 })), ["find_professors"]);
});

test("计划书优先：计划书初稿有了才找教授", () => {
  const a = { ...answers, planStatus: "clear" as const };
  assert.ok(!openKeys(state({ answers: a, schoolCount: 1 })).includes("find_professors"));
  const s = state({ answers: a, schoolCount: 1, documents: [{ id: "d1", kind: "plan" }] });
  assert.ok(planNextSteps(s).done.includes("write_plan"));
  assert.ok(openKeys(s).includes("find_professors"));
});

test("收藏教授后按状态推进：计划书 → 套磁信 → 跟进 → 回复 → 面谈", () => {
  const prof = { id: "p1", name: "山田太郎", status: "to_contact" as const };
  const key = (k: string) => professorStepKey("p1", k);

  let s = state({ professors: [prof] });
  assert.deepEqual(openKeys(s), ["find_professors", key("school"), key("plan")]);
  assert.equal(planNextSteps(s).open[1].title, "查清山田太郎教授所在研究科怎么考");
  assert.equal(planNextSteps(s).open[2].title, "结合山田太郎教授的研究方向写计划书草稿");
  // 关联了研究科：这一步达成
  assert.ok(planNextSteps(state({ professors: [{ ...prof, schoolId: "s1" }] })).done.includes(key("school")));

  s = state({ schoolCount: 1, professors: [prof], documents: [{ id: "d1", kind: "plan", professorId: "p1" }, { id: "l1", kind: "letter", professorId: "p1" }] });
  let plan = planNextSteps(s);
  assert.ok(plan.done.includes(key("plan")));
  const letter = plan.open.find((t) => t.key === key("letter"));
  assert.equal(letter?.documentId, "l1");
  assert.equal(letter?.professorId, "p1");

  plan = planNextSteps(state({ professors: [{ ...prof, status: "contacted", followUpDate: "2026-11-05" }] }));
  assert.ok(plan.done.includes(key("plan")) && plan.done.includes(key("letter")));
  assert.equal(plan.open.find((t) => t.key === key("followup"))?.note, "跟进日：2026-11-05");

  plan = planNextSteps(state({ professors: [{ ...prof, status: "replied", schoolId: "s1" }] }));
  assert.ok(plan.done.includes(key("followup")));
  assert.deepEqual(plan.open.map((t) => t.key), ["find_professors", key("reply"), "application"]);

  assert.ok(openKeys(state({ professors: [{ ...prof, status: "interview" }] })).includes(key("interview")));
  // 同意接收：面谈这一步也算做完，进入出愿准备
  plan = planNextSteps(state({ professors: [{ ...prof, status: "accepted", schoolId: "s1" }] }));
  assert.ok(plan.done.includes(key("interview")));
  assert.ok(plan.open.some((t) => t.key === "application"));
});

test("放弃的教授不产生任务；收藏够 3 位勾掉找教授", () => {
  const profs = ["a", "b", "c"].map((id) => ({ id, name: id, status: "to_contact" as const }));
  const plan = planNextSteps(state({ schoolCount: 1, professors: profs }));
  assert.ok(plan.done.includes("find_professors"));
  const dropped = planNextSteps(state({ schoolCount: 1, professors: [{ id: "x", name: "x", status: "dropped" }] }));
  assert.ok(![...dropped.open.map((t) => t.key), ...dropped.done].some((k) => k.startsWith("prof:x")));
});

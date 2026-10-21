import assert from "node:assert/strict";
import { test } from "node:test";
import { planNextSteps, professorStepKey, type StepState } from "../next-steps";
import type { OnboardingAnswers } from "../onboarding";

const answers: OnboardingAnswers = {
  status: "国内本科在读",
  education: "本科",
  major: "日语",
  gpa: "",
  field: "humanities",
  path: "master",
  planStatus: "none",
  direction: "",
  targetSchools: "",
  japanese: "N1 140",
  english: "",
  targetEntry: "2027年4月",
  notes: "",
};

const state = (patch: Partial<StepState> = {}): StepState => ({
  answers,
  schoolCount: 0,
  professors: [],
  documents: [],
  doneKeys: new Set(),
  ...patch,
});
const openKeys = (s: StepState) => planNextSteps(s).open.map((t) => t.key);

test("一开始只有「确定目标大学和研究科」", () => {
  assert.deepEqual(openKeys(state()), ["pick_schools"]);
  assert.deepEqual(openKeys(state({ answers: { ...answers, path: "unsure" } })), ["confirm_path", "pick_schools"]);
  assert.deepEqual(openKeys(state({ answers: { ...answers, planStatus: "clear" } })), ["pick_schools", "write_plan"]);
});

test("关注研究科后：勾掉选校，出现找教授和语言准备", () => {
  const s = state({ schoolCount: 1, answers: { ...answers, field: "sciences", japanese: "N2 备考中" } });
  const plan = planNextSteps(s);
  assert.ok(plan.done.includes("pick_schools"));
  assert.deepEqual(plan.open.map((t) => t.key), ["find_professors", "japanese", "english"]);
  // 用户手动勾掉选校也往下走
  assert.ok(openKeys(state({ doneKeys: new Set(["pick_schools"]) })).includes("find_professors"));
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

  let s = state({ schoolCount: 1, professors: [prof] });
  assert.deepEqual(openKeys(s), ["find_professors", key("plan")]);
  assert.equal(planNextSteps(s).open[1].title, "结合山田太郎教授的研究方向写计划书草稿");

  s = state({ schoolCount: 1, professors: [prof], documents: [{ id: "d1", kind: "plan", professorId: "p1" }, { id: "l1", kind: "letter", professorId: "p1" }] });
  let plan = planNextSteps(s);
  assert.ok(plan.done.includes(key("plan")));
  const letter = plan.open.find((t) => t.key === key("letter"));
  assert.equal(letter?.documentId, "l1");
  assert.equal(letter?.professorId, "p1");

  plan = planNextSteps(state({ professors: [{ ...prof, status: "contacted", followUpDate: "2026-11-05" }] }));
  assert.ok(plan.done.includes(key("plan")) && plan.done.includes(key("letter")));
  assert.equal(plan.open.find((t) => t.key === key("followup"))?.note, "跟进日：2026-11-05");

  plan = planNextSteps(state({ professors: [{ ...prof, status: "replied" }] }));
  assert.ok(plan.done.includes(key("followup")));
  assert.deepEqual(plan.open.map((t) => t.key), ["pick_schools", key("reply"), "application"]);

  assert.ok(openKeys(state({ professors: [{ ...prof, status: "interview" }] })).includes(key("interview")));
});

test("放弃的教授不产生任务；收藏够 3 位勾掉找教授", () => {
  const profs = ["a", "b", "c"].map((id) => ({ id, name: id, status: "to_contact" as const }));
  const plan = planNextSteps(state({ schoolCount: 1, professors: profs }));
  assert.ok(plan.done.includes("find_professors"));
  const dropped = planNextSteps(state({ schoolCount: 1, professors: [{ id: "x", name: "x", status: "dropped" }] }));
  assert.ok(![...dropped.open.map((t) => t.key), ...dropped.done].some((k) => k.startsWith("prof:x")));
});

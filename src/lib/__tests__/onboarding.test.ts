import assert from "node:assert/strict";
import { test } from "node:test";
import { listSections } from "../md-sections";
import { buildRoadmap, buildUserMd, decideTrack, entryOptions, suggestPath, type OnboardingAnswers } from "../onboarding";

const base: OnboardingAnswers = {
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

test("有明确计划走计划书优先，否则教授优先", () => {
  assert.equal(decideTrack({ planStatus: "clear" }), "plan_first");
  assert.equal(decideTrack({ planStatus: "rough" }), "professor_first");
});

test("文科日语不足建议先读研究生", () => {
  assert.equal(suggestPath({ ...base, path: "unsure", japanese: "N2 备考中" }), "kenkyusei");
  assert.equal(suggestPath({ ...base, path: "unsure" }), "master");
  assert.equal(suggestPath({ ...base, status: "国内硕士在读或已毕业" }), "doctor");
});

test("路线图按轨道和路径生成", () => {
  const a = buildRoadmap(base).map((i) => i.title);
  assert.ok(a.some((t) => t.includes("候选教授")));
  assert.ok(a.some((t) => t.includes("募集要项")));
  assert.ok(!a.some((t) => t.includes("日语学习")));

  const b = buildRoadmap({ ...base, planStatus: "clear", field: "sciences", path: "unsure", japanese: "零基础" }).map((i) => i.title);
  assert.ok(b[0].startsWith("确认申请路径"));
  assert.ok(b.some((t) => t.includes("打磨计划书")));
  assert.ok(b.some((t) => t.includes("TOEFL")));
  assert.ok(b.some((t) => t.includes("日语学习")));
});

test("user.md 分节完整", () => {
  assert.deepEqual(listSections(buildUserMd(base)), ["背景", "语言成绩", "目标", "研究方向", "当前路线", "偏好与备注"]);
});

test("入学季只列未来的", () => {
  const opts = entryOptions(new Date(2026, 9, 21)).map((o) => o.value);
  assert.equal(opts[0], "2027年4月");
  assert.equal(opts.at(-1), "未定");
});

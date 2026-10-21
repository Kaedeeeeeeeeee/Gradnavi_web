import assert from "node:assert/strict";
import { test } from "node:test";
import { listSections } from "../md-sections";
import { answerField, buildRoadmap, buildUserMd, decideTrack, entryOptions, guessField, suggestPath, type OnboardingAnswers } from "../onboarding";

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

test("入学季按当前日期生成接下来 4 个，临近的标出时间较紧", () => {
  const opts = entryOptions(new Date(2026, 9, 21));
  assert.deepEqual(opts.map((o) => o.value), ["2027年4月", "2027年10月", "2028年4月", "2028年10月", "未定"]);
  assert.ok(opts[0].hint?.includes("时间较紧"));
  assert.equal(opts[1].hint, undefined);
  assert.equal(entryOptions(new Date(2027, 4, 1))[0].value, "2027年10月");
});

test("自填领域：能判断文理的按判断走，判断不了不强行归类", () => {
  assert.equal(guessField("半导体材料"), "sciences");
  assert.equal(guessField("认知语言学"), "humanities");
  assert.equal(guessField("数字人文"), undefined);
  assert.equal(answerField({ field: "sciences" }), "sciences");
  assert.equal(answerField({ field: "other", fieldDetail: "强化学习" }), "sciences");
  assert.equal(answerField(null), undefined);

  const a = { ...base, field: "other", fieldDetail: "强化学习", english: "" } as const;
  assert.ok(buildUserMd(a).includes("- 学科：强化学习（偏理科）"));
  assert.ok(buildRoadmap(a).some((i) => i.title.includes("TOEFL")));
  assert.ok(buildUserMd({ ...a, fieldDetail: "数字人文" }).includes("- 学科：数字人文\n"));
});

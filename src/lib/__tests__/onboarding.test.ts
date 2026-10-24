import assert from "node:assert/strict";
import { test } from "node:test";
import { profileScores } from "../aspirations";
import { listSections, undoSectionChange, upsertSection, getSection } from "../md-sections";
import { buildSystemPrompt } from "../ai/prompt";
import { answerField, applicationFacts, buildUserMd, decideTrack, entryOptions, guessField, onboardingQuestions, openingMessage, suggestPath, type OnboardingAnswers } from "../onboarding";

const base: OnboardingAnswers = {
  status: "国内本科在读",
  major: "计算机 / 信息",
  field: "sciences",
  path: "unsure",
  planStatus: "none",
  targetEntry: "2027年10月",
};

test("问卷只有 5 道点选题", () => {
  assert.deepEqual(onboardingQuestions().map((q) => q.key), ["status", "major", "field", "planStatus", "targetEntry"]);
});

test("有明确计划走计划书优先，否则教授优先", () => {
  assert.equal(decideTrack({ planStatus: "clear" }), "plan_first");
  assert.equal(decideTrack({ planStatus: "rough" }), "professor_first");
});

test("文科日语不足（或还不知道）建议先读研究生", () => {
  const hum = { ...base, field: "humanities" } as const;
  assert.equal(suggestPath(hum), "kenkyusei");
  assert.equal(suggestPath(hum, 1), "master");
  assert.equal(suggestPath({ ...base, status: "国内硕士在读或已毕业" }), "doctor");
});

test("user.md 分节完整，问卷没问的先占位", () => {
  const md = buildUserMd(base);
  assert.deepEqual(listSections(md), ["背景", "语言成绩", "目标", "研究方向", "当前路线", "偏好与备注"]);
  assert.ok(md.includes("- 日语：（还没聊到）"));
  assert.ok(md.includes("- 专业：计算机 / 信息"));
});

test("旧问卷的答案照样能生成 user.md、读出成绩", () => {
  const old = { ...base, path: "master", education: "本科，某大学", japanese: "N1 140", english: "TOEFL 85", notes: "想去关西" } as const;
  const md = buildUserMd(old);
  assert.ok(md.includes("- 路径：直考修士"));
  assert.ok(md.includes("想去关西"));
  assert.deepEqual(profileScores("", old), { jlpt: 1, toefl: 85 });
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

  const a = { ...base, field: "other", fieldDetail: "强化学习" } as const;
  assert.ok(buildUserMd(a).includes("- 学科：强化学习（偏理科）"));
  assert.ok(buildUserMd({ ...a, fieldDetail: "数字人文" }).includes("- 学科：数字人文\n"));
});

test("开场消息按答案拼出，附快捷回复", () => {
  const now = new Date(2026, 9, 21);
  const m = openingMessage(base, now);
  assert.ok(m.text.startsWith("你现在国内本科在读，专业是计算机 / 信息，想读理科，研究方向还没定，想 2027 年 10 月入学。我建议先从找教授开始"));
  assert.equal(m.quickReplies.length, 3);
  assert.ok(openingMessage({ ...base, planStatus: "clear" }, now).text.includes("先把它打磨成计划书"));
  assert.ok(openingMessage({ ...base, targetEntry: "2027年4月" }, now).text.includes("离入学时间不多了"));
  assert.ok(openingMessage({ ...base, targetEntry: "未定", status: "其他" }, now).text.startsWith("专业是计算机 / 信息，想读理科，研究方向还没定，入学时间还没定。"));
});

test("撤销记住的信息：没再改过就恢复原样，改过就只删这次写入的内容", () => {
  const md = buildUserMd(base);
  // 新建的节撤销后整节删掉
  const added = upsertSection(md, "找教授偏好", "- 只要关东", "append");
  const c1 = { section: "找教授偏好", before: null, after: getSection(added, "找教授偏好"), content: "- 只要关东" };
  assert.equal(undoSectionChange(added, c1), md);

  // 之后同一节又追加了别的，只删掉这一条
  const before = getSection(md, "偏好与备注");
  const once = upsertSection(md, "偏好与备注", "- 预算有限", "append");
  const c2 = { section: "偏好与备注", before, after: getSection(once, "偏好与备注"), content: "- 预算有限" };
  const twice = upsertSection(once, "偏好与备注", "- 想去关西", "append");
  const undone = undoSectionChange(twice, c2)!;
  assert.ok(!undone.includes("预算有限") && undone.includes("想去关西"));
  // 已经撤销过了
  assert.equal(undoSectionChange(undone, c2), null);
});

test("申请概况：没选路径时给建议并标待确认，系统提示里能看到", () => {
  const answers = { status: "大四在读", major: "教育学", field: "humanities" as const, planStatus: "rough" as const, targetEntry: "2027年4月" };
  assert.deepEqual(applicationFacts({ ...answers, path: "kenkyusei" }), {
    path: "先读研究生，再考修士",
    targetEntry: "2027年4月",
    track: "先找教授，再写贴合教授方向的计划书",
  });
  assert.equal(applicationFacts({ ...answers, path: "unsure" }).path, "先读研究生，再考修士（建议，待确认）");
  const prompt = buildSystemPrompt({ userMd: "# 我的档案", today: "2026年10月24日", facts: applicationFacts({ ...answers, path: "kenkyusei" }) });
  assert.match(prompt, /## 申请概况[^]*路径：先读研究生，再考修士/);
  assert.doesNotMatch(buildSystemPrompt({ userMd: "", today: "x" }), /## 申请概况/);
});

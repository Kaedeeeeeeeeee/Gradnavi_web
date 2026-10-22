import assert from "node:assert/strict";
import { test } from "node:test";
import { raisedBudget, shouldWrapUp, staleStepCount, STEP_BUDGET, taskStepOf, turnKind } from "../ai/turn-budget";

test("按这轮在做什么定类型", () => {
  const t = (c: Partial<Parameters<typeof turnKind>[0]>) => turnKind({ userText: "", ...c });
  assert.equal(t({ taskStep: taskStepOf("prof:p1:school") }), "school");
  assert.equal(t({ taskStep: "application" }), "school");
  assert.equal(t({ taskTitle: "查看「東京大学 教育学研究科」的新募集要项" }), "guide");
  assert.equal(t({ userText: "帮我看看这份募集要项要交什么材料" }), "guide");
  assert.equal(t({ userText: "东大和早稻田哪个更适合我？" }), "compare");
  assert.equal(t({ userText: "帮我对比一下这三个研究科" }), "compare");
  assert.equal(t({ workPath: "/aspirations/compare" }), "compare");
  assert.equal(t({ taskStep: "find_professors" }), "professors");
  assert.equal(t({ userText: "再帮我找几位教授，偏应用一点" }), "professors");
  assert.equal(t({ taskStep: taskStepOf("prof:p1:letter") }), "write");
  assert.equal(t({ pagePath: "/documents/abc" }), "write");
  assert.equal(t({ userText: "我下一步该做什么？" }), "chat");
});

test("中途用了检索或找教授，步数跟着提高", () => {
  assert.equal(raisedBudget(STEP_BUDGET.chat, ["list_todos"]), STEP_BUDGET.chat);
  assert.equal(raisedBudget(STEP_BUDGET.chat, ["web_search"]), STEP_BUDGET.school);
  assert.equal(raisedBudget(STEP_BUDGET.compare, ["web_search"]), STEP_BUDGET.compare);
});

const search = (...urls: string[]) => ({ toolName: "web_search", output: urls.map((url) => ({ title: "", url, snippet: "" })) });

test("连续两步检索都没查到新网页才算查不出新东西", () => {
  assert.equal(staleStepCount([[search("a", "b")], [search("a")], [search("b")]]), 2);
  assert.equal(staleStepCount([[search("a")], [search("a")], [search("c")]]), 0);
  // 中间做了别的事（如加入志愿）就重新数
  assert.equal(staleStepCount([[search("a")], [search("a")], [{ toolName: "save_professor", output: {} }], [search("a")]]), 1);
  // 检索失败（没有结果）也算没查到
  assert.equal(staleStepCount([[search("a")], [{ toolName: "web_search", output: undefined }]]), 1);
});

test("什么时候进入总结", () => {
  const base = { budget: 10, elapsedMs: 1000, steps: [] };
  assert.ok(!shouldWrapUp({ ...base, stepNumber: 0, budget: 1 }));
  assert.ok(!shouldWrapUp({ ...base, stepNumber: 8 }));
  assert.ok(shouldWrapUp({ ...base, stepNumber: 9 }));
  assert.ok(shouldWrapUp({ ...base, stepNumber: 3, elapsedMs: 5 * 60_000 }));
  assert.ok(shouldWrapUp({ ...base, stepNumber: 3, steps: [[search("a")], [search("a")], [search("a")]] }));
});

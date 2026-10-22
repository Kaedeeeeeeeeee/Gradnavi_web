import assert from "node:assert/strict";
import { test } from "node:test";
import { tabFocus, workFocus } from "../ai-context";

test("AI 当前在看什么：志愿给对应的快捷回复，任务标签不算", () => {
  const f = tabFocus({ kind: "professor", id: "p1", title: "佐藤 健一" })!;
  assert.equal(f.label, "佐藤 健一");
  assert.equal(f.replies.length, 3);
  assert.match(f.replies[0].text, /教授 ID：p1/);
  assert.equal(tabFocus({ kind: "task", id: "t1", title: "x" }), null);
  assert.equal(workFocus("/aspirations").label, "志愿");
  assert.equal(workFocus("/somewhere").label, "工作台");
});

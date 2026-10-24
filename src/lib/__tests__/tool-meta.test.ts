import assert from "node:assert/strict";
import { test } from "node:test";
import { endedWithoutAnswer, toolChipText, toolGroupSummary } from "../ai/tool-meta";

test("找教授的进度标签：进行中说找什么，完成后说找到几位，重复调用不显示", () => {
  const input = { keywords: "シリアスゲーム", schools: ["東京大学"] };
  assert.equal(toolChipText("search_professors", "running", input), "正在找教授（東京大学 · シリアスゲーム）");
  assert.equal(toolChipText("search_professors", "running", { keywords: "x", schools: [] }), "正在找教授（x）");
  assert.equal(toolChipText("search_professors", "done", input, { candidates: [{}, {}, {}] }), "找到 3 位教授");
  assert.equal(toolChipText("search_professors", "done", input, { candidates: [] }), "这一轮没找到合适的教授");
  assert.equal(toolChipText("search_professors", "done", input, { skipped: true }), null);
  assert.equal(toolChipText("search_professors", "failed", input), "找教授没成功");
});

test("其他工具：进行中加「正在」，完成显示原来的名字", () => {
  assert.equal(toolChipText("list_aspirations", "running", {}), "正在查看志愿");
  assert.equal(toolChipText("list_aspirations", "done", {}), "查看志愿");
  assert.equal(toolChipText("update_document_section", "running", {}), "正在起草一节");
  assert.equal(toolChipText("web_search", "running", { query: "東京大学 募集要項" }), "正在联网检索「東京大学 募集要項」");
});

test("一串检索折叠成一行的摘要", () => {
  const names = ["list_aspirations", "web_search", "list_watched_schools", ...Array(8).fill("web_search"), "fetch_page"];
  assert.equal(toolGroupSummary(names), "查看志愿，检索 9 次，查看志愿里的研究科，读了 1 个网页");
});

test("这轮没写出结论：最后一步还在调用工具，或整轮没有文字", () => {
  const tool = { type: "tool-web_search" };
  const step = { type: "step-start" };
  const text = (t: string) => ({ type: "text", text: t });
  // 截图里的情况：开头一句话，后面全是检索，最后一步还是工具
  assert.ok(endedWithoutAnswer([step, text("我先看一下志愿"), tool, step, tool, tool]));
  assert.ok(endedWithoutAnswer([step, tool]));
  assert.ok(endedWithoutAnswer([]));
  // 正常结束：最后一步是文字
  assert.ok(!endedWithoutAnswer([step, tool, step, text("查到了：……")]));
  // 写完回答后记了一笔，最后一步空着：不算没下文
  assert.ok(!endedWithoutAnswer([step, text("结论……"), { type: "tool-update_user_md" }, step]));
});

test("没登记中文名的工具不显示变量名；申请表工具说清在做什么", () => {
  assert.equal(toolChipText("some_new_tool", "running", {}), "正在处理");
  assert.equal(toolChipText("some_new_tool", "done", {}), "处理完了一步");
  assert.equal(toolChipText("some_new_tool", "failed", {}), "有一步没成功");
  assert.equal(toolGroupSummary(["some_new_tool"]), "其他操作");
  assert.equal(toolChipText("fill_application_form", "running", {}), "正在下载并填写申请表");
  assert.equal(toolChipText("fill_application_form", "done", {}, { pendingTotal: 12 }), "填好了申请表，12 栏待你确认");
  assert.equal(toolChipText("update_application_form", "running", {}), "正在提议申请表内容");
});

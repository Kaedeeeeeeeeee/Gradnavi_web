import assert from "node:assert/strict";
import { test } from "node:test";
import { toolChipText } from "../ai/tool-meta";

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

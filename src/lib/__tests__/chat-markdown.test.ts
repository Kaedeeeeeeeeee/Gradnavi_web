import { test } from "node:test";
import assert from "node:assert/strict";
import { chatMarkdownToHtml } from "../chat-markdown";

test("chat markdown: bold, lists, headings, tables", () => {
  const html = chatMarkdownToHtml("## 标题\n**1. 方向**\n- a 教育\n- b 防灾\n\n| 学校 | 难度 |\n| --- | --- |\n| 东大 | 高 |");
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<strong>1\. 方向<\/strong>/);
  assert.match(html, /<li>a 教育<\/li>/);
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.match(html, /<td>东大<\/td>/);
});

test("chat markdown: raw html escaped, unsafe links dropped", () => {
  const html = chatMarkdownToHtml('<img src=x onerror=alert(1)> [点我](javascript:alert(1)) [官网](https://www.u-tokyo.ac.jp) ![图](https://x.test/a.png)');
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<a href="https:\/\/www\.u-tokyo\.ac\.jp" target="_blank" rel="noopener noreferrer">官网<\/a>/);
  assert.match(html, /<a href="https:\/\/x\.test\/a\.png"[^>]*>图<\/a>/);
});

test("chat markdown: unfinished stream still renders", () => {
  assert.match(chatMarkdownToHtml("**还没写完"), /\*\*还没写完/);
  assert.match(chatMarkdownToHtml("- a\n- b"), /<ul>/);
});

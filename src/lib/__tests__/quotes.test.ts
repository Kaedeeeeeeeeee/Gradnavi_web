import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanQuoteText, MAX_QUOTES, parseQuotes, quoteSnippet, quotesForModel } from "../quotes";

test("cleanQuoteText trims and collapses blank lines", () => {
  assert.equal(cleanQuoteText("  冈山大学 \n\n\n\n研究科  "), "冈山大学\n\n研究科");
  assert.equal(cleanQuoteText("a".repeat(2500)).length, 2001);
});

test("parseQuotes drops bad entries and caps the count", () => {
  assert.deepEqual(parseQuotes("x"), []);
  assert.deepEqual(parseQuotes([{ text: "  " }, { text: 1 }, null, { text: "冈山大学", source: "AI 的回复" }]), [{ text: "冈山大学", source: "AI 的回复" }]);
  assert.equal(parseQuotes([{ text: "a" }])[0].source, "对话");
  assert.equal(parseQuotes(Array.from({ length: 20 }, () => ({ text: "a" }))).length, MAX_QUOTES);
});

test("quotesForModel numbers quotes like the chips", () => {
  assert.equal(quotesForModel([]), "");
  const out = quotesForModel([
    { text: "冈山大学", source: "AI 的回复" },
    { text: "第一行\n第二行", source: "文稿「研究计划书」" },
  ]);
  assert.match(out, /\[1\] 出自AI 的回复：\n> 冈山大学/);
  assert.match(out, /\[2\] 出自文稿「研究计划书」：\n> 第一行\n> 第二行/);
  assert.match(out, /用户的话：$/);
});

test("quoteSnippet shortens to one line", () => {
  assert.equal(quoteSnippet("一二\n三", 10), "一二 三");
  assert.equal(quoteSnippet("一二三四五", 3), "一二三…");
});

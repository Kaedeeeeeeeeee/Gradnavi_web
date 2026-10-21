import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEmails } from "../beta";
import { costUsd, creditsFor, formatUsd, isEmptyUsage, UsageMeter, type Pricing } from "../credits";

const pricing: Pricing = {
  inputPerM: 0.28,
  cachedInputPerM: 0.028,
  outputPerM: 0.42,
  searchPerCall: 0.00075,
  fetchPerCall: 0.00075,
  creditsPerUsd: 1000,
  markup: 1,
};

test("UsageMeter 累加 token 和检索次数，take 后清零", () => {
  const m = new UsageMeter();
  m.addTokens({ inputTokens: 1000, outputTokens: 100, inputTokenDetails: { cacheReadTokens: 400 } });
  m.addTokens({ inputTokens: 500, outputTokens: 50 });
  m.addTokens(undefined);
  m.addSearch();
  m.addSearch(2);
  m.addFetch();
  assert.deepEqual(m.take(), { inputTokens: 1500, cachedInputTokens: 400, outputTokens: 150, searchCalls: 3, fetchCalls: 1 });
  assert.equal(isEmptyUsage(m.take()), true);
});

test("costUsd 缓存命中的输入按缓存价", () => {
  const cost = costUsd({ inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 1_000_000, searchCalls: 0, fetchCalls: 0 }, pricing);
  assert.ok(Math.abs(cost - (0.14 + 0.014 + 0.42)) < 1e-9);
});

test("costUsd 计入检索和抓取", () => {
  const cost = costUsd({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, searchCalls: 4, fetchCalls: 2 }, pricing);
  assert.ok(Math.abs(cost - 0.0045) < 1e-12);
});

test("costUsd 缓存数异常大于输入时不会算出负数", () => {
  const cost = costUsd({ inputTokens: 100, cachedInputTokens: 500, outputTokens: 0, searchCalls: 0, fetchCalls: 0 }, pricing);
  assert.ok(cost > 0);
});

test("creditsFor 向上取整、有成本至少 1、按加价倍数", () => {
  assert.equal(creditsFor(0, pricing), 0);
  assert.equal(creditsFor(0.0000001, pricing), 1);
  assert.equal(creditsFor(0.003, pricing), 3);
  assert.equal(creditsFor(0.0031, pricing), 4);
  assert.equal(creditsFor(0.003, { ...pricing, markup: 1.5 }), 5);
});

test("formatUsd", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.00123), "$0.00123");
  assert.equal(formatUsd(0.5), "$0.5000");
  assert.equal(formatUsd(12.345), "$12.35");
});

test("parseEmails 支持多种分隔符、去重、转小写、丢掉非法地址", () => {
  assert.deepEqual(parseEmails("A@qq.com, b@163.com\nc@x.cn；a@qq.com  not-an-email"), ["a@qq.com", "b@163.com", "c@x.cn"]);
});

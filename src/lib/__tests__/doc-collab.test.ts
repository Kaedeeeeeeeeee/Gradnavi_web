import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReview, parseReview, parseTranslations } from "../doc-assist";
import { describeEdit, diffText, idleRoundEnded, IDLE_MS, pushChange, summarizeChanges } from "../doc-history";
import { applyOp, canApply, opBeforeAfter, opSection, replaceNth } from "../doc-ops";
import { alignZh, blockKey, pairZh, realignZh, translatableKeys, withZh } from "../doc-zh";
import { isBlankDoc, outlineSkeleton, sectionStatus } from "../documents";

const md = "# 研究計画書\n\n## 研究背景\n\n日本語教育は重要である。\n\n留学生が増えている。\n\n## 研究方法\n\n- インタビュー\n- アンケート\n";

test("段落指纹忽略 Markdown 符号和空白", () => {
  assert.equal(blockKey("**日本語** 教育"), "日本語教育");
  assert.equal(blockKey("- インタビュー\n- アンケート"), "インタビューアンケート");
  assert.deepEqual(translatableKeys(md), ["日本語教育は重要である。", "留学生が増えている。", "インタビューアンケート"]);
});

test("中文对照：改过的段落沿用旧中文并标待更新，未改的保持最新", () => {
  const stored = [
    { key: "日本語教育は重要である。", zh: "日语教育很重要。" },
    { key: "留学生が増えている。", zh: "留学生在增加。" },
  ];
  const edited = md.replace("留学生が増えている。", "留学生が急増している。");
  const cells = alignZh(translatableKeys(edited), stored);
  assert.deepEqual(cells[0], { zh: "日语教育很重要。", stale: false, key: "日本語教育は重要である。" });
  assert.equal(cells[1]?.stale, true);
  assert.equal(cells[1]?.zh, "留学生在增加。");
  assert.equal(cells[2], null, "列表还没翻译");
  // 保存时保留旧指纹，下次打开仍是待更新
  const saved = realignZh(edited, stored);
  assert.deepEqual(alignZh(translatableKeys(edited), saved)[1]?.stale, true);
});

test("中文对照：删掉的段落丢弃，新中文覆盖", () => {
  const stored = [
    { key: "日本語教育は重要である。", zh: "日语教育很重要。" },
    { key: "留学生が増えている。", zh: "留学生在增加。" },
  ];
  const removed = md.replace("留学生が増えている。\n\n", "");
  assert.deepEqual(realignZh(removed, stored), [{ key: "日本語教育は重要である。", zh: "日语教育很重要。" }]);
  const next = withZh(md, stored, [{ key: "留学生が増えている。", zh: "留学生越来越多。" }]);
  assert.equal(next[1].zh, "留学生越来越多。");
  assert.equal(next.length, 2);
});

test("AI 给的中文按段落和日文配对", () => {
  assert.deepEqual(pairZh("一段目。\n\n二段目。", "第一段。\n\n第二段。"), [
    { key: "一段目。", zh: "第一段。" },
    { key: "二段目。", zh: "第二段。" },
  ]);
  assert.equal(pairZh("一段目。\n\n二段目。", "只有一段").length, 1);
});

test("修改建议：替换、写节、整篇", () => {
  assert.ok(applyOp(md, { type: "replace", find: "重要である", replace: "不可欠である" }).includes("不可欠である"));
  const sec = applyOp(md, { type: "section", heading: "研究方法", content: "質的調査を行う。", mode: "replace" });
  assert.ok(sec.includes("## 研究方法\n質的調査を行う。"));
  assert.equal(applyOp(md, { type: "full", markdown: "新しい本文" }), "新しい本文\n");
  assert.equal(canApply(md, { type: "replace", find: "存在しない", replace: "x" }), false);
  const ba = opBeforeAfter(md, { type: "section", heading: "研究背景", content: "追加。", mode: "append" });
  assert.equal(ba.where, "研究背景");
  assert.ok(ba.after.endsWith("追加。"));
  assert.equal(opSection(md, { type: "replace", find: "留学生が", replace: "x" }), "研究背景");
});

test("选区改写：原文重复时按第几处替换", () => {
  const text = "AとB。AとC。";
  assert.equal(replaceNth(text, "A", "X", 1), "AとB。XとC。");
  assert.throws(() => replaceNth(text, "A", "X"), /多次/);
  assert.throws(() => replaceNth(text, "A", "X", 2));
});

test("版本说明：按改动的节生成，合并去重", () => {
  const after = md.replace("インタビュー", "半構造化インタビュー");
  assert.equal(describeEdit(md, after), "编辑了「研究方法」");
  assert.equal(describeEdit(md, md), null);
  let log: string[] = [];
  log = pushChange(log, "编辑了「研究方法」");
  log = pushChange(log, "编辑了「研究方法」");
  log = pushChange(log, "接受 AI 修改：改写研究背景");
  assert.equal(summarizeChanges(log), "编辑了「研究方法」；接受 AI 修改：改写研究背景");
  assert.equal(summarizeChanges([], "导出 PDF"), "导出 PDF");
});

test("停手 30 分钟才算一轮结束", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  assert.equal(idleRoundEnded(new Date(now.getTime() - IDLE_MS), now, ["编辑"]), true);
  assert.equal(idleRoundEnded(new Date(now.getTime() - 60_000), now, ["编辑"]), false);
  assert.equal(idleRoundEnded(new Date(now.getTime() - IDLE_MS), now, []), false);
});

test("差异按语义合并，日文可读", () => {
  const parts = diffText("研究方法は面接である。", "研究方法は質問紙調査である。");
  assert.ok(parts.some(([op, t]) => op === -1 && t.includes("面接")));
  assert.ok(parts.some(([op, t]) => op === 1 && t.includes("質問紙調査")));
});

test("提纲：生成骨架、按提纲判断各节进度", () => {
  const outline = { status: "approved" as const, sections: [{ heading: "研究題目", points: [] }, { heading: "研究方法", points: ["访谈"] }] };
  const skel = outlineSkeleton("研究計画書", outline);
  assert.equal(skel, "# 研究計画書\n\n## 研究題目\n\n## 研究方法\n");
  assert.equal(isBlankDoc(skel), true);
  assert.equal(isBlankDoc(md), false);
  assert.deepEqual(sectionStatus(md, outline), [
    { heading: "研究題目", written: false },
    { heading: "研究方法", written: true },
  ]);
});

test("审阅结果解析：容错类别，限制条数", () => {
  const reply = '```json\n[{"quote":"日本語教育は重要である","body":"太泛了","category":"logic"},{"quote":"x","body":"y","category":"unknown"},{"bad":1}]\n```';
  const r = parseReview(reply);
  assert.equal(r.length, 2);
  assert.equal(r[1].category, "logic");
  assert.throws(() => parseReview("没有 JSON"));
  assert.deepEqual(parseTranslations('["一","二"]', 2), ["一", "二"]);
  assert.throws(() => parseTranslations('["一"]', 2));
  const demo = demoReview(md);
  assert.equal(demo[0].quote, "日本語教育は重要である。");
});

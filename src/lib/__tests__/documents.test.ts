import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReply } from "../ai/demo-model";
import { markdownToHtml } from "../doc-html";
import { describeDocument, detectPlanField, docTemplate, planProgress, replaceTextOnce, sectionBodies } from "../documents";
import { upsertSection } from "../md-sections";

test("计划书模板按文科/理科分节，能识别回学科", () => {
  const h = docTemplate("plan", "humanities").markdown;
  const s = docTemplate("plan", "sciences").markdown;
  assert.match(h, /## 先行研究/);
  assert.match(s, /## 関連研究/);
  assert.equal(detectPlanField(h, "sciences"), "humanities");
  assert.equal(detectPlanField(s, "humanities"), "sciences");
  assert.equal(detectPlanField("", "sciences"), "sciences");
});

test("带写进度：按节是否有正文推进到下一步", () => {
  let md = docTemplate("plan", "humanities").markdown;
  assert.equal(planProgress(md, "humanities").next?.key, "question");
  md = upsertSection(md, "研究題目", "留学生政策の研究");
  assert.equal(planProgress(md, "humanities").next?.key, "question", "问题意识还没写");
  md = upsertSection(md, "研究背景と問題意識", "本研究は……");
  const p = planProgress(md, "humanities");
  assert.equal(p.steps[0].done, true);
  assert.equal(p.next?.key, "literature");
});

test("sectionBodies 只认 ## 节，### 小节算在所属节里", () => {
  const bodies = sectionBodies("# 題\n\n## A\n本文\n### 小\n詳細\n## B\n");
  assert.equal(bodies.get("A"), "本文\n### 小\n詳細");
  assert.equal(bodies.get("B"), "");
  assert.equal(bodies.has("題"), false);
});

test("replaceTextOnce 要求原文唯一", () => {
  assert.equal(replaceTextOnce("あいうえお", "いう", "イウ"), "あイウえお");
  assert.throws(() => replaceTextOnce("あいう", "か", "x"), /找不到/);
  assert.throws(() => replaceTextOnce("ああ", "あ", "x"), /多次/);
});

test("给 AI 的文档摘要包含 ID 和目标教授", () => {
  const base = { id: "d1", kind: "plan" as const, title: "計画書" };
  assert.match(describeDocument({ ...base, targetProfessor: null }), /文档 ID：d1[\s\S]*目标教授：未设定/);
  const withProf = describeDocument({ ...base, targetProfessor: { name: "山田太郎", affiliation: "東京大学", research: "教育社会学" } });
  assert.match(withProf, /山田太郎（東京大学）/);
  assert.match(withProf, /教育社会学/);
});

test("PDF 用 HTML：渲染 Markdown，转义原样 HTML", () => {
  const html = markdownToHtml("## 研究目的\n\n**重要**な点<script>alert(1)</script>");
  assert.match(html, /<h2>研究目的<\/h2>/);
  assert.match(html, /<strong>重要<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("PDF 用 HTML：文字颜色、背景色（可嵌套），未知颜色原样保留", () => {
  const html = markdownToHtml("{color:red}赤い{bg:yellow}**強調**{/bg}{/color}と{color:navy}そのまま{/color}");
  assert.match(html, /<span style="color:#d44c47">赤い<span style="background-color:#fbf3db"><strong>強調<\/strong><\/span><\/span>/);
  assert.match(html, /\{color:navy\}そのまま\{\/color\}/);
});

test("演示模式：在文书页面“写入：”会调用文书工具", () => {
  const reply = demoReply([
    { role: "system", content: "…\n文档 ID：abc-123\n…" },
    { role: "user", content: [{ type: "text", text: "写入：テスト" }] },
  ]);
  assert.deepEqual(reply, {
    toolName: "update_document_section",
    input: { id: "abc-123", section: "メモ", content: "テスト", mode: "append", zh: "（演示译文）テスト", summary: "在メモ里追加一段" },
  });
  const noDoc = demoReply([{ role: "user", content: [{ type: "text", text: "写入：テスト" }] }]);
  assert.ok("text" in noDoc);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeToolCalls } from "../task-report";

test("summarizeToolCalls：同一份文书合成一条，带打开链接；失败的调用不算", () => {
  const items = summarizeToolCalls([
    { toolName: "web_search", input: {}, output: {}, ok: true },
    { toolName: "create_document", input: { kind: "letter" }, output: { id: "d1", title: "给佐藤教授的套磁信" }, ok: true },
    { toolName: "update_document_section", input: { id: "d1", heading: "自己紹介" }, output: { id: "d1", title: "给佐藤教授的套磁信", summary: "写自我介绍" }, ok: true },
    { toolName: "save_professor", input: {}, output: { error: "x" }, ok: false },
    { toolName: "add_calendar_event", input: {}, output: { id: "e1", title: "面谈", date: "2026-11-05" }, ok: true },
  ]);
  assert.equal(items.length, 3);
  assert.match(items[0].text, /检索 1 次/);
  assert.equal(items[1].text, "新建了「给佐藤教授的套磁信」（写自我介绍）");
  assert.deepEqual(items[1].link, { kind: "doc", id: "d1", title: "给佐藤教授的套磁信" });
  assert.match(items[2].text, /面谈.*11\/5/);
});

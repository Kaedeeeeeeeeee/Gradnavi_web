import assert from "node:assert/strict";
import { test } from "node:test";
import { listSections, upsertSection } from "../md-sections";

const md = "# 我的档案\n\n## 背景\n- 专业：日语\n\n## 目标\n- 路径：直考修士\n";

test("替换已有的节", () => {
  const out = upsertSection(md, "背景", "- 专业：经济学");
  assert.equal(out, "# 我的档案\n\n## 背景\n- 专业：经济学\n\n## 目标\n- 路径：直考修士\n");
});

test("追加到已有的节", () => {
  const out = upsertSection(md, "目标", "- 目标入学：2027年4月", "append");
  assert.equal(out, "# 我的档案\n\n## 背景\n- 专业：日语\n\n## 目标\n- 路径：直考修士\n- 目标入学：2027年4月\n");
});

test("节不存在时在文末新建", () => {
  const out = upsertSection(md, "进度", "- 已联系 2 位教授");
  assert.deepEqual(listSections(out), ["背景", "目标", "进度"]);
  assert.ok(out.endsWith("## 进度\n- 已联系 2 位教授\n"));
});

test("空文档", () => {
  assert.equal(upsertSection("", "背景", "x"), "## 背景\nx\n");
});

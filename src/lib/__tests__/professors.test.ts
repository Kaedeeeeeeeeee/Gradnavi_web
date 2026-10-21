import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReply } from "../ai/demo-model";
import { describeDocument } from "../documents";
import {
  buildSearchQueries,
  demoCandidates,
  letterSkeleton,
  parseCandidates,
  professorToTarget,
  splitSchools,
} from "../professors";
import { parseSearchResponse } from "../search";

const sources = [
  { title: "山田太郎 - researchmap", url: "https://researchmap.jp/yamada" },
  { title: "山田研究室", url: "https://www.example-u.ac.jp/yamada" },
];

test("目标校按顿号、逗号、空格拆分，去重并最多 5 所", () => {
  assert.deepEqual(splitSchools("東京大学、京都大学, 大阪大学 東京大学"), ["東京大学", "京都大学", "大阪大学"]);
  assert.equal(splitSchools("a b c d e f g").length, 5);
  assert.deepEqual(splitSchools("  "), []);
});

test("检索词：每所学校查 researchmap + 官网；不填学校时搜全日本", () => {
  const q = buildSearchQueries({ keywords: "第二言語習得", schools: ["東京大学", "京都大学"] });
  assert.equal(q.length, 4);
  assert.ok(q[0].includes("site:researchmap.jp") && q[0].includes("東京大学"));
  assert.ok(buildSearchQueries({ keywords: "強化学習", schools: [] }).every((s) => s.includes("強化学習")));
});

test("解析 AI 整理的候选：只保留检索结果里的来源，没有有效来源的丢掉", () => {
  const reply = `好的，结果如下：
\`\`\`json
{"candidates":[
  {"name":"山田 太郎","university":"東京大学","department":"教育学研究科","lab":null,"research":"研究第二语言习得。","papers":["論文A（2024）"],"acceptsInternational":null,"sources":["https://researchmap.jp/yamada","https://fake.example.com/x"]},
  {"name":"編造 教授","university":"東京大学","research":"x","papers":[],"sources":["https://fake.example.com/y"]},
  {"name":"山田太郎","university":"東京大学","research":"重复","papers":[],"sources":["https://www.example-u.ac.jp/yamada"]},
  {"name":"","university":"京都大学","sources":["https://researchmap.jp/yamada"]}
]}
\`\`\``;
  const list = parseCandidates(reply, sources);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "山田 太郎");
  assert.equal(list[0].department, "教育学研究科");
  assert.equal(list[0].lab, undefined);
  assert.deepEqual(list[0].sources, [sources[0]]);
});

test("解析候选：也接受裸数组，坏 JSON 返回空", () => {
  const arr = JSON.stringify([{ name: "佐藤 花子", university: "京都大学", research: "", papers: [], sources: [sources[1].url] }]);
  assert.equal(parseCandidates(arr, sources).length, 1);
  assert.deepEqual(parseCandidates("没有找到。", sources), []);
  assert.deepEqual(parseCandidates("{oops", sources), []);
});

test("检索服务返回格式宽松解析", () => {
  const a = parseSearchResponse({ results: [{ title: "T", url: "https://a.jp", summary: "S", date: "2025-01-01" }, { title: "bad", url: "ftp://x" }] });
  assert.deepEqual(a, [{ title: "T", url: "https://a.jp", snippet: "S", date: "2025-01-01", site: undefined }]);
  assert.equal(parseSearchResponse({ data: { results: [{ link: "https://b.jp", snippet: "x" }] } })[0].url, "https://b.jp");
  assert.equal(parseSearchResponse({ data: [{ url: "https://c.jp" }] })[0].title, "https://c.jp");
  assert.deepEqual(parseSearchResponse(null), []);
});

test("收藏的教授 → 文书目标教授，带上 ID、所属和代表论文", () => {
  const t = professorToTarget({
    id: "p1",
    name: "山田 太郎",
    university: "東京大学",
    department: "教育学研究科",
    lab: null,
    research: "第二语言习得",
    papers: ["論文A"],
  });
  assert.equal(t.professorId, "p1");
  assert.equal(t.affiliation, "東京大学 教育学研究科");
  assert.match(t.research ?? "", /論文A/);
  assert.match(describeDocument({ id: "d", kind: "letter", title: "套磁信", targetProfessor: t }), /目标教授：山田 太郎/);
});

test("套磁信骨架填好收件人", () => {
  const md = letterSkeleton({ name: "山田 太郎", university: "東京大学", department: "教育学研究科" });
  assert.match(md, /東京大学 教育学研究科\n山田 太郎 先生/);
});

test("演示数据明确标注为示例", () => {
  const list = demoCandidates({ keywords: "強化学習", schools: ["東京大学"] });
  assert.ok(list.length > 0);
  assert.ok(list.every((c) => c.name.includes("示例") && c.research.includes("演示数据")));
});

test("演示模型：“找教授：xxx” 调用 search_professors", () => {
  const reply = demoReply([{ role: "user", content: [{ type: "text", text: "找教授：第二言語習得" }] }]);
  assert.deepEqual(reply, { toolName: "search_professors", input: { keywords: "第二言語習得", schools: [] } });
});

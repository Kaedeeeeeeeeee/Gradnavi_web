import assert from "node:assert/strict";
import { test } from "node:test";
import { demoReply } from "../ai/demo-model";
import { describeDocument } from "../documents";
import {
  buildMoreQueries,
  buildAdmissionQuery,
  buildPaperQueries,
  profileSearchUrl,
  retirementInfo,
  sourceLabel,
  buildSearchQueries,
  candidateCount,
  cleanCopy,
  demoCandidates,
  mergePaperReply,
  letterSkeleton,
  parseCandidates,
  professorAffiliation,
  professorToTarget,
  splitSchools,
  stripUniversity,
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

test("演示模型：“日程：日期 标题” 调用 add_calendar_event", () => {
  const reply = demoReply([{ role: "user", content: [{ type: "text", text: "日程：2026-12-01 JLPT N1" }] }]);
  assert.deepEqual(reply, { toolName: "add_calendar_event", input: { date: "2026-12-01", title: "JLPT N1", kind: "other" } });
});

test("用户要几位就给几位：count 限制候选数，默认 5，最多 8", () => {
  assert.equal(candidateCount({}), 5);
  assert.equal(candidateCount({ count: 3 }), 3);
  assert.equal(candidateCount({ count: 20 }), 8);
  assert.equal(candidateCount({ count: 0 }), 1);
  const many = JSON.stringify({
    candidates: ["一", "二", "三", "四"].map((n) => ({ name: `山田${n}`, university: "例大学", research: "x", sources: [sources[0].url] })),
  });
  assert.equal(parseCandidates(many, sources, 3).length, 3);
});

test("给用户看的文字里不出现内部字段名", () => {
  assert.equal(cleanCopy("papers为空，无法引用论文。研究方向和你的二语习得课题很接近。"), "研究方向和你的二语习得课题很接近。");
  assert.equal(cleanCopy("偏实证，papers 字段为空，和你的方向接近。"), "偏实证，和你的方向接近。");
  assert.equal(cleanCopy("近两年做学习者语料库研究，和你的方向一致。"), "近两年做学习者语料库研究，和你的方向一致。");
  assert.equal(cleanCopy("null"), undefined);
  const [c] = parseCandidates(
    JSON.stringify({ candidates: [{ name: "山田太郎", university: "例大学", research: "语料库", fit: "papers为空。方向接近。", acceptsInternational: "null", sources: [sources[0].url] }] }),
    sources,
  );
  assert.equal(c.fit, "方向接近。");
  assert.equal(c.acceptsInternational, undefined);
});

test("每位候选单独检索：论文、researchmap 业绩、KAKEN、研究室；研究科招生页按研究科搜", () => {
  const qs = buildPaperQueries({ name: "山田 太郎", university: "東京大学" });
  assert.deepEqual(qs, [
    '"山田太郎" 東京大学 論文',
    "山田太郎 論文 業績 site:researchmap.jp",
    "山田太郎 site:kaken.nii.ac.jp",
    '"山田太郎" 東京大学 研究室 留学生',
  ]);
  assert.equal(buildAdmissionQuery({ university: "東京大学", department: "東京大学 教育学研究科 総合教育科学専攻" }), "東京大学 教育学研究科 入試 募集要項 外国人留学生");
  assert.equal(buildAdmissionQuery({ university: "東京大学" }), null);
});

test("补充信息合并：链接只认检索结果或 researchmap 页面里出现过的，查不到的字段不写", () => {
  const base = [{ name: "山田太郎", university: "例大学", research: "语料库", papers: [], paperRefs: [], sources: [sources[0]] }];
  const found = [{ title: "KAKEN", url: "https://kaken.nii.ac.jp/grant/KAKENHI-PROJECT-1/" }];
  const page = "研究室ホームページ https://lab.example.ac.jp/yamada/ 所属 教授";
  const reply = JSON.stringify({
    candidates: [
      {
        index: 1,
        papers: [],
        position: "准教授",
        links: { researchmap: "https://researchmap.jp/fake", lab: "https://lab.example.ac.jp/yamada/", kaken: "https://kaken.nii.ac.jp/grant/KAKENHI-PROJECT-1/", admission: null },
        birthYear: "1962",
        retirementNote: null,
        grants: [{ title: "コーパス研究", years: "2023–2026", url: "https://kaken.nii.ac.jp/grant/KAKENHI-PROJECT-1/" }, { title: "", years: null }],
        chineseStudents: "chineseStudents 为空",
        contact: "研究室主页有联系邮箱 yamada@example.ac.jp",
        contactRule: null,
      },
    ],
  });
  const [a] = mergePaperReply(reply, base, found, [page]);
  assert.deepEqual(a.details, {
    position: "准教授",
    links: { lab: "https://lab.example.ac.jp/yamada/", kaken: "https://kaken.nii.ac.jp/grant/KAKENHI-PROJECT-1/" },
    birthYear: 1962,
    grants: [{ title: "コーパス研究", years: "2023–2026", url: "https://kaken.nii.ac.jp/grant/KAKENHI-PROJECT-1/" }],
    contact: "研究室主页有联系邮箱 yamada@example.ac.jp",
  });
});

test("来源链接写明网站；定年按 65 岁推算，快退休时提示", () => {
  assert.equal(sourceLabel({ title: "Hofmeyr Michael", url: "https://researchmap.jp/hofmeyr" }), "researchmap：Hofmeyr Michael");
  assert.equal(sourceLabel({ title: "https://www.example.ac.jp/x", url: "https://www.example.ac.jp/x" }), "example.ac.jp");
  assert.equal(sourceLabel({ title: "研究者", url: "https://nrid.nii.ac.jp/ja/nrid/1/" }), "KAKEN 研究者：研究者");
  assert.equal(retirementInfo(undefined, 2026), null);
  assert.equal(retirementInfo({ birthYear: 1962 }, 2026)?.warn, true);
  assert.equal(retirementInfo({ birthYear: 1975 }, 2026)?.warn, false);
  assert.deepEqual(retirementInfo({ birthYear: 1975, retirementNote: "2027年3月定年退職予定" }, 2026), { text: "2027年3月定年退職予定", warn: true });
  assert.equal(profileSearchUrl("kaken", "山田 太郎"), "https://kaken.nii.ac.jp/ja/search/?kw=%E5%B1%B1%E7%94%B0%E5%A4%AA%E9%83%8E");
});

test("论文检索结果合并进候选：只认检索到的链接，查不到的保留原样", () => {
  const base = [
    { name: "山田太郎", university: "例大学", research: "语料库", fit: "旧说法", papers: [], paperRefs: [], sources: [sources[0]] },
    { name: "佐藤花子", university: "例大学", research: "习得", papers: ["旧论文"], paperRefs: [{ title: "旧论文" }], sources: [sources[0]] },
  ];
  const paperSources = [{ title: "論文A - CiNii", url: "https://cir.nii.ac.jp/a" }];
  const reply = JSON.stringify({
    candidates: [
      { index: 1, papers: [{ title: "論文A", year: 2025, url: "https://cir.nii.ac.jp/a" }, { title: "論文B", year: 2024, url: "https://fake.example/b" }], fit: "2025 年的论文A做语料库分析，和你的方向一致。" },
      { index: 2, papers: [], fit: "papers为空。" },
      { index: 9, papers: [{ title: "幽霊" }] },
    ],
  });
  const [a, b] = mergePaperReply(reply, base, paperSources);
  assert.deepEqual(a.paperRefs, [{ title: "論文A", year: 2025, url: "https://cir.nii.ac.jp/a" }, { title: "論文B", year: 2024 }]);
  assert.deepEqual(a.papers, ["論文A（2025）", "論文B（2024）"]);
  assert.equal(a.fit, "2025 年的论文A做语料库分析，和你的方向一致。");
  assert.deepEqual(b.papers, ["旧论文"]);
  assert.equal(b.fit, undefined);
  assert.equal(mergePaperReply("{oops", base, paperSources), base);
});

test("所属里重复的大学名去掉", () => {
  assert.equal(stripUniversity("東京大学 大学院情報理工学系研究科 コンピュータ科学専攻", "東京大学"), "大学院情報理工学系研究科 コンピュータ科学専攻");
  assert.equal(stripUniversity("大学院教育学研究科", "東京大学"), "大学院教育学研究科");
  assert.equal(stripUniversity("東京大学", "東京大学"), undefined);
  assert.equal(stripUniversity(null, "東京大学"), undefined);
  assert.equal(professorAffiliation({ name: "x", university: "東京大学", department: "東京大学大学院情報理工学系研究科" }), "東京大学 大学院情報理工学系研究科");
  const [c] = parseCandidates(
    JSON.stringify({ candidates: [{ name: "宮尾祐介", university: "東京大学", department: "東京大学 大学院情報理工学系研究科", research: "x", sources: [sources[0].url] }] }),
    sources,
  );
  assert.equal(c.department, "大学院情報理工学系研究科");
});

test("人数不够时的补充检索词和第一轮不同", () => {
  const input = { keywords: "自然言語処理", schools: ["東京大学"] };
  const first = buildSearchQueries(input);
  const more = buildMoreQueries(input);
  assert.ok(more.length > 0 && more.every((q) => !first.includes(q)));
  assert.ok(buildMoreQueries({ keywords: "x", schools: [] }).length > 0);
});

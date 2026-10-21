import assert from "node:assert/strict";
import { test } from "node:test";
import { diffGuideEvents, parseGuideReply } from "../admissions";
import { describeAspiration, matchSchool, nextDeadline, parseScores, requirementGaps } from "../aspirations";
import type { CalendarItem } from "../calendar";
import { candidateKey, parseCandidates } from "../professors";
import { openTab } from "../shell";

test("从档案里认出语言成绩：取最好的，备考中的不算", () => {
  assert.deepEqual(parseScores("- 日语：JLPT N2（2025）\n- 英语：TOEFL iBT 72，TOEIC 650"), { jlpt: 2, toefl: 72, toeic: 650 });
  assert.deepEqual(parseScores("N2 已过，N1 备考中；TOEFL 目标 90"), { jlpt: 2 });
  assert.deepEqual(parseScores("N1 135 分\nIELTS 6.5"), { jlpt: 1, ielts: 6.5 });
  assert.deepEqual(parseScores("零基础"), {});
});

const req = { toefl: 80, toeic: null, ielts: null, jlpt: 1 };

test("研究科要求和档案对照的差距", () => {
  assert.deepEqual(requirementGaps(req, { toefl: 72, jlpt: 2 }), ["TOEFL 要求 80，你现在 72", "日语要求 N1，你现在 N2"]);
  assert.deepEqual(requirementGaps(req, { toefl: 85, jlpt: 1 }), []);
  assert.deepEqual(requirementGaps(req, {}), ["英语要求 TOEFL 80，你还没有成绩", "日语要求 N1，你还没有 JLPT 成绩"]);
  // 任一英语成绩达标即可
  assert.deepEqual(requirementGaps({ toefl: 80, toeic: 730, ielts: null, jlpt: null }, { toeic: 800 }), []);
  assert.deepEqual(requirementGaps(null, { toefl: 10 }), []);
});

test("教授的研究科・専攻能对上已有的研究科", () => {
  const schools = [
    { id: "s1", university: "東京大学", name: "教育学研究科" },
    { id: "s2", university: "京都大学", name: "教育学研究科" },
    { id: "s3", university: "東京大学", name: "大学院 情報理工学系研究科" },
  ];
  assert.equal(matchSchool({ university: "東京大学", department: "大学院教育学研究科 教育学専攻" }, schools)?.id, "s1");
  assert.equal(matchSchool({ university: "京都大学", department: "教育学研究科" }, schools)?.id, "s2");
  assert.equal(matchSchool({ university: "東京大学", department: "情報理工学系研究科 コンピュータ科学専攻" }, schools)?.id, "s3");
  assert.equal(matchSchool({ university: "東京大学", department: "人文社会系研究科" }, schools), null);
  assert.equal(matchSchool({ university: "東京大学", department: null }, schools), null);
});

test("最近的出愿截止：跨天的看最后一天，已过的跳过", () => {
  const items: CalendarItem[] = [
    { key: "a", source: "guide", title: "出願期間（夏）", date: "2026-07-01", endDate: "2026-07-05", kind: "deadline" },
    { key: "b", source: "guide", title: "出願期間（冬）", date: "2026-12-01", endDate: "2026-12-05", kind: "deadline", tentative: true },
    { key: "c", source: "guide", title: "筆記試験", date: "2026-11-01", kind: "exam" },
  ];
  assert.deepEqual(nextDeadline(items, "2026-10-21"), { label: "出願期間（冬）", date: "2026-12-05", start: "2026-12-01", tentative: true, sourceUrl: undefined });
  assert.equal(nextDeadline(items, "2027-01-01"), null);
});

test("候选教授：论文带年份和链接，链接只认检索结果里的", () => {
  const sources = [
    { title: "山田 - researchmap", url: "https://researchmap.jp/yamada" },
    { title: "論文A", url: "https://cir.nii.ac.jp/a" },
  ];
  const reply = JSON.stringify({
    candidates: [
      {
        name: "山田 太郎",
        university: "東京大学",
        research: "二语习得",
        fit: "近两年都在做学习者语料库",
        papers: [
          { title: "論文A", year: 2025, url: "https://cir.nii.ac.jp/a" },
          { title: "論文B", year: 2024, url: "https://fake.example.com/b" },
          "論文C（2023）",
        ],
        sources: ["https://researchmap.jp/yamada"],
      },
    ],
  });
  const [c] = parseCandidates(reply, sources);
  assert.equal(c.fit, "近两年都在做学习者语料库");
  assert.deepEqual(c.paperRefs, [{ title: "論文A", year: 2025, url: "https://cir.nii.ac.jp/a" }, { title: "論文B", year: 2024 }, { title: "論文C（2023）" }]);
  assert.deepEqual(c.papers, ["論文A（2025）", "論文B（2024）", "論文C（2023）"]);
  assert.equal(candidateKey({ name: "山田 太郎", university: "東京大学" }), candidateKey({ name: "山田太郎", university: "東京大学 " }));
});

test("募集要项解析：同时抽出入试要点，坏字段丢掉", () => {
  const g = parseGuideReply(
    JSON.stringify({
      admissionYear: 2027,
      events: [{ label: "出願期間", date: "2026-12-01", endDate: "2026-12-05", kind: "deadline" }],
      requirements: { contact: "required", contactNote: "出愿前须取得指导教员同意", subjects: ["专业笔试", "口试"], english: "TOEFL iBT 80 以上", toefl: "80", jlpt: 9, notes: null },
    }),
  );
  assert.equal(g?.requirements?.contact, "required");
  assert.equal(g?.requirements?.toefl, 80);
  assert.equal(g?.requirements?.jlpt, null);
  assert.deepEqual(g?.requirements?.subjects, ["专业笔试", "口试"]);
  assert.equal(parseGuideReply(JSON.stringify({ admissionYear: 2027, events: [], requirements: { contact: "maybe", subjects: [] } }))?.requirements, null);
});

test("新要项和之前的仮日程对照", () => {
  const prev = [
    { label: "出願期間", date: "2026-12-02", endDate: "2026-12-06", kind: "deadline" as const },
    { label: "筆記試験", date: "2027-01-20", kind: "exam" as const },
  ];
  const next = [
    { label: "出願期間", date: "2026-12-01", endDate: "2026-12-05", kind: "deadline" as const },
    { label: "筆記試験", date: "2027-01-20", endDate: null, kind: "exam" as const },
    { label: "合格発表", date: "2027-02-10", kind: "other" as const },
  ];
  const d = diffGuideEvents(prev, next);
  assert.deepEqual(d[0].before, { date: "2026-12-02", endDate: "2026-12-06" });
  assert.equal(d[1].before, null);
  assert.equal(d[2].before, null);
});

test("找教授的结果标签只有一个：新一轮替换旧的", () => {
  let tabs = openTab({ tabs: [], active: null }, { kind: "doc", id: "d1", title: "计划书" });
  tabs = openTab(tabs, { kind: "search", id: "s1", title: "找教授：A" });
  tabs = openTab(tabs, { kind: "search", id: "s2", title: "找教授：B" });
  assert.deepEqual(
    tabs.tabs.map((t) => t.title),
    ["计划书", "找教授：B"],
  );
  assert.equal(tabs.active, "search:s2");
});

test("给 AI 的志愿描述：教授 + 研究科 + 差距", () => {
  const text = describeAspiration({
    key: "prof:p1",
    professor: {
      id: "p1",
      name: "山田 太郎",
      university: "東京大学",
      department: "教育学研究科",
      lab: null,
      research: null,
      fit: "方向一致",
      papers: [],
      paperRefs: [],
      acceptsInternational: null,
      sources: [],
      status: "contacted",
      note: null,
      followUpDate: null,
      proposedFollowUp: { date: "2026-11-10" },
    },
    school: null,
    gaps: ["TOEFL 要求 80，你现在 72"],
  });
  assert.match(text, /联系状态：已发信/);
  assert.match(text, /AI 提议的跟进日：2026-11-10/);
  assert.match(text, /研究科：还没关联/);
  assert.match(text, /差距：TOEFL 要求 80/);
});

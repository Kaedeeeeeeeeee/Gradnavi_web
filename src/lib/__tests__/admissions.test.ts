import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPublicUrl,
  eventsChanged,
  extractLinks,
  fingerprintSource,
  guideDocumentUrl,
  htmlToText,
  mergeRequirements,
  parseGuideReply,
  projectGuide,
  requirementsIncomplete,
  type GuideEvent,
} from "../admissions";

const html = `<html><head><style>.x{}</style><script>var a=1</script></head><body>
<nav>ホーム | お知らせ</nav>
<h2>2027年度 大学院入学試験</h2>
<p>出願期間：2026年7月1日～7月7日<br>試験日&nbsp;：8月20日</p>
<p>最終更新日 2026/10/01</p>
<a href="/files/boshu2027.pdf">学生募集要項（PDF）</a>
<a href="https://example.ac.jp/news">ニュース</a>
</body></html>`;

test("htmlToText 去掉脚本样式、保留行结构和实体", () => {
  const text = htmlToText(html);
  assert.ok(!text.includes("var a"));
  assert.ok(text.includes("出願期間：2026年7月1日～7月7日\n試験日 ：8月20日"));
});

test("extractLinks 解析相对链接", () => {
  const links = extractLinks(html, "https://example.ac.jp/admission/");
  assert.deepEqual(links[0], { url: "https://example.ac.jp/files/boshu2027.pdf", text: "学生募集要項（PDF）" });
});

test("指纹只看入试相关的行和链接", () => {
  const base = fingerprintSource(htmlToText(html), extractLinks(html, "https://example.ac.jp/"));
  const newsChanged = html.replace("ホーム | お知らせ", "ホーム | 新着情報").replace("/news", "/news2");
  assert.equal(fingerprintSource(htmlToText(newsChanged), extractLinks(newsChanged, "https://example.ac.jp/")), base);
  const dateChanged = html.replace("7月7日", "7月8日");
  assert.notEqual(fingerprintSource(htmlToText(dateChanged), extractLinks(dateChanged, "https://example.ac.jp/")), base);
  const pdfChanged = html.replace("boshu2027", "boshu2028");
  assert.notEqual(fingerprintSource(htmlToText(pdfChanged), extractLinks(pdfChanged, "https://example.ac.jp/")), base);
});

test("parseGuideReply 校验日期、丢掉不合法的日程", () => {
  const reply =
    '```json\n{"admissionYear":2027,"title":"2027年度 学生募集要項","events":[' +
    '{"label":"試験日","date":"2026-08-20","endDate":null,"kind":"exam"},' +
    '{"label":"出願期間","date":"2026-07-01","endDate":"2026-07-07","kind":"deadline"},' +
    '{"label":"不明","date":"8月下旬"},{"label":"倒置","date":"2026-09-10","endDate":"2026-09-01","kind":"weird"}],"pdfUrl":null}\n```';
  const g = parseGuideReply(reply)!;
  assert.equal(g.admissionYear, 2027);
  assert.deepEqual(
    g.events.map((e) => [e.label, e.date, e.endDate, e.kind]),
    [
      ["出願期間", "2026-07-01", "2026-07-07", "deadline"],
      ["試験日", "2026-08-20", null, "exam"],
      ["倒置", "2026-09-10", null, "other"],
    ],
  );
  assert.equal(parseGuideReply("没有 JSON"), null);
});

test("eventsChanged 与顺序无关", () => {
  const a: GuideEvent[] = [
    { label: "出願", date: "2026-07-01", endDate: "2026-07-07", kind: "deadline" },
    { label: "試験", date: "2026-08-20", kind: "exam" },
  ];
  assert.equal(eventsChanged(a, [...a].reverse()), false);
  assert.equal(eventsChanged(a, [{ ...a[0], endDate: "2026-07-08" }, a[1]]), true);
});

test("projectGuide：往年要项顺延一年为仮，当年要项为正式", () => {
  const guide = {
    schoolId: "s1",
    schoolName: "東京大学 教育学研究科",
    admissionYear: 2026,
    events: [
      { label: "出願期間", date: "2025-07-01", endDate: "2025-07-07", kind: "deadline" as const },
      { label: "試験日", date: "2025-08-20", kind: "exam" as const },
    ],
  };
  const old = projectGuide(guide, "2026-03-01");
  assert.equal(old.tentative, true);
  assert.equal(old.items[0].date, "2026-07-01");
  assert.equal(old.items[0].endDate, "2026-07-07");
  assert.ok(old.items[0].note?.includes("仮・基于 2026 年度"));
  assert.equal(old.items[1].title, "東京大学 教育学研究科 試験日");

  const current = projectGuide(guide, "2025-08-01");
  assert.equal(current.tentative, false);
  assert.equal(current.items[1].date, "2025-08-20");
  // 刚结束一周内仍算当年
  assert.equal(projectGuide(guide, "2025-08-25").tentative, false);
});

test("assertPublicUrl 拒绝内网地址", () => {
  assert.equal(assertPublicUrl("https://www.u-tokyo.ac.jp/ja/admissions/").hostname, "www.u-tokyo.ac.jp");
  for (const bad of ["http://localhost:3000", "http://db:5432", "http://169.254.169.254/latest", "http://10.0.0.5/", "ftp://example.ac.jp", "not a url"]) {
    assert.throws(() => assertPublicUrl(bad), bad);
  }
});

test("要项全文的链接：AI 给的必须在页面上，否则按链接文字找，PDF 优先", () => {
  const links = [
    { text: "入試案内", url: "https://example.ac.jp/admission/guide.html" },
    { text: "学生募集要項（PDF）", url: "https://example.ac.jp/files/boshu.pdf" },
    { text: "ニュース", url: "https://example.ac.jp/news" },
  ];
  assert.equal(guideDocumentUrl("https://example.ac.jp/admission/guide.html", links), "https://example.ac.jp/admission/guide.html");
  assert.equal(guideDocumentUrl("https://evil.example/x.pdf", links), "https://example.ac.jp/files/boshu.pdf");
  assert.equal(guideDocumentUrl(null, links.slice(0, 1)), "https://example.ac.jp/admission/guide.html");
  assert.equal(guideDocumentUrl(null, links.slice(2)), null);
});

test("入试要点：缺考试科目或联系要求时再读全文，全文优先、页面补缺", () => {
  const page = { contact: null, contactNote: null, subjects: [], english: "TOEFL 代替英语笔试", japanese: null, toefl: 80, toeic: null, ielts: null, jlpt: null, notes: null };
  assert.equal(requirementsIncomplete(page), true);
  assert.equal(requirementsIncomplete(null), true);
  const detail = { ...page, contact: "required" as const, contactNote: "出愿前须取得指导教员内诺", subjects: ["专业笔试", "口试"], english: null, toefl: null };
  const merged = mergeRequirements(page, detail)!;
  assert.equal(merged.contact, "required");
  assert.deepEqual(merged.subjects, ["专业笔试", "口试"]);
  assert.equal(merged.english, "TOEFL 代替英语笔试");
  assert.equal(merged.toefl, 80);
  assert.equal(requirementsIncomplete(merged), false);
  assert.equal(mergeRequirements(null, detail), detail);
  assert.equal(mergeRequirements(page, null), page);
});

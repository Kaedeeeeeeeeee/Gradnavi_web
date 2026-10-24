import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cellsFromSegments,
  describeForm,
  detectHandwriting,
  fitText,
  mergeAiFields,
  parseAiFill,
  parsePages,
  pendingCount,
  resolveTarget,
  type FormLayout,
} from "../forms";

// 一份测试用入学願書的版面（Chromium 生成的表格，从 PDF 里读出来的文字和格子）
const layout: FormLayout = JSON.parse(readFileSync(new URL("./fixtures/form-layout.json", import.meta.url), "utf8"));
const text = (s: string) => layout.texts.find((t) => t.text === s)!;
const cellRightOf = (label: string) => {
  const l = layout.cells.find((c) => c.text === label)!;
  return layout.cells.find((c) => Math.abs(c.y - l.y) < 2 && Math.abs(c.x - (l.x + l.w)) < 2)!;
};

test("表格线算出格子：两行两列的表得到四格，套在大框里的小格也能分出来", () => {
  const seg = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
  const cells = cellsFromSegments([seg(0, 0, 200, 0), seg(0, 20, 200, 20), seg(0, 40, 200, 40), seg(0, 0, 0, 40), seg(80, 0, 80, 40), seg(200, 0, 200, 40)]);
  assert.equal(cells.length, 4);
  assert.deepEqual(
    cells.map((c) => [c.x, c.y, c.w, c.h]).sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    [
      [0, 0, 80, 20],
      [80, 0, 120, 20],
      [0, 20, 80, 20],
      [80, 20, 120, 20],
    ],
  );
  // 线段分几截画、有一点误差也算同一条线
  const broken = cellsFromSegments([seg(0, 0, 50, 0), seg(50, 0.5, 100, 0.5), seg(0, 30, 100, 30), seg(0, 0, 0, 30), seg(100, 0, 100, 30)]);
  assert.equal(broken.length, 1);
});

test("测试願書读出了标题格和右边的空格子", () => {
  assert.equal(cellRightOf("氏名").text, "");
  assert.equal(cellRightOf("フリガナ").text, "");
  assert.equal(cellRightOf("性別").text, "男 ・ 女");
});

test("AI 的位置描述换算成框：格子、年月日前面、圈选项、文字右边", () => {
  const name = resolveTarget({ cell: cellRightOf("氏名").id }, layout)!;
  assert.equal(name.kind, "text");
  assert.ok(name.w > 300);

  const nen = text("年");
  const year = resolveTarget({ text: nen.id, before: "年" }, layout)!;
  assert.equal(year.align, "right");
  assert.ok(year.x + year.w <= nen.x, "写在「年」的左边");
  const tsuki = layout.texts.find((t) => t.text === "月" && t.page === nen.page && Math.abs(t.y - nen.y) < 2)!;
  const month = resolveTarget({ text: tsuki.id, before: "月" }, layout)!;
  assert.ok(month.x >= nen.x + nen.w, "月前面的数字不盖住「年」");

  const male = resolveTarget({ text: text("男").id, circle: "男" }, layout)!;
  assert.equal(male.kind, "mark");
  assert.equal(male.mark, "circle");

  const zip = resolveTarget({ text: text("〒").id, place: "right" }, layout)!;
  const cell = cellRightOf("現住所");
  assert.ok(zip.x > text("〒").x && zip.x + zip.w <= cell.x + cell.w, "到格子右边为止");

  assert.equal(resolveTarget({ cell: "c999" }, layout), null);
  assert.equal(resolveTarget({ text: text("男").id, before: "年" }, layout), null);
});

test("扫描版的千分比坐标换成点", () => {
  const b = resolveTarget({ page: 1, box: [100, 100, 500, 50] }, layout)!;
  assert.equal(Math.round(b.x), Math.round(layout.pages[0].w / 10));
  assert.equal(b.page, 0);
  assert.equal(resolveTarget({ page: 5, box: [0, 0, 10, 10] }, layout), null);
});

test("AI 填的都是提议；再填一次只改有变化的栏，用户已接受的值不动", () => {
  let n = 0;
  const id = () => `f${++n}`;
  const first = mergeAiFields(
    [],
    [
      { label: "氏名", target: { cell: cellRightOf("氏名").id }, value: "張 偉" },
      { label: "性別", target: { text: text("男").id, circle: "男" }, value: "✓" },
      { label: "国籍", target: { cell: cellRightOf("国籍").id }, value: "" },
      { label: "写错的", target: { cell: "c999" }, value: "x" },
    ],
    layout,
    id,
  );
  assert.equal(first.fields.length, 3, "国籍不知道也留一栏，写错位置的跳过");
  assert.equal(first.skipped, 1);
  assert.equal(first.changed, 2);
  assert.equal(pendingCount(first.fields), 2);
  assert.ok(first.fields.every((f) => f.value === ""), "还没接受，什么都不印");

  // 用户接受了姓名
  const accepted = first.fields.map((f) => (f.label === "氏名" ? { ...f, value: f.proposed!, proposed: null } : f));
  const again = mergeAiFields(
    accepted,
    [
      { field: accepted[0].id, value: "張 偉" },
      { label: "国籍", target: { cell: cellRightOf("国籍").id }, value: "中華人民共和国" },
    ],
    layout,
    id,
  );
  assert.equal(again.fields.length, 3, "同一个位置不会多出一栏");
  assert.equal(again.fields[0].proposed, null, "和已接受的一样，不算提议");
  assert.equal(again.fields.find((f) => f.label === "国籍")!.proposed, "中華人民共和国");
});

test("解析 AI 的 JSON：包在代码块里、数字和布尔值也能用", () => {
  const r = parseAiFill('好的：\n```json\n{"handwriting":{"required":true,"reason":"原則手書き"},"fields":[{"label":"年","target":{"text":"t9","before":"年"},"value":2001},{"label":"男","target":{"acro":"a1"},"value":true}],"missing":[{"label":"電話","question":"电话号码？"}],"summary":"填了 2 栏"}\n```');
  assert.ok(r);
  assert.equal(r.handwriting?.required, true);
  assert.equal(r.fields[0].value, "2001");
  assert.equal(r.fields[1].value, "✓");
  assert.equal(r.missing[0].label, "電話");
  assert.equal(parseAiFill("不是 JSON"), null);
});

test("字号：单行按格子的高和宽取小，长内容多行时缩小到放得下", () => {
  assert.equal(fitText("張 偉", { x: 0, y: 0, w: 300, h: 30 }).size, 10.5);
  const narrow = fitText("zhangwei2001@example.com", { x: 0, y: 0, w: 72, h: 17 });
  assert.ok(narrow.size < 6);
  const long = "日本の地方自治体における多文化共生政策の展開と課題".repeat(4);
  const m = fitText(long, { x: 0, y: 0, w: 370, h: 25 }, true);
  assert.ok(m.size < 10.5 && m.lines * m.size * 1.25 <= 25);
});

test("表上写着手写要求时认出来", () => {
  const hw = detectHandwriting("令和9年度 入学願書 ※原則として本人が黒のボールペンで手書きしてください。 フリガナ 氏名");
  assert.equal(hw?.required, true);
  assert.equal(hw?.reason, "表上写着「原則として本人が黒のボールペンで手書きしてください。」");
  assert.equal(detectHandwriting("パソコンで入力してもよい"), null);
});

test("页码范围", () => {
  assert.deepEqual(parsePages("12-13", 40), [11, 12]);
  assert.deepEqual(parsePages("3, 5，1", 4), [0, 2]);
  assert.deepEqual(parsePages(undefined, 4), []);
});

test("给 AI 看的申请表状况写明待确认的提议和参照版", () => {
  const t = describeForm({
    id: "x",
    title: "研究生出願票",
    sourceUrl: null,
    mode: "overlay",
    handwriting: { required: true, reason: "原則手書き" },
    fields: [{ id: "f1", page: 0, x: 0, y: 0, w: 10, h: 10, label: "氏名", kind: "text", value: "", proposed: "張 偉" }],
  });
  assert.match(t, /参照版/);
  assert.match(t, /AI 提议「張 偉」待用户确认/);
});

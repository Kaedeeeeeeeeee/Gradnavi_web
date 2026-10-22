import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, formatDate, isIsoDate, itemsOn, monthGrid, overlaps, parseMonth, shiftMonth, shiftYears, todayJst, type CalendarItem } from "../calendar";

test("isIsoDate 拒绝不存在的日期", () => {
  assert.equal(isIsoDate("2026-02-28"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026/02/01"), false);
  assert.equal(isIsoDate(null), false);
});

test("todayJst 按日本时间换日", () => {
  assert.equal(todayJst(new Date("2026-10-21T14:59:00Z")), "2026-10-21");
  assert.equal(todayJst(new Date("2026-10-21T15:00:00Z")), "2026-10-22");
});

test("日期加减与跨年", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftYears("2025-07-10", 1), "2026-07-10");
  assert.equal(shiftYears("2024-02-29", 1), "2025-02-28");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(parseMonth("2026-13", "2026-10-21"), "2026-10");
  assert.equal(parseMonth("2027-02", "2026-10-21"), "2027-02");
});

test("monthGrid 从周一开始、整周补齐", () => {
  const weeks = monthGrid("2026-10"); // 2026-10-01 是周四
  assert.equal(weeks[0][0].date, "2026-09-28");
  assert.equal(weeks[0][3].date, "2026-10-01");
  assert.equal(weeks[0][0].inMonth, false);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks.at(-1)![6].date, "2026-11-01");
});

test("跨天日程在区间内每天都显示", () => {
  const items: CalendarItem[] = [{ key: "a", source: "event", title: "出願", date: "2026-11-02", endDate: "2026-11-06", kind: "deadline" }];
  assert.equal(itemsOn(items, "2026-11-04").length, 1);
  assert.equal(itemsOn(items, "2026-11-07").length, 0);
  assert.equal(overlaps("2026-10-30", "2026-11-02", "2026-11-01", "2026-11-30"), true);
  assert.equal(overlaps("2026-10-30", null, "2026-11-01", "2026-11-30"), false);
});

test("formatDate：全站统一的「10/24 周六」，不是今年的带年份", () => {
  assert.equal(formatDate("2026-10-24", "2026-10-22"), "10/24 周六");
  assert.equal(formatDate("2027-01-15", "2026-10-22"), "2027/1/15 周五");
});

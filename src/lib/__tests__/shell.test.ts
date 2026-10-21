import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPreset,
  closeTab,
  collapsePane,
  currentPreset,
  DEFAULT_LAYOUT,
  EMPTY_TABS,
  expandPane,
  MAX_TABS,
  withoutDoc,
  openTab,
  parseLayout,
  parseTabs,
  serializeLayout,
  serializeTabs,
  type DocTab,
} from "../shell";

const doc = (id: string): DocTab => ({ kind: "doc", id, title: `文书 ${id}` });

test("布局预设", () => {
  assert.equal(currentPreset(DEFAULT_LAYOUT, true), "three");
  const chat = applyPreset(DEFAULT_LAYOUT, "chatDoc", "work");
  assert.deepEqual(chat.collapsed, { work: true, doc: false, ai: false });
  assert.equal(currentPreset(chat, true), "chatDoc");
  const focus = applyPreset(DEFAULT_LAYOUT, "focus", "ai");
  assert.deepEqual(focus.collapsed, { work: true, doc: true, ai: false });
  assert.equal(currentPreset(focus, true), "focus");
  assert.equal(currentPreset(applyPreset(focus, "three", "work"), true), "three");
});

test("最后一栏不能收起；展开时窄屏切到这一栏", () => {
  const focus = applyPreset(DEFAULT_LAYOUT, "focus", "doc");
  assert.equal(collapsePane(focus, "doc", true), focus);
  const two = collapsePane(DEFAULT_LAYOUT, "work", true);
  assert.equal(two.collapsed.work, true);
  const back = expandPane(two, "work");
  assert.equal(back.collapsed.work, false);
  assert.equal(back.mobile, "work");
});

test("标签：打开、重复打开、上限、关闭", () => {
  let s = openTab(EMPTY_TABS, doc("a"));
  s = openTab(s, doc("b"));
  assert.equal(s.active, "doc:b");
  s = openTab(s, { ...doc("a"), title: "新标题" });
  assert.equal(s.tabs.length, 2);
  assert.equal(s.active, "doc:a");
  assert.equal(s.tabs[0].title, "新标题");
  s = closeTab(s, "doc:a");
  assert.deepEqual(s, { tabs: [doc("b")], active: "doc:b" });
  assert.deepEqual(closeTab(s, "doc:b"), EMPTY_TABS);
  for (let i = 0; i < MAX_TABS + 2; i++) s = openTab(s, doc(String(i)));
  assert.equal(s.tabs.length, MAX_TABS);
  assert.equal(s.active, `doc:${MAX_TABS + 1}`);
});

test("cookie 读写；坏数据退回默认", () => {
  const s = openTab(EMPTY_TABS, { kind: "web", url: "https://example.ac.jp/a?b=1;c", title: "研究室" });
  assert.deepEqual(parseTabs(serializeTabs(s)), s);
  const layout = applyPreset(DEFAULT_LAYOUT, "chatDoc", "work");
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout);
  assert.deepEqual(parseLayout("%7Bbad"), DEFAULT_LAYOUT);
  assert.deepEqual(parseLayout(serializeLayout({ ...layout, collapsed: { work: true, doc: true, ai: true } })), DEFAULT_LAYOUT);
  assert.deepEqual(parseTabs(undefined), EMPTY_TABS);
  assert.equal(parseTabs(serializeTabs({ tabs: [doc("a")], active: "doc:zzz" })).active, null);
});

test("没有文稿时只有两栏", () => {
  assert.equal(currentPreset(DEFAULT_LAYOUT, false), "three");
  // 只剩 AI 展开 = 专注；工作台不能再收起
  const aiOnly = collapsePane(DEFAULT_LAYOUT, "work", false);
  assert.equal(currentPreset(aiOnly, false), "focus");
  assert.equal(collapsePane(aiOnly, "ai", false), aiOnly);
  // 专注在文稿上时关掉最后一个标签：回到两栏，窄屏回到工作台
  const docFocus = applyPreset(DEFAULT_LAYOUT, "focus", "doc");
  const after = withoutDoc(docFocus);
  assert.deepEqual(after.collapsed, { work: false, doc: false, ai: false });
  assert.equal(after.mobile, "work");
  assert.deepEqual(parseLayout(serializeLayout(docFocus), false), after);
});

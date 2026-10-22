import assert from "node:assert/strict";
import { test } from "node:test";
import { splitLinks } from "../links";

test("子步骤里的网址拆成链接，句末标点不算进去", () => {
  assert.deepEqual(splitLinks("用表单事前登记：https://ludixlab.net/ja/?p=5437 。"), [
    { text: "用表单事前登记：" },
    { url: "https://ludixlab.net/ja/?p=5437" },
    { text: " 。" },
  ]);
  assert.deepEqual(splitLinks("见 https://a.jp/x.pdf，再看（https://b.jp）"), [
    { text: "见 " },
    { url: "https://a.jp/x.pdf" },
    { text: "，再看（" },
    { url: "https://b.jp" },
    { text: "）" },
  ]);
  assert.deepEqual(splitLinks("准备 1 分钟自我介绍"), [{ text: "准备 1 分钟自我介绍" }]);
});

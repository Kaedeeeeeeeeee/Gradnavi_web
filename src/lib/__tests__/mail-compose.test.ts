import assert from "node:assert/strict";
import { test } from "node:test";
import { MAILTO_LIMIT, composeLink, isEmail, splitLetter } from "../mail-compose";

test("第一行「件名：」拆成标题，其余是正文", () => {
  assert.deepEqual(splitLetter("件名：研究生受け入れのお願い（張）\n\n東京大学\n山田 先生\n\n本文"), {
    subject: "研究生受け入れのお願い（張）",
    body: "東京大学\n山田 先生\n\n本文",
  });
  assert.deepEqual(splitLetter("\n件名: Hello\n本文"), { subject: "Hello", body: "本文" });
  assert.deepEqual(splitLetter("山田 先生\n本文"), { subject: "", body: "山田 先生\n本文" });
});

test("邮箱格式", () => {
  assert.ok(isEmail(" yamada@u-tokyo.ac.jp "));
  assert.ok(!isEmail("yamada"));
  assert.ok(!isEmail("a@b"));
});

test("mailto 带收件人、标题、正文，换行写成 CRLF", () => {
  const { url, prefilled } = composeLink("default", { to: "yamada@u-tokyo.ac.jp", subject: "お願い", body: "先生\n本文" });
  assert.equal(prefilled, "all");
  assert.equal(url, `mailto:yamada@u-tokyo.ac.jp?subject=${encodeURIComponent("お願い")}&body=${encodeURIComponent("先生\r\n本文")}`);
});

test("没有收件人也能打开", () => {
  assert.match(composeLink("default", { to: "", subject: "", body: "x" }).url, /^mailto:\?body=x$/);
});

test("正文太长时只带收件人和标题", () => {
  const body = "研".repeat(MAILTO_LIMIT);
  const r = composeLink("default", { to: "a@b.jp", subject: "件", body });
  assert.equal(r.prefilled, "no-body");
  assert.equal(r.url, `mailto:a@b.jp?subject=${encodeURIComponent("件")}`);
});

test("网页邮箱链接", () => {
  const mail = { to: "a@b.jp", subject: "S", body: "B" };
  assert.equal(composeLink("gmail", mail).url, "https://mail.google.com/mail/?view=cm&fs=1&to=a%40b.jp&su=S&body=B");
  assert.equal(composeLink("outlook", mail).url, "https://outlook.live.com/mail/0/deeplink/compose?to=a%40b.jp&subject=S&body=B");
  assert.deepEqual(composeLink("qq", mail), { url: "https://mail.qq.com/", prefilled: "none" });
});

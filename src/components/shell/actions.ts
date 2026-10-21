"use server";

import { assertPublicUrl } from "@/lib/admissions";
import { requireUser } from "@/lib/session";

/**
 * 外部网页能不能嵌进文稿栏：很多网站用 X-Frame-Options / CSP frame-ancestors 禁止被嵌入，
 * 浏览器那边看不到原因（只显示空白），所以由服务器先看一眼响应头。只取响应头，不读正文。
 */
export async function probeFrameAction(url: string): Promise<"ok" | "blocked" | "unknown"> {
  await requireUser();
  try {
    assertPublicUrl(url);
  } catch {
    return "blocked";
  }
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; GradNaviBot/1.0)" } });
    await res.body?.cancel();
    const xfo = res.headers.get("x-frame-options")?.toLowerCase() ?? "";
    if (xfo.includes("deny") || xfo.includes("sameorigin")) return "blocked";
    const ancestors = /frame-ancestors([^;]*)/i.exec(res.headers.get("content-security-policy") ?? "")?.[1]?.trim();
    if (ancestors !== undefined && !ancestors.split(/\s+/).includes("*")) return "blocked";
    return "ok";
  } catch {
    return "unknown";
  }
}

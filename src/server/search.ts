import "server-only";
import type { UsageMeter } from "@/lib/credits";
import { env } from "@/lib/env";
import { parseSearchResponse, type SearchResult } from "@/lib/search";

// DeepSeek 检索 / 抓取服务（POST {DEEPSEEK_TOOLS_URL}/search、/fetch，和对话共用 API key）。
// 按成功请求计费（约 $0.75 / 千次），失败和空结果不计费。限流 5 次/秒，429 时稍等重试一次。
// ⚠️ 接口刚开放、文档里字段名不全，这里对返回格式做了宽松解析；接上真实 key 后核对一次。

const TIMEOUT_MS = 20_000;

async function call(path: "search" | "fetch", body: unknown): Promise<unknown> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("演示模式下无法联网检索（服务器未配置 DEEPSEEK_API_KEY）");
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${env.DEEPSEEK_TOOLS_URL}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (!res.ok) throw new Error(`检索服务出错（HTTP ${res.status}）`);
    return res.json();
  }
  throw new Error("检索服务繁忙，请稍后再试");
}

/** meter：传入时记一次检索调用，用于 credit 计费和成本统计 */
export async function webSearch(query: string, count = 8, meter?: UsageMeter): Promise<SearchResult[]> {
  const json = await call("search", { query, count });
  meter?.addSearch();
  return parseSearchResponse(json);
}

const FETCH_LIMIT = 15_000;

/** 抓取网页正文（Markdown），截断以控制 token */
export async function fetchPage(url: string, meter?: UsageMeter): Promise<{ url: string; content: string }> {
  if (!/^https?:\/\//.test(url)) throw new Error("只支持 http(s) 链接");
  const json = (await call("fetch", { url })) as Record<string, unknown>;
  meter?.addFetch();
  const data = (json.data && typeof json.data === "object" ? json.data : json) as Record<string, unknown>;
  const content = [data.content, data.markdown, data.text].find((v): v is string => typeof v === "string" && v.length > 0);
  if (!content) throw new Error("没有抓到页面内容");
  return { url, content: content.length > FETCH_LIMIT ? `${content.slice(0, FETCH_LIMIT)}\n\n（后文省略）` : content };
}

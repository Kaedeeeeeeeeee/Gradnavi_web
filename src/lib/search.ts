// 检索服务返回格式的解析（纯函数，便于测试）

export type SearchResult = { title: string; url: string; snippet: string; date?: string; site?: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 返回体里的结果数组可能叫 results / data / items，也可能再包一层 data */
export function parseSearchResponse(json: unknown): SearchResult[] {
  const obj = (json ?? {}) as Record<string, unknown>;
  const inner = (obj.data && !Array.isArray(obj.data) ? obj.data : obj) as Record<string, unknown>;
  const list = [inner.results, inner.data, inner.items, obj.results].find(Array.isArray) as unknown[] | undefined;
  return (list ?? []).flatMap((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const url = str(r.url) || str(r.link);
    if (!/^https?:\/\//.test(url)) return [];
    return [
      {
        title: str(r.title) || url,
        url,
        snippet: (str(r.summary) || str(r.snippet) || str(r.content)).slice(0, 800),
        date: str(r.date) || undefined,
        site: str(r.site_name) || undefined,
      },
    ];
  });
}

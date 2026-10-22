// 任务「待你确认」时，详情页最上面列出 AI 在这个任务的对话里做了什么（来自工具调用记录，不调 AI）。
// 每条带一个可以打开的对象（文书、志愿、日历），用户不用自己去找结果。

export type ToolCallRecord = { toolName: string; input: unknown; output: unknown; ok: boolean };

export type ReportLink = { kind: "doc"; id: string; title: string } | { kind: "professor"; id: string; title: string } | { kind: "page"; href: string; title: string };

export type ReportItem = { text: string; link?: ReportLink };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const fmt = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 把一段对话里成功的工具调用整理成「AI 做了什么」，同一份文书 / 同一位教授只列一次 */
export function summarizeToolCalls(calls: ToolCallRecord[]): ReportItem[] {
  const docs = new Map<string, { title: string; created: boolean; drafts: string[] }>();
  const items: ReportItem[] = [];
  const seen = new Set<string>();
  const push = (key: string, item: ReportItem) => {
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  let searches = 0;
  let readPages = 0;

  for (const c of calls) {
    if (!c.ok) continue;
    const input = obj(c.input);
    const out = obj(c.output);
    switch (c.toolName) {
      case "create_document":
      case "create_tailored_copy":
      case "update_document_section":
      case "replace_document_text":
      case "update_document":
      case "propose_outline": {
        const id = str(out.id) ?? str(input.id) ?? str(input.documentId);
        if (!id) break;
        const d = docs.get(id) ?? { title: str(out.title) ?? "文书", created: false, drafts: [] };
        if (str(out.title)) d.title = str(out.title)!;
        if (c.toolName === "create_document" || c.toolName === "create_tailored_copy") d.created = true;
        const what = str(out.summary) ?? str(input.heading) ?? (c.toolName === "propose_outline" ? "提纲" : null);
        if (what && !d.drafts.includes(what)) d.drafts.push(what);
        docs.set(id, d);
        if (!seen.has(`doc:${id}`)) push(`doc:${id}`, { text: "", link: { kind: "doc", id, title: d.title } });
        break;
      }
      case "save_professor": {
        const id = str(out.id);
        if (id) push(`prof:${id}`, { text: `把${str(out.name) ?? ""}教授加进了志愿`, link: { kind: "professor", id, title: str(out.name) ?? "教授" } });
        break;
      }
      case "update_saved_professor": {
        const id = str(input.id) ?? str(out.id);
        if (id) push(`prof-up:${id}`, { text: `更新了${str(out.name) ?? "志愿里教授"}的信息`, link: { kind: "professor", id, title: str(out.name) ?? "教授" } });
        break;
      }
      case "add_calendar_event":
        push(`ev:${str(out.id)}`, { text: `提议了日程「${str(out.title) ?? str(input.title) ?? ""}」${str(out.date) ? `（${fmt(str(out.date)!)}）` : ""}，在主页等你同意`, link: { kind: "page", href: "/workbench", title: "主页" } });
        break;
      case "add_todos": {
        const n = Array.isArray(out.proposed) ? out.proposed.length : 0;
        if (n) push(`todos:${items.length}`, { text: `提议了 ${n} 个新任务，在主页等你同意`, link: { kind: "page", href: "/workbench", title: "主页" } });
        break;
      }
      case "watch_school":
        push(`school:${str(out.id)}`, { text: `关注了${str(out.name) ?? "研究科"}，系统会盯着它的募集要项`, link: { kind: "page", href: "/aspirations", title: "志愿" } });
        break;
      case "update_school_requirements":
        push("req", { text: "记下了研究科的入试要点", link: { kind: "page", href: "/aspirations", title: "志愿" } });
        break;
      case "update_user_md":
        push("usermd", { text: "把了解到的情况记进了「AI 对你的了解」", link: { kind: "page", href: "/profile", title: "AI 对你的了解" } });
        break;
      case "web_search":
        searches++;
        break;
      case "fetch_page":
        readPages++;
        break;
    }
  }

  for (const it of items) {
    if (it.link?.kind !== "doc") continue;
    const d = docs.get(it.link.id)!;
    it.link.title = d.title;
    const drafts = d.drafts.length ? `（${d.drafts.slice(0, 3).join("、")}${d.drafts.length > 3 ? " 等" : ""}）` : "";
    it.text = `${d.created ? "新建了" : "修改了"}「${d.title}」${drafts}`;
  }
  if (searches || readPages) items.unshift({ text: `查了资料（检索 ${searches} 次，读了 ${readPages} 个网页）` });
  return items;
}

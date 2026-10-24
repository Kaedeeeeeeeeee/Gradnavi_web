// 前端可用的工具元信息（不含执行逻辑）：侧边栏据此显示中文名、决定是否刷新页面数据
export const TOOL_META: Record<string, { label: string; mutates: boolean }> = {
  read_user_md: { label: "读取 user.md", mutates: false },
  update_user_md: { label: "记住了你的信息", mutates: true },
  list_todos: { label: "查看任务", mutates: false },
  add_todos: { label: "提议任务", mutates: true },
  update_todo: { label: "更新任务", mutates: true },
  list_documents: { label: "查看文书列表", mutates: false },
  read_document: { label: "读取文书", mutates: false },
  create_document: { label: "新建文书", mutates: true },
  update_document_section: { label: "起草了一节（待你确认）", mutates: true },
  replace_document_text: { label: "提出修改（待你确认）", mutates: true },
  update_document: { label: "修改文书", mutates: true },
  propose_outline: { label: "列出提纲（待你确认）", mutates: true },
  create_tailored_copy: { label: "复制定制版", mutates: true },
  fill_application_form: { label: "填写了申请表（待你确认）", mutates: true },
  refill_application_form: { label: "重新填写了申请表（待你确认）", mutates: true },
  update_application_form: { label: "提议了申请表内容（待你确认）", mutates: true },
  read_application_form: { label: "查看申请表", mutates: false },
  list_application_forms: { label: "查看申请表列表", mutates: false },
  search_professors: { label: "找教授", mutates: true },
  list_aspirations: { label: "查看志愿", mutates: false },
  save_professor: { label: "加入志愿", mutates: true },
  update_saved_professor: { label: "更新志愿里的教授", mutates: true },
  update_school_requirements: { label: "记下入试要点", mutates: true },
  web_search: { label: "联网检索", mutates: false },
  fetch_page: { label: "读取网页", mutates: false },
  delete_todo: { label: "删除任务", mutates: true },
  list_calendar: { label: "查看日历", mutates: false },
  add_calendar_event: { label: "提议日程", mutates: true },
  update_calendar_event: { label: "修改日程", mutates: true },
  delete_calendar_event: { label: "删除日程", mutates: true },
  list_watched_schools: { label: "查看志愿里的研究科", mutates: false },
  watch_school: { label: "关注研究科", mutates: true },
  unwatch_school: { label: "取消关注研究科", mutates: true },
};

const str = (v: unknown, key: string) => {
  const x = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  return typeof x === "string" ? x.trim() : "";
};

/**
 * AI 回复里工具调用的进度标签文字。进行中说清在做什么（如「正在找教授（東京大学 · シリアスゲーム）」），
 * 完成后说结果（如「找到 5 位教授」）。返回 null = 不显示（如重复调用被跳过）。
 */
export function toolChipText(name: string, state: "running" | "done" | "failed", input: unknown, output?: unknown): string | null {
  const meta = TOOL_META[name];
  // 没登记中文名的工具（新加的忘了登记，或者页面还是旧版本）不把变量名显示出来
  if (!meta) return state === "running" ? "正在处理" : state === "failed" ? "有一步没成功" : "处理完了一步";
  const label = meta.label;
  if (state === "failed") return `${label}没成功`;
  if (name === "search_professors") {
    const schools = input && typeof input === "object" && Array.isArray((input as { schools?: unknown }).schools) ? ((input as { schools: unknown[] }).schools.filter((s) => typeof s === "string") as string[]) : [];
    const scope = [schools.join("、"), str(input, "keywords")].filter(Boolean).join(" · ");
    if (state === "running") return `正在找教授${scope ? `（${scope}）` : ""}`;
    if (output && typeof output === "object" && (output as { skipped?: unknown }).skipped) return null;
    const list = output && typeof output === "object" ? (output as { candidates?: unknown }).candidates : undefined;
    const n = Array.isArray(list) ? list.length : 0;
    return n ? `找到 ${n} 位教授` : "这一轮没找到合适的教授";
  }
  if (name === "web_search") {
    const q = str(input, "query");
    return state === "running" ? `正在联网检索${q ? `「${q.slice(0, 30)}」` : ""}` : `联网检索${q ? `「${q.slice(0, 30)}」` : ""}`;
  }
  if (name === "fetch_page") return state === "running" ? "正在读取网页" : "读了网页";
  if (name === "fill_application_form" || name === "refill_application_form") {
    if (state === "running") return name === "fill_application_form" ? "正在下载并填写申请表" : "正在重新填写申请表";
    const n = output && typeof output === "object" ? (output as { pendingTotal?: unknown }).pendingTotal : undefined;
    return typeof n === "number" && n > 0 ? `填好了申请表，${n} 栏待你确认` : "填好了申请表";
  }
  if (state === "running") return `正在${label.replace(/了|（待你确认）/g, "")}`;
  return label;
}

/** 一串只读工具调用（检索、读网页、查看志愿……）折叠成一行时的摘要，如「检索 9 次，读了 1 个网页，查看志愿」 */
export function toolGroupSummary(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts]
    .map(([n, c]) => {
      if (n === "web_search") return `检索 ${c} 次`;
      if (n === "fetch_page") return `读了 ${c} 个网页`;
      const label = TOOL_META[n]?.label ?? "其他操作";
      return c > 1 ? `${label} ${c} 次` : label;
    })
    .join("，");
}

type PartLike = { type: string; text?: string };

const isTool = (p: PartLike) => p.type.startsWith("tool-") || p.type === "dynamic-tool";

/**
 * AI 这轮没写出结论就结束了：最后一步还在调用工具（步数用完、被停止或出错时循环被打断），或者整轮一个字都没写。
 * 这时提示用户并给「继续」，不让对话停在一串工具标签上没有下文。
 */
export function endedWithoutAnswer(parts: PartLike[]): boolean {
  if (!parts.some((p) => p.type === "text" && p.text?.trim())) return true;
  const lastStep = parts.slice(parts.findLastIndex((p) => p.type === "step-start") + 1);
  return lastStep.some(isTool);
}

// 一轮对话给 AI 多少步：按这轮在做什么自动定，用户不用选「思考强度」。
// 一步 = 模型想一次（可以同时调用好几个工具）。最后一步不给工具，只写总结；
// 另外查不出新东西、或时间太长时提前进入总结，见 shouldWrapUp。

export type TurnKind = "chat" | "write" | "professors" | "guide" | "school" | "compare";

/** 每类工作的步数上限（含最后写总结的那一步） */
export const STEP_BUDGET: Record<TurnKind, number> = {
  // 普通问答、商量下一步
  chat: 6,
  // 改文书的一节、写套磁信
  write: 10,
  // 找教授（search_professors 内部还会查十几次）
  professors: 10,
  // 读一份募集要项：页面已知，主要是读和整理，有时再看一个附件
  guide: 6,
  // 查研究科怎么考：找入试页 → 读 → 找要项 PDF → 读 → 记下要点
  school: 10,
  // 对比几所学校：每所都要走一遍「查研究科怎么考」
  compare: 25,
};

/** 一轮最长时间，到了就进入总结 */
export const TURN_TIME_LIMIT_MS = 5 * 60_000;

/** 连续几步检索都没查到新网页，就提前总结 */
export const STALE_STEPS = 2;

export type TurnContext = {
  /** 任务对话的流程任务类型（stepKey 里的 school / plan / letter …） */
  taskStep?: string | null;
  taskTitle?: string | null;
  /** 文稿栏 / 工作台当前页面 */
  pagePath?: string | null;
  workPath?: string | null;
  /** 用户这次发的话 */
  userText: string;
};

const COMPARE = /对比|比较|比一比|哪(个|所|一所|边)(研究科|学校|大学)?更?(好|适合|容易)|并排/;
const GUIDE = /募集要[项項]|入试要[项項]|入試要項|出愿材料|出願書類/;
const PROFESSORS = /找(几位|一些|些)?教授|推荐(几位|一些)?教授|换一批教授|再找/;
const WRITE_STEPS = new Set(["write_plan", "plan", "letter", "achievements"]);

export function turnKind(c: TurnContext): TurnKind {
  const text = c.userText;
  const paths = [c.pagePath, c.workPath].filter(Boolean) as string[];
  if (COMPARE.test(text) || paths.some((p) => p.startsWith("/aspirations/compare"))) return "compare";
  if (c.taskStep === "school" || c.taskStep === "application") return "school";
  if (!c.taskStep && c.taskTitle && /^查看「.+」.*募集要项/.test(c.taskTitle)) return "guide";
  if (c.taskStep === "find_professors" || PROFESSORS.test(text)) return "professors";
  if (GUIDE.test(text)) return "guide";
  if ((c.taskStep && WRITE_STEPS.has(c.taskStep)) || paths.some((p) => p.startsWith("/documents/"))) return "write";
  return "chat";
}

/** 流程任务 key（如 prof:<id>:school）里的类型部分 */
export function taskStepOf(stepKey: string | null | undefined): string | null {
  if (!stepKey) return null;
  return stepKey.startsWith("prof:") ? (stepKey.split(":")[2] ?? null) : stepKey;
}

/** 这轮中途调用了某些工具，说明工作比开头判断的重：步数跟着提高 */
export function raisedBudget(budget: number, toolNames: Iterable<string>): number {
  let b = budget;
  for (const n of toolNames) {
    if (n === "search_professors") b = Math.max(b, STEP_BUDGET.professors);
    if (n === "web_search" || n === "fetch_page" || n === "watch_school") b = Math.max(b, STEP_BUDGET.school);
  }
  return b;
}

export type StepTools = { toolName: string; output: unknown }[];

const LOOKUPS = new Set(["web_search", "fetch_page"]);

function urlsOf(t: { toolName: string; output: unknown }): string[] {
  if (t.toolName === "web_search" && Array.isArray(t.output))
    return t.output.flatMap((r) => (r && typeof r === "object" && typeof (r as { url?: unknown }).url === "string" ? [(r as { url: string }).url] : []));
  if (t.toolName === "fetch_page" && t.output && typeof t.output === "object" && typeof (t.output as { url?: unknown }).url === "string")
    return [(t.output as { url: string }).url];
  return [];
}

/** 最后连续几步「只在检索，却没有查到新网页」 */
export function staleStepCount(steps: StepTools[]): number {
  const seen = new Set<string>();
  let stale = 0;
  for (const tools of steps) {
    if (!tools.length || tools.some((t) => !LOOKUPS.has(t.toolName))) {
      stale = 0;
      continue;
    }
    const fresh = tools.flatMap(urlsOf).filter((u) => !seen.has(u));
    fresh.forEach((u) => seen.add(u));
    stale = fresh.length ? 0 : stale + 1;
  }
  return stale;
}

/** 下一步（第 stepNumber 步，从 0 数）是不是该只写总结了 */
export function shouldWrapUp(o: { stepNumber: number; budget: number; elapsedMs: number; steps: StepTools[] }): boolean {
  if (o.stepNumber === 0) return false;
  return o.stepNumber >= o.budget - 1 || o.elapsedMs >= TURN_TIME_LIMIT_MS || staleStepCount(o.steps) >= STALE_STEPS;
}

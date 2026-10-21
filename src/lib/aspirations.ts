// 志愿 = 一位教授 + 教授所在的研究科（也可以只有研究科）。这里是两边信息的对照、差距计算、研究科匹配（纯函数，前后端共用）。

import type { AdmissionRequirements } from "./admissions";
import { CONTACT_RULE_LABELS } from "./admissions";
import type { CalendarItem } from "./calendar";
import { getSection } from "./md-sections";
import type { OnboardingAnswers } from "./onboarding";
import { describeProfessor, PROFESSOR_STATUS_LABELS, type PaperRef, type ProfessorStatus, type SourceLink } from "./professors";

/** 志愿里的教授（页面用） */
export type ProfessorView = {
  id: string;
  name: string;
  university: string;
  department: string | null;
  lab: string | null;
  research: string | null;
  fit: string | null;
  papers: string[];
  paperRefs: PaperRef[];
  acceptsInternational: string | null;
  sources: SourceLink[];
  status: ProfessorStatus;
  note: string | null;
  followUpDate: string | null;
  proposedFollowUp: { date: string | null } | null;
};

/** 志愿里的研究科：入试要点 + 募集要项日程 */
export type SchoolView = {
  id: string;
  university: string;
  name: string;
  url: string;
  requirements: AdmissionRequirements | null;
  checkedAt: string | null;
  pending: boolean;
  problem: string | null;
  guideYear: number | null;
  tentative: boolean;
  deadline: ReturnType<typeof nextDeadline>;
  events: { key: string; title: string; date: string; endDate: string | null; kind: string }[];
};

export type AspirationView = {
  /** prof:<教授 id> 或 school:<研究科 id>（只有研究科的志愿） */
  key: string;
  professor: ProfessorView | null;
  school: SchoolView | null;
  /** 和用户档案对照的差距，如「TOEFL 要求 80，你现在 72」 */
  gaps: string[];
};

/** 用户的语言成绩（从 user.md「语言成绩」一节和问卷答案里读） */
export type Scores = { toefl?: number; toeic?: number; ielts?: number; jlpt?: number };

// 「目标 TOEFL 90」「N1 在备考」这类还没拿到的成绩不算
const NOT_YET = /目标|备考|在考|准备|计划|打算|想考/;

/** 从自由文本里认出成绩。同一项写了多次时取最好的 */
export function parseScores(text: string): Scores {
  const out: Scores = {};
  const best = (key: keyof Scores, v: number, better: (a: number, b: number) => boolean) => {
    if (!Number.isFinite(v)) return;
    if (out[key] === undefined || better(v, out[key]!)) out[key] = v;
  };
  for (const seg of text.split(/[\n；;，,。]/)) {
    if (NOT_YET.test(seg)) continue;
    const toefl = /TOEFL(?:\s*-?\s*iBT)?\s*[:：]?\s*(\d{2,3})/i.exec(seg);
    if (toefl && Number(toefl[1]) <= 120) best("toefl", Number(toefl[1]), (a, b) => a > b);
    const toeic = /TOEIC(?:\s*L&R)?\s*[:：]?\s*(\d{3})/i.exec(seg);
    if (toeic && Number(toeic[1]) <= 990) best("toeic", Number(toeic[1]), (a, b) => a > b);
    const ielts = /IELTS\s*[:：]?\s*(\d(?:\.\d)?)/i.exec(seg);
    if (ielts && Number(ielts[1]) <= 9) best("ielts", Number(ielts[1]), (a, b) => a > b);
    for (const m of seg.matchAll(/(?:JLPT\s*)?N\s*([1-5])(?![0-9])/gi)) best("jlpt", Number(m[1]), (a, b) => a < b);
  }
  return out;
}

/** 用户现在的语言成绩：user.md「语言成绩」一节（AI 会随时更新）+ 旧问卷答案，取最好的 */
export function profileScores(markdown: string, answers?: Pick<OnboardingAnswers, "japanese" | "english"> | null): Scores {
  return parseScores([getSection(markdown, "语言成绩"), answers?.japanese, answers?.english].filter(Boolean).join("\n"));
}

/**
 * 研究科要求和用户成绩的差距，如「TOEFL 要求 80，你现在 72」。
 * 英语任一项达标就不再提英语；没有成绩时提醒还没有。
 */
export function requirementGaps(req: Pick<AdmissionRequirements, "toefl" | "toeic" | "ielts" | "jlpt"> | null, scores: Scores): string[] {
  if (!req) return [];
  const gaps: string[] = [];
  const english: [keyof Scores, string, number | null][] = [
    ["toefl", "TOEFL", req.toefl],
    ["toeic", "TOEIC", req.toeic],
    ["ielts", "IELTS", req.ielts],
  ];
  const required = english.filter(([, , min]) => min !== null);
  if (required.length) {
    const met = required.some(([k, , min]) => scores[k] !== undefined && scores[k]! >= min!);
    if (!met) {
      const have = required.find(([k]) => scores[k] !== undefined);
      if (have) gaps.push(`${have[1]} 要求 ${have[2]}，你现在 ${scores[have[0]]}`);
      else gaps.push(`英语要求 ${required.map(([, label, min]) => `${label} ${min}`).join(" 或 ")}，你还没有成绩`);
    }
  }
  if (req.jlpt !== null) {
    if (scores.jlpt === undefined) gaps.push(`日语要求 N${req.jlpt}，你还没有 JLPT 成绩`);
    else if (scores.jlpt > req.jlpt) gaps.push(`日语要求 N${req.jlpt}，你现在 N${scores.jlpt}`);
  }
  return gaps;
}

const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\s　・·]/g, "")
    .toLowerCase();

/** 「大学院教育学研究科 教育学専攻」→「教育学研究科」 */
function schoolPart(department: string) {
  const d = normalize(department).replace(/^大学院/, "");
  const m = /^(.*?(研究科|学府|学環|学院|研究部|教育部))/.exec(d);
  return m ? m[1] : d;
}

/** 教授的「研究科・専攻」能不能对上一个已有的研究科（同一大学，名称互相包含）。用于收藏教授时自动带出入试信息 */
export function matchSchool<T extends { id: string; university: string; name: string }>(
  p: { university: string; department?: string | null },
  schools: T[],
): T | null {
  if (!p.department) return null;
  const univ = normalize(p.university);
  const dept = schoolPart(p.department);
  if (!dept) return null;
  return (
    schools.find((s) => {
      if (normalize(s.university) !== univ) return false;
      const name = schoolPart(s.name);
      return !!name && (name === dept || name.includes(dept) || dept.includes(name));
    }) ?? null
  );
}

/** 最近的出愿截止（含仮）：出愿期间这类跨天的日程看最后一天 */
export function nextDeadline(items: CalendarItem[], today: string) {
  const it = items.filter((i) => i.kind === "deadline" && (i.endDate ?? i.date) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  return it ? { label: it.title, date: it.endDate ?? it.date, start: it.date, tentative: !!it.tentative, sourceUrl: it.sourceUrl } : null;
}

/** 事先联系：有明确结论时显示结论；没有结论但要项里有相关说法（如「未提及需事先联系」）时显示那句说法 */
export function contactLabel(req: Pick<AdmissionRequirements, "contact" | "contactNote"> | null) {
  if (req?.contact) return CONTACT_RULE_LABELS[req.contact];
  return req?.contactNote || "未查到";
}

export function languageLabel(req: Pick<AdmissionRequirements, "english" | "japanese" | "toefl" | "toeic" | "ielts" | "jlpt"> | null) {
  if (!req) return "未查到";
  const parts = [
    req.english || [req.toefl && `TOEFL ${req.toefl}`, req.toeic && `TOEIC ${req.toeic}`, req.ielts && `IELTS ${req.ielts}`].filter(Boolean).join(" / "),
    req.japanese || (req.jlpt ? `JLPT N${req.jlpt}` : ""),
  ].filter(Boolean);
  return parts.join("；") || "未写明";
}

/** 给 AI 看的研究科这边的要点 */
export function describeRequirements(req: AdmissionRequirements | null) {
  if (!req) return "入试要点：还没查到（可以用 web_search 查募集要项，再用 update_school_requirements 记下来）";
  return [
    `事先联系：${contactLabel(req)}${req.contact && req.contactNote ? `（${req.contactNote}）` : ""}`,
    `考试科目：${req.subjects.join("、") || "未写明"}`,
    `语言：${languageLabel(req)}`,
    req.notes ? `其他：${req.notes}` : "",
    `来源：${req.source === "monitor" ? "募集要项监控" : "AI 检索"}${req.sourceUrl ? ` ${req.sourceUrl}` : ""}`,
  ]
    .filter(Boolean)
    .join("；");
}

export function aspirationTitle(a: Pick<AspirationView, "professor" | "school">) {
  if (a.professor) return `${a.professor.name}（${a.professor.university}${a.school ? ` ${a.school.name}` : a.professor.department ? ` ${a.professor.department}` : ""}）`;
  return `${a.school!.university} ${a.school!.name}`;
}

/** 给 AI 看的一条志愿（教授这边 + 研究科这边 + 差距） */
export function describeAspiration(a: AspirationView) {
  const lines = [a.professor ? `教授：${describeProfessor(a.professor)}` : "（只有研究科，还没定教授）"];
  if (a.professor?.proposedFollowUp) lines.push(`AI 提议的跟进日：${a.professor.proposedFollowUp.date ?? "取消"}（等用户同意）`);
  if (a.school) {
    lines.push(`研究科：${a.school.university} ${a.school.name}（ID：${a.school.id}）`);
    lines.push(describeRequirements(a.school.requirements));
    lines.push(a.school.deadline ? `出愿截止：${a.school.deadline.date}${a.school.deadline.tentative ? "（仮，按往年推算）" : ""}` : "出愿截止：还没有日程");
  } else lines.push("研究科：还没关联（查到入试页面后用 watch_school 带 professorId 关联）");
  if (a.gaps.length) lines.push(`差距：${a.gaps.join("；")}`);
  return lines.join("\n");
}

export function statusLabel(status: ProfessorStatus) {
  return PROFESSOR_STATUS_LABELS[status];
}

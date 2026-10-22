// 志愿 = 一位教授 + 教授所在的研究科（也可以只有研究科）。这里是两边信息的对照、差距计算、研究科匹配（纯函数，前后端共用）。

import type { AdmissionRequirements } from "./admissions";
import { CONTACT_RULE_LABELS } from "./admissions";
import type { CalendarItem } from "./calendar";
import { getSection } from "./md-sections";
import type { OnboardingAnswers } from "./onboarding";
import { describeProfessor, PROFESSOR_STATUS_LABELS, type PaperRef, type ProfessorDetails, type ProfessorStatus, type SourceLink } from "./professors";

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
  details: ProfessorDetails | null;
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

/** 志愿卡片的「下一步」：按联系状态写死的文案 + 一个让 AI 在对话里开始的按钮（不调 AI） */
export type NextStep = { text: string; action: { label: string; prompt: string } | null };

export function aspirationNextStep(a: Pick<AspirationView, "professor" | "school">): NextStep | null {
  const p = a.professor;
  const s = a.school;
  if (!p) {
    const name = s ? `${s.university} ${s.name}` : "这个研究科";
    return { text: "还没定教授", action: { label: "找这里的教授", prompt: `帮我在${name}找 2–3 位和我方向合适的教授，先问我一两个问题。` } };
  }
  const who = `${p.name}教授（教授 ID：${p.id}）`;
  const contact = s?.requirements?.contact;
  switch (p.status) {
    case "to_contact":
      return {
        text: contact === "required" ? "先联系教授（这个研究科必须先联系）" : contact === "recommended" ? "先联系教授（建议）" : "写一封套磁信联系教授",
        action: { label: "让 AI 起草套磁信", prompt: `帮我给${who}写套磁信：新建一份关联这位教授的套磁信，按我的档案、计划书和教授的研究方向写日文初稿。` },
      };
    case "contacted":
      return {
        text: p.followUpDate ? `${Number(p.followUpDate.slice(5, 7))}/${Number(p.followUpDate.slice(8))} 还没回就跟进` : "等回信；可以定一个跟进日",
        action: { label: "起草跟进邮件", prompt: `我给${who}发了套磁信，还没收到回复。帮我判断什么时候跟进合适，再写一封简短礼貌的日文跟进邮件。` },
      };
    case "replied":
      return {
        text: p.note ? (p.note.length > 40 ? `${p.note.slice(0, 40)}…` : p.note) : "教授回信了，商量怎么回",
        action: { label: "回复教授", prompt: `${who}回复我了（要点在志愿备注里）。帮我理解回信、写日文回复；要约面谈的话，时间定了提议写进日历。` },
      };
    case "interview":
      return { text: "准备面谈", action: { label: "和 AI 模拟面谈", prompt: `帮我准备和${who}的面谈：整理教授近期研究、可能被问到的问题和回答要点，然后和我做一次模拟问答。` } };
    case "accepted":
      return { text: "教授同意接收了，准备出愿材料", action: { label: "列出出愿材料", prompt: `${who}同意接收我了。帮我查他所在研究科的募集要项，列出出愿材料和截止日期。` } };
    case "dropped":
      return null;
  }
}

/** 志愿的默认顺序：放弃的放最后；其余按最近的出愿日期，没有日期的排在后面 */
export function sortAspirations<T extends Pick<AspirationView, "professor" | "school">>(list: T[]): T[] {
  const rank = (a: T) => (a.professor?.status === "dropped" ? 1 : 0);
  const date = (a: T) => a.school?.deadline?.date ?? "9999";
  return [...list].sort((x, y) => rank(x) - rank(y) || date(x).localeCompare(date(y)));
}

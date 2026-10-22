// 主页的流程任务：按用户当前进度（志愿里的教授和研究科、文书）用固定规则推算，不调用 AI。
// 每条流程任务有固定 key，src/server/next-steps.ts 按 key 和 todo 表对账：缺的补上、条件达成的改成待你确认、过时的移除。
// 默认先找教授（日本修士往往先和教授联系上，再看研究科怎么考）；每位教授都要同时弄清教授所在研究科的入试要求，两边一起权衡。

import type { Scores } from "./aspirations";
import type { DocKind } from "./documents";
import { answerField, decideTrack, PATH_LABELS, suggestPath, type OnboardingAnswers } from "./onboarding";
import type { ProfessorStatus } from "./professors";

export type StepState = {
  answers: OnboardingAnswers;
  /** 用户现在的语言成绩（user.md「语言成绩」一节 + 旧问卷答案），AI 在聊天里随时更新 */
  scores: Scores;
  /** 关注的研究科数量（志愿里的研究科，含只有研究科的志愿） */
  schoolCount: number;
  professors: { id: string; name: string; status: ProfessorStatus; followUpDate?: string | null; schoolId?: string | null; schoolKnown?: boolean }[];
  documents: { id: string; kind: DocKind; professorId?: string | null }[];
  /** 已经勾掉的流程任务 key。用户手动勾掉也算这一步做完了，后面的步骤照常出现 */
  doneKeys: Set<string>;
};

export type StepTask = { key: string; title: string; note?: string; professorId?: string; documentId?: string };

/** open：此刻应该出现的任务；done：条件已达成、该勾掉的任务 key */
export type StepPlan = { open: StepTask[]; done: string[] };

/** 每位教授的任务按状态推进，排在当前状态之前的都算做完了 */
const PROFESSOR_STAGES: { status: ProfessorStatus; keys: string[] }[] = [
  { status: "to_contact", keys: ["plan", "letter"] },
  { status: "contacted", keys: ["followup"] },
  { status: "replied", keys: ["reply"] },
  { status: "interview", keys: ["interview"] },
  { status: "accepted", keys: [] },
];

export const MIN_PROFESSORS = 3;

export function professorStepKey(professorId: string, step: string) {
  return `prof:${professorId}:${step}`;
}

export function planNextSteps(s: StepState): StepPlan {
  const a = s.answers;
  const open: StepTask[] = [];
  const done: string[] = [];
  const step = (key: string, finished: boolean, task: Omit<StepTask, "key">) => {
    if (finished) done.push(key);
    else open.push({ key, ...task });
  };
  const isDone = (key: string) => done.includes(key) || s.doneKeys.has(key);

  const track = decideTrack(a);
  const plans = s.documents.filter((d) => d.kind === "plan");
  const letters = s.documents.filter((d) => d.kind === "letter");
  const active = s.professors.filter((p) => p.status !== "dropped");

  if (a.path === "unsure") {
    step("confirm_path", false, {
      title: `确认申请路径（建议：${PATH_LABELS[suggestPath(a, s.scores.jlpt)]}）`,
      note: "可以在右侧问 AI 几条路的区别和适合人群",
    });
  } else done.push("confirm_path");

  if (track === "plan_first") {
    step("write_plan", plans.length > 0, { title: "把现有研究计划整理成计划书初稿", note: "在「文书」新建研究计划书，AI 会分步带你写" });
  }
  const hasPlan = track === "professor_first" || isDone("write_plan");

  if (hasPlan || active.length >= MIN_PROFESSORS) {
    step("find_professors", active.length >= MIN_PROFESSORS, {
      title: `和 AI 一起找 ${MIN_PROFESSORS}–5 位合适的教授，加入志愿`,
      note:
        track === "plan_first"
          ? "按计划书的方向匹配。在右侧对话里和 AI 聊，AI 找到合适的教授会问你要不要加入志愿"
          : "在右侧对话里和 AI 聊聊你的研究兴趣，AI 找到候选教授（附近期论文）后会问你要不要加入志愿",
    });
  }

  // 有了志愿（教授或研究科）之后，语言成绩这些研究科那边的要求才具体
  if (active.length > 0 || s.schoolCount > 0) {
    if (!(s.scores.jlpt && s.scores.jlpt <= 2)) {
      step("japanese", false, { title: "制定日语学习计划，目标 JLPT N2 以上", note: "文科多数研究科要求 N1 或同等水平" });
    }
    if (answerField(a) === "sciences" && s.scores.toefl === undefined && s.scores.toeic === undefined && s.scores.ielts === undefined) {
      step("english", false, { title: "准备 TOEFL 或 TOEIC", note: "理科很多研究科用英语成绩代替英语笔试" });
    }
    if ((a.path === "unsure" ? suggestPath(a, s.scores.jlpt) : a.path) === "doctor") {
      step("achievements", false, { title: "整理已有研究成果（硕士论文、发表论文、学会报告）" });
    }
  }

  for (const p of active) {
    const stage = PROFESSOR_STAGES.findIndex((st) => st.status === p.status);
    PROFESSOR_STAGES.slice(0, stage).forEach((st) => st.keys.forEach((k) => done.push(professorStepKey(p.id, k))));
    const key = (k: string) => professorStepKey(p.id, k);
    const who = `${p.name}教授`;

    // 教授和研究科一起看：教授想收、但研究科难考也不行
    // 只关联了研究科不算查清：研究科的入试要点（要不要先联系教授、考试科目、语言要求）记下来了才算
    step(key("school"), !!p.schoolId && !!p.schoolKnown, {
      title: `查清${who}所在研究科怎么考`,
      note: "要不要先联系教授、考试科目、语言要求、出愿截止；AI 可以帮你查募集要项并关注",
      professorId: p.id,
    });

    switch (p.status) {
      case "to_contact": {
        const plan = plans.find((d) => d.professorId === p.id);
        if (track === "professor_first") {
          step(key("plan"), !!plan, {
            title: `结合${who}的研究方向写计划书草稿`,
            note: "先读教授近 3 年的论文。第一封邮件最好附上草稿，空手问课题容易被忽略",
            professorId: p.id,
          });
        }
        if (track === "plan_first" ? hasPlan : isDone(key("plan"))) {
          const letter = letters.find((d) => d.professorId === p.id);
          step(key("letter"), false, {
            title: `给${who}写套磁信并发送`,
            note: "附上计划书草稿；用自己的邮箱发出后，把联系状态改成「已发信」",
            professorId: p.id,
            documentId: letter?.id,
          });
        }
        break;
      }
      case "contacted":
        step(key("followup"), false, {
          title: `等${who}回复，到期没回就礼貌跟进`,
          note: p.followUpDate ? `跟进日：${p.followUpDate}` : "一般等 1–2 周；收到回信后贴给 AI，它会更新联系状态并帮你回复",
          professorId: p.id,
        });
        break;
      case "replied":
        step(key("reply"), false, { title: `回复${who}，约面谈`, note: "把回信贴给 AI 一起看；面谈时间商量好后 AI 会提议写进日历", professorId: p.id });
        break;
      case "interview":
        step(key("interview"), false, { title: `准备和${who}的面谈`, note: "复习教授近期论文和自己的计划书，准备好想问的问题", professorId: p.id });
        break;
    }
  }

  if (active.some((p) => p.status === "replied" || p.status === "interview" || p.status === "accepted")) {
    step("application", false, { title: "按募集要项准备出愿材料", note: "在「志愿」里确认出愿期、考试科目和材料清单" });
  }

  return { open, done };
}

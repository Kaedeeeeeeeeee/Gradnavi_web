// 工作台「下一步」里的流程任务：按用户当前进度（研究科、教授清单、文书）用固定规则推算，不调用 AI。
// 每条流程任务有固定 key，src/server/next-steps.ts 按 key 和 todo 表对账：缺的补上、条件达成的勾掉、过时的移除。

import type { DocKind } from "./documents";
import { answerField, decideTrack, hasEnglishScore, hasStrongJapanese, PATH_LABELS, suggestPath, type OnboardingAnswers } from "./onboarding";
import type { ProfessorStatus } from "./professors";

export type StepState = {
  answers: OnboardingAnswers;
  /** 关注的研究科数量 */
  schoolCount: number;
  professors: { id: string; name: string; status: ProfessorStatus; followUpDate?: string | null }[];
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
      title: `确认申请路径（建议：${PATH_LABELS[suggestPath(a)]}）`,
      note: "可以在右侧问 AI 几条路的区别和适合人群",
    });
  } else done.push("confirm_path");

  step("pick_schools", s.schoolCount > 0, {
    title: "确定目标大学和研究科",
    note: "在「研究科」页添加并关注，系统会帮你盯募集要项；也可以让 AI 帮你挑",
  });
  if (track === "plan_first") {
    step("write_plan", plans.length > 0, { title: "把现有研究计划整理成计划书初稿", note: "在「文书」新建研究计划书，AI 会分步带你写" });
  }
  const hasSchools = isDone("pick_schools");
  const hasPlan = track === "professor_first" || isDone("write_plan");

  if (hasSchools) {
    if (hasPlan || active.length >= MIN_PROFESSORS) {
      step("find_professors", active.length >= MIN_PROFESSORS, {
        title: `在目标研究科找 ${MIN_PROFESSORS}–5 位候选教授`,
        note:
          track === "plan_first"
            ? "按计划书的方向匹配，在「找教授」检索后收藏合适的"
            : "看研究方向和自己的兴趣有没有交集，在「找教授」检索后收藏合适的",
      });
    }
    if (!hasStrongJapanese(a.japanese)) {
      step("japanese", false, { title: "制定日语学习计划，目标 JLPT N2 以上", note: "文科多数研究科要求 N1 或同等水平" });
    }
    if (answerField(a) === "sciences" && !hasEnglishScore(a.english)) {
      step("english", false, { title: "准备 TOEFL 或 TOEIC", note: "理科很多研究科用英语成绩代替英语笔试" });
    }
    if ((a.path === "unsure" ? suggestPath(a) : a.path) === "doctor") {
      step("achievements", false, { title: "整理已有研究成果（硕士论文、发表论文、学会报告）" });
    }
  }

  for (const p of active) {
    const stage = PROFESSOR_STAGES.findIndex((st) => st.status === p.status);
    PROFESSOR_STAGES.slice(0, stage).forEach((st) => st.keys.forEach((k) => done.push(professorStepKey(p.id, k))));
    const key = (k: string) => professorStepKey(p.id, k);
    const who = `${p.name}教授`;

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
            note: "附上计划书草稿；用自己的邮箱发出后，把教授状态改成「已发套磁」",
            professorId: p.id,
            documentId: letter?.id,
          });
        }
        break;
      }
      case "contacted":
        step(key("followup"), false, {
          title: `等${who}回复，到期没回就礼貌跟进`,
          note: p.followUpDate ? `跟进日：${p.followUpDate}` : "一般等 1–2 周；收到回复后把教授状态改成「已回复」",
          professorId: p.id,
        });
        break;
      case "replied":
        step(key("reply"), false, { title: `回复${who}，约面谈`, note: "面谈定下来后把教授状态改成「面谈」", professorId: p.id });
        break;
      case "interview":
        step(key("interview"), false, { title: `准备和${who}的面谈`, note: "复习教授近期论文和自己的计划书，准备好想问的问题", professorId: p.id });
        break;
    }
  }

  if (active.some((p) => p.status === "replied" || p.status === "interview")) {
    step("application", false, { title: "按募集要项准备出愿材料", note: "在「研究科」页确认出愿期和材料清单" });
  }

  return { open, done };
}

/** 「让 AI 开始」：点按钮后代用户发给 AI 的开场消息；href 有值时改为跳转到对应页面（页面自己会让 AI 开工） */
export type Kickoff = { prompt: string } | { href: string };

export function kickoffFor(t: { stepKey: string | null; title: string; note: string | null; professorId: string | null; documentId: string | null }, professorName?: string): Kickoff {
  const who = professorName ? `${professorName}教授` : "这位教授";
  const pid = t.professorId ? `（教授清单 ID：${t.professorId}）` : "";
  const step = t.stepKey?.startsWith("prof:") ? t.stepKey.split(":")[2] : t.stepKey;
  switch (step) {
    case "confirm_path":
      return { prompt: "帮我确认申请路径：根据我的档案比较「先读研究生再考修士」「直考修士」「博士」哪条更适合我，说明理由。我确认后帮我更新 user.md。" };
    case "pick_schools":
      return {
        prompt:
          "帮我确定目标大学和研究科：先根据我的档案（研究方向、成绩、日语水平、偏好）问我两三个关键问题，再推荐 3–5 个合适的研究科并说明理由。我选定后，帮我找到它们官网的入试信息页面并关注。",
      };
    case "write_plan":
      return { prompt: "帮我把现有研究计划整理成计划书初稿：新建一份研究计划书，然后按带写步骤从第 1 步开始问我。" };
    case "find_professors":
      return {
        prompt: "帮我在已关注的研究科里找 3–5 位候选教授：先看我关注了哪些研究科，按我的研究方向检索，介绍每位教授和我方向的关联。我挑中的再收藏。",
      };
    case "japanese":
      return { prompt: "帮我制定日语学习计划：根据我现在的日语水平和目标入学时间，排出到 N2 / N1 的阶段计划和考试日期，我确认后加进 Todo 和日历。" };
    case "english":
      return { prompt: "帮我准备英语成绩：根据我的目标研究科说明 TOEFL 和 TOEIC 该考哪个、要多少分，排出备考计划和考试日期，我确认后加进 Todo 和日历。" };
    case "achievements":
      return { prompt: "帮我整理已有研究成果（硕士论文、发表论文、学会报告）：先问我有哪些，再整理成申请博士时能用的清单，记进 user.md。" };
    case "application":
      return { prompt: "帮我准备出愿材料：查看我关注研究科的募集要项，列出需要的材料和截止日期，我确认后加进 Todo。" };
    case "plan":
      return {
        prompt: `帮我结合${who}${pid}的研究方向写研究计划书草稿：先查教授近几年的论文，告诉我可以从哪些角度贴合；然后新建一份关联这位教授的研究计划书，按带写步骤从第 1 步开始问我。`,
      };
    case "letter":
      if (t.documentId) return { href: `/documents/${t.documentId}?ai=letter` };
      return { prompt: `帮我给${who}${pid}写套磁信：新建一份关联这位教授的套磁信，按我的档案、计划书和教授的研究方向写日文初稿。` };
    case "followup":
      return { prompt: `我给${who}${pid}发了套磁信，还没收到回复。帮我判断什么时候跟进合适，到时候写一封简短礼貌的日文跟进邮件，并把跟进日期记到教授清单里。` };
    case "reply":
      return { prompt: `${who}${pid}回复我了。我先把教授的回信贴给你，请帮我理解内容，再写日文回复、约面谈时间。` };
    case "interview":
      return { prompt: `帮我准备和${who}${pid}的面谈：整理教授近期研究、可能被问到的问题和我的回答要点，然后和我做一次模拟问答。` };
    default:
      return {
        prompt: `我想开始做这件事：「${t.title}」${t.note ? `（${t.note}）` : ""}。帮我拆成具体步骤，能直接用工具帮我做的就直接做，需要我决定的先问我。`,
      };
  }
}

// 引导问卷：问题定义 + 由答案生成初版 user.md（纯函数，前后端共用）。「下一步」任务见 next-steps.ts

export type Field = "humanities" | "sciences";
/** 问卷里的学科选择：other = 用户自己填了更具体的领域（存在 fieldDetail） */
export type FieldChoice = Field | "other";
export type PathChoice = "kenkyusei" | "master" | "doctor" | "unsure";
export type PlanStatus = "none" | "rough" | "clear";
/** A = 方向未定，先找教授；B = 已有明确计划，先打磨计划书 */
export type Track = "professor_first" | "plan_first";

/**
 * 问卷答案。现在只问 5 道点选题（status / major / field / planStatus / targetEntry），
 * 其余信息（GPA、语言成绩、心仪学校……）在之后的聊天里由 AI 记进 user.md。
 * 标“旧问卷”的字段只有 2026-10 之前做过 13 题问卷的用户才有。
 */
export type OnboardingAnswers = {
  status: string;
  major: string;
  field: FieldChoice;
  /** field 选 other 时用户填写的具体领域 */
  fieldDetail?: string;
  /** 新问卷不再问，固定为 unsure（主页上会有「确认申请路径」任务） */
  path: PathChoice;
  planStatus: PlanStatus;
  targetEntry: string;
  /** 旧问卷 */
  education?: string;
  gpa?: string;
  direction?: string;
  targetSchools?: string;
  japanese?: string;
  english?: string;
  notes?: string;
};

type Option = { value: string; label: string; hint?: string };

/** 问卷里的题目（都是点选题，部分带“自己填写”） */
export type QuestionKey = "status" | "major" | "field" | "planStatus" | "targetEntry";

export type Question = {
  key: QuestionKey;
  title: string;
  hint?: string;
  options: Option[];
  /** 附加的“自己填写”选项：选中后 key 记为 value，内容存到 detailKey；没有 detailKey 时内容直接存到 key */
  other?: { value?: string; label: string; detailKey?: "fieldDetail"; placeholder?: string };
};

export const PATH_LABELS: Record<PathChoice, string> = {
  kenkyusei: "先读研究生，再考修士",
  master: "直考修士",
  doctor: "博士",
  unsure: "还不确定",
};

export const TRACK_LABELS: Record<Track, string> = {
  professor_first: "先找教授，再写贴合教授方向的计划书",
  plan_first: "先打磨计划书，再按计划匹配教授",
};

const ENTRY_COUNT = 4;
/** 离入学不到这么多个月时，多数研究科的出愿已截止或临近 */
const TIGHT_MONTHS = 8;
const TIGHT_HINT = "时间较紧：多数研究科的出愿已截止或临近，适合已在准备的人";

/** 按当前日期生成接下来几个入学季（日本大学院主要是 4 月和 10 月入学） */
export function entryOptions(now = new Date()): Option[] {
  const options: Option[] = [];
  for (let y = now.getFullYear(); options.length < ENTRY_COUNT; y++) {
    for (const m of [4, 10]) {
      const start = new Date(y, m - 1, 1);
      if (start <= now || options.length >= ENTRY_COUNT) continue;
      const months = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
      options.push({
        value: `${y}年${m}月`,
        label: `${y} 年 ${m} 月入学`,
        hint: months < TIGHT_MONTHS ? TIGHT_HINT : undefined,
      });
    }
  }
  options.push({ value: "未定", label: "还没想好" });
  return options;
}

export const MAJOR_OPTIONS = [
  "日语 / 外语",
  "文学 / 历史 / 哲学",
  "经济 / 管理 / 商科",
  "法学 / 政治 / 社会学",
  "教育 / 心理",
  "艺术 / 设计 / 传媒",
  "计算机 / 信息",
  "电子 / 机械 / 土木等工科",
  "数学 / 物理 / 化学 / 生物",
  "农学 / 医药 / 环境",
];

export function onboardingQuestions(now = new Date()): Question[] {
  return [
    {
      key: "status",
      title: "你现在处于什么状态？",
      options: [
        { value: "国内本科在读", label: "国内本科在读" },
        { value: "国内本科已毕业", label: "国内本科已毕业（工作或备考中）" },
        { value: "国内硕士在读或已毕业", label: "国内硕士在读或已毕业" },
        { value: "日本语言学校在读", label: "在日本读语言学校" },
        { value: "日本研究生在读", label: "在日本当研究生（旁听生，非正式学籍）" },
        { value: "其他", label: "其他" },
      ],
    },
    {
      key: "major",
      title: "本科（或硕士）学的是什么专业？",
      options: MAJOR_OPTIONS.map((m) => ({ value: m, label: m })),
      other: { label: "其他（自己填写）", placeholder: "例如：旅游管理 / 生物医学工程" },
    },
    {
      key: "field",
      title: "你想读的方向偏文科还是理科？",
      hint: "不一定和本科专业一样。找教授和计划书的写法，文理科差别很大。",
      options: [
        { value: "humanities", label: "文科（含社科、经济、教育等）" },
        { value: "sciences", label: "理科（含工学、农学、医学等）" },
      ],
      other: {
        value: "other",
        label: "其他 / 我已经有具体方向（自己填写）",
        detailKey: "fieldDetail",
        placeholder: "例如：认知语言学 / 半导体材料 / 文化遗产保护",
      },
    },
    {
      key: "planStatus",
      title: "研究方向想清楚了吗？",
      options: [
        { value: "none", label: "还没想好", hint: "先找教授，从教授的研究里找方向" },
        { value: "rough", label: "有个大概的领域", hint: "先找教授，再把方向收窄" },
        { value: "clear", label: "已经有比较明确的研究计划", hint: "先打磨计划书，再匹配教授" },
      ],
    },
    {
      key: "targetEntry",
      title: "希望什么时候入学？",
      options: entryOptions(now),
      other: { label: "更晚 / 其他（自己填写）", placeholder: "例如：2029 年 4 月 / 先读研究生，大约 3 年后" },
    },
  ];
}

const SCIENCE_HINT =
  /理科|理工|工学|工程|理学|农|医|药|看护|护理|兽医|数学|物理|化学|生物|生命|地球|天文|环境科学|材料|机械|电气|电子|电机|通信|半导体|信息|情报|计算机|软件|算法|人工智能|AI|机器学习|深度学习|强化学习|数据科学|统计|建筑|土木|能源|航空|机器人|控制|食品科学|海洋/i;
const HUMANITIES_HINT =
  /文科|文学|语言|日语|汉语|翻译|历史|哲学|宗教|艺术|美术|音乐|设计|传媒|新闻|社会|心理|教育|法学|法律|政治|国际关系|经济|经营|管理|商学|会计|金融|市场|观光|旅游|文化|人类学|考古|地理|公共政策|福祉/;

/** 从用户自填的领域粗略判断文理；判断不了返回 undefined，交给 AI 结合上下文判断 */
export function guessField(detail: string): Field | undefined {
  const sci = SCIENCE_HINT.test(detail);
  const hum = HUMANITIES_HINT.test(detail);
  if (sci === hum) return undefined;
  return sci ? "sciences" : "humanities";
}

/** 问卷答案对应的文理（用于模板、检索等需要二选一的地方）；不确定时返回 undefined */
export function answerField(a: Pick<OnboardingAnswers, "field" | "fieldDetail"> | null | undefined): Field | undefined {
  if (!a) return undefined;
  return a.field === "other" ? guessField(a.fieldDetail ?? "") : a.field;
}

function fieldLabel(a: OnboardingAnswers) {
  if (a.field !== "other") return a.field === "humanities" ? "文科" : "理科";
  const f = answerField(a);
  const detail = a.fieldDetail?.trim() || "（未填）";
  return f ? `${detail}（偏${f === "humanities" ? "文科" : "理科"}）` : detail;
}

export function decideTrack(a: Pick<OnboardingAnswers, "planStatus">): Track {
  return a.planStatus === "clear" ? "plan_first" : "professor_first";
}

/**
 * 用户没选路径时给的建议。jlpt：用户现在的 JLPT 级别（1 = N1），不知道时为 undefined
 */
export function suggestPath(a: OnboardingAnswers, jlpt?: number): Exclude<PathChoice, "unsure"> {
  if (a.status.includes("硕士")) return "doctor";
  if (a.status === "日本研究生在读") return "master";
  if (answerField(a) === "humanities" && !(jlpt && jlpt <= 2)) return "kenkyusei";
  return "master";
}

const line = (label: string, value: string | undefined) => `- ${label}：${value?.trim() || "（还没聊到）"}`;

const PLAN_STATUS_TEXT: Record<PlanStatus, string> = {
  none: "还没想好",
  rough: "有个大概的领域，具体还没聊",
  clear: "已经有比较明确的研究计划，具体还没聊",
};

/** 初版 user.md。用 “## 标题” 分节，AI 按节读写；问卷没问的项先占位，AI 在聊天里补上 */
export function buildUserMd(a: OnboardingAnswers): string {
  const track = decideTrack(a);
  return [
    "# 我的档案",
    "",
    "## 背景",
    line("现状", a.status),
    line("专业", a.major),
    line("学历和学校", a.education),
    line("GPA", a.gpa),
    line("学科", fieldLabel(a)),
    "",
    "## 语言成绩",
    line("日语", a.japanese),
    line("英语", a.english),
    "",
    "## 目标",
    line("路径", a.path === "unsure" ? undefined : PATH_LABELS[a.path]),
    line("目标入学", a.targetEntry),
    line("心仪学校", a.targetSchools),
    "",
    "## 研究方向",
    a.direction?.trim() || PLAN_STATUS_TEXT[a.planStatus],
    "",
    "## 当前路线",
    `- ${TRACK_LABELS[track]}`,
    "",
    "## 偏好与备注",
    a.notes?.trim() || "（暂无）",
    "",
  ].join("\n");
}

/** 「2027年4月」→「2027 年 4 月」 */
function entryText(entry: string) {
  return entry.replace(/^(\d{4})年(\d{1,2})月$/, "$1 年 $2 月");
}

function monthsUntil(entry: string, now: Date) {
  const m = /^(\d{4})年(\d{1,2})月$/.exec(entry);
  return m ? (Number(m[1]) - now.getFullYear()) * 12 + (Number(m[2]) - 1 - now.getMonth()) : null;
}

export type OpeningMessage = { text: string; quickReplies: string[] };

/** 做完问卷后 AI 栏里的开场消息：按模板拼出来，不调用 AI */
export function openingMessage(a: OnboardingAnswers, now = new Date()): OpeningMessage {
  const field = answerField(a);
  const facts = [
    a.status === "其他" ? "" : `你现在${a.status}`,
    `专业是${a.major}`,
    a.field === "other" ? `想做${a.fieldDetail?.trim() || "自己的方向"}` : `想读${field === "humanities" ? "文科" : "理科"}`,
    { none: "研究方向还没定", rough: "有个大概的领域", clear: "已经有比较明确的研究计划" }[a.planStatus],
    a.targetEntry === "未定" ? "入学时间还没定" : `想 ${entryText(a.targetEntry)}入学`,
  ].filter(Boolean);

  const months = monthsUntil(a.targetEntry, now);
  const tight = months !== null && months < TIGHT_MONTHS ? "离入学时间不多了，很多研究科的出愿已截止或临近，我们先确认还能赶上哪些。" : "";

  const plan: Record<PlanStatus, { advice: string; replies: string[] }> = {
    none: {
      advice: "我建议先从找教授开始：看看教授们在研究什么，方向往往就是从这里定下来的。说说你平时对什么感兴趣？",
      replies: ["我没什么头绪，问我几个问题帮我找方向", "从我的专业出发，推荐几个可以读的方向", "先讲讲整个申请流程"],
    },
    rough: {
      advice: "我建议先从找教授开始，边看教授的研究边把方向收窄。你感兴趣的领域大概是什么？",
      replies: ["问我几个问题，帮我把方向收窄", "从我的专业出发，推荐几个细分方向", "先讲讲整个申请流程"],
    },
    clear: {
      advice: "既然已经有研究计划，我建议先把它打磨成计划书，再按计划匹配教授。可以把计划贴给我，或者先口头说说。",
      replies: ["我把现有的计划贴给你", "问我几个问题，帮我把计划理清楚", "先讲讲整个申请流程"],
    },
  };

  const text =
    `${facts.join("，")}。${tight}${plan[a.planStatus].advice}\n\n` +
    "其他情况（成绩、语言、想去的学校）我们边聊边补，我记下的内容都能在「AI 对你的了解」里查看和修改。";
  return { text, quickReplies: plan[a.planStatus].replies };
}

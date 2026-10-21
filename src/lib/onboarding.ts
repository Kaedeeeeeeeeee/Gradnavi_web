// 引导问卷：问题定义 + 由答案生成初版 user.md（纯函数，前后端共用）。「下一步」任务见 next-steps.ts

export type Field = "humanities" | "sciences";
/** 问卷里的学科选择：other = 用户自己填了更具体的领域（存在 fieldDetail） */
export type FieldChoice = Field | "other";
export type PathChoice = "kenkyusei" | "master" | "doctor" | "unsure";
export type PlanStatus = "none" | "rough" | "clear";
/** A = 方向未定，先找教授；B = 已有明确计划，先打磨计划书 */
export type Track = "professor_first" | "plan_first";

export type OnboardingAnswers = {
  status: string;
  education: string;
  major: string;
  gpa: string;
  field: FieldChoice;
  /** field 选 other 时用户填写的具体领域；旧数据没有这个字段 */
  fieldDetail?: string;
  path: PathChoice;
  planStatus: PlanStatus;
  direction: string;
  targetSchools: string;
  japanese: string;
  english: string;
  targetEntry: string;
  notes: string;
};

type Option = { value: string; label: string; hint?: string };
type AnswerKey = keyof OnboardingAnswers;

export type Question = {
  key: AnswerKey;
  title: string;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  /** 文本题为空时，用另一题的回答预填 */
  prefillFrom?: AnswerKey;
} & (
  | {
      kind: "choice";
      options: Option[];
      /** 附加的“自己填写”选项：选中后 key 记为 value，内容存到 detailKey；没有 detailKey 时内容直接存到 key */
      other?: { value?: string; label: string; detailKey?: AnswerKey; placeholder?: string };
    }
  | { kind: "text"; multiline?: boolean }
);

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
        hint: months < TIGHT_MONTHS ? "时间较紧：多数研究科的出愿已截止或临近，适合已在准备的人" : undefined,
      });
    }
  }
  options.push({ value: "未定", label: "还没想好" });
  return options;
}

export function onboardingQuestions(now = new Date()): Question[] {
  return [
    {
      key: "status",
      title: "你现在处于什么状态？",
      kind: "choice",
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
      key: "education",
      title: "最高学历和毕业院校？",
      kind: "text",
      placeholder: "例如：本科，某某大学（2025 年毕业）",
    },
    { key: "major", title: "本科（或硕士）专业是什么？", kind: "text", placeholder: "例如：日语语言文学 / 计算机科学" },
    { key: "gpa", title: "GPA 或平均分大概多少？", kind: "text", optional: true, placeholder: "例如：3.4/4.0 或 平均分 85" },
    {
      key: "field",
      title: "你想读的方向偏文科还是理科？",
      hint: "找教授和计划书的写法，文理科差别很大。",
      kind: "choice",
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
      key: "path",
      title: "你打算走哪条路？",
      hint: "研究生是正式考修士前的旁听身份，可以先进研究室适应，再考修士。",
      kind: "choice",
      options: [
        { value: "kenkyusei", label: PATH_LABELS.kenkyusei },
        { value: "master", label: PATH_LABELS.master },
        { value: "doctor", label: PATH_LABELS.doctor },
        { value: "unsure", label: "还不确定，想听建议" },
      ],
    },
    {
      key: "planStatus",
      title: "研究方向想清楚了吗？",
      kind: "choice",
      options: [
        { value: "none", label: "还没想好", hint: "先找教授，从教授的研究里找方向" },
        { value: "rough", label: "有个大概的领域", hint: "先找教授，再把方向收窄" },
        { value: "clear", label: "已经有比较明确的研究计划", hint: "先打磨计划书，再匹配教授" },
      ],
    },
    {
      key: "direction",
      title: "你感兴趣的研究领域或课题？",
      kind: "text",
      multiline: true,
      optional: true,
      prefillFrom: "fieldDetail",
      placeholder: "想到什么写什么，例如：中日对比语言学 / 图像识别在农业中的应用",
    },
    { key: "targetSchools", title: "有心仪的学校吗？", kind: "text", optional: true, placeholder: "例如：东京大学、早稻田大学；没有可以跳过" },
    { key: "japanese", title: "日语水平？", kind: "text", placeholder: "例如：JLPT N1 135 分 / N2 在备考 / 零基础" },
    { key: "english", title: "英语成绩？", kind: "text", optional: true, placeholder: "例如：TOEFL 85 / TOEIC 750 / 六级 520" },
    {
      key: "targetEntry",
      title: "希望什么时候入学？",
      kind: "choice",
      options: entryOptions(now),
      other: { label: "更晚 / 其他（自己填写）", placeholder: "例如：2029 年 4 月 / 先读研究生，大约 3 年后" },
    },
    { key: "notes", title: "还有什么想让 AI 知道的？", kind: "text", multiline: true, optional: true, placeholder: "例如：预算有限、想去关西、希望读完留日工作……" },
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

/** JLPT N1/N2 视为日语基本够用 */
export function hasStrongJapanese(japanese: string) {
  return /N\s*[12]\b/i.test(japanese) && !/备考|在考|准备|目标/.test(japanese);
}

export function hasEnglishScore(english: string) {
  return /\d{2,}/.test(english);
}

/** 用户没选路径时给的建议 */
export function suggestPath(a: OnboardingAnswers): Exclude<PathChoice, "unsure"> {
  if (a.status.includes("硕士")) return "doctor";
  if (a.status === "日本研究生在读") return "master";
  if (answerField(a) === "humanities" && !hasStrongJapanese(a.japanese)) return "kenkyusei";
  return "master";
}

const line = (label: string, value: string) => `- ${label}：${value.trim() || "（未填）"}`;

/** 初版 user.md。用 “## 标题” 分节，AI 按节读写 */
export function buildUserMd(a: OnboardingAnswers): string {
  const track = decideTrack(a);
  const path = a.path === "unsure" ? `还不确定（初步建议：${PATH_LABELS[suggestPath(a)]}）` : PATH_LABELS[a.path];
  return [
    "# 我的档案",
    "",
    "## 背景",
    line("现状", a.status),
    line("学历", a.education),
    line("专业", a.major),
    line("GPA", a.gpa),
    line("学科", fieldLabel(a)),
    "",
    "## 语言成绩",
    line("日语", a.japanese),
    line("英语", a.english),
    "",
    "## 目标",
    line("路径", path),
    line("目标入学", a.targetEntry),
    line("心仪学校", a.targetSchools),
    "",
    "## 研究方向",
    a.direction.trim() || "（还没想好）",
    "",
    "## 当前路线",
    `- ${TRACK_LABELS[track]}`,
    "",
    "## 偏好与备注",
    a.notes.trim() || "（暂无）",
    "",
  ].join("\n");
}

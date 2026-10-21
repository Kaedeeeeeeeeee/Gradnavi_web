// 引导问卷：问题定义 + 由答案生成初版 user.md 和路线图（纯函数，前后端共用）

export type Field = "humanities" | "sciences";
export type PathChoice = "kenkyusei" | "master" | "doctor" | "unsure";
export type PlanStatus = "none" | "rough" | "clear";
/** A = 方向未定，先找教授；B = 已有明确计划，先打磨计划书 */
export type Track = "professor_first" | "plan_first";

export type OnboardingAnswers = {
  status: string;
  education: string;
  major: string;
  gpa: string;
  field: Field;
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

export type Question = {
  key: keyof OnboardingAnswers;
  title: string;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
} & ({ kind: "choice"; options: Option[] } | { kind: "text"; multiline?: boolean });

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

/** 生成未来几个入学季供选择（日本大学院主要是 4 月和 10 月入学） */
export function entryOptions(now = new Date()): Option[] {
  const options: Option[] = [];
  const year = now.getFullYear();
  for (let y = year; y <= year + 2; y++) {
    for (const m of [4, 10]) {
      if (new Date(y, m - 1, 1) > now) options.push({ value: `${y}年${m}月`, label: `${y} 年 ${m} 月入学` });
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
        { value: "日本研究生在读", label: "在日本当研究生（研究生）" },
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
      placeholder: "想到什么写什么，例如：中日对比语言学 / 图像识别在农业中的应用",
    },
    { key: "targetSchools", title: "有心仪的学校吗？", kind: "text", optional: true, placeholder: "例如：东京大学、早稻田大学；没有可以跳过" },
    { key: "japanese", title: "日语水平？", kind: "text", placeholder: "例如：JLPT N1 135 分 / N2 在备考 / 零基础" },
    { key: "english", title: "英语成绩？", kind: "text", optional: true, placeholder: "例如：TOEFL 85 / TOEIC 750 / 六级 520" },
    { key: "targetEntry", title: "希望什么时候入学？", kind: "choice", options: entryOptions(now) },
    { key: "notes", title: "还有什么想让 AI 知道的？", kind: "text", multiline: true, optional: true, placeholder: "例如：预算有限、想去关西、希望读完留日工作……" },
  ];
}

export function decideTrack(a: Pick<OnboardingAnswers, "planStatus">): Track {
  return a.planStatus === "clear" ? "plan_first" : "professor_first";
}

/** JLPT N1/N2 视为日语基本够用 */
function hasStrongJapanese(japanese: string) {
  return /N\s*[12]\b/i.test(japanese) && !/备考|在考|准备|目标/.test(japanese);
}

function hasEnglishScore(english: string) {
  return /\d{2,}/.test(english);
}

/** 用户没选路径时给的建议 */
export function suggestPath(a: OnboardingAnswers): Exclude<PathChoice, "unsure"> {
  if (a.status.includes("硕士")) return "doctor";
  if (a.status === "日本研究生在读") return "master";
  if (a.field === "humanities" && !hasStrongJapanese(a.japanese)) return "kenkyusei";
  return "master";
}

export type RoadmapItem = { title: string; note?: string };

export function buildRoadmap(a: OnboardingAnswers): RoadmapItem[] {
  const path = a.path === "unsure" ? suggestPath(a) : a.path;
  const items: RoadmapItem[] = [];

  if (a.path === "unsure") {
    items.push({
      title: `确认申请路径（建议：${PATH_LABELS[path]}）`,
      note: "可以在右侧问 AI 两条路的区别和适合人群",
    });
  }

  if (decideTrack(a) === "professor_first") {
    items.push(
      { title: "确定 3–5 所目标大学和研究科" },
      { title: "筛选 5–10 位候选教授", note: "看研究方向是否和自己的兴趣有交集" },
      { title: "阅读候选教授近 3 年的论文，记下研究课题" },
      { title: "结合教授方向写研究计划书草稿", note: "第一封邮件最好附上草稿，空手问课题容易被忽略" },
      { title: "写套磁信，附计划书草稿联系教授" },
    );
  } else {
    items.push(
      { title: "把现有研究计划整理成计划书初稿" },
      { title: "和 AI 一起打磨计划书：问题意识、先行研究、研究方法" },
      { title: "按计划书匹配 5–10 位教授" },
      { title: "写套磁信，附计划书联系教授" },
    );
  }

  if (path === "kenkyusei") items.push({ title: "查目标大学研究生（研究生）的出愿时间和材料要求" });
  if (path === "master") items.push({ title: "查目标研究科修士课程的募集要项（出愿期、考试科目）" });
  if (path === "doctor") {
    items.push(
      { title: "整理已有研究成果（硕士论文、发表论文、学会报告）" },
      { title: "查目标研究科博士课程的募集要项" },
    );
  }

  if (!hasStrongJapanese(a.japanese)) {
    items.push({ title: "制定日语学习计划，目标 JLPT N2 以上", note: "文科多数研究科要求 N1 或同等水平" });
  }
  if (a.field === "sciences" && !hasEnglishScore(a.english)) {
    items.push({ title: "准备 TOEFL 或 TOEIC", note: "理科很多研究科用英语成绩代替英语笔试" });
  }

  return items;
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
    line("学科", a.field === "humanities" ? "文科" : "理科"),
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

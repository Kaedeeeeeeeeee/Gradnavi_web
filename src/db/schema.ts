import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AdmissionRequirements, GuideEvent } from "../lib/admissions";
import type { CalendarKind } from "../lib/calendar";
import type { Feature, LedgerKind } from "../lib/credits";
import type { DocKind, Outline, TargetProfessor, WriteMode, CommentCategory, CommentStatus } from "../lib/documents";
import type { DocOp, SuggestionSource, SuggestionStatus } from "../lib/doc-ops";
import type { VersionTrigger } from "../lib/doc-history";
import type { ZhEntry } from "../lib/doc-zh";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { PaperRef, ProfessorCandidate, ProfessorStatus, SourceLink } from "../lib/professors";
import type { NextPick } from "../lib/next-pick";
import type { OnboardingAnswers } from "../lib/onboarding";
import type { TaskArea, TaskChange, TaskStatus, TaskStep } from "../lib/tasks";

// 以下四张表是 Better Auth 的核心表，字段名需与 Better Auth 保持一致。

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------- 第 2 步：user.md、Todo、AI 对话 ----------

/** 每个用户一份 user.md（AI 的长期记忆，用户可查看/编辑）+ 引导问卷的原始答案 */
export const userProfile = pgTable("user_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  markdown: text("markdown").notNull().default(""),
  onboarding: jsonb("onboarding").$type<OnboardingAnswers>(),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 任务（主页待办，表名沿用 todo）：用户、AI 和系统流程共用。任务 → 子步骤两层；可挂在某位教授、文书或研究科下；
 * 有截止日期的显示在日历上。只有用户能标完成（AI 设「待你确认」）；AI 新建的任务和改的截止日先是提议，用户同意后才生效。
 */
export const todo = pgTable(
  "todo",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    dueDate: date("due_date"),
    /** 子步骤（任务内的小清单，AI 可帮忙拆） */
    steps: jsonb("steps").$type<TaskStep[]>().notNull().default([]),
    /** AI 新建、用户还没同意的任务 */
    proposed: boolean("proposed").notNull().default(false),
    /** AI 对截止日的修改提议，用户同意后写进 dueDate */
    proposedChange: jsonb("proposed_change").$type<TaskChange>(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").$type<"user" | "ai" | "system">().notNull().default("user"),
    professorId: text("professor_id").references(() => savedProfessor.id, { onDelete: "set null" }),
    documentId: text("document_id").references(() => document.id, { onDelete: "set null" }),
    schoolId: text("school_id").references(() => graduateSchool.id, { onDelete: "set null" }),
    /** 流程任务的 key（见 src/lib/next-steps.ts），系统按进度自动增删勾选；用户和 AI 加的为空 */
    stepKey: text("step_key"),
    /** 分类（语言考试 / 专业课和备考 / 申请准备 / 其他）；为空时按关联对象、流程 key 和标题自动归类（见 lib/tasks.ts taskGroup） */
    area: text("area").$type<TaskArea>(),
    /** 准备要几天（AI 估、用户可改），主页「下一件事」用它算最晚开始日；空 = 按类型给默认值 */
    prepDays: integer("prep_days"),
    /** 用户删掉的流程任务只做标记，免得下次对账又加回来 */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("todo_user_id_idx").on(t.userId), uniqueIndex("todo_user_step_key_idx").on(t.userId, t.stepKey)],
);

export const aiConversation = pgTable(
  "ai_conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    /** 一个任务一段对话（从任务卡「让 AI 开始」打开）；为空的是主页上的通用对话 */
    todoId: text("todo_id").references(() => todo.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_conversation_user_id_idx").on(t.userId, t.updatedAt), uniqueIndex("ai_conversation_todo_idx").on(t.todoId)],
);

/** 以 AI SDK 的 UIMessage 格式保存（parts 含文本和工具调用），方便原样回放 */
export const aiMessage = pgTable(
  "ai_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversation.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    parts: jsonb("parts").notNull(),
    seq: integer("seq").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_message_conversation_idx").on(t.conversationId, t.seq)],
);

/** AI 每次调用工具都记一笔，便于追溯“AI 做了什么” */
export const aiToolCall = pgTable(
  "ai_tool_call",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => aiConversation.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    ok: boolean("ok").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_tool_call_user_id_idx").on(t.userId, t.createdAt)],
);

// ---------- 第 3 步：文书（研究计划书、套磁信、自我介绍） ----------

/** 文书正文以 Markdown 存储，用户在编辑器里改、AI 通过工具改，走同一套 src/server/documents */
export const document = pgTable(
  "document",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<DocKind>().notNull(),
    title: text("title").notNull(),
    markdown: text("markdown").notNull().default(""),
    /** 计划书要贴合的教授（主线 A）。第 4 步从教授清单关联，现在可手填 */
    targetProfessor: jsonb("target_professor").$type<TargetProfessor>(),
    /** 每次保存 +1，用于发现编辑器和 AI 同时修改的冲突 */
    version: integer("version").notNull().default(1),
    /** 中文对照：每段日文的指纹 → 中文（见 src/lib/doc-zh.ts） */
    zh: jsonb("zh").$type<ZhEntry[]>().notNull().default([]),
    outline: jsonb("outline").$type<Outline>(),
    writeMode: text("write_mode").$type<WriteMode>(),
    /** 定制版：复制自哪份文书的第几版 */
    parentId: text("parent_id").references((): AnyPgColumn => document.id, { onDelete: "set null" }),
    parentVersion: integer("parent_version"),
    /** 套磁信附上的计划书 */
    attachmentId: text("attachment_id").references((): AnyPgColumn => document.id, { onDelete: "set null" }),
    /** 上次存版以来做过的修改（合成版本说明用） */
    pendingChanges: jsonb("pending_changes").$type<string[]>().notNull().default([]),
    /** 文书列表里的顺序（用户拖动调整），小的在前；新建的排最前 */
    position: integer("position").notNull().default(0),
    /** 删除先放进回收（可撤销），30 天后清掉 */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** 正文最后一次被修改的时间（判断“停手 30 分钟”） */
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_user_id_idx").on(t.userId, t.updatedAt), index("document_parent_idx").on(t.parentId)],
);

/** 文书的版本：每版存全文（文书很小），对比时现算差异 */
export const documentVersion = pgTable(
  "document_version",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    /** 第几版，每份文书从 1 起 */
    number: integer("number").notNull(),
    markdown: text("markdown").notNull(),
    zh: jsonb("zh").$type<ZhEntry[]>().notNull().default([]),
    /** 自动生成的一句说明 */
    summary: text("summary").notNull(),
    /** 用户起的名字（如「发给佐藤教授的版本」） */
    name: text("name"),
    trigger: text("trigger").$type<VersionTrigger>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("document_version_doc_number_idx").on(t.documentId, t.number)],
);

/** AI 对文书的修改建议，用户接受后才写进正文 */
export const documentSuggestion = pgTable(
  "document_suggestion",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    op: jsonb("op").$type<DocOp>().notNull(),
    /** 新写的日文对应的中文，按段落 */
    zh: jsonb("zh").$type<string[]>().notNull().default([]),
    /** 一句中文说明（如「改写研究背景，补充问题意识」） */
    summary: text("summary").notNull(),
    source: text("source").$type<SuggestionSource>().notNull(),
    commentId: text("comment_id"),
    status: text("status").$type<SuggestionStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("document_suggestion_doc_idx").on(t.documentId, t.status)],
);

/** 「让 AI 当教授审一遍」留下的页边批注。只批注，不改原文 */
export const documentComment = pgTable(
  "document_comment",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    /** 第几轮审阅 */
    round: integer("round").notNull(),
    /** 批注针对的原文（逐字摘录，用来在正文里标出位置） */
    quote: text("quote").notNull(),
    body: text("body").notNull(),
    category: text("category").$type<CommentCategory>().notNull(),
    status: text("status").$type<CommentStatus>().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_comment_doc_idx").on(t.documentId, t.round)],
);

// ---------- 第 4 步：找教授 → 志愿 ----------

/**
 * 志愿里的教授（加入志愿 = 收藏）。一条志愿 = 一位教授 + 教授所在的研究科（schoolId）；
 * 只有研究科、没有教授的志愿是没被任何教授关联的 school_watch。
 * 教授信息是加入时的快照（来自 AI 检索或手填），每个用户一份，用户和 AI 都能修改，互不影响。
 */
export const savedProfessor = pgTable(
  "saved_professor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    university: text("university").notNull(),
    /** 研究科・専攻 */
    department: text("department"),
    lab: text("lab"),
    /** 研究方向摘要（中文） */
    research: text("research"),
    /** 代表论文（标题，尽量带年份） */
    papers: jsonb("papers").$type<string[]>().notNull().default([]),
    /** 近两三年的论文，带链接（检索结果里有链接时） */
    paperRefs: jsonb("paper_refs").$type<PaperRef[]>().notNull().default([]),
    /** 为什么适合这位用户（AI 检索时写的） */
    fit: text("fit"),
    /** 是否招外国留学生/研究生，查不到时为空 */
    acceptsInternational: text("accepts_international"),
    /** 教授的邮箱（套磁信收件人），用户填或 AI 从官网查到 */
    email: text("email"),
    sources: jsonb("sources").$type<SourceLink[]>().notNull().default([]),
    status: text("status").$type<ProfessorStatus>().notNull().default("to_contact"),
    note: text("note"),
    /** 跟进日期，显示在日历上 */
    followUpDate: date("follow_up_date"),
    /** AI 对跟进日期的修改提议（日历上虚线显示），用户同意后写进 followUpDate；date 为 null = 提议取消跟进日 */
    proposedFollowUp: jsonb("proposed_follow_up").$type<{ date: string | null }>(),
    /** 教授所在的研究科（志愿的研究科这边：入试要点、募集要项日程） */
    schoolId: text("school_id").references(() => graduateSchool.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saved_professor_user_name_univ_idx").on(t.userId, t.name, t.university)],
);

/**
 * 在对话里找教授的每一轮结果（AI 调 search_professors 时保存），在文稿栏以候选卡片显示。
 * 用户点「不合适」的记在 rejected 里（原因同时写进 user.md）；加入志愿的看 saved_professor。
 */
export const professorSearch = pgTable(
  "professor_search",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    keywords: text("keywords").notNull(),
    schools: jsonb("schools").$type<string[]>().notNull().default([]),
    preference: text("preference"),
    candidates: jsonb("candidates").$type<ProfessorCandidate[]>().notNull().default([]),
    /** 候选 key（candidateKey）→ 不合适的原因（可为空） */
    rejected: jsonb("rejected").$type<Record<string, string>>().notNull().default({}),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("professor_search_user_idx").on(t.userId, t.createdAt)],
);

// ---------- 第 5 步：日历、募集要项监控 ----------

/**
 * 用户和 AI 手动添加的日程。日历页面还会合并显示：有截止日期的 Todo、教授跟进日、
 * 关注研究科的募集要项日程（后三者不复制到这张表，改源数据日历就跟着变）。
 */
export const calendarEvent = pgTable(
  "calendar_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    date: date("date").notNull(),
    endDate: date("end_date"),
    kind: text("kind").$type<CalendarKind>().notNull().default("other"),
    note: text("note"),
    createdBy: text("created_by").$type<"user" | "ai" | "system">().notNull().default("user"),
    /** AI 写进日历的日程先是提议（虚线显示），用户同意后才变成正式日程 */
    proposed: boolean("proposed").notNull().default(false),
    /** AI 对已有日程改期的提议 */
    proposedChange: jsonb("proposed_change").$type<{ date: string; endDate: string | null }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("calendar_event_user_date_idx").on(t.userId, t.date)],
);

/** 研究科的标识（大学 + 研究科名，跨用户同一条）。监控和解析结果按用户各自保存，见 school_watch / admission_guide */
export const graduateSchool = pgTable(
  "graduate_school",
  {
    id: text("id").primaryKey(),
    university: text("university").notNull(),
    name: text("name").notNull(),
    /** 第一次被关注时的入试页面链接（只作参考；每个用户监控自己填的链接，见 school_watch.url） */
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("graduate_school_univ_name_idx").on(t.university, t.name)],
);

/** AI 从募集要项页面解析出的日程，每个用户、每个研究科、每个入学年度一条（监控按用户各自跑，结果不共用） */
export const admissionGuide = pgTable(
  "admission_guide",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => graduateSchool.id, { onDelete: "cascade" }),
    /** 入学年度（如 2027 = 2027 年 4 月入学的年度，10 月入学也算同一年度） */
    admissionYear: integer("admission_year").notNull(),
    title: text("title"),
    events: jsonb("events").$type<GuideEvent[]>().notNull().default([]),
    sourceUrl: text("source_url").notNull(),
    /** 新要项公布 / 日程更新、通知了用户的时间（主页提醒用）；第一次检查得到的基准要项为空 */
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    /** 公布前日历上的日程（往年要项顺延的仮日程，或更新前的日程），主页提醒里对照显示 */
    previousEvents: jsonb("previous_events").$type<GuideEvent[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("admission_guide_user_school_year_idx").on(t.userId, t.schoolId, t.admissionYear)],
);

/**
 * 用户关注的研究科 + 这个用户自己的募集要项监控（每人各自检查、AI 解析费用扣自己的 credit，结果不共用）
 */
export const schoolWatch = pgTable(
  "school_watch",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => graduateSchool.id, { onDelete: "cascade" }),
    /** 募集要项 / 入试信息页面 */
    url: text("url").notNull(),
    /** 页面里和入试相关部分的指纹，变了才调用 AI 解析 */
    contentHash: text("content_hash"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    /** 用户点“立即检查”或刚关注时设置，worker 几分钟内处理 */
    checkRequestedAt: timestamp("check_requested_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** credit 用完时暂停监控的时间；补充后下次检查自动恢复 */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** 入试要点：要不要先联系教授、考试科目、语言要求（监控解析或 AI 检索） */
    requirements: jsonb("requirements").$type<AdmissionRequirements>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.schoolId] }), index("school_watch_school_idx").on(t.schoolId)],
);

// ---------- 第 6 步：credit 计量、内测 ----------

/** 每个用户的 credit 余额。第一次用到时创建并发放注册赠送（见 src/server/credits.ts） */
export const creditAccount = pgTable("credit_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** credit 流水：每次余额变动一笔。以后接 Stripe 充值时 kind = topup，externalRef 填支付单号 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LedgerKind>().notNull(),
    /** 正数为增加，负数为扣除 */
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    note: text("note"),
    usageId: text("usage_id").references(() => aiUsage.id, { onDelete: "set null" }),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_ledger_user_idx").on(t.userId, t.createdAt), uniqueIndex("credit_ledger_external_ref_idx").on(t.externalRef)],
);

/** 每次 AI 操作的用量和我们付出的成本（含不扣 credit 的系统任务，userId 为空） */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    feature: text("feature").$type<Feature>().notNull(),
    model: text("model").notNull(),
    /** 对话 ID 等，便于追溯 */
    refId: text("ref_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    searchCalls: integer("search_calls").notNull().default(0),
    fetchCalls: integer("fetch_calls").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    credits: integer("credits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt), index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

/** 内测邀请名单：SIGNUP_MODE=invite 时只有名单内（或 ADMIN_EMAILS）的新邮箱能注册 */
export const betaInvite = pgTable("beta_invite", {
  email: text("email").primaryKey(),
  note: text("note"),
  invitedBy: text("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 内测反馈 */
export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    page: text("page"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_created_idx").on(t.createdAt)],
);

/**
 * 主页「下一件事」的判断结果，每个用户一条。inputKey 是判断用到的全部输入（任务事实、日程、user.md、日期），
 * 输入没变就直接用，变了才重新让 AI 判断（按用量扣 credit）。
 */
export const nextPick = pgTable("next_pick", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  inputKey: text("input_key").notNull(),
  pick: jsonb("pick").$type<NextPick>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { GuideEvent } from "../lib/admissions";
import type { CalendarKind } from "../lib/calendar";
import type { DocKind, TargetProfessor } from "../lib/documents";
import type { ProfessorStatus, SourceLink } from "../lib/professors";
import type { OnboardingAnswers } from "../lib/onboarding";

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

/** Todo：用户和 AI 共用。可挂在某位教授或某份文书下；有截止日期的会显示在日历上 */
export const todo = pgTable(
  "todo",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    done: boolean("done").notNull().default(false),
    dueDate: date("due_date"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").$type<"user" | "ai" | "system">().notNull().default("user"),
    professorId: text("professor_id").references(() => savedProfessor.id, { onDelete: "set null" }),
    documentId: text("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("todo_user_id_idx").on(t.userId)],
);

export const aiConversation = pgTable(
  "ai_conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_conversation_user_id_idx").on(t.userId, t.updatedAt)],
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_user_id_idx").on(t.userId, t.updatedAt)],
);

// ---------- 第 4 步：找教授（教授清单） ----------

/**
 * 用户收藏的教授。教授信息是收藏时的快照（来自 AI 检索或手填），每个用户一份，
 * 用户和 AI 都能修改，互不影响。跨用户共享的教授库等数据量上来再考虑。
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
    /** 是否招外国留学生/研究生，查不到时为空 */
    acceptsInternational: text("accepts_international"),
    sources: jsonb("sources").$type<SourceLink[]>().notNull().default([]),
    status: text("status").$type<ProfessorStatus>().notNull().default("to_contact"),
    note: text("note"),
    /** 跟进日期。第 5 步接入日历 */
    followUpDate: date("follow_up_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("saved_professor_user_name_univ_idx").on(t.userId, t.name, t.university)],
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("calendar_event_user_date_idx").on(t.userId, t.date)],
);

/** 研究科（跨用户共享）。募集要项按研究科每天检查一次，多个用户关注同一研究科只查一次 */
export const graduateSchool = pgTable(
  "graduate_school",
  {
    id: text("id").primaryKey(),
    university: text("university").notNull(),
    name: text("name").notNull(),
    /** 募集要项 / 入试信息页面 */
    url: text("url").notNull(),
    /** 页面里和入试相关部分的指纹，变了才调用 AI 解析 */
    contentHash: text("content_hash"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    /** 用户点“立即检查”或刚关注时设置，worker 几分钟内处理 */
    checkRequestedAt: timestamp("check_requested_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("graduate_school_univ_name_idx").on(t.university, t.name)],
);

/** AI 从募集要项页面解析出的日程，每个研究科每个入学年度一条 */
export const admissionGuide = pgTable(
  "admission_guide",
  {
    id: text("id").primaryKey(),
    schoolId: text("school_id")
      .notNull()
      .references(() => graduateSchool.id, { onDelete: "cascade" }),
    /** 入学年度（如 2027 = 2027 年 4 月入学的年度，10 月入学也算同一年度） */
    admissionYear: integer("admission_year").notNull(),
    title: text("title"),
    events: jsonb("events").$type<GuideEvent[]>().notNull().default([]),
    sourceUrl: text("source_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("admission_guide_school_year_idx").on(t.schoolId, t.admissionYear)],
);

/** 用户关注的研究科 */
export const schoolWatch = pgTable(
  "school_watch",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => graduateSchool.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.schoolId] }), index("school_watch_school_idx").on(t.schoolId)],
);

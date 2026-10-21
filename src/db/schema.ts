import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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

/** Todo：用户和 AI 共用。日历、关联教授/文档等字段在第 5 步扩展 */
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

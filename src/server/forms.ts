import "server-only";
import { generateText } from "ai";
import { and, desc, eq, getTableColumns, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { applicationForm, document, graduateSchool, user } from "@/db/schema";
import { getChatModel, getVisionModel, isDemoMode } from "@/lib/ai/model";
import type { UsageMeter } from "@/lib/credits";
import { profileScores } from "@/lib/aspirations";
import {
  detectHandwriting,
  layoutForModel,
  mergeAiFields,
  parseAiFill,
  pendingCount,
  type AiFill,
  type Box,
  type FormField,
  type FormLayout,
  type Handwriting,
  type MissingInfo,
} from "@/lib/forms";
import { applicationFacts } from "@/lib/onboarding";
import { analyzeFormPdf, FormPdfError, renderFilledPdf } from "./form-pdf";
import { pdfPageImages } from "./pdf-text";
import { getProfile } from "./profile";
import { getSavedProfessor } from "./professors";
import { download } from "./read-url";

// 申请表的读写和 AI 填写。聊天里的 AI 工具和文书页上的操作都走这里。
// 和文书一样，AI 不直接改内容：AI 填的值放在每一栏的 proposed，用户在预览里接受后才印到 PDF 上。

export type FormRow = typeof applicationForm.$inferSelect;

const PURGE_AFTER_MS = 30 * 24 * 3600 * 1000;

const listColumns = {
  id: applicationForm.id,
  title: applicationForm.title,
  sourceUrl: applicationForm.sourceUrl,
  handwriting: applicationForm.handwriting,
  fields: applicationForm.fields,
  professorId: applicationForm.professorId,
  updatedAt: applicationForm.updatedAt,
};

export async function listForms(userId: string) {
  return db
    .select(listColumns)
    .from(applicationForm)
    .where(and(eq(applicationForm.userId, userId), isNull(applicationForm.deletedAt)))
    .orderBy(desc(applicationForm.updatedAt));
}

/** 不含 PDF 本身（预览、改栏目用不着，几百 KB 不必每次读） */
export type FormMeta = Omit<FormRow, "pdf">;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 去掉 pdf 列
const { pdf: _pdf, ...metaColumns } = getTableColumns(applicationForm);

const own = (userId: string, id: string) => and(eq(applicationForm.id, id), eq(applicationForm.userId, userId), isNull(applicationForm.deletedAt));

export async function getForm(userId: string, id: string): Promise<FormMeta | null> {
  const [row] = await db.select(metaColumns).from(applicationForm).where(own(userId, id));
  return row ?? null;
}

export async function getFormWithPdf(userId: string, id: string): Promise<FormRow | null> {
  const [row] = await db.select().from(applicationForm).where(own(userId, id));
  return row ?? null;
}

async function getFormOrThrow(userId: string, id: string) {
  const form = await getForm(userId, id);
  if (!form) throw new Error("找不到这份申请表");
  return form;
}

async function saveFields(form: FormMeta, patch: Partial<Pick<FormRow, "fields" | "missing" | "handwriting" | "title">>, baseVersion?: number) {
  const where = baseVersion === undefined ? eq(applicationForm.id, form.id) : and(eq(applicationForm.id, form.id), eq(applicationForm.version, baseVersion));
  const [row] = await db
    .update(applicationForm)
    .set({ ...patch, version: form.version + 1, updatedAt: new Date() })
    .where(where)
    .returning(metaColumns);
  return row ?? null;
}

/** 改栏目：读最新的一份，改完存回；同时有别的修改（AI 刚填了）就重试一次 */
async function mutateFields(userId: string, id: string, change: (fields: FormField[]) => FormField[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = await getFormOrThrow(userId, id);
    const saved = await saveFields(form, { fields: change(form.fields.map((f) => ({ ...f }))) }, form.version);
    if (saved) return saved;
  }
  throw new Error("保存冲突，请刷新后再试");
}

// ---------- 用户在预览里的操作 ----------

export async function acceptProposals(userId: string, id: string, fieldIds?: string[]) {
  return mutateFields(userId, id, (fields) =>
    fields.map((f) => (f.proposed !== null && (!fieldIds || fieldIds.includes(f.id)) ? { ...f, value: f.proposed, proposed: null } : f)),
  );
}

export async function rejectProposals(userId: string, id: string, fieldIds?: string[]) {
  return mutateFields(userId, id, (fields) => fields.map((f) => (!fieldIds || fieldIds.includes(f.id) ? { ...f, proposed: null } : f)));
}

/** 用户自己改一栏（直接生效，这一栏的 AI 提议作废） */
export async function setFieldValue(userId: string, id: string, fieldId: string, value: string) {
  return mutateFields(userId, id, (fields) => fields.map((f) => (f.id === fieldId ? { ...f, value: value.slice(0, 2000), proposed: null } : f)));
}

export async function moveField(userId: string, id: string, fieldId: string, box: Box) {
  return mutateFields(userId, id, (fields) => fields.map((f) => (f.id === fieldId ? { ...f, ...clampBox(box) } : f)));
}

export async function setFieldOptions(userId: string, id: string, fieldId: string, opts: { multiline?: boolean; label?: string }) {
  return mutateFields(userId, id, (fields) =>
    fields.map((f) => (f.id === fieldId ? { ...f, ...(opts.multiline === undefined ? {} : { multiline: opts.multiline }), ...(opts.label ? { label: opts.label.slice(0, 60) } : {}) } : f)),
  );
}

/** 用户在预览上点一处空白，加一栏自己填 */
export async function addField(userId: string, id: string, page: number, box: Box, label: string) {
  return mutateFields(userId, id, (fields) => [
    ...fields,
    { id: crypto.randomUUID().slice(0, 8), page, ...clampBox(box), label: label.slice(0, 60) || "新的一栏", kind: "text", value: "", proposed: null },
  ]);
}

export async function removeField(userId: string, id: string, fieldId: string) {
  return mutateFields(userId, id, (fields) => fields.filter((f) => f.id !== fieldId));
}

const clampBox = (b: Box): Box => ({ x: Math.max(0, b.x), y: Math.max(0, b.y), w: Math.max(4, Math.min(2000, b.w)), h: Math.max(4, Math.min(2000, b.h)) });

export async function renameForm(userId: string, id: string, title: string) {
  const form = await getFormOrThrow(userId, id);
  await saveFields(form, { title: title.slice(0, 100) });
}

/** 用户改「是否要求手写」（AI 判断错了时） */
export async function setHandwriting(userId: string, id: string, handwriting: Handwriting | null) {
  const form = await getFormOrThrow(userId, id);
  await saveFields(form, { handwriting });
}

export async function deleteForm(userId: string, id: string) {
  await db
    .update(applicationForm)
    .set({ deletedAt: new Date() })
    .where(and(eq(applicationForm.id, id), eq(applicationForm.userId, userId), isNull(applicationForm.deletedAt)));
  await db.delete(applicationForm).where(and(eq(applicationForm.userId, userId), lt(applicationForm.deletedAt, new Date(Date.now() - PURGE_AFTER_MS))));
}

export async function restoreForm(userId: string, id: string) {
  await db
    .update(applicationForm)
    .set({ deletedAt: null })
    .where(and(eq(applicationForm.id, id), eq(applicationForm.userId, userId), isNotNull(applicationForm.deletedAt)));
}

/** 下载用的 PDF：只印已接受的内容 */
export async function renderForm(userId: string, id: string) {
  const form = await getFormWithPdf(userId, id);
  if (!form) throw new Error("找不到这份申请表");
  const pdf = await renderFilledPdf(form.pdf, form.layout, form.fields, !!form.handwriting?.required);
  return { form, pdf };
}

// ---------- AI 填写 ----------

type FillContext = { userMd: string; facts: string; email: string; name: string; professor: string; school: string; documents: string; today: string };

/** 填表用得上的用户资料：user.md、申请概况、目标教授和研究科、计划书（研究题目、研究内容） */
async function fillContext(userId: string, professorId: string | null, schoolId: string | null): Promise<FillContext> {
  const [profile, [account], professor] = await Promise.all([
    getProfile(userId),
    db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, userId)),
    professorId ? getSavedProfessor(userId, professorId) : null,
  ]);
  const sid = schoolId ?? professor?.schoolId ?? null;
  const [school] = sid ? await db.select().from(graduateSchool).where(eq(graduateSchool.id, sid)) : [];
  const userMd = profile?.markdown ?? "";
  const facts = profile?.onboarding ? applicationFacts(profile.onboarding, profileScores(userMd, profile.onboarding).jlpt) : null;
  // 计划书和自我介绍：给这位教授的定制版优先，其次通用版；每份只取前面一部分
  const docs = await db
    .select({ id: document.id, kind: document.kind, title: document.title, markdown: document.markdown, target: document.targetProfessor })
    .from(document)
    .where(and(eq(document.userId, userId), isNull(document.deletedAt)))
    .orderBy(desc(document.updatedAt));
  const relevant = docs
    .filter((d) => d.kind === "plan" || d.kind === "intro")
    .sort((a, b) => Number(b.target?.professorId === professorId && !!professorId) - Number(a.target?.professorId === professorId && !!professorId))
    .slice(0, 3);
  return {
    userMd,
    facts: facts ? `路径：${facts.path}；目标入学：${facts.targetEntry}；路线：${facts.track}` : "（没有）",
    email: account?.email ?? "",
    name: account?.name ?? "",
    professor: professor ? `${professor.name}（${professor.university}${professor.department ? ` ${professor.department}` : ""}${professor.lab ? ` ${professor.lab}` : ""}）` : "（没指定）",
    school: school ? `${school.university} ${school.name}` : "（没指定）",
    documents: relevant.length ? relevant.map((d) => `### ${d.title}（${d.kind === "plan" ? "研究计划书" : "自我介绍"}）\n${d.markdown.slice(0, 3000)}`).join("\n\n") : "（还没有）",
    today: new Intl.DateTimeFormat("ja-JP-u-ca-japanese", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(new Date()) + `（西暦 ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}）`,
  };
}

const FILL_RULES = `规则：
- 只填资料里明确有的信息，不要编造（学历、成绩、经历、住址、电话、护照号码等）。资料里没有的栏目：value 写空字符串，在 missing 里列出要问用户的问题（中文）。
- 填进表里的内容用日文：日期按表上的格式（西暦还是和暦，看表上的写法，如「令和」「年 月 日」）；姓名用日本汉字写法（张→張、伟→偉、刘→劉，简体字日文字体里没有，会显示不出来）；フリガナ / ふりがな栏按表上要求用片假名或平假名写中文姓名的读音（如 張 偉 → チョウ イ）；ローマ字栏写拼音（ZHANG Wei）。
- 记入日 / 提出日填今天。志望指导教员、志望研究科、研究题目等从目标教授、研究科和计划书里取。
- 「該当するものに○」这类选项：用 circle 圈出用户的那一项（value 写 "✓"）；□ 打勾用 on（value 写 "✓"）。不确定的不圈。
- 学校事务填写的栏（※印、受験番号、「記入しないこと」「大学使用欄」）和照片、签名（署名、印）栏不填。
- 栏目很长（志望理由、研究计划概要）时，按计划书内容写日文（である体），控制在格子放得下的长度（按格子大小估计，每行约 宽/10.5 个字，行高约 13）。
- handwriting：表上或说明里要求亲笔填写（手書き、自筆、黒ボールペン等）时 required 为 true，reason 用中文写依据。`;

const OUTPUT_FORMAT = `只输出一个 JSON 对象（不要解释），格式：
{
  "handwriting": { "required": false, "reason": "" },
  "fields": [
    { "label": "氏名", "target": { "cell": "c4" }, "value": "張 偉", "note": "可选，中文说明，如「按 user.md 的毕业时间」" }
  ],
  "missing": [ { "label": "現住所", "question": "你现在的住址（日本或国内）是？" } ],
  "summary": "一句中文，说填了哪些、还缺什么"
}`;

const TARGET_HELP = `target 的写法（编号来自下面的版面）：
- {"acro":"a3"}：PDF 自带的填写栏（有填写栏时优先用）；复选框 value 写 "✓" 表示勾选
- {"cell":"c12"}：写进一个格子（通常是标题格右边或下面的空格子）
- {"text":"t7","place":"right"}：写在一段文字的右边（「氏名＿＿＿」这种下划线表）；"below" 写在下面
- {"text":"t9","before":"年"}：写在这段文字里某个字的前面（「　年　月　日」分三栏填：年前面写 2001，月前面写 5，日前面写 13）
- {"text":"t13","circle":"男"}：圈出选项；{"text":"t20","on":"□"}：在 □ 上打勾
已经有的栏（下面「已有的栏」）要改时写 {"field":"栏ID", "value": "..."}，不用再写 target。`;

function fillPrompt(ctx: FillContext, layoutText: string, existing: FormField[], instructions: string, title: string) {
  const known = existing.length
    ? existing.map((f) => `- ${f.id} 第${f.page + 1}页 ${f.label}：${f.value ? `「${f.value.slice(0, 60)}」` : "（空）"}${f.proposed !== null ? `（已提议「${f.proposed.slice(0, 60)}」）` : ""}`).join("\n")
    : "（还没有）";
  return `你在帮一位中国留学生填写日本大学院的申请表「${title}」。根据用户资料决定每一栏写什么、写在哪里。

${FILL_RULES}

${TARGET_HELP}

${OUTPUT_FORMAT}
${instructions ? `\n## 这次的要求\n${instructions}\n` : ""}
## 用户资料
- 今天：${ctx.today}
- 注册邮箱：${ctx.email}（表上要邮箱且资料里没有别的邮箱时用它）
- 申请概况：${ctx.facts}
- 目标教授：${ctx.professor}
- 目标研究科：${ctx.school}

### user.md
${ctx.userMd.slice(0, 12000) || "（空）"}

### 文书（节选）
${ctx.documents}

## 已有的栏
${known}

## 版面
坐标单位是点（pt），原点在页面左上角。每页列出：填写栏（a 编号）、表格线围成的格子（c 编号，「」里是格子里原有的字）、文字段（t 编号）。

${layoutText}`;
}

/** 扫描版：给 AI 看页面图片，坐标用 0–1000 的比例 */
function scannedPrompt(ctx: FillContext, pages: number, existing: FormField[], instructions: string, title: string) {
  return `${fillPrompt(ctx, `（扫描版，没有文字层，共 ${pages} 页，见图片）`, existing, instructions, title).replace(TARGET_HELP, "")}

这份表是扫描版，只有图片。target 写成 {"page": 第几页（从 1 起）, "box": [x, y, 宽, 高]}，坐标是页面宽高的千分比（左上角 0,0，右下角 1000,1000），框住要写字的空白处（不要盖住印好的字）。`;
}

async function runFill(form: Pick<FormRow, "pdf" | "mode" | "layout" | "fields" | "title">, ctx: FillContext, instructions: string, meter?: UsageMeter): Promise<AiFill | null> {
  if (isDemoMode()) return demoFill(form.layout, form.fields, ctx);
  const result =
    form.mode === "scanned"
      ? await generateText({
          model: getVisionModel(),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: scannedPrompt(ctx, form.layout.pages.length, form.fields, instructions, form.title) },
                ...(await pdfPageImages(form.pdf, { maxPages: form.layout.pages.length })).map((img) => ({ type: "file" as const, data: img, mediaType: "image/jpeg" })),
              ],
            },
          ],
        })
      : await generateText({ model: getChatModel(), prompt: fillPrompt(ctx, layoutForModel(form.layout), form.fields, instructions, form.title) });
  meter?.addTokens(result.totalUsage);
  return parseAiFill(result.text);
}

/** 演示模式（没有 API key）：只按栏名填姓名和邮箱，测试整条链路用 */
function demoFill(layout: FormLayout, existing: FormField[], ctx: FillContext): AiFill {
  const fields: AiFill["fields"] = [];
  const empty = (c: { x: number; y: number; page: number }) => layout.cells.find((x) => x.page === c.page && !x.text && x.x > c.x && Math.abs(x.y - c.y) < 4);
  for (const cell of layout.cells) {
    const value = /^(氏\s*名|Name)/i.test(cell.text) ? ctx.name : /mail/i.test(cell.text) ? ctx.email : null;
    const target = value !== null ? empty(cell) : undefined;
    if (target && value !== null) fields.push({ label: cell.text, target: { cell: target.id }, value, note: "演示模式：按栏名填的" });
  }
  for (const a of layout.acro) if (/name|氏名/i.test(a.name)) fields.push({ label: a.name, target: { acro: a.id }, value: ctx.name });
  return { fields: existing.length ? [] : fields, missing: [{ label: "其他栏目", question: "（演示模式）配置 DeepSeek API key 后 AI 会按你的资料填写其余栏目" }], summary: "演示模式：只填了姓名和邮箱" };
}

export type FillResult = { form: FormMeta; changed: number; skipped: number; missing: MissingInfo[]; summary: string; pending: number };

async function applyFill(form: FormMeta, ai: AiFill | null, explicitHandwriting?: boolean): Promise<FillResult> {
  if (!ai) throw new Error("AI 这次没给出能用的填写结果，请再试一次");
  let n = 0;
  const { fields, changed, skipped } = mergeAiFields(form.fields, ai.fields, form.layout, () => `f${Date.now().toString(36)}${n++}`);
  const handwriting: Handwriting | null =
    explicitHandwriting !== undefined
      ? explicitHandwriting
        ? { required: true, reason: form.handwriting?.reason || "募集要项要求亲笔填写" }
        : null
      : ai.handwriting?.required
        ? { required: true, reason: ai.handwriting.reason || "表上要求亲笔填写" }
        : form.handwriting;
  const saved = await saveFields(form, { fields, missing: ai.missing, handwriting });
  if (!saved) throw new Error("保存冲突，请再试一次");
  return { form: saved, changed, skipped, missing: ai.missing, summary: ai.summary, pending: pendingCount(saved.fields) };
}

export type NewFormInput = {
  url: string;
  pages?: string;
  title?: string;
  professorId?: string | null;
  schoolId?: string | null;
  /** 聊天里的 AI 从募集要项知道学校要求手写时传 true */
  handwritten?: boolean;
  instructions?: string;
};

/** 下载学校的申请表 PDF，读出版面，让 AI 按用户资料填一遍（结果都是提议，等用户接受） */
export async function createFormFromUrl(userId: string, input: NewFormInput, meter?: UsageMeter): Promise<FillResult> {
  // 各步用时记进日志（下载、读版面、AI 填写），慢的时候看得出卡在哪
  const t0 = Date.now();
  const direct = await download(input.url).catch((e) => {
    throw new Error(`下载不了这个 PDF（${e instanceof Error ? e.message : String(e)}）`);
  });
  if (direct.kind !== "pdf") throw new Error("这个链接不是 PDF。请找到申请表（様式）PDF 的直接链接");
  let analyzed;
  try {
    const t1 = Date.now();
    analyzed = await analyzeFormPdf(direct.data, input.pages);
    console.info(`[forms] 下载 ${t1 - t0}ms，读版面 ${Date.now() - t1}ms（${direct.data.length} 字节）`);
  } catch (e) {
    throw e instanceof FormPdfError ? new Error(e.message) : e;
  }
  if (input.professorId && !(await getSavedProfessor(userId, input.professorId))) throw new Error("志愿里没有这位教授，请先用 list_aspirations 确认 ID");
  const detected = detectHandwriting(analyzed.text);
  const pagesNote = analyzed.totalPages > analyzed.sourcePages.length ? `（原 PDF 第 ${analyzed.sourcePages.join("、")} 页）` : "";
  const [form] = await db
    .insert(applicationForm)
    .values({
      id: crypto.randomUUID(),
      userId,
      title: (input.title?.trim() || analyzed.text.match(/[^\s]{0,20}(願書|出願票|履歴書|申請書|調書|志望理由書|計画書)/)?.[0] || "申请表").slice(0, 80) + pagesNote,
      sourceUrl: input.url,
      sourcePages: analyzed.sourcePages,
      totalPages: analyzed.totalPages,
      pdf: analyzed.pdf,
      mode: analyzed.mode,
      layout: analyzed.layout,
      handwriting: input.handwritten ? { required: true, reason: "募集要项要求亲笔填写" } : detected,
      professorId: input.professorId ?? null,
      schoolId: input.schoolId ?? null,
    })
    .returning();
  const ctx = await fillContext(userId, form.professorId, form.schoolId);
  const t2 = Date.now();
  const ai = await runFill(form, ctx, input.instructions ?? "", meter);
  console.info(`[forms] AI 填写 ${Date.now() - t2}ms（${form.mode}，${analyzed.layout.cells.length} 个格子，${ai?.fields.length ?? 0} 栏）`);
  return applyFill(form, ai, input.handwritten);
}

/** 再填一遍（用户补充了信息，或者要求改某几栏）：已有的栏更新提议，新的栏加上 */
export async function refillForm(userId: string, id: string, instructions: string, meter?: UsageMeter, handwritten?: boolean): Promise<FillResult> {
  const form = await getFormWithPdf(userId, id);
  if (!form) throw new Error("找不到这份申请表");
  const ctx = await fillContext(userId, form.professorId, form.schoolId);
  return applyFill(form, await runFill(form, ctx, instructions, meter), handwritten);
}

/** 聊天里的 AI 直接给某几栏提议新内容（用户在对话里告诉了住址、电话等） */
export async function proposeFieldValues(userId: string, id: string, values: { fieldId: string; value: string; note?: string }[]) {
  const form = await getFormOrThrow(userId, id);
  const unknown = values.filter((v) => !form.fields.some((f) => f.id === v.fieldId)).map((v) => v.fieldId);
  if (unknown.length) throw new Error(`没有这些栏：${unknown.join("、")}，先用 read_application_form 看栏目 ID`);
  const { fields, changed } = mergeAiFields(
    form.fields,
    values.map((v) => ({ field: v.fieldId, value: v.value, note: v.note })),
    form.layout,
    () => crypto.randomUUID().slice(0, 8),
  );
  const saved = await saveFields(form, { fields });
  if (!saved) throw new Error("保存冲突，请再试一次");
  return { form: saved, changed, pending: pendingCount(saved.fields) };
}

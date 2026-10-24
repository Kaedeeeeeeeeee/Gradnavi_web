"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormField } from "@/lib/forms";
import { requireUser } from "@/lib/session";
import {
  acceptProposals,
  addField,
  deleteForm,
  moveField,
  rejectProposals,
  removeField,
  renameForm,
  restoreForm,
  setFieldOptions,
  setFieldValue,
  setHandwriting,
} from "@/server/forms";

// 申请表预览上的用户操作（和 AI 工具走同一套 src/server/forms）。
// 改栏目的操作返回最新的栏目，预览直接换上，不用刷新整个外壳。

const idSchema = z.string().max(64);
const boxSchema = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() });
const idsSchema = z.array(idSchema).max(300).optional();

const out = (row: { fields: unknown; version: number }) => ({ fields: row.fields as FormField[], version: row.version });

export async function acceptFormFieldsAction(id: string, fieldIds?: string[]) {
  const user = await requireUser();
  const r = out(await acceptProposals(user.id, idSchema.parse(id), idsSchema.parse(fieldIds)));
  // 文书列表上的「N 栏待确认」跟着变
  revalidatePath("/", "layout");
  return r;
}

export async function rejectFormFieldsAction(id: string, fieldIds?: string[]) {
  const user = await requireUser();
  const r = out(await rejectProposals(user.id, idSchema.parse(id), idsSchema.parse(fieldIds)));
  revalidatePath("/", "layout");
  return r;
}

export async function setFormFieldValueAction(id: string, fieldId: string, value: string) {
  const user = await requireUser();
  return out(await setFieldValue(user.id, idSchema.parse(id), idSchema.parse(fieldId), z.string().max(2000).parse(value)));
}

export async function moveFormFieldAction(id: string, fieldId: string, box: z.infer<typeof boxSchema>) {
  const user = await requireUser();
  return out(await moveField(user.id, idSchema.parse(id), idSchema.parse(fieldId), boxSchema.parse(box)));
}

export async function setFormFieldOptionsAction(id: string, fieldId: string, opts: { multiline?: boolean; label?: string }) {
  const user = await requireUser();
  const o = z.object({ multiline: z.boolean().optional(), label: z.string().max(60).optional() }).parse(opts);
  return out(await setFieldOptions(user.id, idSchema.parse(id), idSchema.parse(fieldId), o));
}

export async function addFormFieldAction(id: string, page: number, box: z.infer<typeof boxSchema>, label: string) {
  const user = await requireUser();
  return out(await addField(user.id, idSchema.parse(id), z.number().int().min(0).max(50).parse(page), boxSchema.parse(box), z.string().max(60).parse(label)));
}

export async function removeFormFieldAction(id: string, fieldId: string) {
  const user = await requireUser();
  return out(await removeField(user.id, idSchema.parse(id), idSchema.parse(fieldId)));
}

export async function setFormHandwritingAction(id: string, required: boolean) {
  const user = await requireUser();
  await setHandwriting(user.id, idSchema.parse(id), required ? { required: true, reason: "你标记了要求亲笔填写" } : null);
  revalidatePath("/", "layout");
}

export async function renameFormAction(id: string, title: string) {
  const user = await requireUser();
  await renameForm(user.id, idSchema.parse(id), z.string().trim().min(1).max(100).parse(title));
  revalidatePath("/", "layout");
}

export async function deleteFormAction(id: string) {
  const user = await requireUser();
  await deleteForm(user.id, idSchema.parse(id));
  revalidatePath("/", "layout");
}

export async function restoreFormAction(id: string) {
  const user = await requireUser();
  await restoreForm(user.id, idSchema.parse(id));
  revalidatePath("/", "layout");
}

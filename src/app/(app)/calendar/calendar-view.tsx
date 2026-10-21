"use client";

import { useState, useTransition } from "react";
import { CALENDAR_KIND_LABELS, CALENDAR_KINDS, type CalendarKind } from "@/lib/calendar";
import { addEventAction, deleteEventAction } from "./actions";

const input = "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function AddEventForm({ defaultDate }: { defaultDate: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", date: defaultDate, endDate: "", kind: "other" as CalendarKind, note: "" });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await addEventAction(form);
          if (res.ok) setForm((f) => ({ ...f, title: "", endDate: "", note: "" }));
          else setError(res.error);
        });
      }}
      className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800"
    >
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="标题，如 JLPT N1 考试" className={input} />
      <div className="flex gap-2">
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${input} min-w-0`} required />
        <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={`${input} min-w-0`} title="结束日期（可选）" />
      </div>
      <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CalendarKind })} className={input}>
        {CALENDAR_KINDS.map((k) => (
          <option key={k} value={k}>
            {CALENDAR_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注（可选）" className={input} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="rounded-md bg-foreground px-3 py-1.5 text-background disabled:opacity-50">
        {pending ? "添加中…" : "添加"}
      </button>
    </form>
  );
}

export function DeleteEventButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => deleteEventAction(id))}
      className="text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-600"
    >
      删除
    </button>
  );
}

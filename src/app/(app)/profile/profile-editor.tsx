"use client";

import { useState, useTransition } from "react";
import { saveProfileMarkdown } from "../actions";

export function ProfileEditor({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const dirty = value !== saved;

  // AI 在侧边栏改了档案后页面会刷新：没有未保存修改时同步新内容，有修改时保留用户正在编辑的内容
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    if (!dirty) setValue(initial);
    setSaved(initial);
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        await saveProfileMarkdown(value);
        setSaved(value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      }
    });
  }

  return (
    <div className="space-y-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={24}
        spellCheck={false}
        className="input w-full p-3 font-mono text-sm leading-relaxed"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || pending}
          className="btn-primary px-4 py-2 text-sm"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        <span className="text-sm text-muted">{dirty ? "有未保存的修改" : "已保存"}</span>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}

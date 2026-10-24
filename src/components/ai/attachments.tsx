"use client";

import { FileText, Paperclip } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { uuid } from "@/lib/browser";
import { ACCEPT, formatSize, kindLabel, MAX_ATTACHMENTS, uploadProblem, type AttachmentRef } from "@/lib/attachments";

// 聊天附件的前端：回形针按钮、拖进 AI 栏、在输入框里粘贴，都会马上上传；输入框上面显示附件小卡片（图片带缩略图），
// 上传完才能发送。发出的消息里附件显示在用户的话上面，点一下打开文件。说明见 src/lib/attachments.ts。

type Draft = {
  key: string;
  name: string;
  size: number;
  mediaType: string;
  /** 图片的本地预览 */
  preview?: string;
  status: "uploading" | "ready" | "error";
  ref?: AttachmentRef;
  error?: string;
};

async function upload(file: File): Promise<AttachmentRef> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/attachments", { method: "POST", body });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || "上传失败，请稍后再试");
  return (await res.json()) as AttachmentRef;
}

/** 粘贴的截图浏览器都叫 image.png，换个看得懂的名字 */
function renamePasted(file: File): File {
  if (!/^image\.\w+$/.test(file.name)) return file;
  const ext = file.name.split(".").pop();
  const t = new Date();
  const hhmm = `${String(t.getHours()).padStart(2, "0")}${String(t.getMinutes()).padStart(2, "0")}`;
  return new File([file], `截图-${hhmm}.${ext}`, { type: file.type });
}

export function useAttachments() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const countRef = useRef(0);
  useEffect(() => {
    countRef.current = drafts.length;
  }, [drafts]);
  // 离开页面时释放本地预览
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const add = useCallback((files: File[], pasted = false) => {
    const problems: string[] = [];
    let room = MAX_ATTACHMENTS - countRef.current;
    const accepted: Draft[] = [];
    for (const raw of files) {
      const file = pasted ? renamePasted(raw) : raw;
      const problem = uploadProblem(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      if (room <= 0) {
        problems.push(`一条消息最多附 ${MAX_ATTACHMENTS} 个文件`);
        break;
      }
      room--;
      const key = uuid();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (preview) previews.current.add(preview);
      accepted.push({ key, name: file.name, size: file.size, mediaType: file.type, preview, status: "uploading" });
      upload(file).then(
        (ref) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, status: "ready", ref } : x))),
        (e: Error) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, status: "error", error: e.message } : x))),
      );
    }
    countRef.current += accepted.length;
    if (accepted.length) setDrafts((d) => [...d, ...accepted]);
    setNotice(problems.length ? problems.join("；") : null);
  }, []);

  const remove = useCallback((key: string) => {
    setDrafts((d) => d.filter((x) => x.key !== key));
    setNotice(null);
  }, []);

  /** 发送时取走已上传好的附件，清空输入框里的卡片 */
  const take = useCallback((): AttachmentRef[] => {
    const refs = drafts.flatMap((d) => (d.status === "ready" && d.ref ? [d.ref] : []));
    setDrafts([]);
    setNotice(null);
    return refs;
  }, [drafts]);

  return {
    drafts,
    notice,
    add,
    remove,
    take,
    uploading: drafts.some((d) => d.status === "uploading"),
    ready: drafts.some((d) => d.status === "ready"),
  };
}

/** 回形针按钮（打开文件选择框） */
export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        title="添加附件：图片、PDF、Word（.docx）、文本，也可以拖进来或直接粘贴截图"
        aria-label="添加附件"
        className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-foreground disabled:opacity-40"
      >
        <Icon icon={Paperclip} className="size-4" />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );
}

/** 输入框里的附件卡片 */
export function AttachmentDrafts({ drafts, notice, onRemove }: { drafts: Draft[]; notice: string | null; onRemove: (key: string) => void }) {
  if (!drafts.length && !notice) return null;
  return (
    <div className="space-y-1.5 px-2.5 pt-2.5" data-testid="attachment-drafts">
      {drafts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {drafts.map((d) => (
            <span
              key={d.key}
              title={d.error ?? `${d.name}（${formatSize(d.size)}）`}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-md border py-0.5 pl-0.5 pr-0.5 text-xs ${d.status === "error" ? "border-danger/40 bg-danger-soft" : "border-line bg-subtle"}`}
            >
              {d.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.preview} alt="" className="size-7 shrink-0 rounded object-cover" />
              ) : (
                <span className="grid size-7 shrink-0 place-items-center rounded bg-surface">
                  <Icon icon={FileText} className="size-4" />
                </span>
              )}
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="max-w-40 truncate">{d.name}</span>
                <span className={d.status === "error" ? "max-w-40 truncate text-danger" : "text-faint"}>
                  {d.status === "uploading" ? "上传中…" : d.status === "error" ? d.error : formatSize(d.size)}
                </span>
              </span>
              <button type="button" onClick={() => onRemove(d.key)} className="shrink-0 self-start rounded px-1 text-faint hover:bg-line hover:text-foreground" aria-label={`删掉附件 ${d.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {notice && <p className="text-xs text-danger">{notice}</p>}
    </div>
  );
}

/** 聊天记录里用户发出的附件：图片显示缩略图，其他显示文件卡片；点一下在新标签页打开 */
export function SentAttachments({ attachments }: { attachments: AttachmentRef[] }) {
  if (!attachments.length) return null;
  return (
    <div className="ml-auto flex w-fit max-w-[85%] flex-wrap items-start justify-end gap-1.5" data-testid="sent-attachments">
      {attachments.map((a) => {
        const href = `/api/attachments/${a.id}`;
        if (a.mediaType.startsWith("image/"))
          return (
            <a key={a.id} href={href} target="_blank" rel="noreferrer" title={a.name} className="block overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={href} alt={a.name} className="max-h-40 max-w-56 object-cover" />
            </a>
          );
        return (
          <a
            key={a.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            title={a.name}
            className="flex max-w-64 items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs hover:bg-subtle"
          >
            <Icon icon={FileText} className="size-5" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-foreground">{a.name}</span>
              <span className="text-faint">
                {kindLabel(a)} · {formatSize(a.size)}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

/** 拖文件进 AI 栏时盖一层提示 */
export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-panel/90 text-sm text-accent">
      <span className="flex items-center gap-2">
        <Icon icon={Paperclip} className="size-4 text-accent" />
        松开就加到消息里（图片、PDF、Word、文本）
      </span>
    </div>
  );
}

import { OpenTabLink } from "@/components/shell/app-shell";
import { DOC_KIND_LABELS } from "@/lib/documents";
import { requireUser } from "@/lib/session";
import { listDocuments } from "@/server/documents";
import { answerField } from "@/lib/onboarding";
import { getProfile } from "@/server/profile";
import { createDocumentAction } from "./actions";

export const metadata = { title: "文书 · GradNavi" };

const fmt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });

export default async function DocumentsPage() {
  const user = await requireUser();
  const [docs, profile] = await Promise.all([listDocuments(user.id), getProfile(user.id)]);
  const field = answerField(profile?.onboarding) ?? "humanities";

  const newButtons = [
    { label: `研究计划书（${field === "sciences" ? "理科" : "文科"}模板）`, action: createDocumentAction.bind(null, "plan", field) },
    {
      label: `研究计划书（${field === "sciences" ? "文科" : "理科"}模板）`,
      action: createDocumentAction.bind(null, "plan", field === "sciences" ? "humanities" : "sciences"),
    },
    { label: "套磁信", action: createDocumentAction.bind(null, "letter", undefined) },
    { label: "自我介绍", action: createDocumentAction.bind(null, "intro", undefined) },
    { label: "空白文书", action: createDocumentAction.bind(null, "other", undefined) },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">文书</h1>
        <p className="text-sm text-zinc-500">研究计划书、套磁信、自我介绍都在这里写。点开的文书在中间的文稿栏编辑，正文用日文；右侧 AI 可以直接读写你打开的文书。</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {newButtons.map((b) => (
          <form key={b.label} action={b.action}>
            <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-500 dark:border-zinc-700">
              + {b.label}
            </button>
          </form>
        ))}
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-zinc-500">还没有文书。新建一份研究计划书，AI 会分步带你写。</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {docs.map((d) => (
            <li key={d.id}>
              <OpenTabLink tab={{ kind: "doc", id: d.id, title: d.title }} href={`/documents/${d.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-xs text-zinc-500">{DOC_KIND_LABELS[d.kind]}</span>
                  {d.title}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">{fmt.format(d.updatedAt)}</span>
              </OpenTabLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

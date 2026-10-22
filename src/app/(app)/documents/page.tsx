import { requireUser } from "@/lib/session";
import { listDocuments } from "@/server/documents";
import { answerField } from "@/lib/onboarding";
import { getProfile } from "@/server/profile";
import { createDocumentAction } from "./actions";
import { DocumentList } from "./document-list";

export const metadata = { title: "文书 · GradNavi" };

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
      <div className="space-y-2">
        <h1 className="page-title">文书</h1>
        <p className="text-sm text-muted">研究计划书、套磁信、自我介绍都在这里写。点开的文书在中间的文稿栏编辑，正文用日文；右侧 AI 可以直接读写你打开的文书。</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {newButtons.map((b) => (
          <form key={b.label} action={b.action}>
            <button className="btn px-3 py-1.5 text-sm">
              + {b.label}
            </button>
          </form>
        ))}
      </div>

      <DocumentList docs={docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, updatedAt: d.updatedAt.toISOString() }))} />
    </div>
  );
}

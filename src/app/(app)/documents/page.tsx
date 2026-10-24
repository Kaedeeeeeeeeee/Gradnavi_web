import { requireUser } from "@/lib/session";
import { listDocuments } from "@/server/documents";
import { listForms } from "@/server/forms";
import { answerField } from "@/lib/onboarding";
import { getProfile } from "@/server/profile";
import { createDocumentAction } from "./actions";
import { DocumentList } from "./document-list";
import { FormList } from "./form-list";
import { DOC_KIND_ICONS, Icon } from "@/components/ui/icons";
import { FileText } from "lucide-react";

export const metadata = { title: "文书 · GradNavi" };

export default async function DocumentsPage() {
  const user = await requireUser();
  const [docs, profile, forms] = await Promise.all([listDocuments(user.id), getProfile(user.id), listForms(user.id)]);
  const field = answerField(profile?.onboarding) ?? "humanities";

  const newButtons = [
    { kind: "plan" as const, label: `研究计划书（${field === "sciences" ? "理科" : "文科"}模板）`, action: createDocumentAction.bind(null, "plan", field) },
    {
      kind: "plan" as const,
      label: `研究计划书（${field === "sciences" ? "文科" : "理科"}模板）`,
      action: createDocumentAction.bind(null, "plan", field === "sciences" ? "humanities" : "sciences"),
    },
    { kind: "letter" as const, label: "套磁信", action: createDocumentAction.bind(null, "letter", undefined) },
    { kind: "intro" as const, label: "自我介绍", action: createDocumentAction.bind(null, "intro", undefined) },
    { kind: "other" as const, label: "空白文书", action: createDocumentAction.bind(null, "other", undefined) },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="page-title flex items-center gap-2">
          <Icon icon={FileText} className="size-5" />
          文书
        </h1>
        <p className="text-sm text-muted">研究计划书、套磁信、自我介绍都在这里写；学校发的申请表（PDF）也可以让 AI 填好放在这里。点开的文书在中间的文稿栏编辑，正文用日文；右侧 AI 可以直接读写你打开的文书。</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {newButtons.map((b) => (
          <form key={b.label} action={b.action}>
            <button className="btn gap-1.5 px-3 py-1.5 text-sm">
              <Icon icon={DOC_KIND_ICONS[b.kind].icon} className="size-3.5" />
              {b.label}
            </button>
          </form>
        ))}
      </div>

      <DocumentList docs={docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, updatedAt: d.updatedAt.toISOString() }))} />

      <FormList
        forms={forms.map((f) => ({
          id: f.id,
          title: f.title,
          reference: !!f.handwriting?.required,
          pending: f.fields.filter((x) => x.proposed !== null).length,
          updatedAt: f.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}

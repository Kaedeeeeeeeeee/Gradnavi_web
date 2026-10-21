import { notFound } from "next/navigation";
import { detectPlanField } from "@/lib/documents";
import { decideTrack } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { getDocument } from "@/server/documents";
import { getProfile } from "@/server/profile";
import { listSavedProfessors } from "@/server/professors";
import { DocumentEditor } from "./editor";

export async function generateMetadata({ params }: PageProps<"/documents/[id]">) {
  const user = await requireUser();
  const doc = await getDocument(user.id, (await params).id);
  return { title: `${doc?.title ?? "文书"} · GradNavi` };
}

export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [doc, profile, professors] = await Promise.all([getDocument(user.id, id), getProfile(user.id), listSavedProfessors(user.id)]);
  if (!doc) notFound();
  const onboarding = profile?.onboarding;
  const linked = professors.find((p) => p.id === doc.targetProfessor?.professorId);
  // 从找教授页“写套磁信”进来时带 ?ai=letter，进入后让 AI 写初稿
  const autoAsk = (await searchParams).ai === "letter" && doc.kind === "letter" ? "letter" : null;

  return (
    <DocumentEditor
      doc={{
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        markdown: doc.markdown,
        version: doc.version,
        targetProfessor: doc.targetProfessor,
      }}
      planField={detectPlanField(doc.markdown, onboarding?.field ?? "humanities")}
      track={onboarding ? decideTrack(onboarding) : null}
      professors={professors.map((p) => ({ id: p.id, label: `${p.name}（${p.university}）` }))}
      linkedStatus={linked?.status ?? null}
      autoAsk={autoAsk}
    />
  );
}

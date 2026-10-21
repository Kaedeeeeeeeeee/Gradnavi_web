import { notFound } from "next/navigation";
import { detectPlanField } from "@/lib/documents";
import { decideTrack } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { getDocument } from "@/server/documents";
import { getProfile } from "@/server/profile";
import { DocumentEditor } from "./editor";

export async function generateMetadata({ params }: PageProps<"/documents/[id]">) {
  const user = await requireUser();
  const doc = await getDocument(user.id, (await params).id);
  return { title: `${doc?.title ?? "文书"} · GradNavi` };
}

export default async function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [doc, profile] = await Promise.all([getDocument(user.id, id), getProfile(user.id)]);
  if (!doc) notFound();
  const onboarding = profile?.onboarding;

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
    />
  );
}

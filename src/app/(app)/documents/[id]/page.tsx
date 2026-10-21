import { OpenTabOnMount } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/session";
import { getDocument } from "@/server/documents";
import DocumentsPage from "../page";
import { QueueAutoAsk } from "./queue-auto-ask";

export const metadata = { title: "文书 · GradNavi" };

// 文书在中间的文稿栏打开；这个地址（新建文书、从别处链接进来）显示文书列表并打开对应标签
export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const doc = await getDocument(user.id, id);
  // 从找教授页“写套磁信”进来时带 ?ai=letter，进入后让 AI 写初稿
  const letter = (await searchParams).ai === "letter" && doc?.kind === "letter";

  return (
    <>
      {doc && (
        <>
          {letter && <QueueAutoAsk docId={doc.id} />}
          <OpenTabOnMount tab={{ kind: "doc", id: doc.id, title: doc.title }} replaceWith="/documents" />
        </>
      )}
      <DocumentsPage />
    </>
  );
}

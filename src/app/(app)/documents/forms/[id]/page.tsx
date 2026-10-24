import { OpenTabOnMount } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/session";
import { getForm } from "@/server/forms";
import DocumentsPage from "../../page";

export const metadata = { title: "申请表 · GradNavi" };

// 申请表在文稿栏打开；这个地址（AI 填好后的链接、任务里的链接）显示文书列表并打开对应标签
export default async function FormPage({ params }: PageProps<"/documents/forms/[id]">) {
  const user = await requireUser();
  const form = await getForm(user.id, (await params).id);
  return (
    <>
      {form && <OpenTabOnMount tab={{ kind: "form", id: form.id, title: form.title }} replaceWith="/documents" />}
      <DocumentsPage />
    </>
  );
}

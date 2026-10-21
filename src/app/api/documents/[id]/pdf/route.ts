import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getDocument } from "@/server/documents";
import { renderDocumentPdf } from "@/server/pdf";

export const maxDuration = 60;

// 导出文书为 A4 PDF（日文字体），用于发给教授
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/pdf">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  const doc = await getDocument(session.user.id, (await ctx.params).id);
  if (!doc) return new Response("找不到这份文书", { status: 404 });

  try {
    const pdf = await renderDocumentPdf(doc.title, doc.markdown);
    const filename = encodeURIComponent(`${doc.title}.pdf`);
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[pdf]", error);
    return new Response("PDF 生成失败，请稍后再试", { status: 500 });
  }
}

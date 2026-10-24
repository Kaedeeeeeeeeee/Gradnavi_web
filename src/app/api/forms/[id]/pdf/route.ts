import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { renderForm } from "@/server/forms";

export const maxDuration = 60;

// 下载填好的申请表 PDF（只印用户接受了的内容；要求手写的表是参照版）
export async function GET(req: Request, ctx: RouteContext<"/api/forms/[id]/pdf">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  try {
    const { form, pdf } = await renderForm(session.user.id, (await ctx.params).id);
    const name = `${form.title}${form.handwriting?.required ? "（参照版）" : ""}.pdf`;
    const download = new URL(req.url).searchParams.has("download");
    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "找不到这份申请表") return new Response(error.message, { status: 404 });
    console.error("[form-pdf]", error);
    return new Response("PDF 生成失败，请稍后再试", { status: 500 });
  }
}

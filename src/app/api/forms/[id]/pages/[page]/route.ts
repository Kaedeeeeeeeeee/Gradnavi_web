import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getFormWithPdf } from "@/server/forms";
import { pdfPageImage } from "@/server/pdf-text";

export const maxDuration = 30;

// 申请表预览的底图：原表的一页（不含印上的字，字由预览组件叠在上面，拖动、修改时不用重新生成）
export async function GET(_req: Request, ctx: RouteContext<"/api/forms/[id]/pages/[page]">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  const { id, page } = await ctx.params;
  const form = await getFormWithPdf(session.user.id, id);
  const n = Number(page);
  if (!form || !Number.isInteger(n) || n < 1 || n > form.layout.pages.length) return new Response("找不到这一页", { status: 404 });
  try {
    const jpeg = await pdfPageImage(form.pdf, n, 1400);
    // 底图不会变（字是叠上去的），可以缓存
    return new Response(jpeg as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable" } });
  } catch (error) {
    console.error("[form-page]", error);
    return new Response("这一页显示不了", { status: 500 });
  }
}

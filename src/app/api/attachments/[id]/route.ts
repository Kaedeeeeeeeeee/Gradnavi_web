import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAttachmentFile } from "@/server/attachments";

// 聊天附件的预览 / 下载（只能看自己的）。图片和 PDF 在浏览器里直接打开，其他下载
export async function GET(req: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  const file = await getAttachmentFile(session.user.id, (await ctx.params).id);
  if (!file) return new Response("找不到这个文件", { status: 404 });
  const inline = (file.mediaType.startsWith("image/") || file.mediaType === "application/pdf") && !new URL(req.url).searchParams.has("download");
  return new Response(file.data as BodyInit, {
    headers: {
      "Content-Type": file.mediaType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { saveAttachment, UploadError } from "@/server/attachments";

export const maxDuration = 60;

// 聊天附件上传：一次一个文件（multipart，字段名 file）。返回附件信息，随下一条消息发给 AI
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("未登录", { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return new Response("没有收到文件", { status: 400 });
  try {
    return Response.json(await saveAttachment(session.user.id, file));
  } catch (error) {
    if (error instanceof UploadError) return new Response(error.message, { status: 400 });
    console.error("[attachments]", error);
    return new Response("上传失败，请稍后再试", { status: 500 });
  }
}

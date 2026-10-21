import { requireUser } from "@/lib/session";
import { getProfile } from "@/server/profile";
import { ProfileEditor } from "./profile-editor";

export const metadata = { title: "AI 对你的了解 · GradNavi" };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">AI 对你的了解</h1>
        <p className="text-sm text-zinc-500">
          AI 每次对话都会读这份档案（user.md）。聊天里你说的成绩、目标、偏好，AI 会记到这里，并在对话里显示「已记住」，可以撤销。
          标「（还没聊到）」的地方，之后聊到时 AI 会补上。哪里不对，直接在下面改。
        </p>
      </div>
      <ProfileEditor initial={profile?.markdown ?? ""} />
    </div>
  );
}

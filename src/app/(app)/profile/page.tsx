import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProfile } from "@/server/profile";
import { ProfileEditor } from "./profile-editor";

export const metadata = { title: "我的档案 · GradNavi" };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">我的档案（user.md）</h1>
        <p className="text-sm text-zinc-500">
          AI 每次对话都会读这份档案，你告诉 AI 的新信息也会被记到这里。可以随时直接修改。
          {profile?.onboardedAt && (
            <>
              {" "}
              <Link href="/onboarding" className="underline">
                重新填写引导问卷
              </Link>
            </>
          )}
        </p>
      </div>
      <ProfileEditor initial={profile?.markdown ?? ""} />
    </div>
  );
}

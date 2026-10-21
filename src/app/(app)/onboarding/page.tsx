import { onboardingQuestions } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { getProfile } from "@/server/profile";
import { OnboardingWizard } from "./wizard";

export const metadata = { title: "开始使用 · GradNavi" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{profile?.onboardedAt ? "重新填写引导问卷" : "先认识一下你"}</h1>
        <p className="text-sm text-zinc-500">
          {profile?.onboardedAt
            ? "提交后会用新答案覆盖你的档案（user.md），已有的 Todo 不变。"
            : "回答几个问题（约 2 分钟），我们会生成你的档案和一份初始路线图。之后随时可以修改。"}
        </p>
      </div>
      <OnboardingWizard questions={onboardingQuestions()} initial={profile?.onboarding ?? null} />
    </div>
  );
}

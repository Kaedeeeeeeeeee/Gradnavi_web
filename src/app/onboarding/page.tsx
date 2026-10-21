import { redirect } from "next/navigation";
import { onboardingQuestions } from "@/lib/onboarding";
import { requireUser } from "@/lib/session";
import { getProfile } from "@/server/profile";
import { OnboardingWizard } from "./wizard";

export const metadata = { title: "开始使用 · GradNavi" };

// 新用户引导：5 道点选题，做完直接进工作台。不在三栏外壳里，做完才进入「工作台 | AI 对话」
export default async function OnboardingPage() {
  const user = await requireUser();
  // 做过问卷（包括旧问卷）的用户不再重做；之后的信息在聊天里补充，或在「AI 对你的了解」里改
  if ((await getProfile(user.id))?.onboardedAt) redirect("/workbench");

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">先认识一下你</h1>
        <p className="text-sm text-zinc-500">5 个问题，点选就行，1 分钟做完。成绩、语言、想去的学校这些，之后和 AI 聊的时候再说。</p>
      </div>
      <OnboardingWizard questions={onboardingQuestions()} />
    </main>
  );
}

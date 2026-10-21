import { splitSchools } from "@/lib/professors";
import { requireUser } from "@/lib/session";
import { getProfile } from "@/server/profile";
import { listSavedProfessors } from "@/server/professors";
import { ProfessorsView } from "./professors-view";

export const metadata = { title: "找教授 · GradNavi" };

export default async function ProfessorsPage() {
  const user = await requireUser();
  const [profile, saved] = await Promise.all([getProfile(user.id), listSavedProfessors(user.id)]);
  const answers = profile?.onboarding;

  return (
    <ProfessorsView
      defaults={{
        keywords: answers?.direction ?? "",
        schools: splitSchools(answers?.targetSchools ?? "").join("、"),
        field: answers?.field ?? "humanities",
      }}
      saved={saved.map((p) => ({
        id: p.id,
        name: p.name,
        university: p.university,
        department: p.department,
        lab: p.lab,
        research: p.research,
        papers: p.papers,
        acceptsInternational: p.acceptsInternational,
        sources: p.sources,
        status: p.status,
        note: p.note,
        followUpDate: p.followUpDate,
      }))}
    />
  );
}

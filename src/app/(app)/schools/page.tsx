import { todayJst } from "@/lib/calendar";
import { requireUser } from "@/lib/session";
import { listWatchedSchools } from "@/server/schools";
import { SchoolsView } from "./schools-view";

export const metadata = { title: "目标研究科 · GradNavi" };

export default async function SchoolsPage() {
  const user = await requireUser();
  const rows = await listWatchedSchools(user.id, todayJst());

  return (
    <SchoolsView
      schools={rows.map(({ school, guide, tentative, calendar }) => ({
        id: school.id,
        university: school.university,
        name: school.name,
        url: school.url,
        checkedAt: school.checkedAt?.toISOString() ?? null,
        pending: !school.checkedAt || !!school.checkRequestedAt,
        problem: school.lastError,
        guideYear: guide?.admissionYear ?? null,
        guideUpdatedAt: guide?.updatedAt.toISOString() ?? null,
        tentative,
        events: calendar.map((it) => ({ key: it.key, title: it.title, date: it.date, endDate: it.endDate ?? null })),
      }))}
    />
  );
}

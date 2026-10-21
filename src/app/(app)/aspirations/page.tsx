import { todayJst } from "@/lib/calendar";
import { requireUser } from "@/lib/session";
import { listAspirations } from "@/server/aspirations";
import { latestProfessorSearch } from "@/server/professor-search";
import { AspirationsView } from "./aspirations-view";

export const metadata = { title: "志愿 · GradNavi" };

// 志愿：每条 = 一位教授 + 教授所在的研究科（也可以只有研究科）。找教授在右侧对话里进行，候选卡片显示在文稿栏。
export default async function AspirationsPage() {
  const user = await requireUser();
  const [list, search] = await Promise.all([listAspirations(user.id, todayJst()), latestProfessorSearch(user.id)]);
  return <AspirationsView list={list} lastSearch={search ? { id: search.id, title: `找教授：${search.keywords}`.slice(0, 40), count: search.candidates.length } : null} />;
}

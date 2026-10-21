import { redirect } from "next/navigation";

// 找教授并入了「志愿」（教授 + 研究科）
export default function ProfessorsPage() {
  redirect("/aspirations");
}

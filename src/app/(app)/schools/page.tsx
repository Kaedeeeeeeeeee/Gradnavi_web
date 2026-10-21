import { redirect } from "next/navigation";

// 目标研究科并入了「志愿」（教授 + 研究科）
export default function SchoolsPage() {
  redirect("/aspirations");
}

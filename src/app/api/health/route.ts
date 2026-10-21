import { sql } from "drizzle-orm";
import { db } from "@/db";

// 供 Docker healthcheck 与部署脚本探活
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}

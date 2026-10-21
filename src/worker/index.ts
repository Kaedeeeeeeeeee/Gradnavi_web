// 定时任务 worker：独立进程，和 web 用同一个镜像（node worker.mjs）。
// 用 pg-boss（基于 Postgres 的队列 + cron），不需要额外的 Redis。
//   admission-daily      每天 4:00（日本时间）检查所有被关注的研究科的募集要项
//   admission-requested  每 5 分钟处理新关注 / 用户点了“立即检查”的研究科
// 数据库迁移由 web 启动时执行，compose 里 worker 等 web 健康后再启动。

import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { runAdmissionChecks } from "@/server/admission-monitor";

const JOBS = [
  { name: "admission-daily", cron: "0 4 * * *", mode: "daily" },
  { name: "admission-requested", cron: "*/5 * * * *", mode: "requested" },
] as const;

async function main() {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, max: 3 });
  boss.on("error", (error) => console.error("[worker]", error));
  await boss.start();

  for (const job of JOBS) {
    // singleton：同一时间只跑一个，上一轮没跑完时不会叠加
    await boss.createQueue(job.name, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
    await boss.schedule(job.name, job.cron, null, { tz: "Asia/Tokyo" });
    await boss.work(job.name, async () => {
      const started = Date.now();
      const summary = await runAdmissionChecks(job.mode);
      if (summary.checked) console.info(`[worker] ${job.name} ${JSON.stringify(summary)} ${Date.now() - started}ms`);
      return summary;
    });
  }
  console.info(`[worker] started: ${JOBS.map((j) => `${j.name} (${j.cron})`).join(", ")}`);

  const stop = async () => {
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((error) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});

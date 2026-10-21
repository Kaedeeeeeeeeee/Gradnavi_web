// 服务启动时自动执行数据库迁移（开发与生产一致，部署无需额外步骤）
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./db/migrate");
    await runMigrations();
  }
}

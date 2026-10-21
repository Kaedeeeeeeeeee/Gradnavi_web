import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // 没有 .env 时直接使用进程环境变量
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});

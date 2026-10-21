import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// 开发时热更新会反复执行模块，复用同一个连接池
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client = globalForDb.pg ?? postgres(env.DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });

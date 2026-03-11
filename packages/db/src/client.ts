import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/mlbb_tools";
const parsedPoolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
const isServerless = process.env.VERCEL === "1";
const poolMax = Number.isFinite(parsedPoolMax) ? Math.min(15, Math.max(isServerless ? 3 : 5, parsedPoolMax)) : 10;

export const pool = new Pool({
  connectionString,
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});
export const db = drizzle(pool, { schema });

export async function closeDbPool() {
  await pool.end();
}

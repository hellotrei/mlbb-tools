import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const filename = fileURLToPath(import.meta.url);
const currentDir = dirname(filename);
const migrationsFile = join(currentDir, "..", "migrations", "0000_init.sql");

async function main() {
  const sql = await readFile(migrationsFile, "utf8");
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/mlbb_tools"
  });

  try {
    await pool.query(sql);
    console.log("[db] migration applied");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

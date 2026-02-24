import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const filename = fileURLToPath(import.meta.url);
const currentDir = dirname(filename);
const migrationsDir = join(currentDir, "..", "migrations");

async function main() {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.log("[db] no migration files found");
    return;
  }

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/mlbb_tools"
  });

  try {
    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await pool.query(sql);
      console.log(`[db] migration applied: ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

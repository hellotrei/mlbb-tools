import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

const workspaceRoot = resolve(import.meta.dirname, "..", "..");
const envFiles = [".env", ".env.local", ".env.production"];

for (const file of envFiles) {
  const path = resolve(workspaceRoot, file);
  if (existsSync(path)) {
    loadEnv({ path, override: file !== ".env" });
  }
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/mlbb_tools"
  }
});

import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env") });

const composeFile = resolve(process.cwd(), "infra", "docker-compose.yml");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/mlbb_tools";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

function run(command, args, { stdio = "inherit", shell = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio, shell });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise(undefined);
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function parseHostPort(urlValue, fallbackHost, fallbackPort) {
  try {
    const parsed = new URL(urlValue);
    return {
      host: parsed.hostname || fallbackHost,
      port: Number(parsed.port || fallbackPort)
    };
  } catch {
    return { host: fallbackHost, port: fallbackPort };
  }
}

async function waitForTcp(name, host, port, attempts = 60, delayMs = 1000) {
  for (let i = 1; i <= attempts; i += 1) {
    const ok = await new Promise((resolveCheck) => {
      const socket = new Socket();
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolveCheck(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolveCheck(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolveCheck(false);
      });
      socket.connect(port, host);
    });

    if (ok) {
      console.log(`[dev] ${name} is reachable at ${host}:${port}`);
      return;
    }

    if (i < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw new Error(`[dev] Timed out waiting for ${name} at ${host}:${port}`);
}

async function main() {
  const pg = parseHostPort(databaseUrl, "localhost", 5432);
  const redis = parseHostPort(redisUrl, "localhost", 6379);

  console.log("[dev] Starting docker services...");
  await run("docker", ["compose", "-f", composeFile, "up", "-d"]);

  console.log("[dev] Waiting for Postgres and Redis...");
  await Promise.all([
    waitForTcp("postgres", pg.host, pg.port),
    waitForTcp("redis", redis.host, redis.port)
  ]);

  console.log("[dev] Running migrations...");
  await run("pnpm", ["-w", "db:migrate"]);

  console.log("[dev] Starting api + web (worker runs separately)...");
  await run("pnpm", ["turbo", "run", "dev", "--filter=@mlbb/api", "--filter=@mlbb/web", "--parallel"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

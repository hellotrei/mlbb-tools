import cron from "node-cron";
import type { Timeframe } from "@mlbb/shared";
import { z } from "zod";
import { TIMEFRAMES } from "./constants";

const DEFAULT_ACTIVE_TIMEFRAMES = "7d,15d,30d";
const DEFAULT_INGEST_CRON = "*/30 * * * *";
const DEFAULT_REDIS_URL = "redis://localhost:6379";

const workerEnvSchema = z.object({
  REDIS_URL: z.string().trim().min(1).default(DEFAULT_REDIS_URL),
  ACTIVE_TIMEFRAMES: z.string().trim().min(1).default(DEFAULT_ACTIVE_TIMEFRAMES),
  INGEST_CRON: z.string().trim().min(1).default(DEFAULT_INGEST_CRON)
});

const timeframeSchema = z.enum(TIMEFRAMES);

export interface WorkerRuntimeConfig {
  readonly redisUrl: string;
  readonly activeTimeframes: Timeframe[];
  readonly ingestCron: string;
}

function parseActiveTimeframes(rawValue: string): Timeframe[] {
  const parsed = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const result = timeframeSchema.safeParse(value);
      if (!result.success) {
        throw new Error(`[worker] ACTIVE_TIMEFRAMES contains unsupported timeframe: ${value}`);
      }
      return result.data;
    });

  if (parsed.length === 0) {
    throw new Error("[worker] ACTIVE_TIMEFRAMES must include at least one timeframe");
  }

  return Array.from(new Set(parsed));
}

export function parseWorkerRuntimeConfig(env: NodeJS.ProcessEnv): WorkerRuntimeConfig {
  const parsedEnv = workerEnvSchema.parse(env);
  const activeTimeframes = parseActiveTimeframes(parsedEnv.ACTIVE_TIMEFRAMES);

  if (!cron.validate(parsedEnv.INGEST_CRON)) {
    throw new Error(`[worker] Invalid INGEST_CRON: ${parsedEnv.INGEST_CRON}`);
  }

  return {
    redisUrl: parsedEnv.REDIS_URL,
    activeTimeframes,
    ingestCron: parsedEnv.INGEST_CRON
  };
}

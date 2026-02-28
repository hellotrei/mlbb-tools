import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import cron from "node-cron";
import { Queue, Worker } from "bullmq";
import type { Timeframe } from "@mlbb/shared";
import { QUEUES, TIMEFRAMES } from "./constants";
import { runIngest } from "./jobs/ingest";
import { runComputeTier } from "./jobs/compute-tier";
import { runComputeCounters } from "./jobs/compute-counters";
import { runComputeSynergies } from "./jobs/compute-synergies";
import { importHeroMeta } from "./services/meta";
import { syncHeroRolePool } from "./services/role-pool";

loadEnv({ path: resolve(process.cwd(), "../../.env") });

const redisConnection = {
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
  maxRetriesPerRequest: null
};

const ingestQueue = new Queue<{ timeframe: Timeframe }>(QUEUES.ingest, { connection: redisConnection });
const tierQueue = new Queue<{ timeframe?: Timeframe }>(QUEUES.tier, { connection: redisConnection });
const countersQueue = new Queue<{ timeframe?: Timeframe }>(QUEUES.counters, { connection: redisConnection });
const synergiesQueue = new Queue<{ timeframe?: Timeframe }>(QUEUES.synergies, { connection: redisConnection });

const ingestWorker = new Worker<{ timeframe: Timeframe }>(
  QUEUES.ingest,
  async (job) => {
    await runIngest(job.data.timeframe);
  },
  { connection: redisConnection, concurrency: 1 }
);

const tierWorker = new Worker<{ timeframe?: Timeframe }>(
  QUEUES.tier,
  async (job) => {
    await runComputeTier(job.data.timeframe);
  },
  { connection: redisConnection, concurrency: 1 }
);

const countersWorker = new Worker<{ timeframe?: Timeframe }>(
  QUEUES.counters,
  async (job) => {
    await runComputeCounters(job.data.timeframe);
  },
  { connection: redisConnection, concurrency: 1 }
);

const synergiesWorker = new Worker<{ timeframe?: Timeframe }>(
  QUEUES.synergies,
  async (job) => {
    await runComputeSynergies(job.data.timeframe);
  },
  { connection: redisConnection, concurrency: 1 }
);

for (const worker of [ingestWorker, tierWorker, countersWorker, synergiesWorker]) {
  worker.on("failed", (job, error) => {
    console.error(`[worker] ${job?.queueName} failed id=${job?.id}`, error);
  });
}

async function enqueueAll() {
  for (const timeframe of TIMEFRAMES) {
    await ingestQueue.add("ingest", { timeframe }, { removeOnComplete: true, removeOnFail: 100 });
  }
  await tierQueue.add("compute-tier", {}, { removeOnComplete: true, removeOnFail: 100 });
  await countersQueue.add("compute-counters", {}, { removeOnComplete: true, removeOnFail: 100 });
  await synergiesQueue.add("compute-synergies", {}, { removeOnComplete: true, removeOnFail: 100 });
}

async function bootstrap() {
  await importHeroMeta();
  await syncHeroRolePool();

  const cronExpr = process.env.INGEST_CRON ?? "*/30 * * * *";
  if (!cron.validate(cronExpr)) {
    throw new Error(`[worker] Invalid INGEST_CRON: ${cronExpr}`);
  }

  await enqueueAll();
  cron.schedule(cronExpr, () => {
    void enqueueAll();
  });
}

async function shutdown() {
  await Promise.all([
    ingestWorker.close(),
    tierWorker.close(),
    countersWorker.close(),
    synergiesWorker.close(),
    ingestQueue.close(),
    tierQueue.close(),
    countersQueue.close(),
    synergiesQueue.close()
  ]);
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

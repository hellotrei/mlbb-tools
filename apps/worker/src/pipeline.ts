import type { Timeframe } from "@mlbb/shared";

export const workerJobOptions = {
  removeOnComplete: true,
  removeOnFail: 100
} as const;

interface QueueLike<JobData> {
  add(name: string, data: JobData, opts: typeof workerJobOptions): Promise<unknown>;
}

interface FollowUpQueues {
  readonly tierQueue: QueueLike<{ timeframe: Timeframe }>;
  readonly countersQueue: QueueLike<{ timeframe: Timeframe }>;
  readonly synergiesQueue: QueueLike<{ timeframe: Timeframe }>;
}

export async function enqueueIngestJobs(
  ingestQueue: QueueLike<{ timeframe: Timeframe }>,
  timeframes: readonly Timeframe[]
): Promise<void> {
  for (const timeframe of timeframes) {
    await ingestQueue.add("ingest", { timeframe }, workerJobOptions);
  }
}

export async function enqueueFollowUpJobs(
  queues: FollowUpQueues,
  timeframe: Timeframe
): Promise<void> {
  await queues.tierQueue.add("compute-tier", { timeframe }, workerJobOptions);
  await queues.countersQueue.add("compute-counters", { timeframe }, workerJobOptions);
  await queues.synergiesQueue.add("compute-synergies", { timeframe }, workerJobOptions);
}

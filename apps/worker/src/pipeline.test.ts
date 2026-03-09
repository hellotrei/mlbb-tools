import assert from "node:assert/strict";
import test from "node:test";
import type { Timeframe } from "@mlbb/shared";
import { enqueueFollowUpJobs, enqueueIngestJobs, workerJobOptions } from "./pipeline";

interface RecordedJob {
  readonly name: string;
  readonly data: { timeframe: Timeframe };
  readonly opts: typeof workerJobOptions;
}

function createQueueRecorder() {
  const jobs: RecordedJob[] = [];

  return {
    jobs,
    queue: {
      async add(name: string, data: { timeframe: Timeframe }, opts: typeof workerJobOptions) {
        jobs.push({ name, data, opts });
      }
    }
  };
}

test("enqueueIngestJobs enqueues only ingest jobs for each active timeframe", async () => {
  const { jobs, queue } = createQueueRecorder();

  await enqueueIngestJobs(queue, ["7d", "15d"]);

  assert.deepEqual(jobs, [
    { name: "ingest", data: { timeframe: "7d" }, opts: workerJobOptions },
    { name: "ingest", data: { timeframe: "15d" }, opts: workerJobOptions }
  ]);
});

test("enqueueFollowUpJobs fans out tier, counter, and synergy work after ingest", async () => {
  const tier = createQueueRecorder();
  const counters = createQueueRecorder();
  const synergies = createQueueRecorder();

  await enqueueFollowUpJobs(
    {
      tierQueue: tier.queue,
      countersQueue: counters.queue,
      synergiesQueue: synergies.queue
    },
    "30d"
  );

  assert.deepEqual(tier.jobs, [
    { name: "compute-tier", data: { timeframe: "30d" }, opts: workerJobOptions }
  ]);
  assert.deepEqual(counters.jobs, [
    { name: "compute-counters", data: { timeframe: "30d" }, opts: workerJobOptions }
  ]);
  assert.deepEqual(synergies.jobs, [
    { name: "compute-synergies", data: { timeframe: "30d" }, opts: workerJobOptions }
  ]);
});

# App: Worker (`apps/worker`)

## Responsibility

The worker is a long-lived background process that:

- Ingests hero stats on a schedule.
- Computes derived artifacts (tier rankings, counters, synergies).
- Writes results to Postgres for the API/web to serve.
- Maintains BullMQ queues and runs periodic maintenance tasks.

Operationally, it is intended to be decoupled from the blue/green web+api deployment (see `docs/architecture-decisions.md` ADR-001).

## Entry point

- `apps/worker/src/index.ts`

## Core runtime flow

1. Load environment (`../../.env`) and parse worker config: `parseWorkerRuntimeConfig(process.env)`.
2. Create BullMQ queues (Redis-backed): ingest, tier, counters, synergies.
3. Create BullMQ workers (each concurrency=1) that run the corresponding jobs.
4. On startup:
   - Import bundled hero metadata snapshot.
   - Sync hero role pools (lane confidence data).
   - Sync community votes from Supabase (best-effort).
   - Enqueue ingest jobs for configured timeframes.
   - Run maintenance cleanup for counter-pick history.
5. Schedule recurring work:
   - `INGEST_CRON` controls enqueue frequency for ingest+followups.
   - Hourly sync of community votes.

## Queues and pipeline

- Queue constants: `apps/worker/src/constants.ts` (`QUEUES`).
- Job enqueue orchestration: `apps/worker/src/pipeline.ts`
  - `enqueueIngestJobs()` enqueues ingest per timeframe.
  - `enqueueFollowUpJobs()` enqueues tier/counters/synergies after ingest completes.

## Key jobs

- `apps/worker/src/jobs/ingest.ts` — fetch + persist hero stats snapshots/latest
- `apps/worker/src/jobs/compute-tier.ts` — compute tier results and persist
- `apps/worker/src/jobs/compute-counters.ts` — compute counter matrix and persist
- `apps/worker/src/jobs/compute-synergies.ts` — compute synergy matrix and persist
- `apps/worker/src/jobs/cleanup-counter-history.ts` — maintenance cleanup
- `apps/worker/src/jobs/sync-community-votes.ts` — periodic Redis materialization of Supabase votes

## Dependencies

- `@mlbb/db` — Postgres persistence for raw stats and computed artifacts
- `@mlbb/shared` — shared types (e.g., `Timeframe`) and scoring helpers used by compute jobs
- Redis — BullMQ queues and shared cache used by API

## Logging/error handling

- Each BullMQ worker attaches a `"failed"` handler and logs queue name + job id.
- Community vote sync is treated as best-effort (warns on failure) and does not prevent startup.


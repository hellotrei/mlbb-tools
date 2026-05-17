# Package: DB (`packages/db`)

## Responsibility

`@mlbb/db` centralizes all Postgres-related concerns:

- Drizzle schema definitions (tables + indexes).
- A shared `pg.Pool` + Drizzle client (`db`) used by API and worker.
- A simple SQL migration runner.

## Public API

- `db`: Drizzle client bound to the schema.
- `pool`: shared `pg` pool.
- `closeDbPool()`: graceful shutdown helper.
- All table definitions exported from `schema.ts`.

Entry exports: `packages/db/src/index.ts`.

## DB client (`client.ts`)

- Reads `DATABASE_URL` (defaulting to a local Postgres URL).
- Computes a bounded pool size:
  - Detects serverless via `VERCEL === "1"`.
  - Clamps `DATABASE_POOL_MAX` into a safe range (serverless defaults lower).

## Schema (`schema.ts`) overview

Hero/meta + stats:

- `heroes`
- `heroStatsSnapshots`, `heroStatsLatest`
- `heroRolePool`

Computed artifacts:

- `tierResults`
- `counterMatrix`, `synergyMatrix`
- `counterPickHistory` (captures counter recommendation requests for later cleanup/analysis)

Tournaments (created via web UI / Telegram bot):

- `tournamentEvents`, `tournamentTeams`, `tournamentRounds`, `tournamentMatches`
- `tournamentMatchDraftLogs` (draft log persistence)
- Telegram/session tables: `telegramSessions`, `eventSubscribers`

## Migrations

- Runner: `packages/db/src/migrate.ts` reads `.env`, `.env.local`, `.env.production` (if present) from the workspace root.
- Migration files live under `packages/db/migrations/*.sql` and are applied in filename order.


# MLBB Tools Monorepo

TypeScript-only pnpm + Turborepo starter for MLBB analysis tools.

## Apps

- `apps/web` - SvelteKit dashboard
- `apps/api` - Hono BFF API
- `apps/worker` - BullMQ ingestion/compute workers

## Packages

- `packages/shared` - shared contracts, zod schemas, scoring helpers
- `packages/db` - Drizzle schema + migrations + db client
- `packages/ui` - reusable Svelte UI components + theme tokens
- `packages/config` - shared tsconfig/eslint/prettier base

## Prerequisites

- Node.js 20+
- pnpm latest
- Docker

## Setup

1. Copy env file:
   - `cp .env.example .env`
2. Install deps:
   - `pnpm i`
3. Start everything:
   - `pnpm dev`
   - or `pnpm services:start`
4. Stop everything:
   - `pnpm services:stop`

`pnpm dev` automatically:
1. starts Postgres + Redis from `infra/docker-compose.yml`
2. waits for services to become reachable
3. runs DB migrations
4. runs worker + api + web in parallel

## URLs

- web: http://localhost:5173
- api health: http://localhost:8787/health

## Draft Master Intelligence

### Advanced capabilities

- Adaptive draft recommendations with stage-aware weighting (early, mid, late pick).
- Three recommendation channels in one flow:
  - Recommended Heroes (main decision list)
  - Meta Picks (tier/stat power oriented)
  - Counter Picks (enemy-context + community driven)
- Lane-aware filtering:
  - blocks impossible lane overlaps from committed single-lane heroes
  - boosts missing-lane coverage and role balance
- Stability controls to reduce recommendation jitter between turns:
  - phase profile blending
  - confidence/reliability gating for counter and community signals
- Live draft orchestration:
  - ranked and tournament flows
  - auto-refresh recommendations on every draft state change
  - lane drag-and-drop before final matchup analysis

### Frontend recommendation flow

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant P as "DraftMaster +page.svelte"
  participant A as "POST /draft/analyze"
  participant F as "POST /draft/feasibility"

  U->>P: Open page or change draft state
  P->>P: onMount() -> didMount=true
  P->>P: analyze()

  par parallel fetch
    P->>A: draft context + picks + bans + turn side/type
    P->>F: allyMlids + enemyMlids
  end

  A-->>P: recommendedPicks + recommendedMetaPicks + recommendedCounterPicks
  F-->>P: ally/enemy feasibility

  P->>P: derive actionableRecommendations
  P->>P: derive metaRecommendations
  P->>P: derive counterRecommendations
  P-->>U: render Recommended Heroes / Meta Picks / Counter Picks
```

### API scoring and data pipeline

```mermaid
flowchart TD
  IN["Request: /draft/analyze"] --> TURN["inferDraftTurn + cache key"]
  TURN --> LOAD["Load data sources"]
  LOAD --> TIER["Tier map (rank scoped)"]
  LOAD --> STATS["hero_stats_snapshots"]
  LOAD --> ROLE["hero_role_pool (+ heroes fallback)"]
  LOAD --> CM["counter_matrix"]
  LOAD --> SM["synergy_matrix"]
  LOAD --> COMM["Supabase counter votes"]

  TIER --> SCORE["Per-hero scoring"]
  STATS --> SCORE
  ROLE --> SCORE
  CM --> SCORE
  SM --> SCORE
  COMM --> SCORE

  SCORE --> PHASE["phaseWeights + tunePhaseWeights + pickStageProfile"]
  PHASE --> PICK["pickScore -> Recommended Heroes"]
  PHASE --> META["metaScore -> Meta Picks"]
  PHASE --> CTR["counterPickScore -> Counter Picks"]

  PICK --> OUT["toRec + lane-diverse selector + response JSON"]
  META --> OUT
  CTR --> OUT
```

## Milestone coverage

- M0: scaffold + one-command local dev
- M1: hero meta import + heroes endpoints + dashboard shell
- M2: stats ingest fallback + stats endpoint + virtualized stats UI
- M3: tier compute + tier endpoint + tier page
- M4: counters endpoint + counter page
- M5: draft analyze endpoint + draft page

## Notes

- Stats ingest now uses GMS `POST /api/gms/source/{sourceId}/{endpoint}` per timeframe endpoint (configurable via `.env`).
- GMS rank `bigrank` is normalized into `rankScope` snapshots; canonical `/stats` data uses priority: `all_rank(101) -> mythic_glory -> mythic_honor -> mythic -> ...`.
- If GMS fetch fails, worker falls back to deterministic mock stats and keeps running.
- Hero metadata import source uses `HERO_META_SOURCE=gms` (GMS only, no file fallback mode).
- Hero import is idempotent via upsert on `mlid`.
- Refresh local metadata snapshot file: `pnpm meta:refresh`.

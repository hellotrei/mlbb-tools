# Package: Shared (`packages/shared`)

## Responsibility

`@mlbb/shared` is the shared domain contract used by both API and worker:

- Type definitions for shared concepts (heroes, tiers, timeframes, request/response shapes).
- Zod schemas used for API input validation.
- Pure functions for scoring and draft recommendation logic.

Keeping this package pure (no IO) makes it safe to reuse in API, worker, and web tooling.

## Entry exports

`packages/shared/src/index.ts` re-exports:

- `types.ts` — shared types (e.g., `Tier`, `Timeframe`).
- `schemas.ts` — Zod schemas + inferred request types.
- `scoring.ts` — tier/counter/synergy scoring helpers.
- `draft-feasibility.ts` — lane/role feasibility logic for Draft Master.
- `archetypes.ts` — archetype detection + boosts.

## Key modules

### Request validation schemas (`schemas.ts`)

These are used by the API via `@hono/zod-validator`:

- `statsQuerySchema` → `StatsQuery` (`GET /stats`)
- `tierQuerySchema` → `TierQuery` (`GET /tier`)
- `countersBodySchema` → `CountersBody` (`POST /counters`)
- `draftAnalyzeBodySchema` → `DraftAnalyzeBody` (`POST /draft/analyze`, etc.)

### Scoring (`scoring.ts`)

Core scoring utilities that show up in tier ranking and recommendations:

- `computeTierResults(rows)` — converts raw win/pick/ban rates into ranked tiers (SS…D).
- `phaseWeights(pickNumber)` — draft-phase weighting profile (early picks prioritize tier/flex; later picks prioritize countering).
- `computeCounterScore(...)`, `computeEnhancedCounterScore(...)`, `computeSynergyScore(...)`, `computeFlexValue(...)` — helper functions used by recommendation engines.


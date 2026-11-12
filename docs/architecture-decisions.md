# Architect decisions — MLBB Tools

## 2026-11-12 — Season as a separate engine, not a mode

MPL S18 is registered as its own engine (`mpl_id_s18`, `mpl_ph_s18`) rather than
turning `mpl_id` into a season-selectable engine.

Why: the whole engine is keyed by `engineId` — Redis `tournament:{engineId}:dataset:v2`,
the route slug, and the `HeroAggregate` / counter / synergy aggregates. A season
selector would need the engine to hold two datasets and every consumer
(status, tier, stats, counters, analyze, postmatch) to carry a season parameter.
That is a bigger blast radius than adding two config entries.

Consequence: S17 stays available at `/tournament-intelligence/mpl-id` and S18
lives at `/tournament-intelligence/mpl-id-s18`. When S17 data goes stale, the
choice is to point the old slug at the new pages or to retire it — a one-line
config change, no code.

## 2026-11-12 — hero alias lookup is an exact-token map, never a regex

`normalizeHeroToken()` applies `HERO_ALIASES[key]` BEFORE the regex chain.

Why: a regex like `/\blapu\b/ → "lapu-lapu"` also rewrites the already-correct
value `"lapu-lapu"`, because `\b` matches between `u` and `-`. Simulated cost:
86 maps lost across the S17+S18 pages. The exact-token map costs 0.

A single unresolved PICK token makes `picks.length !== 5`, which discards the
entire map — picks, bans, winner, counters and synergies with it. Ban slots are
not gated, so an unresolved ban only loses that one ban. This is why ambiguous
short forms are omitted on purpose: `"val"` could be Valir or Valentina, and
guessing would silently corrupt counter data rather than drop a map.

## 2026-11-12 — rate limiter exempts /health on purpose

`/health` and `/health/full` bypass the per-IP bucket. Without that exemption a
saturated bucket makes the healthcheck fail, and Docker marks a perfectly healthy
container unhealthy. Diagnose "app looks down but container healthy" by checking
whether 429s are being counted — see the mlbb-tools skill pitfalls.

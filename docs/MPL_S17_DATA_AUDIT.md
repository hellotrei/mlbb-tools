# MPL ID / MPL PH S17 data-quality audit (2026-11-12)

Method: fetch the 4 Liquipedia pages through the Cloudflare Worker proxy, dump each
engine's persisted Redis dataset, compare wikitext-derived counts against dataset counts.
No production data was written (only the natural 6h rebuild was triggered).

Scripts left in `/tmp` on the VPS: `wt.mjs` (fetch wikitext → `/tmp/wt_{id,ph}_{rs,po}.txt`),
`sim3.mjs` (replay `normalizeHeroToken` + the week regex against those files),
`analyze_ds.py` (dump the Redis dataset).

## 1. Sources

| Engine | Pages | wikitext maps (non-skip) | in dataset | status |
|---|---|---|---|---|
| mpl_id | `MPL/Indonesia/Season_17/Regular_Season` | 174 | 168 | −6 |
| mpl_id | `MPL/Indonesia/Season_17/Playoffs` | 31 | 30 | −1 |
| mpl_ph | `MPL/Philippines/Season_17/Regular_Season` | 134 | 134 | ✓ |
| mpl_ph | `MPL/Philippines/Season_17/Playoffs` | 35 | 35 | ✓ |

`==={{HiddenSort|RS: Week N}}===` in both RS pages, `<!-- Round Name -->` comments in both
PO pages. Proxy host that actually resolves: `liquipedia-proxy.mlbb-draft.workers.dev`
(`*.mlbb-draft.work` is NXDOMAIN). Header `x-proxy-token` required.

## 2. Bug: hero-token alias gaps drop whole maps

`normalizeHeroToken()` in `tournament-engine.ts` has aliases only for
`yss, phove, valen, leo, fred, gatot, luo yi, x.borg, yi sun shin`.
Liquipedia S17 also writes: `arlot` (arlott), `guin` (guinevere), `lapu` (lapu-lapu),
`luo` (luo-yi), `yuzhong` (yu-zhong).

A map is discarded when any pick slot fails to resolve (`picks.length !== 5`), so a single
alias gap throws away the whole map (picks + bans + winner + counters + synergies).

Verified effect (`sim3.mjs`):

| | maps lost | failing tokens |
|---|---|---|
| current code | 7 | yuzhong×3, arlot×2, lapu×1, luo×1 |
| with exact-token alias map | 0 | — |

**Use an exact-token map, not a regex.** `replace(/\blapu\b/g,"lapu-lapu")` corrupts the
already-correct value `lapu-lapu` → `lapu-lapu-lapu` (`\b` matches before `-`), which lost
86 maps in simulation. Correct form:

```ts
const HERO_ALIASES: Record<string, string> = {
  arlot: "arlott", guin: "guinevere", lapu: "lapu-lapu", luo: "luo-yi", yuzhong: "yu-zhong"
};
function normalizeHeroToken(input: string) {
  const key = input.toLowerCase().trim();
  return (HERO_ALIASES[key] ?? key)
    .replace(/x\.borg/g, "x-borg")
    /* …rest of existing chain… */
}
```

## 3. Bug: matchDate is a bare month name

`parseMatchesFromWikitext`: `rawDate.split(" ")[0]` turns
`March 27, 2026 - 15:15{{abbr/ICT}}` into `"March"`.

`new Date("March")` → `Invalid Date`, so `dateLabel` renders `"—"` for every row in
`tournament-intelligence/[engine]/+page.svelte` (line ~308). `timeLabel` is equally dead.
The frontend also fabricates `day = floor((index % 9) / 3) + 1` from array position.

Fix: parse `^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})` → `YYYY-MM-DD` (safe: UTC midnight lands
on the same WIB calendar day).

## 4. Bug (regression): week extraction

See `references/week-distribution-bug.md` → "REGRESSION". Deployed build has the broken
regex, so all regular-season matches collapse to `Week 1 · Match N`. Fixed regex recovers
8×9 weeks (ID) and 7×8 weeks (PH).

## 5. Not bugs

- `mvp` absent on every map in S17 → MVP column shows `N/A` (data isn't on the page).
- PH RS/PO have no `mapmode` → `mapName` null.
- `teamBlueName` = `"Team 1"` in the flat `maps[]` array is builder scaffolding; the real
  names live in `matches[].team1Name/team2Name` and in `gameDetails`.
- `team1Bans` sometimes has 4 entries (older ban rules) — no pick-count filter applies.
- 429s from `curl localhost:28787/...` are the in-app rate limiter; add
  `-H "X-Forwarded-For: <random>"` (pitfall #42).

## 6. Recommended change set (smallest diff, one rebuild)

1. `HERO_ALIASES` exact-token map (recovers 6 maps ID RS + 1 map ID PO → 198→205 maps, 79→80 matches).
2. ISO date parse for `matchDate`.
3. Restore the fixed week regex (8 weeks of UI grouping return).
All three live in `apps/api/src/lib/tournament-engine.ts`. Then `docker exec mlbb-redis
redis-cli DEL tournament:mpl_id:dataset:v2 tournament:mpl_ph:dataset:v2` + restart the
live API slot (blue-green pitfall #0).

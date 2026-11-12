# Adding MPL ID / MPL PH Season 18 datasets — pattern + pre-flight result

Audited 2026-11-12. Nothing here is applied yet (S17 fixes intentionally on hold).
All numbers below come from real fetches through the Cloudflare worker proxy.

## 0. The pattern

```
Liquipedia page ──► Cloudflare Worker proxy ──► fetchWikitext() ──► parseMapBlocks()/parseMatchesFromWikitext()
   ──► buildDataset() aggregates (heroes, counters, synergies, patterns)
   ──► Redis  tournament:{engineId}:dataset:v2   (TTL 7d, rebuilt every 6h in-process)
   ──► routes /draft/{slug}/*, /stats/{slug}, /tier/{slug}, /counters/{slug}/:mlid
```

Engine id → the Redis key and the Liquipedia pages (`tournament-engine-config.ts`).
Slug → the public URL (`registerTournamentRoutes({ slug })`).
Adding a season = add one config entry + one 13-line wrapper + one `registerTournamentRoutes` call
(plus the frontend store/wiring — see `references/adding-tournament-engine.md`).

### Pre-flight the source FIRST — always
```bash
# token lives in .env.production (VERCEL_API_PROXY_TOKEN)
grep -m1 '^VERCEL_API_PROXY_TOKEN=' /opt/mlbb-tools/.env.production | cut -d= -f2- > /tmp/proxy_token.txt
chmod 600 /tmp/proxy_token.txt

cd /opt/mlbb-tools && node scripts/liquipedia-probe.mjs \
  "MPL/Indonesia/Season_18/Regular_Season" "MPL/Indonesia/Season_18/Playoffs" \
  "MPL/Philippines/Season_18/Regular_Season" "MPL/Philippines/Season_18/Playoffs" \
  --dump /tmp/s18
```
Exit 0 = every usable map resolves. Exit 1 = maps would be silently dropped.
The probe mirrors `normalizeHeroToken()` + the week regex and diffs against the live `heroes` table.

## 1. S18 pages exist and are complete

| page | chars | matchBlocks | map slots | skipped | usable | week hdrs | PO rounds |
|---|---|---|---|---|---|---|---|
| MPL/Indonesia/Season_18/Regular_Season | 108.727 | 72 | 216 | 42 | 174 | 9 | – |
| MPL/Indonesia/Season_18/Playoffs | 22.592 | 8 | 44 | 3 | 41 | – | 6 |
| MPL/Philippines/Season_18/Regular_Season | 94.624 | 56 | 168 | 34 | 134 | 8 | – |
| MPL/Philippines/Season_18/Playoffs | 23.782 | 8 | 44 | 6 | 38 | – | 6 |

Same shape as S17 (ID 174 usable RS, PH 134 — identical). Bonus for S18:
**series are finished** — ID PO dates Nov 4-8 2026, PH PO Oct 21-25 2026, every `{{Match}}` has a
`winner=`, so `scoreline`/`winnerTeam`/`getPostmatchIntelligence` work from day one.
`MPL/{Region}/Season_18` (the parent page) holds no match data — ignore it.

## 2. BLOCKER: 33 of 387 S18 maps would be dropped

`normalizeHeroToken()` has no alias for the short hero forms used in the S18 pages.
One unresolved pick token → `picks.length !== 5` → **the whole map is discarded**
(picks, bans, winner, counters and synergies with it).

Measured on the 4 S18 pages (and the cached S17 pages, same code path):

| | usable maps | maps lost |
|---|---|---|
| current code | 387 (S18) | **33** |
| with alias map below | 387 | **0** |

Per page today: ID RS 174→170, ID PO 41→30, PH RS 134→125, PH PO 38→36.

Unresolved tokens (count in S18): `yz×10, lapu×5, mino×4, paq×4, zx×3, esme×3, guin×3, yuzhong×2, pove×2, obsi×2, arlot×1, xb×1, bene×1, rafa×1, nova×1, khu×1`.
Readings verified against the surrounding lineup (role fit) and the `heroes` table.

### Patch A — `apps/api/src/lib/tournament-engine.ts`
Add above `normalizeHeroToken()` and use it as the first step:

```ts
// Liquipedia writes short hero forms. One unresolved token drops the WHOLE map,
// so this must cover every abbreviation that appears in the configured pages.
const HERO_ALIASES: Record<string, string> = {
  arlot: "arlott", guin: "guinevere", lapu: "lapu-lapu", luo: "luo-yi",
  yuzhong: "yu-zhong", yz: "yu-zhong", pove: "phoveus", xb: "x-borg",
  esme: "esmeralda", mino: "minotaur", paq: "paquito", paqu: "paquito",
  zx: "zhuxin", obsi: "obsidia", rafa: "rafaela", khu: "khufra",
  val: "valentina", bene: "benedetta", nova: "novaria", haya: "hayabusa",
  mathil: "mathilda"
};

function normalizeHeroToken(input: string) {
  const key = input.toLowerCase().trim();
  return (HERO_ALIASES[key] ?? key)
    .replace(/x\.borg/g, "x-borg")
    /* … existing chain unchanged … */
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

⚠️ **Must be an exact-token map, not a regex.** `replace(/\blapu\b/g, "lapu-lapu")` also rewrites the
already-correct `lapu-lapu` (because `\b` matches before `-`) → `lapu-lapu-lapu` → 86 maps lost in
simulation. The existing `\barlot\b → arlot` line in the chain is a no-op and can be dropped.

## 3. BLOCKER: week extraction (regression) — without it every PO match shows "Week 10"

Deployed build still has the broken regex, so S17 RS collapses to `Week 1 · Match N`.
For S18: RS needs it to group 9 (ID) / 8 (PH) weeks, and PO needs the round offsets
(R1M1…R6M1 → Upper-Bracket-QF…Grand Final → weeks 10-15).

### Patch B — replace `extractWeekForPosition()`'s week regex
```ts
const weekRegex = /==\s*(?:\{\{HiddenSort\|[^}]*?Week\s+(\d+)[^}]*\}\}|Week\s+(\d+))\s*==/gi;
// week number is in capture group 1 OR 2
```
Verified against S17 + S18: ID 9 weeks, PH 8 weeks, 8 matches per week. Header level is 3 in S18
(`==={{HiddenSort|RS: Week 1}}===`) and 2 in S17 — the fixed regex covers both.
Also extend `PLAYOFFS_ROUND_MAP` if a page ever uses `Upper Bracket Round 1/2` or `Lower Bracket Round 1/2`.

## 4. BLOCKER: match dates are unreadable — every row renders "—"

`parseMatchesFromWikitext()` does `rawDate.split(" ")[0]`:
`"August 14, 2026 - 15:00 {{abbr/ICT}}"` → `"August"` → `new Date("August")` = `Invalid Date`.
S18 makes it worse: some entries are already ISO (`2026-09-12`), some are `Oct 11, 2026`, some
`October 21,2026` (no space after the comma).

### Patch C
```ts
function toIsoDate(raw: string): string | null {
  const m = raw.match(/^\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,\s*(\d{4})/);
  if (!m) {
    const iso = raw.match(/^\s*(\d{4}-\d{2}-\d{2})/);
    return iso ? iso[1]! : raw.split(" ")[0]?.trim() || null;
  }
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const month = months.indexOf(m[1]!.slice(0, 3).toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}
// in parseMatchesFromWikitext():
const matchDate = rawDate ? toIsoDate(rawDate) : null;
```
UTC midnight lands on the same WIB calendar day, so SSR rendering stays correct.

## 5. Ready-to-apply wiring (after patches A-C)

`apps/api/src/lib/tournament-engine-config.ts`
```ts
mpl_id_s18: { engineId: "mpl_id_s18",
  pages: ["MPL/Indonesia/Season_18/Regular_Season", "MPL/Indonesia/Season_18/Playoffs"] as const },
mpl_ph_s18: { engineId: "mpl_ph_s18",
  pages: ["MPL/Philippines/Season_18/Regular_Season", "MPL/Philippines/Season_18/Playoffs"] as const }
```
Wrappers `apps/api/src/lib/mpl-id-s18-engine.ts` / `mpl-ph-s18-engine.ts`: copy `mpl-id-engine.ts`, swap the key.
`apps/api/src/index.ts`: import both wrappers, add two `registerTournamentRoutes({ slug: "mpl-id-s18" | "mpl-ph-s18", label: "MPL ID S18" | "MPL PH S18", … })`.

Frontend (4 files, all mandatory or the dropdown shows "Loading" forever):
`stores/engine.ts` (type union + 2 stores), `tournament-engines.ts` (2 entries),
`routes/+layout.svelte` (5 places), `routes/+page.svelte` (statusMap ×2 + type union),
`routes/tournament-intelligence/[engine]/+page.ts` (`ENGINE_MAP`).

### Optional: stop hand-copying 13-line wrappers
```ts
// index.ts — replaces N wrappers + N registerTournamentRoutes blocks
const SEASON_ENGINES = {
  "mpl-id-s18": { label: "MPL ID S18", pages: TOURNAMENT_ENGINE_CONFIG.mpl_id_s18.pages, engineId: "mpl_id_s18" },
  "mpl-ph-s18": { label: "MPL PH S18", pages: TOURNAMENT_ENGINE_CONFIG.mpl_ph_s18.pages, engineId: "mpl_ph_s18" }
};
for (const [slug, cfg] of Object.entries(SEASON_ENGINES)) {
  registerTournamentRoutes({ slug, label: cfg.label, ...createTournamentEngine(cfg) });
}
```
Judgement call: leave the S17 wrappers alone, use the loop only for future seasons.

## 6. Deploy + verify (blue-green, zero downtime — pitfall #0)

```bash
cd /opt/mlbb-tools
docker build -f infra/bluegreen/Dockerfile.api -t mlbb-local/api:latest .
docker build -f infra/bluegreen/Dockerfile.web -t mlbb-local/web:latest .
cd infra/bluegreen
# build into the STANDBY slot, health check it, flip nginx, then stop the old slot
cat .active-slot .active-slot-api          # truth: currently green (api 28787 / web 23000)
```
Then warm + verify:
```bash
# the 6h in-process cache means a restart alone is enough to rebuild; force it by deleting the keys
RP=$(grep -m1 '^REDIS_PASSWORD' /opt/mlbb-tools/.env.production | cut -d= -f2-)
docker exec mlbb-redis redis-cli -a "$RP" --no-auth-warning DEL \
  tournament:mpl_id_s18:dataset:v2 tournament:mpl_ph_s18:dataset:v2

# status: first call takes 5-30s (Liquipedia scrape), later calls <100ms
curl -s -H "X-Forwarded-For: 10.9.9.1" localhost:28787/draft/mpl-id-s18/status

# dataset sanity — must equal the probe's "usable" numbers
docker exec mlbb-redis redis-cli -a "$RP" --no-auth-warning --no-raw GET tournament:mpl_id_s18:dataset:v2 \
| python3 -c "
import sys,json;d=json.loads(json.loads(sys.stdin.read().strip()))
from collections import Counter
print('maps',len(d['maps']),'matches',len(d['matches']),'heroes',len(d['heroes']))
print('byPage',dict(Counter(m['page'].rsplit('/',1)[-1] for m in d['maps'])))
print('weeks',sorted(Counter(m['week'] for m in d['matches']).items()))
print('unmatched',d['unmatchedHeroTokens'])"
```
Expected after patches A-C: ID S18 maps 215 (174 RS + 41 PO), PH S18 maps 172 (134 + 38),
`unmatchedHeroTokens: []`, weeks `1..9` (ID) / `1..8` (PH) + 10-15 for PO.

⚠️ `curl localhost:28787/...` returns `{"error":"Too many requests"}` without a unique
`X-Forwarded-For` — that is the in-app rate limiter, not an outage (pitfall #42).

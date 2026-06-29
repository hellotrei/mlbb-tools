# Match Draft Tracking Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Allow tournament admins to record hero bans/picks for each match via visual UI, with real-time spectator viewing.

**Architecture:** Extend existing `tournamentMatchDraftLogs` table + admin mode. Add PATCH endpoint for incremental updates, visual hero selection panel, and auto-refresh for spectators.

**Tech Stack:** Drizzle ORM, Hono API, SvelteKit 5, HeroAvatar component, existing hero data from layout.

---

## Existing Infrastructure (No Changes Needed)

- **DB Table:** `tournamentMatchDraftLogs` — already has `teamAPicks`, `teamBPicks`, `teamABans`, `teamBBans` (jsonb), `matchId`, `source`, `notes`
- **API:** POST `/events/:id/matches/:matchId/draft-log` — already saves full draft
- **Web:** `PUBLIC_TOURNAMENT_DRAFTLOG_ADMIN` env var gates draft log UI
- **Components:** `HeroAvatar` from `@mlbb/ui`, hero data from layout `+layout.ts`

---

## Task 1: Add PATCH Endpoint for Incremental Draft Updates

**Objective:** API endpoint to add/remove single hero from draft (ban or pick) without sending full draft each time.

**Files:**
- Modify: `apps/api/src/index.ts` (add PATCH route after existing POST draft-log)

**Step 1: Add Zod schema for PATCH body**

```ts
// After line 407 (existing updateTournamentMatchDraftLogBodySchema)
const patchDraftLogBodySchema = z.object({
  action: z.enum(["add", "remove"]),
  type: z.enum(["ban", "pick"]),
  side: z.enum(["A", "B"]),
  heroId: z.number().int().positive()
});
```

**Step 2: Add PATCH route**

```ts
app.patch(
  "/events/:eventId/matches/:matchId/draft-log",
  zValidator("param", tournamentEventIdParamsSchema),
  zValidator("json", patchDraftLogBodySchema),
  async (c) => {
    const eventId = Number(c.req.valid("param").eventId);
    const matchId = Number(c.req.valid("param").matchId);
    const body = c.req.valid("json");

    // Upsert draft log
    const existing = await db
      .select()
      .from(tournamentMatchDraftLogs)
      .where(eq(tournamentMatchDraftLogs.matchId, matchId))
      .then((rows) => rows[0] ?? null);

    const field = body.type === "ban"
      ? (body.side === "A" ? "teamABans" : "teamBBans")
      : (body.side === "A" ? "teamAPicks" : "teamBPicks");

    let currentIds: number[] = existing ? (existing as any)[field] ?? [] : [];

    if (body.action === "add") {
      if (!currentIds.includes(body.heroId)) currentIds.push(body.heroId);
    } else {
      currentIds = currentIds.filter((id) => id !== body.heroId);
    }

    if (existing) {
      await db
        .update(tournamentMatchDraftLogs)
        .set({ [field]: currentIds, updatedAt: new Date() })
        .where(eq(tournamentMatchDraftLogs.id, existing.id));
    } else {
      await db.insert(tournamentMatchDraftLogs).values({
        eventId,
        matchId,
        [field]: currentIds,
        source: "manual"
      });
    }

    return c.json({ ok: true, field, ids: currentIds });
  }
);
```

**Step 3: Verify**

```bash
pnpm --filter @mlbb/api build
# Expected: Build success
```

**Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): add PATCH endpoint for incremental draft updates"
```

---

## Task 2: Add GET Endpoint for Draft State

**Objective:** Fetch current draft state for a match.

**Files:**
- Modify: `apps/api/src/index.ts` (add GET route)

**Step 1: Add GET route**

```ts
app.get(
  "/events/:eventId/matches/:matchId/draft-log",
  zValidator("param", tournamentEventIdParamsSchema),
  async (c) => {
    const matchId = Number(c.req.valid("param").matchId);

    const draft = await db
      .select()
      .from(tournamentMatchDraftLogs)
      .where(eq(tournamentMatchDraftLogs.matchId, matchId))
      .then((rows) => rows[0] ?? null);

    if (!draft) {
      return c.json({
        teamAPicks: [],
        teamBPicks: [],
        teamABans: [],
        teamBBans: [],
        status: "not_started"
      });
    }

    const allFilled = [draft.teamAPicks, draft.teamBPicks, draft.teamABans, draft.teamBBans]
      .every((arr) => (arr?.length ?? 0) === 5);
    const anyFilled = [draft.teamAPicks, draft.teamBPicks, draft.teamABans, draft.teamBBans]
      .some((arr) => (arr?.length ?? 0) > 0);

    let status: string = "not_started";
    if (allFilled) status = "completed";
    else if (anyFilled) {
      const totalBans = (draft.teamABans?.length ?? 0) + (draft.teamBBans?.length ?? 0);
      status = totalBans < 10 ? "ban_phase" : "pick_phase";
    }

    return c.json({
      teamAPicks: draft.teamAPicks,
      teamBPicks: draft.teamBPicks,
      teamABans: draft.teamABans,
      teamBBans: draft.teamBBans,
      status,
      source: draft.source,
      notes: draft.notes,
      updatedAt: draft.updatedAt
    });
  }
);
```

**Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): add GET endpoint for match draft state"
```

---

## Task 3: Create DraftPanel Svelte Component

**Objective:** Reusable component showing draft state (bans/picks for both teams) with hero avatars.

**Files:**
- Create: `apps/web/src/lib/components/DraftPanel.svelte`

**Step 1: Create component**

```svelte
<script lang="ts">
  import { HeroAvatar } from "@mlbb/ui";

  export let teamAName: string = "Team A";
  export let teamBName: string = "Team B";
  export let teamAPicks: number[] = [];
  export let teamBPicks: number[] = [];
  export let teamABans: number[] = [];
  export let teamBBans: number[] = [];
  export let heroMap: Map<number, { name: string; imageKey: string }>;
  export let status: string = "not_started";

  function heroName(mlid: number) {
    return heroMap.get(mlid)?.name ?? `#${mlid}`;
  }
  function heroImage(mlid: number) {
    return heroMap.get(mlid)?.imageKey ?? "";
  }
</script>

<div class="draft-panel" class:completed={status === "completed"}>
  <div class="draft-header">
    <span class="draft-status {status}">{status.replace(/_/g, " ")}</span>
  </div>

  <div class="draft-teams">
    <!-- Team A -->
    <div class="draft-team">
      <h3 class="team-name">{teamAName}</h3>
      <div class="draft-section">
        <span class="section-label">Bans</span>
        <div class="hero-slots">
          {#each Array(5) as _, i}
            <div class="hero-slot ban-slot" class:filled={teamABans[i]}>
              {#if teamABans[i]}
                <HeroAvatar imageKey={heroImage(teamABans[i])} name={heroName(teamABans[i])} size={32} />
                <span class="slot-name">{heroName(teamABans[i])}</span>
              {:else}
                <span class="slot-empty">B{i + 1}</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
      <div class="draft-section">
        <span class="section-label">Picks</span>
        <div class="hero-slots">
          {#each Array(5) as _, i}
            <div class="hero-slot pick-slot" class:filled={teamAPicks[i]}>
              {#if teamAPicks[i]}
                <HeroAvatar imageKey={heroImage(teamAPicks[i])} name={heroName(teamAPicks[i])} size={40} />
                <span class="slot-name">{heroName(teamAPicks[i])}</span>
              {:else}
                <span class="slot-empty">P{i + 1}</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- VS Divider -->
    <div class="draft-vs">VS</div>

    <!-- Team B -->
    <div class="draft-team">
      <h3 class="team-name">{teamBName}</h3>
      <div class="draft-section">
        <span class="section-label">Bans</span>
        <div class="hero-slots">
          {#each Array(5) as _, i}
            <div class="hero-slot ban-slot" class:filled={teamBBans[i]}>
              {#if teamBBans[i]}
                <HeroAvatar imageKey={heroImage(teamBBans[i])} name={heroName(teamBBans[i])} size={32} />
                <span class="slot-name">{heroName(teamBBans[i])}</span>
              {:else}
                <span class="slot-empty">B{i + 1}</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
      <div class="draft-section">
        <span class="section-label">Picks</span>
        <div class="hero-slots">
          {#each Array(5) as _, i}
            <div class="hero-slot pick-slot" class:filled={teamBPicks[i]}>
              {#if teamBPicks[i]}
                <HeroAvatar imageKey={heroImage(teamBPicks[i])} name={heroName(teamBPicks[i])} size={40} />
                <span class="slot-name">{heroName(teamBPicks[i])}</span>
              {:else}
                <span class="slot-empty">P{i + 1}</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .draft-panel { display: grid; gap: 12px; }
  .draft-header { text-align: center; }
  .draft-status { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 12px; border-radius: 99px; background: rgba(255,255,255,0.06); }
  .draft-status.not_started { color: var(--muted); }
  .draft-status.ban_phase { color: #f59e0b; }
  .draft-status.pick_phase { color: #3b82f6; }
  .draft-status.completed { color: #10b981; }
  .draft-teams { display: grid; grid-template-columns: 1fr auto 1fr; gap: 16px; align-items: start; }
  .draft-team { display: grid; gap: 12px; }
  .team-name { margin: 0; font-size: 0.95rem; text-align: center; }
  .draft-section { display: grid; gap: 6px; }
  .section-label { font-size: 0.7rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; }
  .hero-slots { display: flex; flex-wrap: wrap; gap: 6px; }
  .hero-slot { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .ban-slot { opacity: 0.5; }
  .ban-slot.filled { opacity: 1; }
  .slot-empty { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.15); font-size: 0.65rem; color: var(--muted); }
  .slot-name { font-size: 0.6rem; color: var(--muted); max-width: 48px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .draft-vs { display: grid; place-items: center; font-weight: 700; color: var(--muted); font-size: 1.2rem; padding-top: 40px; }
</style>
```

**Step 2: Verify**

```bash
cd apps/web && npx vite build 2>&1 | grep -E "error|Error|built"
# Expected: built successfully
```

**Step 3: Commit**

```bash
git add apps/web/src/lib/components/DraftPanel.svelte
git commit -m "feat(web): add DraftPanel component for match draft display"
```

---

## Task 4: Create HeroPicker Svelte Component

**Objective:** Visual hero selection grid with search/filter for admin to pick bans/picks.

**Files:**
- Create: `apps/web/src/lib/components/HeroPicker.svelte`

**Step 1: Create component**

```svelte
<script lang="ts">
  import { HeroAvatar } from "@mlbb/ui";

  export let heroes: Array<{ mlid: number; name: string; imageKey: string; rolePrimary: string }>;
  export let disabledMlids: Set<number> = new Set();
  export let onSelect: (mlid: number) => void;

  let searchQuery = "";
  let roleFilter = "";

  const roles = ["tank", "fighter", "assassin", "mage", "marksman", "support"];

  $: filteredHeroes = heroes.filter((hero) => {
    const matchesSearch = !searchQuery || hero.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = !roleFilter || hero.rolePrimary === roleFilter;
    return matchesSearch && matchesRole;
  });
</script>

<div class="hero-picker">
  <div class="picker-controls">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search hero..."
      class="picker-search"
    />
    <div class="picker-roles">
      <button
        class="role-btn"
        class:active={roleFilter === ""}
        on:click={() => (roleFilter = "")}
      >All</button>
      {#each roles as role}
        <button
          class="role-btn"
          class:active={roleFilter === role}
          on:click={() => (roleFilter = role)}
        >{role}</button>
      {/each}
    </div>
  </div>

  <div class="picker-grid">
    {#each filteredHeroes as hero (hero.mlid)}
      <button
        class="picker-hero"
        class:disabled={disabledMlids.has(hero.mlid)}
        disabled={disabledMlids.has(hero.mlid)}
        on:click={() => onSelect(hero.mlid)}
        title={hero.name}
      >
        <HeroAvatar imageKey={hero.imageKey} name={hero.name} size={44} />
        <span class="picker-hero-name">{hero.name}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .hero-picker { display: grid; gap: 10px; }
  .picker-controls { display: grid; gap: 8px; }
  .picker-search { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 8px 12px; color: inherit; font-size: 0.85rem; }
  .picker-roles { display: flex; flex-wrap: wrap; gap: 4px; }
  .role-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: transparent; color: var(--muted); font-size: 0.75rem; cursor: pointer; }
  .role-btn.active { background: rgba(59,130,246,0.2); border-color: rgba(59,130,246,0.5); color: #93c5fd; }
  .picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 6px; max-height: 300px; overflow-y: auto; }
  .picker-hero { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; border-radius: 8px; border: 1px solid transparent; background: transparent; cursor: pointer; color: inherit; }
  .picker-hero:hover:not(.disabled) { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.12); }
  .picker-hero.disabled { opacity: 0.3; cursor: not-allowed; }
  .picker-hero-name { font-size: 0.6rem; color: var(--muted); max-width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/components/HeroPicker.svelte
git commit -m "feat(web): add HeroPicker component with search and role filter"
```

---

## Task 5: Integrate Draft Panel into Tournament Detail Page

**Objective:** Show DraftPanel for each match in the bracket when admin mode is active or draft exists.

**Files:**
- Modify: `apps/web/src/routes/tournaments/[id]/+page.svelte` (add draft panel in bracket match cards)

**Step 1: Add state variables (after line 2182)**

```ts
let draftDataCache = new Map<number, any>();
let draftLoadingMatchId: number | null = null;

async function loadDraftForMatch(matchId: number) {
  if (draftDataCache.has(matchId)) return draftDataCache.get(matchId);
  draftLoadingMatchId = matchId;
  try {
    const res = await fetch(apiUrl(`/events/${data.event.id}/matches/${matchId}/draft-log`));
    if (res.ok) {
      const draft = await res.json();
      draftDataCache.set(matchId, draft);
      return draft;
    }
  } catch {}
  return null;
}
```

**Step 2: Add DraftPanel in bracket match cards (inside bracket rendering loop)**

Find the match card rendering in bracket section and add:

```svelte
{#if adminMode || (match.id && draftDataCache.get(match.id))}
  {#await loadDraftForMatch(match.id) then draft}
    {#if draft && (draft.teamAPicks?.length || draft.teamABans?.length)}
      <DraftPanel
        teamAName={match.teamA?.name ?? "Team A"}
        teamBName={match.teamB?.name ?? "Team B"}
        teamAPicks={draft.teamAPicks ?? []}
        teamBPicks={draft.teamBPicks ?? []}
        teamABans={draft.teamABans ?? []}
        teamBBans={draft.teamBBans ?? []}
        {heroMap}
        status={draft.status}
      />
    {/if}
  {/await}
{/if}
```

**Step 3: Commit**

```bash
git add apps/web/src/routes/tournaments/[id]/+page.svelte
git commit -m "feat(web): integrate DraftPanel into tournament bracket view"
```

---

## Task 6: Add Draft Admin Panel for Match Draft Input

**Objective:** Admin can select heroes for bans/picks via HeroPicker UI (replace text inputs).

**Files:**
- Modify: `apps/web/src/routes/tournaments/[id]/+page.svelte` (add draft admin section)

**Step 1: Add draft admin state (after task 5 state)**

```ts
let draftAdminMatchId: number | null = null;
let draftAdminSide: "A" | "B" = "A";
let draftAdminAction: "ban" | "pick" = "ban";
let draftAdminSubmitting = false;

async function submitDraftAction(heroId: number) {
  if (!draftAdminMatchId || draftAdminSubmitting) return;
  draftAdminSubmitting = true;
  try {
    await fetch(
      apiUrl(`/events/${data.event.id}/matches/${draftAdminMatchId}/draft-log`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          type: draftAdminAction,
          side: draftAdminSide,
          heroId
        })
      }
    );
    draftDataCache.delete(draftAdminMatchId);
    await invalidateAll();
  } finally {
    draftAdminSubmitting = false;
  }
}

async function removeDraftHero(matchId: number, type: "ban" | "pick", side: "A" | "B", heroId: number) {
  await fetch(
    apiUrl(`/events/${data.event.id}/matches/${matchId}/draft-log`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", type, side, heroId })
    }
  );
  draftDataCache.delete(matchId);
  await invalidateAll();
}
```

**Step 2: Add draft admin panel in bracket (when admin mode active)**

```svelte
{#if adminMode}
  <div class="draft-admin-panel">
    <h3>Draft Admin</h3>
    <select bind:value={draftAdminMatchId}>
      <option value={null}>Select match...</option>
      {#each bracketMatches as match}
        <option value={match.id}>{match.teamA?.name ?? "?"} vs {match.teamB?.name ?? "?"}</option>
      {/each}
    </select>
    <div class="draft-admin-controls">
      <select bind:value={draftAdminSide}>
        <option value="A">Team A</option>
        <option value="B">Team B</option>
      </select>
      <select bind:value={draftAdminAction}>
        <option value="ban">Ban</option>
        <option value="pick">Pick</option>
      </select>
    </div>
    {#if draftAdminMatchId}
      <HeroPicker
        {heroes}
        disabledMlids={getDisabledMlids(draftAdminMatchId)}
        onSelect={submitDraftAction}
      />
    {/if}
  </div>
{/if}
```

**Step 3: Add getDisabledMlids helper**

```ts
function getDisabledMlids(matchId: number): Set<number> {
  const draft = draftDataCache.get(matchId);
  if (!draft) return new Set();
  return new Set([
    ...(draft.teamAPicks ?? []),
    ...(draft.teamBPicks ?? []),
    ...(draft.teamABans ?? []),
    ...(draft.teamBBans ?? [])
  ]);
}
```

**Step 4: Commit**

```bash
git add apps/web/src/routes/tournaments/[id]/+page.svelte
git commit -m "feat(web): add visual draft admin panel with HeroPicker"
```

---

## Task 7: Add Auto-Refresh for Spectators

**Objective:** Draft data auto-refreshes every 5-10 seconds for spectators viewing ongoing matches.

**Files:**
- Modify: `apps/web/src/routes/tournaments/[id]/+page.svelte`

**Step 1: Add auto-refresh timer (after existing auto-refresh setup)**

```ts
let draftRefreshTimer: ReturnType<typeof setInterval> | null = null;

function setupDraftAutoRefresh() {
  if (!browser) return;
  if (data.event.status === "ongoing" && draftDataCache.size > 0) {
    if (!draftRefreshTimer) {
      draftRefreshTimer = setInterval(() => {
        for (const matchId of draftDataCache.keys()) {
          draftDataCache.delete(matchId);
        }
        void invalidateAll();
      }, 8000);
    }
  } else if (draftRefreshTimer) {
    clearInterval(draftRefreshTimer);
    draftRefreshTimer = null;
  }
}

$: setupDraftAutoRefresh();

onDestroy(() => {
  if (draftRefreshTimer) clearInterval(draftRefreshTimer);
});
```

**Step 2: Commit**

```bash
git add apps/web/src/routes/tournaments/[id]/+page.svelte
git commit -m "feat(web): add auto-refresh for draft data on ongoing matches"
```

---

## Task 8: Enable Feature Flag and Deploy

**Objective:** Enable `PUBLIC_TOURNAMENT_DRAFTLOG_ADMIN=1` in .env and deploy.

**Files:**
- Modify: `.env` (add feature flag)
- Deploy: VPS

**Step 1: Add to .env**

```
PUBLIC_TOURNAMENT_DRAFTLOG_ADMIN=1
```

**Step 2: Build and verify**

```bash
pnpm build
# Expected: all packages build successfully
```

**Step 3: Deploy to VPS**

```bash
git add -A && git commit -m "chore: enable tournament draft log admin" && git push origin main
# Then deploy via VPS scripts
```

**Step 4: Verify on live**

```
https://draftarenax.com/tournaments/{ongoing-event-id}
→ Admin mode → Select match → Draft panel visible → Hero picker works
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | PATCH endpoint for incremental updates | `apps/api/src/index.ts` |
| 2 | GET endpoint for draft state | `apps/api/src/index.ts` |
| 3 | DraftPanel component | `apps/web/src/lib/components/DraftPanel.svelte` |
| 4 | HeroPicker component | `apps/web/src/lib/components/HeroPicker.svelte` |
| 5 | Integrate DraftPanel in bracket | `apps/web/src/routes/tournaments/[id]/+page.svelte` |
| 6 | Draft admin panel | `apps/web/src/routes/tournaments/[id]/+page.svelte` |
| 7 | Auto-refresh for spectators | `apps/web/src/routes/tournaments/[id]/+page.svelte` |
| 8 | Enable flag + deploy | `.env`, VPS deploy |

## Verification

1. API: `curl -X PATCH /events/1/matches/123/draft-log -d '{"action":"add","type":"ban","side":"A","heroId":88}'`
2. API: `curl /events/1/matches/123/draft-log` → returns draft state
3. Web: Open ongoing tournament → Admin unlock → Select match → Pick heroes → Draft panel updates
4. Spectator: Open tournament detail → Draft panels auto-refresh every 8s

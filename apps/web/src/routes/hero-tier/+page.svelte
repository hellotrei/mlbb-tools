<script lang="ts">
  import { goto } from "$app/navigation";
  import { Card, HeroAvatar, Skeleton } from "@mlbb/ui";
  import {
    LANES,
    RANK_SCOPES,
    ROLES,
    TIMEFRAMES,
    laneLabel,
    rankScopeLabel,
    roleLabel,
    timeframeLabel
  } from "$lib/options";

  export let data: {
    timeframe: string;
    role: string;
    lane: string;
    rankScope: string;
    tier: {
      segment: string;
      rankScope?: string | null;
      computedAt?: string | null;
      tiers: Record<"SS" | "S" | "A" | "B" | "C" | "D", Array<{ mlid: number; score: number }>>;
    };
    meta: {
      timeframe?: string;
      statsFetchedAt?: string | null;
      tierComputedAt?: string | null;
      countersComputedAt?: string | null;
    };
    heroes: Array<{
      mlid: number;
      name: string;
      rolePrimary: string;
      roleSecondary?: string | null;
      lanes: string[];
      imageKey: string;
    }>;
  };

  const ROLE_ICON_PATHS: Record<string, string> = {
    tank: "/filters/tank.webp",
    fighter: "/filters/fighter.webp",
    assassin: "/filters/assassin.webp",
    mage: "/filters/mage.webp",
    marksman: "/filters/marksman.webp",
    support: "/filters/support.webp"
  };

  const LANE_ICON_PATHS: Record<string, string> = {
    gold: "/filters/gold.webp",
    exp: "/filters/exp.webp",
    mid: "/filters/mid.webp",
    roam: "/filters/roam.webp",
    jungle: "/filters/jungle.webp"
  };

  const TIER_ORDER: Array<"SS" | "S" | "A" | "B" | "C" | "D"> = ["SS", "S", "A", "B", "C", "D"];

  const TIER_META: Record<(typeof TIER_ORDER)[number], { hint: string; from: string; to: string }> = {
    SS: { hint: "God-tier picks that define the meta", from: "#5f3b8f", to: "#334571" },
    S: { hint: "Top-tier picks that dominate the meta", from: "#8a3940", to: "#69412e" },
    A: { hint: "Strong heroes that consistently perform well", from: "#8a5b2a", to: "#675232" },
    B: { hint: "Solid picks for most compositions", from: "#1f5864", to: "#2b5b4f" },
    C: { hint: "Situational picks for specific drafts", from: "#2f4672", to: "#2f5971" },
    D: { hint: "Needs draft support to work effectively", from: "#4e5d77", to: "#404a60" }
  };

  $: heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero]));
  $: tierRows = TIER_ORDER.map((tier) => ({ tier, rows: data.tier?.tiers?.[tier] ?? [] }));
  $: resolvedUpdatedAt = data.rankScope
    ? data.tier?.computedAt ?? data.meta?.statsFetchedAt ?? data.meta?.tierComputedAt ?? null
    : data.meta?.statsFetchedAt ?? data.tier?.computedAt ?? data.meta?.tierComputedAt ?? null;
  $: lastUpdatedText = resolvedUpdatedAt ? new Date(resolvedUpdatedAt).toLocaleString() : null;

  function setFilters(patch: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }

    const nextQuery = next.toString();
    void goto(nextQuery ? `/hero-tier?${nextQuery}` : "/hero-tier", {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true
    });
  }

  function toggleRole(role: string) {
    setFilters({ role: data.role === role ? "" : role });
  }

  function toggleLane(lane: string) {
    setFilters({ lane: data.lane === lane ? "" : lane });
  }
</script>

<section class="hero-tier-root">
  <header class="hero-head">
    <h1 class="page-title hero-title">Mobile Legends Hero Tier List</h1>
    <p class="page-subtitle">Discover the current meta rankings. Filter by role and lane to find the best picks for your playstyle.</p>
    {#if lastUpdatedText}
      <p class="updated">Tier list last updated: {lastUpdatedText}</p>
    {/if}
  </header>

  <div class="controls">
    <section class="themed-select">
      <label for="timeframe-select">Timeframe</label>
      <div class="select-wrap">
        <select
          id="timeframe-select"
          value={data.timeframe}
          on:change={(e) => setFilters({ timeframe: (e.currentTarget as HTMLSelectElement).value })}
        >
          {#each TIMEFRAMES as timeframe}
            <option value={timeframe}>{timeframeLabel(timeframe)}</option>
          {/each}
        </select>
      </div>
    </section>

    <section class="themed-select">
      <label for="rank-scope-select">Rank Scope</label>
      <div class="select-wrap">
        <select
          id="rank-scope-select"
          value={data.rankScope}
          on:change={(e) => setFilters({ rankScope: (e.currentTarget as HTMLSelectElement).value })}
        >
          {#each RANK_SCOPES as rankScope}
            <option value={rankScope}>{rankScopeLabel(rankScope)}</option>
          {/each}
        </select>
      </div>
    </section>
  </div>

  <div class="filter-panels">
    <Card title="Filter by Role">
      <div class="choice-grid role-grid">
        {#each ROLES as role}
          <button class:selected={data.role === role} on:click={() => toggleRole(role)}>
            <img src={ROLE_ICON_PATHS[role]} alt={roleLabel(role)} class="filter-icon" loading="lazy" />
            <span>{roleLabel(role)}</span>
          </button>
        {/each}
      </div>
    </Card>

    <Card title="Filter by Lane">
      <div class="choice-grid lane-grid">
        {#each LANES as lane}
          <button class:selected={data.lane === lane} on:click={() => toggleLane(lane)}>
            <img src={LANE_ICON_PATHS[lane]} alt={laneLabel(lane)} class="filter-icon" loading="lazy" />
            <span>{laneLabel(lane)}</span>
          </button>
        {/each}
      </div>
    </Card>
  </div>

  {#if !data.tier?.tiers}
    <div class="grid">
      {#each Array.from({ length: 3 }) as _}
        <Card><Skeleton height="140px" /></Card>
      {/each}
    </div>
  {:else}
    <div class="tier-stack">
      {#each tierRows as row}
        {@const tier = row.tier}
        {@const meta = TIER_META[tier]}
        <section class="tier-row">
          <div class="tier-badge" style={`--from:${meta.from};--to:${meta.to}`}>
            <div class="tier-label">{tier}</div>
            <small>TIER</small>
          </div>

          <div class="tier-content">
            <div class="tier-caption">
              <p>{meta.hint}</p>
              <span>{row.rows.length} heroes</span>
            </div>

            {#if row.rows.length === 0}
              <p class="muted empty-inline">No hero data for filter ini.</p>
            {/if}

            <div class="hero-row">
              {#each row.rows as heroRow}
                {@const hero = heroMap.get(heroRow.mlid)}
                <article class="hero-card">
                  <div class="avatar-wrap">
                    <HeroAvatar name={hero?.name ?? `Hero #${heroRow.mlid}`} imageKey={hero?.imageKey ?? ""} size={54} />
                    {#if hero}
                      <span class="role-dot" title={roleLabel(hero.rolePrimary)}>
                        <img src={ROLE_ICON_PATHS[hero.rolePrimary]} alt={roleLabel(hero.rolePrimary)} />
                      </span>
                    {/if}
                  </div>

                  <strong>{hero?.name ?? `Hero #${heroRow.mlid}`}</strong>
                  <small class="lane-text">{hero?.lanes?.[0] ? laneLabel(hero.lanes[0]) : "Flexible"}</small>
                  <small class="meta-score">Meta Score {heroRow.score.toFixed(3)}</small>
                </article>
              {/each}
            </div>
          </div>
        </section>
      {/each}
    </div>
  {/if}
</section>

<style>
  .hero-tier-root {
    border: 1px solid rgba(136, 184, 255, 0.16);
    border-radius: 28px;
    padding: clamp(14px, 2.2vw, 24px);
    background: rgba(16, 29, 53, 0.64);
    box-shadow: inset 0 1px 0 rgba(206, 230, 255, 0.04), 0 18px 44px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(8px);
  }

  .hero-head {
    display: grid;
    gap: 9px;
    margin-bottom: 18px;
  }

  .hero-title {
    margin-bottom: 0;
    line-height: 1.04;
    text-shadow: 0 0 16px rgba(72, 238, 255, 0.25);
  }

  .page-subtitle {
    margin-bottom: 0;
    line-height: 1.35;
    max-width: 70ch;
  }

  .updated {
    margin: 0;
    color: #d6e7ff;
    font-weight: 500;
    line-height: 1.2;
  }

  .controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    align-items: end;
    margin-bottom: 16px;
  }

  .themed-select {
    border: 1px solid rgba(111, 156, 228, 0.2);
    border-radius: 18px;
    background: rgba(20, 37, 63, 0.55);
    padding: 13px;
    backdrop-filter: blur(6px);
    box-shadow: inset 0 1px 0 rgba(195, 224, 255, 0.05);
  }

  .themed-select label {
    display: block;
    margin-bottom: 8px;
    color: #a7bfdf;
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 700;
  }

  .select-wrap {
    position: relative;
  }

  .select-wrap::after {
    content: "";
    position: absolute;
    right: 12px;
    top: 50%;
    width: 10px;
    height: 10px;
    border-right: 2px solid #a9c8ee;
    border-bottom: 2px solid #a9c8ee;
    transform: translateY(-58%) rotate(45deg);
    pointer-events: none;
    opacity: 0.9;
  }

  .themed-select select {
    width: 100%;
    border: 1px solid rgba(132, 177, 245, 0.2);
    background: rgba(24, 41, 67, 0.78);
    color: #dbebff;
    border-radius: 14px;
    padding: 11px 38px 11px 12px;
    font-size: 0.98rem;
    font-weight: 600;
    appearance: none;
    transition: border-color 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out;
  }

  .themed-select select:hover {
    border-color: rgba(114, 190, 244, 0.38);
    background: rgba(27, 49, 78, 0.86);
  }

  .themed-select select:focus {
    outline: none;
    border-color: rgba(49, 222, 255, 0.6);
    box-shadow: inset 0 0 0 1px rgba(49, 222, 255, 0.28), 0 0 0 2px rgba(49, 222, 255, 0.14);
    background: rgba(30, 57, 89, 0.9);
  }

  .filter-panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }

  .filter-panels :global(.card) {
    border-radius: 22px;
    padding: 16px;
  }

  .filter-panels :global(.card h3) {
    margin-bottom: 14px;
  }

  .choice-grid {
    display: grid;
    gap: 11px;
  }

  .role-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .lane-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .choice-grid button {
    border: 1px solid rgba(138, 180, 255, 0.15);
    background: rgba(40, 53, 75, 0.9);
    color: #d6e7ff;
    border-radius: 16px;
    padding: 11px 8px 10px;
    min-width: 0;
    font-weight: 600;
    transition: all 180ms ease-out;
    display: grid;
    gap: 5px;
    justify-items: center;
    min-height: 70px;
    box-shadow: inset 0 1px 0 rgba(193, 220, 255, 0.08);
  }

  .filter-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    opacity: 0.95;
  }

  .choice-grid button span {
    font-size: 0.7rem;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
    width: 100%;
  }

  .choice-grid button.selected {
    border-color: rgba(48, 221, 255, 0.42);
    box-shadow: inset 0 0 0 1px rgba(48, 221, 255, 0.32), 0 0 0 2px rgba(48, 221, 255, 0.1);
    background: rgba(42, 73, 116, 0.78);
  }

  .tier-stack {
    display: grid;
    gap: 18px;
  }

  .tier-row {
    border: 1px solid rgba(146, 186, 255, 0.16);
    border-radius: 20px;
    overflow: hidden;
    background: rgba(24, 36, 58, 0.86);
    display: grid;
    grid-template-columns: 90px 1fr;
    min-height: 152px;
  }

  .tier-badge {
    display: grid;
    place-items: center;
    text-align: center;
    border-right: 1px solid rgba(255, 255, 255, 0.2);
    background: linear-gradient(180deg, var(--from), var(--to));
    color: #f5fbff;
    padding: 10px 8px;
  }

  .tier-label {
    font-size: 2.2rem;
    font-weight: 800;
    line-height: 1;
  }

  .tier-badge small {
    color: rgba(241, 247, 255, 0.92);
    letter-spacing: 0.12em;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .tier-content {
    display: grid;
    gap: 12px;
    min-width: 0;
  }

  .tier-caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(192, 219, 255, 0.18);
    color: #e9f3ff;
  }

  .tier-caption p {
    font-size: 1rem;
    color: #dce8fb;
  }

  .tier-caption span {
    font-size: 0.82rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .hero-row {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    overflow-x: auto;
    padding: 2px 14px 14px;
    scrollbar-width: thin;
  }

  .hero-card {
    flex: 0 0 auto;
    width: 118px;
    height: 136px;
    border: 1px solid rgba(138, 180, 255, 0.13);
    border-radius: 16px;
    background: rgba(56, 72, 98, 0.68);
    padding: 9px 8px 8px;
    display: grid;
    grid-template-rows: auto auto auto auto;
    gap: 4px;
    justify-items: center;
    align-content: start;
    text-align: center;
    transition: transform 180ms ease-out, border-color 180ms ease-out;
  }

  .hero-card:hover {
    transform: translateY(-2px);
    border-color: rgba(48, 221, 255, 0.4);
  }

  .avatar-wrap {
    position: relative;
    width: fit-content;
  }

  .role-dot {
    position: absolute;
    right: -5px;
    top: -5px;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid rgba(176, 215, 255, 0.3);
    background: #132840;
    overflow: hidden;
  }

  .role-dot img {
    width: 12px;
    height: 12px;
    object-fit: contain;
  }

  .hero-card strong {
    font-size: 0.92rem;
    color: #f4f8ff;
    line-height: 1.12;
    min-height: 2.05em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .hero-card small {
    color: #acc6e8;
    font-size: 0.7rem;
    line-height: 1.1;
  }

  .lane-text {
    color: #b6c9e4;
  }

  .meta-score {
    color: #86d8ff;
    font-weight: 600;
  }

  .muted {
    color: var(--muted);
  }

  .empty-inline {
    padding: 0 14px 2px;
  }

  @media (max-width: 1100px) {
    .controls {
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
    }

    .role-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .lane-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 700px) {
    .tier-row {
      grid-template-columns: 70px 1fr;
      min-height: 132px;
    }

    .tier-label {
      font-size: 1.75rem;
    }

    .hero-card {
      width: 112px;
      height: 134px;
    }

    .lane-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>

<script lang="ts">
  import { goto } from "$app/navigation";
  import { Card, HeroAvatar, Skeleton } from "@mlbb/ui";
  import { LANES, ROLES, TIMEFRAMES, laneLabel, roleLabel, timeframeLabel } from "$lib/options";

  export let data: {
    timeframe: string;
    role: string;
    lane: string;
    tier: {
      segment: string;
      computedAt?: string | null;
      tiers: Record<"SS" | "S" | "A" | "B" | "C" | "D", Array<{ mlid: number; score: number }>>;
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

  const ROLE_ICONS: Record<string, string> = {
    tank: "T",
    fighter: "F",
    assassin: "A",
    mage: "M",
    marksman: "MM",
    support: "S"
  };

  const LANE_ICONS: Record<string, string> = {
    gold: "G",
    exp: "E",
    mid: "M",
    roam: "R",
    jungle: "J"
  };

  const TIER_ORDER: Array<"SS" | "S" | "A" | "B" | "C" | "D"> = ["SS", "S", "A", "B", "C", "D"];

  const TIER_META: Record<(typeof TIER_ORDER)[number], { hint: string; from: string; to: string }> = {
    SS: { hint: "God-tier picks that define the meta", from: "#8f2bff", to: "#4f6dff" },
    S: { hint: "Top-tier picks that dominate the meta", from: "#ff2b35", to: "#ff6a2b" },
    A: { hint: "Strong heroes that consistently perform well", from: "#ff8f1f", to: "#ffbe2b" },
    B: { hint: "Solid picks for most compositions", from: "#14c6cc", to: "#26e2a8" },
    C: { hint: "Situational picks for specific drafts", from: "#5f7cff", to: "#4cb8ff" },
    D: { hint: "Needs draft support to work effectively", from: "#637192", to: "#7a8aa7" }
  };

  const heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero]));
  $: tierRows = TIER_ORDER.map((tier) => ({ tier, rows: data.tier?.tiers?.[tier] ?? [] }));
  $: lastUpdatedText = data.tier?.computedAt ? new Date(data.tier.computedAt).toLocaleString() : null;

  function setFilters(patch: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }

    void goto(`/hero-tier?${next.toString()}`, {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true
    });
  }

  function resetFilters() {
    void goto("/hero-tier?timeframe=7d", {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true
    });
  }
</script>

<h1 class="page-title hero-title">Mobile Legends Hero Tier List</h1>
<p class="page-subtitle">Discover the current meta rankings. Filter by role and lane to find the best picks for your playstyle.</p>
{#if lastUpdatedText}
  <p class="updated">Tier list last updated: {lastUpdatedText}</p>
{/if}

<div class="controls">
  <select value={data.timeframe} on:change={(e) => setFilters({ timeframe: (e.currentTarget as HTMLSelectElement).value })}>
    {#each TIMEFRAMES as timeframe}
      <option value={timeframe}>{timeframeLabel(timeframe)}</option>
    {/each}
  </select>
  <button class="ghost" on:click={resetFilters}>Reset</button>
</div>

<div class="filter-panels">
  <Card title="Filter by Role">
    <div class="choice-grid role-grid">
      <button class:selected={data.role === ""} on:click={() => setFilters({ role: "" })}>All</button>
      {#each ROLES as role}
        <button class:selected={data.role === role} on:click={() => setFilters({ role })}>
          <span class="icon">{ROLE_ICONS[role]}</span>
          <span>{roleLabel(role)}</span>
        </button>
      {/each}
    </div>
  </Card>

  <Card title="Filter by Lane">
    <div class="choice-grid lane-grid">
      <button class:selected={data.lane === ""} on:click={() => setFilters({ lane: "" })}>All</button>
      {#each LANES as lane}
        <button class:selected={data.lane === lane} on:click={() => setFilters({ lane })}>
          <span class="icon">{LANE_ICONS[lane]}</span>
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
                      {ROLE_ICONS[hero.rolePrimary] ?? roleLabel(hero.rolePrimary).slice(0, 1)}
                    </span>
                  {/if}
                </div>

                <strong>{hero?.name ?? `Hero #${heroRow.mlid}`}</strong>
                <small>
                  {hero?.lanes?.[0] ? laneLabel(hero.lanes[0]) : "Flexible"} | {heroRow.score.toFixed(3)}
                </small>
              </article>
            {/each}
          </div>
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .hero-title {
    text-shadow: 0 0 18px rgba(72, 238, 255, 0.35);
  }

  .updated {
    margin-bottom: 16px;
    color: #d6e7ff;
    font-weight: 500;
  }

  .ghost {
    background: rgba(45, 57, 79, 0.9);
  }

  .filter-panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .choice-grid {
    display: grid;
    gap: 10px;
  }

  .role-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .lane-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .choice-grid button {
    border: 1px solid rgba(138, 180, 255, 0.22);
    background: rgba(40, 53, 75, 0.92);
    color: #d6e7ff;
    border-radius: 14px;
    padding: 12px 10px;
    font-weight: 600;
    transition: all 180ms ease-out;
    display: grid;
    gap: 6px;
    justify-items: center;
    min-height: 78px;
  }

  .choice-grid button .icon {
    font-size: 1.15rem;
    opacity: 0.9;
  }

  .choice-grid button.selected {
    border-color: rgba(48, 221, 255, 0.6);
    box-shadow: inset 0 0 0 1px rgba(48, 221, 255, 0.35), 0 0 0 3px rgba(48, 221, 255, 0.12);
    background: linear-gradient(145deg, rgba(31, 72, 126, 0.9), rgba(53, 67, 100, 0.9));
  }

  .tier-stack {
    display: grid;
    gap: 14px;
  }

  .tier-row {
    border: 1px solid rgba(146, 186, 255, 0.26);
    border-radius: 14px;
    overflow: hidden;
    background: linear-gradient(95deg, rgba(28, 37, 56, 0.95) 0%, rgba(29, 44, 70, 0.88) 58%, rgba(22, 42, 68, 0.8) 100%);
    display: grid;
    grid-template-columns: 90px 1fr;
    min-height: 150px;
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
    font-size: 2.25rem;
    font-weight: 800;
    line-height: 1;
  }

  .tier-badge small {
    color: rgba(241, 247, 255, 0.94);
    letter-spacing: 0.12em;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .tier-content {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .tier-caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(192, 219, 255, 0.32);
    color: #e9f3ff;
  }

  .tier-caption p {
    font-size: 1.05rem;
    color: #e4eeff;
  }

  .tier-caption span {
    font-size: 0.86rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .hero-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    overflow-x: auto;
    padding: 4px 12px 12px;
    scrollbar-width: thin;
  }

  .hero-card {
    flex: 0 0 auto;
    width: 104px;
    border: 1px solid rgba(138, 180, 255, 0.18);
    border-radius: 12px;
    background: rgba(56, 72, 98, 0.74);
    padding: 8px;
    display: grid;
    gap: 6px;
    justify-items: center;
    text-align: center;
    transition: transform 180ms ease-out, border-color 180ms ease-out;
  }

  .hero-card:hover {
    transform: translateY(-2px);
    border-color: rgba(48, 221, 255, 0.48);
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
    border: 1px solid rgba(176, 215, 255, 0.45);
    background: #132840;
    font-size: 0.68rem;
    line-height: 1;
  }

  .hero-card strong {
    font-size: 1.05rem;
    color: #f4f8ff;
    line-height: 1.15;
  }

  .hero-card small {
    color: #acc6e8;
    font-size: 0.72rem;
  }

  .muted {
    color: var(--muted);
  }

  .empty-inline {
    padding: 0 14px 2px;
  }

  @media (max-width: 960px) {
    .role-grid,
    .lane-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .tier-row {
      grid-template-columns: 70px 1fr;
      min-height: 132px;
    }

    .tier-label {
      font-size: 1.75rem;
    }

    .hero-card {
      width: 98px;
    }
  }
</style>

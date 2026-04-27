<script lang="ts">
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { Card, HeroAvatar, Skeleton } from "@mlbb/ui";
  import {
    LANES,
    ROLES,
    laneLabel,
    roleLabel
  } from "$lib/options";
  import { engine } from "$lib/stores/engine";
  import { apiUrl } from "$lib/api";
  import { isTournamentEngine, tournamentEngineConfig } from "$lib/tournament-engines";
  import {
    deriveHeroInsight,
    metricPercent,
    priorityChipClass,
    riskChipClass
  } from "$lib/hero-tier-insight";

  type TierData = {
    segment: string;
    rankScope?: string | null;
    computedAt?: string | null;
    tiers: Record<"SS" | "S" | "A" | "B" | "C" | "D", Array<{ mlid: number; score: number }>>;
  };

  export let data: {
    role: string;
    lane: string;
    tier: TierData;
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

  let tierData: TierData = data.tier;
  let tierLoading = false;
  let didMount = false;
  let filterRole = data.role;
  let filterLane = data.lane;

  onMount(() => {
    didMount = true;
  });

  $: if (!isTournamentEngine($engine)) {
    tierData = data.tier;
    filterRole = data.role;
    filterLane = data.lane;
  }

  async function refetchTierForEngine(eng: string) {
    const tournamentEndpoint = tournamentEngineConfig(eng)?.tierPath ?? null;
    if (tournamentEndpoint) {
      tierLoading = true;
      try {
        const res = await fetch(apiUrl(tournamentEndpoint));
        if (!res.ok) throw new Error("Failed to load tournament tier data.");
        const payload = (await res.json()) as { items: Array<{ mlid: number; tier: string; score: number }> };
        const tiers: Record<string, Array<{ mlid: number; score: number }>> = {
          SS: [], S: [], A: [], B: [], C: [], D: []
        };
        for (const item of payload.items) {
          const bucket = tiers[item.tier];
          if (bucket) {
            bucket.push({ mlid: item.mlid, score: item.score });
          }
        }
        tierData = {
          segment: "all",
          rankScope: "tournament",
          computedAt: null,
          tiers: tiers as TierData["tiers"]
        };
      } catch (_err) {
      } finally {
        tierLoading = false;
      }
    } else {
      tierLoading = true;
      try {
        const params = new URLSearchParams({ timeframe: "7d" });
        if (data.role) params.set("role", data.role);
        if (data.lane) params.set("lane", data.lane);
        params.set("rankScope", "mythic_glory");
        const res = await fetch(apiUrl(`/tier?${params.toString()}`));
        if (!res.ok) throw new Error("Failed to reload community tier data.");
        tierData = (await res.json()) as TierData;
      } catch (_err) {
      } finally {
        tierLoading = false;
      }
    }
  }

  $: if (browser && didMount) void refetchTierForEngine($engine);

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

  // ── Infotip state ──────────────────────────────────────────────────────────
  type InfotipTarget = { mlid: number; score: number; tier: string };
  type InfotipPlacement = {
    vertical: "top" | "bottom";
    horizontal: "center" | "left" | "right";
  };

  let infotipTarget: InfotipTarget | null = null;
  let infotipPos = { top: 0, left: 0 };
  let infotipPlacement: InfotipPlacement = { vertical: "top", horizontal: "center" };
  let infotipCloseTimer: ReturnType<typeof setTimeout> | null = null;

  function computeInfotipLayout(anchor: HTMLElement): {
    placement: InfotipPlacement;
    position: { top: number; left: number };
  } {
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = Math.min(300, vw - 32);
    const ph = 440;
    const gap = 10;
    const margin = 12;

    const centerL = rect.left + rect.width / 2 - pw / 2;
    const horizontal: InfotipPlacement["horizontal"] =
      centerL < margin ? "left" : centerL + pw > vw - margin ? "right" : "center";

    const spaceAbove = rect.top;
    const spaceBelow = vh - rect.bottom;
    const vertical: InfotipPlacement["vertical"] =
      spaceAbove >= ph || spaceAbove >= spaceBelow ? "top" : "bottom";

    let left = rect.left + rect.width / 2 - pw / 2;
    if (horizontal === "left") left = rect.left;
    if (horizontal === "right") left = rect.right - pw;
    left = Math.max(margin, Math.min(left, vw - pw - margin));

    const top =
      vertical === "top" ? rect.top : rect.bottom + gap;
    return { placement: { vertical, horizontal }, position: { top: Math.max(margin, top), left } };
  }

  function openInfotip(
    heroRow: { mlid: number; score: number },
    tier: string,
    anchor: HTMLElement
  ): void {
    if (infotipCloseTimer) clearTimeout(infotipCloseTimer);
    const { placement, position } = computeInfotipLayout(anchor);
    infotipTarget = { mlid: heroRow.mlid, score: heroRow.score, tier };
    infotipPos = position;
    infotipPlacement = placement;
  }

  function queueInfotipClose(): void {
    infotipCloseTimer = setTimeout(() => {
      infotipTarget = null;
    }, 140);
  }

  function cancelInfotipClose(): void {
    if (infotipCloseTimer) clearTimeout(infotipCloseTimer);
  }

  // ───────────────────────────────────────────────────────────────────────────

  $: heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero]));
  $: tierRows = TIER_ORDER.map((tier) => ({
    tier,
    rows: (tierData?.tiers?.[tier] ?? []).filter((heroRow) => {
      const hero = heroMap.get(heroRow.mlid);
      if (!hero) return false;
      if (filterRole && hero.rolePrimary !== filterRole && hero.roleSecondary !== filterRole) return false;
      if (filterLane && !hero.lanes.includes(filterLane)) return false;
      return true;
    })
  }));

  function setFilters(patch: Record<string, string>) {
    if ("role" in patch) filterRole = patch.role ?? "";
    if ("lane" in patch) filterLane = patch.lane ?? "";

    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }

    const nextQuery = next.toString();
    void goto(nextQuery ? `/hero-tier?${nextQuery}` : "/hero-tier", {
      keepFocus: true,
      noScroll: true
    });
  }

  function toggleRole(role: string) {
    setFilters({ role: filterRole === role ? "" : role });
  }

  function toggleLane(lane: string) {
    setFilters({ lane: filterLane === lane ? "" : lane });
  }
</script>

<section class="hero-tier-root">
  <header class="hero-head">
    <h1 class="page-title hero-title">Draft Arena</h1>
  </header>

  <div class="filter-panels">
    <Card title="Filter by Role">
      <div class="choice-grid role-grid">
        {#each ROLES as role}
          <button type="button" class:selected={filterRole === role} on:click={() => toggleRole(role)}>
            <img src={ROLE_ICON_PATHS[role]} alt={roleLabel(role)} class="filter-icon" loading="lazy" />
            <span>{roleLabel(role)}</span>
          </button>
        {/each}
      </div>
    </Card>

    <Card title="Filter by Lane">
      <div class="choice-grid lane-grid">
        {#each LANES as lane}
          <button type="button" class:selected={filterLane === lane} on:click={() => toggleLane(lane)}>
            <img src={LANE_ICON_PATHS[lane]} alt={laneLabel(lane)} class="filter-icon" loading="lazy" />
            <span>{laneLabel(lane)}</span>
          </button>
        {/each}
      </div>
    </Card>
  </div>

  {#if tierLoading}
    <div class="grid">
      {#each Array.from({ length: 3 }) as _}
        <Card><Skeleton height="140px" /></Card>
      {/each}
    </div>
  {:else if !tierData?.tiers}
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
                <article
                    class="hero-card"
                    tabindex="0"
                    role="article"
                    aria-label="{hero?.name ?? `Hero #${heroRow.mlid}`} — {tier} tier"
                    aria-describedby={infotipTarget?.mlid === heroRow.mlid ? "hero-infotip" : undefined}
                    on:mouseenter={(e) => openInfotip(heroRow, tier, e.currentTarget)}
                    on:mouseleave={queueInfotipClose}
                    on:focus={(e) => openInfotip(heroRow, tier, e.currentTarget)}
                    on:blur={queueInfotipClose}
                  >
                  <div class="avatar-wrap">
                    <HeroAvatar name={hero?.name ?? `Hero #${heroRow.mlid}`} imageKey={hero?.imageKey ?? ""} size={48} />
                    {#if hero}
                      <span class="role-dot" title={roleLabel(hero.rolePrimary)}>
                        <img src={ROLE_ICON_PATHS[hero.rolePrimary]} alt={roleLabel(hero.rolePrimary)} />
                      </span>
                    {/if}
                  </div>

                  <strong>{hero?.name ?? `Hero #${heroRow.mlid}`}</strong>
                  <small class="lane-text">{hero?.lanes?.[0] ? laneLabel(hero.lanes[0]) : "Flexible"}</small>
                  <small class="meta-score">Score {heroRow.score.toFixed(3)}</small>
                  {#if hero}
                    {@const _insight = deriveHeroInsight(hero, heroRow.score, tier)}
                    <span class="ht-priority-chip ht-priority-chip--{priorityChipClass(_insight.priority).replace('ht-badge--', '')}">{_insight.priority}</span>
                  {/if}
                </article>
              {/each}
            </div>
          </div>
        </section>
      {/each}
    </div>
  {/if}
</section>

{#if browser && infotipTarget}
  {@const _th = heroMap.get(infotipTarget.mlid)}
  {#if _th}
    {@const _insight = deriveHeroInsight(_th, infotipTarget.score, infotipTarget.tier)}
    {@const _tierMeta = TIER_META[infotipTarget.tier as keyof typeof TIER_META]}
    <div
      id="hero-infotip"
      class="ht-infotip ht-infotip--{infotipPlacement.vertical} ht-infotip--{infotipPlacement.horizontal}"
      role="tooltip"
      style={`top:${infotipPos.top}px; left:${infotipPos.left}px;`}
      on:mouseenter={cancelInfotipClose}
      on:mouseleave={queueInfotipClose}
      transition:fade={{ duration: 110 }}
    >
      <div
        class="ht-infotip-arrow ht-infotip-arrow--{infotipPlacement.vertical} ht-infotip-arrow--{infotipPlacement.horizontal}"
        aria-hidden="true"
      ></div>

      <div class="ht-infotip-head">
        <div class="ht-infotip-hero">
          <HeroAvatar name={_th.name} imageKey={_th.imageKey ?? ""} size={40} />
          <div class="ht-infotip-copy">
            <span class="ht-infotip-kicker">{_tierMeta?.hint ?? ""}</span>
            <strong>{_th.name}</strong>
            <span>{roleLabel(_th.rolePrimary)} · {_th.lanes[0] ? laneLabel(_th.lanes[0]) : "Flexible"}</span>
          </div>
        </div>
      </div>

      <div class="ht-infotip-badges">
        <span class="ht-tier-pill">{infotipTarget.tier} TIER</span>
        <span class="ht-badge {priorityChipClass(_insight.priority)}">{_insight.priority}</span>
        <span class="ht-badge {riskChipClass(_insight.risk)}">Risk: {_insight.risk}</span>
        <span class="ht-badge ht-badge--spike">⚡ {_insight.spike}</span>
      </div>

      <div class="ht-infotip-section">
        <strong>Why this hero</strong>
        {#each _insight.reasons as reason}
          <p>{reason}</p>
        {/each}
      </div>

      <div class="ht-infotip-metrics">
        {#each _insight.bars as bar}
          <div class="ht-metric-card ht-metric-card--{bar.tone}">
            <div class="ht-metric-head">
              <span>{bar.label}</span>
              <strong>{metricPercent(bar.value)}%</strong>
            </div>
            <div class="ht-metric-bar">
              <span class="ht-metric-fill" style={`width: ${metricPercent(bar.value)}%`}></span>
            </div>
          </div>
        {/each}
      </div>

      <div class="ht-infotip-context">
        <div class="ht-ctx-row">
          <span class="ht-ctx-label">STRONG VS</span>
          <span class="ht-ctx-val">{_insight.strongVs}</span>
        </div>
        <div class="ht-ctx-row">
          <span class="ht-ctx-label">WEAK VS</span>
          <span class="ht-ctx-val">{_insight.weakVs}</span>
        </div>
        <div class="ht-ctx-row">
          <span class="ht-ctx-label">SYNERGY</span>
          <span class="ht-ctx-val">{_insight.synergy}</span>
        </div>
      </div>

      <div class="ht-infotip-cta">
        <a href="/hero-statistics" class="ht-cta-btn">View Stats</a>
        <a href="/counter-pick" class="ht-cta-btn">Counter</a>
        <a href="/draft-master" class="ht-cta-btn ht-cta-btn--accent">Draft</a>
      </div>
    </div>
  {/if}
{/if}

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
    border-radius: 13px;
    padding: 8px 6px 7px;
    min-width: 0;
    font-weight: 600;
    transition: all 180ms ease-out;
    display: grid;
    gap: 4px;
    justify-items: center;
    min-height: 60px;
    box-shadow: inset 0 1px 0 rgba(193, 220, 255, 0.08);
  }

  .filter-icon {
    width: 20px;
    height: 20px;
    object-fit: contain;
    opacity: 0.95;
  }

  .choice-grid button span {
    font-size: 0.64rem;
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
    grid-template-columns: 82px 1fr;
    min-height: 138px;
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
    font-size: 1.95rem;
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
    padding: 9px 12px;
    border-bottom: 1px solid rgba(192, 219, 255, 0.18);
    color: #e9f3ff;
  }

  .tier-caption p {
    font-size: 0.9rem;
    color: #dce8fb;
  }

  .tier-caption span {
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .hero-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    overflow-x: auto;
    padding: 1px 10px 10px;
    scrollbar-width: thin;
  }

  .hero-card {
    flex: 0 0 auto;
    width: 104px;
    min-height: 122px;
    height: auto;
    border: 1px solid rgba(138, 180, 255, 0.13);
    border-radius: 13px;
    background: rgba(56, 72, 98, 0.68);
    padding: 7px 7px 6px;
    display: grid;
    grid-template-rows: auto auto auto auto auto;
    gap: 3px;
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
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid rgba(176, 215, 255, 0.3);
    background: #132840;
    overflow: hidden;
  }

  .role-dot img {
    width: 10px;
    height: 10px;
    object-fit: contain;
  }

  .hero-card strong {
    font-size: 0.82rem;
    color: #f4f8ff;
    line-height: 1.12;
    min-height: 1.95em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .hero-card small {
    color: #acc6e8;
    font-size: 0.64rem;
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
    .role-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .lane-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .choice-grid {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
      gap: 8px;
      padding-left: 4px;
      padding-bottom: 4px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    .choice-grid::-webkit-scrollbar {
      display: none;
    }

    .choice-grid button {
      flex: 0 0 64px;
      width: 64px;
      height: 72px;
      min-height: unset;
      padding: 8px 4px 6px;
    }

    .filter-icon {
      width: 20px;
      height: 20px;
    }

    .choice-grid button span {
      font-size: 0.625rem;
    }

    /* ── Tier row: badge moves to top as full-width bar ── */
    .tier-row {
      grid-template-columns: 1fr;
      min-height: unset;
    }

    .tier-badge {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-right: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      justify-content: flex-start;
    }

    .tier-label {
      font-size: 1.25rem;
    }

    .tier-badge small {
      font-size: 0.65rem;
    }

    /* ── Tier content ── */
    .tier-content {
      gap: 8px;
    }

    /* Hide description text — low value on mobile */
    .tier-caption p {
      display: none;
    }

    .tier-caption {
      padding: 6px 10px;
    }

    /* ── Hero row: 2-column grid instead of horizontal scroll ── */
    .hero-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      overflow-x: unset;
      padding: 4px 10px 10px;
    }

    /* ── Hero card: horizontal compact layout ── */
    .hero-card {
      flex: unset;
      width: 100%;
      height: auto;
      display: grid;
      grid-template-columns: 44px 1fr;
      grid-template-rows: auto auto;
      column-gap: 9px;
      row-gap: 1px;
      align-items: center;
      padding: 7px 9px;
      justify-items: start;
      text-align: left;
    }

    .avatar-wrap {
      grid-row: 1 / -1;
      align-self: center;
    }

    .hero-card strong {
      min-height: unset;
      font-size: 0.78rem;
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }

    .lane-text {
      font-size: 0.6rem;
    }

    /* Hide meta score on mobile */
    .meta-score {
      display: none;
    }

    .ht-priority-chip {
      display: none;
    }

    /* Infotip: smaller on mobile */
    .ht-infotip {
      width: min(288px, calc(100vw - 24px)) !important;
      font-size: 0.66rem;
    }
  }

  /* ── Hero card tweaks for focusability ── */
  .hero-card {
    cursor: default;
    outline: none;
  }

  .hero-card:focus-visible {
    border-color: rgba(48, 221, 255, 0.55);
    box-shadow: 0 0 0 2px rgba(48, 221, 255, 0.18);
  }

  /* ── Priority chip on card ── */
  .ht-priority-chip {
    font-size: 0.52rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: 999px;
    padding: 2px 6px;
    line-height: 1.4;
    white-space: nowrap;
  }

  .ht-priority-chip--first {
    border: 1px solid rgba(250, 204, 21, 0.5);
    background: rgba(78, 53, 0, 0.6);
    color: #fde68a;
  }

  .ht-priority-chip--safe {
    border: 1px solid rgba(74, 222, 128, 0.4);
    background: rgba(6, 50, 25, 0.6);
    color: #86efac;
  }

  .ht-priority-chip--counter {
    border: 1px solid rgba(251, 146, 60, 0.4);
    background: rgba(60, 20, 0, 0.6);
    color: #fdba74;
  }

  .ht-priority-chip--situational {
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(30, 41, 59, 0.6);
    color: #94a3b8;
  }

  /* ══ Infotip (fixed floating panel) ══════════════════════════════════════ */

  :global(.ht-infotip) {
    position: fixed;
    width: min(300px, calc(100vw - 24px));
    border: 1px solid rgba(101, 137, 196, 0.44);
    border-radius: 12px;
    background: rgba(8, 20, 47, 0.97);
    color: #c9ddff;
    padding: 12px;
    display: grid;
    gap: 9px;
    z-index: 200;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(96, 165, 250, 0.06);
    pointer-events: auto;
    animation: ht-infotip-in 140ms ease-out;
  }

  :global(.ht-infotip--top) {
    transform: translateY(-100%) translateY(-10px);
  }

  :global(.ht-infotip--bottom) {
    transform: translateY(0);
  }

  :global(.ht-infotip-arrow) {
    position: absolute;
    left: 50%;
    width: 12px;
    height: 12px;
    background: rgba(8, 20, 47, 0.97);
    border-right: 1px solid rgba(101, 137, 196, 0.44);
    border-bottom: 1px solid rgba(101, 137, 196, 0.44);
  }

  :global(.ht-infotip-arrow--top) {
    bottom: -6px;
    transform: translateX(-50%) rotate(45deg);
  }

  :global(.ht-infotip-arrow--bottom) {
    top: -6px;
    transform: translateX(-50%) rotate(225deg);
  }

  :global(.ht-infotip-arrow--left) {
    left: 20px;
    transform: rotate(45deg);
  }

  :global(.ht-infotip-arrow--bottom.ht-infotip-arrow--left) {
    transform: rotate(225deg);
  }

  :global(.ht-infotip-arrow--right) {
    left: auto;
    right: 20px;
    transform: rotate(45deg);
  }

  :global(.ht-infotip-arrow--bottom.ht-infotip-arrow--right) {
    transform: rotate(225deg);
  }

  :global(.ht-infotip-head) {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  :global(.ht-infotip-hero) {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  :global(.ht-infotip-copy) {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  :global(.ht-infotip-kicker) {
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7aa0c8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.ht-infotip-copy strong) {
    font-size: 0.88rem;
    color: #eff6ff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.ht-infotip-copy span) {
    font-size: 0.59rem;
    color: #9bb7dc;
  }

  :global(.ht-infotip-badges) {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  :global(.ht-tier-pill) {
    border-radius: 999px;
    border: 1px solid rgba(119, 210, 156, 0.45);
    background: rgba(21, 72, 53, 0.52);
    color: #b9f3d6;
    padding: 2px 7px;
    font-size: 0.52rem;
    font-weight: 700;
    white-space: nowrap;
  }

  :global(.ht-badge) {
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 0.5rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  :global(.ht-badge--first) {
    border: 1px solid rgba(250, 204, 21, 0.5);
    background: rgba(78, 53, 0, 0.6);
    color: #fde68a;
  }

  :global(.ht-badge--safe) {
    border: 1px solid rgba(74, 222, 128, 0.4);
    background: rgba(6, 50, 25, 0.6);
    color: #86efac;
  }

  :global(.ht-badge--counter) {
    border: 1px solid rgba(251, 146, 60, 0.4);
    background: rgba(60, 20, 0, 0.6);
    color: #fdba74;
  }

  :global(.ht-badge--situational) {
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(30, 41, 59, 0.6);
    color: #94a3b8;
  }

  :global(.ht-badge--risk-low) {
    border: 1px solid rgba(74, 222, 128, 0.35);
    background: rgba(6, 46, 22, 0.55);
    color: #86efac;
  }

  :global(.ht-badge--risk-med) {
    border: 1px solid rgba(251, 191, 36, 0.35);
    background: rgba(55, 38, 0, 0.55);
    color: #fcd34d;
  }

  :global(.ht-badge--risk-high) {
    border: 1px solid rgba(248, 113, 113, 0.35);
    background: rgba(56, 10, 10, 0.55);
    color: #fca5a5;
  }

  :global(.ht-badge--spike) {
    border: 1px solid rgba(129, 140, 248, 0.35);
    background: rgba(20, 14, 56, 0.55);
    color: #a5b4fc;
  }

  :global(.ht-infotip-section) {
    display: grid;
    gap: 5px;
    padding: 9px 10px;
    border-radius: 10px;
    background: rgba(14, 29, 56, 0.58);
    border: 1px solid rgba(132, 176, 244, 0.1);
  }

  :global(.ht-infotip-section strong) {
    font-size: 0.62rem;
    color: #eaf2ff;
    font-weight: 700;
  }

  :global(.ht-infotip-section p) {
    margin: 0;
    font-size: 0.59rem;
    line-height: 1.45;
    color: #a9c2e6;
  }

  :global(.ht-infotip-metrics) {
    display: grid;
    gap: 6px;
  }

  :global(.ht-metric-card) {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 10px;
    border-radius: 10px;
    background: rgba(10, 22, 46, 0.72);
    border: 1px solid rgba(132, 176, 244, 0.1);
  }

  :global(.ht-metric-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  :global(.ht-metric-head span) {
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #9bb7dc;
  }

  :global(.ht-metric-head strong) {
    font-size: 0.62rem;
    color: #eff6ff;
  }

  :global(.ht-metric-bar) {
    position: relative;
    height: 7px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.16);
    overflow: hidden;
  }

  :global(.ht-metric-fill) {
    display: block;
    height: 100%;
    border-radius: inherit;
    transition: width 300ms ease-out;
  }

  :global(.ht-metric-card--tier .ht-metric-fill) {
    background: linear-gradient(90deg, #f59e0b, #fcd34d);
  }

  :global(.ht-metric-card--win .ht-metric-fill) {
    background: linear-gradient(90deg, #ef4444, #fb7185);
  }

  :global(.ht-metric-card--pressure .ht-metric-fill) {
    background: linear-gradient(90deg, #f97316, #fb923c);
  }

  :global(.ht-metric-card--flex .ht-metric-fill) {
    background: linear-gradient(90deg, #38bdf8, #60a5fa);
  }

  :global(.ht-infotip-context) {
    display: grid;
    gap: 5px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(14, 29, 56, 0.44);
    border: 1px solid rgba(132, 176, 244, 0.08);
  }

  :global(.ht-ctx-row) {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  :global(.ht-ctx-label) {
    font-size: 0.48rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #7aa0c8;
    flex-shrink: 0;
    width: 58px;
  }

  :global(.ht-ctx-val) {
    font-size: 0.58rem;
    color: #c2d8f4;
    line-height: 1.35;
    min-width: 0;
  }

  :global(.ht-infotip-cta) {
    display: flex;
    gap: 6px;
  }

  :global(.ht-cta-btn) {
    flex: 1;
    border: 1px solid rgba(129, 172, 239, 0.25);
    background: rgba(20, 37, 62, 0.72);
    color: #c2d8f4;
    border-radius: 8px;
    padding: 5px 8px;
    font-size: 0.58rem;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    transition: border-color 140ms ease, background 140ms ease;
  }

  :global(.ht-cta-btn:hover) {
    border-color: rgba(96, 165, 250, 0.5);
    background: rgba(30, 56, 96, 0.72);
    color: #dbeafe;
  }

  :global(.ht-cta-btn--accent) {
    border-color: rgba(48, 221, 255, 0.38);
    background: rgba(10, 52, 80, 0.72);
    color: #7dd3fc;
  }

  :global(.ht-cta-btn--accent:hover) {
    border-color: rgba(48, 221, 255, 0.62);
    background: rgba(10, 65, 100, 0.82);
  }

  @keyframes ht-infotip-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>

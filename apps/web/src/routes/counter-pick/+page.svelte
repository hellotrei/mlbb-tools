<script lang="ts">
  import { HeroAvatar, Skeleton } from "@mlbb/ui";
  import { apiUrl } from "$lib/api";
  import {
    LANES,
    RANK_SCOPES,
    ROLES,
    TIMEFRAMES,
    heroRoles,
    laneLabel,
    rankScopeLabel,
    roleLabel,
    timeframeLabel
  } from "$lib/options";

  type Hero = {
    mlid: number;
    name: string;
    rolePrimary: string;
    roleSecondary?: string | null;
    lanes: string[];
    imageKey: string;
  };

  type Recommendation = {
    mlid: number;
    score: number;
    tier?: string;
    countersAgainst?: number[];
    communityVotes?: number;
  };

  export let data: {
    timeframe: string;
    rankScope: string;
    heroes: Hero[];
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

  let timeframe = data.timeframe;
  let rankScope = data.rankScope;
  let enemyRoleFilter = "";
  let enemyLaneFilter = "";
  let preferredRole = "";
  let preferredLane = "";

  let loading = false;
  let error = "";
  let recommendations: Recommendation[] = [];
  let selectedEnemyMlids: number[] = [];
  let communityVoteCount = 0;
  let analyzeTimer: ReturnType<typeof setTimeout> | null = null;

  const heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero]));

  $: selectedEnemySet = new Set(selectedEnemyMlids);
  $: selectedEnemies = selectedEnemyMlids.map((mlid) => heroMap.get(mlid)).filter((hero): hero is Hero => Boolean(hero));

  $: filteredEnemyHeroes = data.heroes.filter((hero) => {
    if (enemyRoleFilter && !heroRoles(hero).includes(enemyRoleFilter)) return false;
    if (enemyLaneFilter && !hero.lanes.includes(enemyLaneFilter)) return false;
    return true;
  });

  $: recommendationCards = recommendations
    .map((row) => {
      const hero = heroMap.get(row.mlid);
      if (!hero) return null;
      const counters = (row.countersAgainst ?? [])
        .map((enemyMlid) => heroMap.get(enemyMlid)?.name)
        .filter((name): name is string => Boolean(name));
      return {
        row,
        hero,
        countersText: counters.length > 0 ? counters.join(", ") : selectedEnemies.map((enemy) => enemy.name).slice(0, 2).join(", ")
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  $: topScore = recommendations.length > 0 ? recommendations[0].score : null;

  function syncQuery() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("timeframe", timeframe);
    params.set("rankScope", rankScope);
    const next = params.toString();
    window.history.replaceState({}, "", next ? `/counter-pick?${next}` : "/counter-pick");
  }

  function scheduleAnalyze(delay = 160) {
    if (analyzeTimer) clearTimeout(analyzeTimer);
    if (selectedEnemyMlids.length === 0) {
      loading = false;
      recommendations = [];
      error = "";
      return;
    }

    analyzeTimer = setTimeout(() => {
      void analyze();
    }, delay);
  }

  function toggleEnemyHero(mlid: number) {
    error = "";
    if (selectedEnemySet.has(mlid)) {
      selectedEnemyMlids = selectedEnemyMlids.filter((value) => value !== mlid);
      scheduleAnalyze();
      return;
    }

    if (selectedEnemyMlids.length >= 5) {
      error = "Maximum 5 enemy heroes.";
      return;
    }

    selectedEnemyMlids = [...selectedEnemyMlids, mlid];
    scheduleAnalyze();
  }

  function clearSelection() {
    selectedEnemyMlids = [];
    recommendations = [];
    error = "";
  }

  function updateTimeframe(value: string) {
    timeframe = value;
    syncQuery();
    scheduleAnalyze(0);
  }

  function updateRankScope(value: string) {
    rankScope = value;
    syncQuery();
    scheduleAnalyze(0);
  }

  function togglePreferredRole(role: string) {
    preferredRole = preferredRole === role ? "" : role;
    scheduleAnalyze(0);
  }

  function togglePreferredLane(lane: string) {
    preferredLane = preferredLane === lane ? "" : lane;
    scheduleAnalyze(0);
  }

  async function analyze() {
    if (selectedEnemyMlids.length === 0) {
      recommendations = [];
      error = "Select at least 1 enemy hero.";
      return;
    }

    loading = true;
    error = "";

    try {
      const response = await fetch(apiUrl("/counters"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeframe,
          rankScope,
          enemyMlids: selectedEnemyMlids,
          preferredRole: preferredRole || undefined,
          preferredLane: preferredLane || undefined
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        error = payload?.error ?? "Failed to load recommendations.";
        recommendations = [];
        return;
      }

      recommendations = (payload.recommendations ?? []) as Recommendation[];
      communityVoteCount = payload.communityVotes ?? 0;
      if (recommendations.length === 0) {
        error = "No recommendations for current filters.";
      }
    } catch {
      error = "Failed to load recommendations.";
      recommendations = [];
    } finally {
      loading = false;
    }
  }
</script>

<section class="counter-root">
  <header class="head">
    <h1 class="page-title title">Mobile Legends Hero Counter</h1>
    <p class="page-subtitle">Select up to 5 enemy heroes and get soft-ranked counter recommendations for your draft plan.</p>
  </header>

  <div class="layout">
    <section class="panel left-panel">
      <div class="panel-head">
        <div>
          <h2>Select Enemy Heroes (1-5)</h2>
          <p>Pick enemy heroes first, then the right panel updates automatically.</p>
        </div>
        <button class="clear-btn" on:click={clearSelection} disabled={selectedEnemyMlids.length === 0}>
          Clear ({selectedEnemyMlids.length})
        </button>
      </div>

      <div class="top-controls">
        <label class="themed-select">
          <span>Timeframe</span>
          <select value={timeframe} on:change={(e) => updateTimeframe((e.currentTarget as HTMLSelectElement).value)}>
            {#each TIMEFRAMES as tf}
              <option value={tf}>{timeframeLabel(tf)}</option>
            {/each}
          </select>
        </label>

        <label class="themed-select">
          <span>Rank Scope</span>
          <select value={rankScope} on:change={(e) => updateRankScope((e.currentTarget as HTMLSelectElement).value)}>
            {#each RANK_SCOPES as scope}
              <option value={scope}>{rankScopeLabel(scope)}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="filter-wrap">
        <section class="filter-group filter-panel">
          <small>Enemy Role</small>
          <div class="icon-row role-row">
            {#each ROLES as role}
              <button class:selected={enemyRoleFilter === role} on:click={() => (enemyRoleFilter = enemyRoleFilter === role ? "" : role)}>
                <img src={ROLE_ICON_PATHS[role]} alt={roleLabel(role)} loading="lazy" />
              </button>
            {/each}
          </div>
        </section>

        <section class="filter-group filter-panel">
          <small>Enemy Lane</small>
          <div class="icon-row lane-row">
            {#each LANES as lane}
              <button class:selected={enemyLaneFilter === lane} on:click={() => (enemyLaneFilter = enemyLaneFilter === lane ? "" : lane)}>
                <img src={LANE_ICON_PATHS[lane]} alt={laneLabel(lane)} loading="lazy" />
              </button>
            {/each}
          </div>
        </section>
      </div>

      {#if selectedEnemies.length > 0}
        <div class="selected-strip">
          {#each selectedEnemies as hero}
            <button class="selected-chip" on:click={() => toggleEnemyHero(hero.mlid)}>
              <HeroAvatar imageKey={hero.imageKey} name={hero.name} size={26} />
              <span>{hero.name}</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="hero-grid">
        {#each filteredEnemyHeroes as hero}
          <button
            class="hero-card"
            class:selected={selectedEnemySet.has(hero.mlid)}
            on:click={() => toggleEnemyHero(hero.mlid)}
            disabled={!selectedEnemySet.has(hero.mlid) && selectedEnemyMlids.length >= 5}
          >
            <HeroAvatar imageKey={hero.imageKey} name={hero.name} size={40} />
            <span>{hero.name}</span>
          </button>
        {/each}
      </div>
    </section>

    <section class="panel right-panel">
      <div class="panel-head rec-head">
        <div>
          <h2>Recommended Counter Picks</h2>
          <p>Higher score means stronger counter impact for selected enemy setup.</p>
        </div>
        {#if topScore !== null}
          <div class="score-pill">Top score {topScore.toFixed(2)}</div>
        {/if}
      </div>

      <div class="preferences">
        <section class="pref-filter">
          <span>Preferred Role</span>
          <div class="icon-row">
            {#each ROLES as role}
              <button class:selected={preferredRole === role} on:click={() => togglePreferredRole(role)}>
                <img src={ROLE_ICON_PATHS[role]} alt={roleLabel(role)} loading="lazy" />
              </button>
            {/each}
          </div>
        </section>

        <section class="pref-filter">
          <span>Preferred Lane</span>
          <div class="icon-row">
            {#each LANES as lane}
              <button class:selected={preferredLane === lane} on:click={() => togglePreferredLane(lane)}>
                <img src={LANE_ICON_PATHS[lane]} alt={laneLabel(lane)} loading="lazy" />
              </button>
            {/each}
          </div>
        </section>
      </div>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      {#if loading}
        <Skeleton height="380px" />
      {:else if recommendationCards.length > 0}
        {#if communityVoteCount > 0}
          <p class="community-note">Scoring blends meta stats + {communityVoteCount.toLocaleString()} community votes</p>
        {/if}
        <div class="rec-list">
          {#each recommendationCards as item}
            <article class="rec-row">
              <div class="hero-side">
                <HeroAvatar imageKey={item.hero.imageKey} name={item.hero.name} size={50} />
                <div class="hero-meta">
                  <div class="hero-name-row">
                    <strong>{item.hero.name}</strong>
                    <span class="score">{item.row.score.toFixed(2)}</span>
                  </div>
                  <p>
                    Role: {roleLabel(item.hero.rolePrimary)}
                    {#if item.hero.roleSecondary}
                      , {roleLabel(item.hero.roleSecondary)}
                    {/if}
                  </p>
                  <p>Lane: {item.hero.lanes.map((lane) => laneLabel(lane)).join(" | ")}</p>
                  <p class="counters">Counters: {item.countersText || "Mixed enemy setup"}</p>
                </div>
              </div>

              {#if item.row.tier}
                <span class="tier" data-tier={item.row.tier}>Tier {item.row.tier}</span>
              {/if}
            </article>
          {/each}
        </div>
      {:else}
        <div class="empty">
          <p>Select enemy heroes to see counter recommendations.</p>
        </div>
      {/if}
    </section>
  </div>
</section>

<style>
  .counter-root {
    border: 1px solid rgba(132, 176, 244, 0.16);
    border-radius: 28px;
    padding: clamp(16px, 2vw, 24px);
    background: rgba(16, 30, 54, 0.66);
    box-shadow: inset 0 1px 0 rgba(209, 232, 255, 0.05), 0 18px 40px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(8px);
  }

  .head {
    display: grid;
    gap: 7px;
    margin-bottom: 14px;
  }

  .title {
    margin-bottom: 0;
    line-height: 1.06;
    text-shadow: 0 0 15px rgba(72, 238, 255, 0.22);
  }

  .layout {
    display: grid;
    grid-template-columns: 1.18fr 1fr;
    gap: 14px;
    align-items: start;
  }

  .panel {
    border: 1px solid rgba(132, 176, 244, 0.17);
    border-radius: 20px;
    background: rgba(16, 29, 52, 0.72);
    padding: 13px;
    box-shadow: inset 0 1px 0 rgba(209, 232, 255, 0.05);
  }

  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 9px;
    margin-bottom: 10px;
  }

  .panel-head h2 {
    font-size: 1.2rem;
    margin-bottom: 2px;
  }

  .panel-head p {
    color: #9db6d8;
    font-size: 0.82rem;
    line-height: 1.33;
  }

  .clear-btn {
    border: 1px solid rgba(255, 170, 170, 0.28);
    background: rgba(130, 46, 58, 0.45);
    color: #ffd5d7;
    border-radius: 11px;
    padding: 8px 11px;
    font-weight: 600;
    white-space: nowrap;
    font-size: 0.8rem;
  }

  .clear-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .top-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 9px;
  }

  .themed-select {
    border: 1px solid rgba(116, 160, 226, 0.2);
    border-radius: 12px;
    padding: 7px;
    background: rgba(19, 36, 62, 0.6);
  }

  .themed-select span,
  .preferences span,
  .filter-group small {
    display: block;
    color: #a2bad9;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 5px;
  }

  .themed-select select {
    width: 100%;
    border: 1px solid rgba(132, 176, 244, 0.2);
    background: rgba(23, 43, 73, 0.8);
    color: #dbeaff;
    border-radius: 10px;
    padding: 7px 10px;
    font-weight: 600;
    font-size: 0.86rem;
  }

  .filter-wrap {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 9px;
  }

  .filter-panel {
    border: 1px solid rgba(116, 160, 226, 0.18);
    border-radius: 11px;
    background: rgba(18, 34, 58, 0.58);
    padding: 7px;
  }

  .icon-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .icon-row button {
    border: 1px solid rgba(129, 172, 239, 0.16);
    background: rgba(35, 51, 77, 0.76);
    color: #dbeaff;
    min-width: 34px;
    min-height: 32px;
    border-radius: 9px;
    padding: 5px 7px;
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 0.78rem;
  }

  .icon-row button img {
    width: 16px;
    height: 16px;
    object-fit: contain;
    opacity: 0.95;
  }

  .icon-row button.selected {
    border-color: rgba(56, 207, 255, 0.38);
    background: rgba(42, 70, 110, 0.8);
    box-shadow: inset 0 0 0 1px rgba(56, 207, 255, 0.22);
  }

  .selected-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 9px;
  }

  .selected-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 8px 4px 5px;
    border-radius: 999px;
    border: 1px solid rgba(121, 189, 248, 0.32);
    background: rgba(31, 63, 102, 0.7);
    color: #dcecff;
    font-weight: 600;
    font-size: 0.76rem;
  }

  .hero-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
    gap: 6px;
    max-height: 560px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .hero-card {
    border: 1px solid rgba(129, 172, 239, 0.14);
    background: rgba(28, 42, 65, 0.72);
    border-radius: 9px;
    padding: 6px 4px;
    display: grid;
    justify-items: center;
    gap: 3px;
    text-align: center;
    min-height: 72px;
  }

  .hero-card span {
    font-size: 0.58rem;
    line-height: 1.1;
    color: #dcecff;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .hero-card.selected {
    border-color: rgba(59, 219, 255, 0.42);
    background: rgba(42, 70, 112, 0.84);
    box-shadow: inset 0 0 0 1px rgba(59, 219, 255, 0.22);
  }

  .hero-card:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .rec-head {
    margin-bottom: 8px;
  }

  .score-pill {
    border: 1px solid rgba(121, 189, 248, 0.33);
    background: rgba(31, 63, 102, 0.74);
    color: #dcecff;
    border-radius: 999px;
    padding: 5px 9px;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .preferences {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 9px;
  }

  .pref-filter {
    border: 1px solid rgba(116, 160, 226, 0.18);
    border-radius: 11px;
    padding: 7px;
    background: rgba(19, 36, 62, 0.58);
  }

  .rec-list {
    display: grid;
    gap: 8px;
    max-height: 620px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .rec-row {
    border: 1px solid rgba(132, 176, 244, 0.14);
    border-radius: 12px;
    background: rgba(30, 44, 67, 0.72);
    padding: 9px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .hero-side {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .hero-meta {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .hero-name-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .hero-name-row strong {
    font-size: 0.98rem;
  }

  .score {
    border: 1px solid rgba(196, 218, 246, 0.4);
    border-radius: 999px;
    padding: 1px 7px;
    font-weight: 700;
    font-size: 0.72rem;
    color: #eaf4ff;
  }

  .hero-meta p {
    margin: 0;
    color: #bed0ea;
    font-size: 0.78rem;
    line-height: 1.2;
  }

  .hero-meta .counters {
    color: #9ed8ff;
  }

  .tier {
    border-radius: 9px;
    padding: 5px 7px;
    font-size: 0.72rem;
    font-weight: 700;
    border: 1px solid transparent;
    color: #0f1c2d;
    white-space: nowrap;
  }

  .tier[data-tier="SS"],
  .tier[data-tier="S"] {
    background: rgba(160, 227, 126, 0.86);
    border-color: rgba(160, 227, 126, 0.9);
  }

  .tier[data-tier="A"],
  .tier[data-tier="B"] {
    background: rgba(111, 188, 255, 0.84);
    border-color: rgba(111, 188, 255, 0.9);
  }

  .tier[data-tier="C"],
  .tier[data-tier="D"] {
    background: rgba(183, 137, 255, 0.82);
    border-color: rgba(183, 137, 255, 0.88);
  }

  .empty {
    border: 1px dashed rgba(132, 176, 244, 0.2);
    border-radius: 12px;
    padding: 16px;
    color: #9eb7d8;
    text-align: center;
    font-weight: 600;
  }

  .error {
    color: #ffc0c0;
    margin: 0 0 10px;
    font-size: 0.86rem;
  }

  .community-note {
    font-size: 0.78rem;
    color: rgba(132, 220, 180, 0.75);
    margin: 0 0 8px;
    letter-spacing: 0.01em;
  }

  @media (max-width: 1200px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .hero-grid {
      max-height: 400px;
    }

    .rec-list {
      max-height: 440px;
    }
  }

  @media (max-width: 700px) {
    .top-controls,
    .preferences {
      grid-template-columns: minmax(0, 1fr);
    }

    .filter-wrap {
      grid-template-columns: minmax(0, 1fr);
    }

    .hero-grid {
      grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    }

    .hero-card {
      min-height: 68px;
      padding: 6px 4px;
    }

    .hero-card span {
      font-size: 0.56rem;
    }

    .rec-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .tier {
      align-self: flex-end;
    }
  }
</style>

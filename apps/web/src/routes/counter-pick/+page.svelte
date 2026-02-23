<script lang="ts">
  import { Card, Chip, Skeleton } from "@mlbb/ui";
  import { apiUrl } from "$lib/api";
  import { LANES, ROLES, TIMEFRAMES, heroRoles, laneLabel, roleLabel, timeframeLabel } from "$lib/options";

  type Hero = {
    mlid: number;
    name: string;
    rolePrimary: string;
    roleSecondary?: string | null;
    lanes: string[];
    specialities?: string[];
  };

  export let data: {
    timeframe: string;
    heroes: Hero[];
  };

  let timeframe = data.timeframe;
  let enemyRoleFilter = "";
  let enemyLaneFilter = "";
  let preferredRole = "";
  let preferredLane = "";
  let loading = false;
  let recommendations: Array<{ mlid: number; score: number; tier?: string }> = [];
  let error = "";

  let enemySlots = ["", "", "", "", ""];

  $: filteredEnemyOptions = data.heroes.filter((hero) => {
    if (enemyRoleFilter && !heroRoles(hero).includes(enemyRoleFilter)) return false;
    if (enemyLaneFilter && !hero.lanes.includes(enemyLaneFilter)) return false;
    return true;
  });

  function setEnemySlot(index: number, value: string) {
    enemySlots[index] = value;
    enemySlots = [...enemySlots];
  }

  function clearSelection() {
    enemySlots = ["", "", "", "", ""];
    preferredRole = "";
    preferredLane = "";
    enemyRoleFilter = "";
    enemyLaneFilter = "";
    recommendations = [];
  }

  async function analyze() {
    error = "";
    loading = true;
    recommendations = [];

    const enemyMlids = Array.from(
      new Set(
        enemySlots
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    ).slice(0, 5);

    if (enemyMlids.length === 0) {
      loading = false;
      error = "Pilih minimal 1 hero musuh.";
      return;
    }

    const response = await fetch(apiUrl("/counters"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeframe, enemyMlids, preferredRole: preferredRole || undefined, preferredLane: preferredLane || undefined })
    });

    const payload = await response.json();
    recommendations = payload.recommendations ?? [];
    loading = false;
  }

  const heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero]));
</script>

<h1 class="page-title">Counter Pick</h1>
<p class="page-subtitle">Pilih hero musuh lewat dropdown, lalu dapatkan rekomendasi counter otomatis.</p>

<Card>
  <div class="controls">
    <select bind:value={timeframe}>
      {#each TIMEFRAMES as tf}
        <option value={tf}>{timeframeLabel(tf)}</option>
      {/each}
    </select>

    <select bind:value={enemyRoleFilter}>
      <option value="">Filter Enemy Role: All</option>
      {#each ROLES as role}
        <option value={role}>{roleLabel(role)}</option>
      {/each}
    </select>

    <select bind:value={enemyLaneFilter}>
      <option value="">Filter Enemy Lane: All</option>
      {#each LANES as lane}
        <option value={lane}>{laneLabel(lane)}</option>
      {/each}
    </select>

    <select bind:value={preferredRole}>
      <option value="">Preferred Counter Role: Any</option>
      {#each ROLES as role}
        <option value={role}>{roleLabel(role)}</option>
      {/each}
    </select>

    <select bind:value={preferredLane}>
      <option value="">Preferred Counter Lane: Any</option>
      {#each LANES as lane}
        <option value={lane}>{laneLabel(lane)}</option>
      {/each}
    </select>

    <button class="ghost" on:click={clearSelection}>Reset</button>
    <button on:click={analyze}>Analyze</button>
  </div>

  <div class="slot-grid">
    {#each [0, 1, 2, 3, 4] as index}
      <select value={enemySlots[index]} on:change={(e) => setEnemySlot(index, (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">Enemy Slot {index + 1}</option>
        {#each filteredEnemyOptions as hero}
          <option value={String(hero.mlid)}>{hero.name} ({hero.mlid})</option>
        {/each}
      </select>
    {/each}
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if loading}
    <Skeleton height="180px" />
  {:else if recommendations.length > 0}
    <div class="grid results">
      {#each recommendations as row}
        {@const hero = heroMap.get(row.mlid)}
        <div class="rec">
          <div>
            <strong>{hero?.name ?? `Hero #${row.mlid}`}</strong>
            <p class="muted">MLID {row.mlid}</p>
          </div>
          <div class="meta">
            {#if row.tier}
              <Chip label={`Tier ${row.tier}`} />
            {/if}
            <small>{row.score.toFixed(4)}</small>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="muted">Belum ada rekomendasi. Pilih hero musuh lalu klik Analyze.</p>
  {/if}
</Card>

<style>
  .ghost {
    background: rgba(59, 73, 97, 0.72);
  }

  .slot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    margin-bottom: 10px;
  }

  .results {
    margin-top: 8px;
  }

  .rec {
    border: 1px solid rgba(132, 180, 255, 0.12);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: border-color 180ms ease-out;
  }

  .rec:hover {
    border-color: rgba(48, 221, 255, 0.35);
  }

  .meta {
    display: grid;
    gap: 6px;
    justify-items: end;
    color: var(--muted);
  }

  .error {
    color: #ffa3a3;
    margin: 8px 0;
  }

  .muted,
  small {
    color: var(--muted);
  }
</style>

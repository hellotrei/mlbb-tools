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
  };

  export let data: {
    timeframe: string;
    heroes: Hero[];
  };

  let timeframe = data.timeframe;
  let roleFilter = "";
  let laneFilter = "";

  let allySlots = ["", "", "", "", ""];
  let enemySlots = ["", "", "", "", ""];
  let loading = false;
  let payload: {
    recommendedPicks: Array<{ mlid: number; score: number; reasons?: string[] }>;
    recommendedBans: Array<{ mlid: number; score: number; reasons?: string[] }>;
    notes: string[];
  } | null = null;

  const heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero.name]));

  $: filteredOptions = data.heroes.filter((hero) => {
    if (roleFilter && !heroRoles(hero).includes(roleFilter)) return false;
    if (laneFilter && !hero.lanes.includes(laneFilter)) return false;
    return true;
  });

  function setSlot(kind: "ally" | "enemy", index: number, value: string) {
    if (kind === "ally") {
      allySlots[index] = value;
      allySlots = [...allySlots];
      return;
    }

    enemySlots[index] = value;
    enemySlots = [...enemySlots];
  }

  function clearDraft() {
    allySlots = ["", "", "", "", ""];
    enemySlots = ["", "", "", "", ""];
    roleFilter = "";
    laneFilter = "";
    payload = null;
  }

  async function analyze() {
    loading = true;

    const allyMlids = Array.from(
      new Set(
        allySlots
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item) && item > 0)
      )
    ).slice(0, 5);

    const enemyMlids = Array.from(
      new Set(
        enemySlots
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item) && item > 0)
      )
    ).slice(0, 5);

    const response = await fetch(apiUrl("/draft/analyze"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeframe, allyMlids, enemyMlids })
    });

    payload = await response.json();
    loading = false;
  }
</script>

<h1 class="page-title">Draft Master</h1>
<p class="page-subtitle">Pilih slot ally/enemy dari dropdown lalu analisis draft secara instan.</p>

<Card>
  <div class="controls">
    <select bind:value={timeframe}>
      {#each TIMEFRAMES as tf}
        <option value={tf}>{timeframeLabel(tf)}</option>
      {/each}
    </select>

    <select bind:value={roleFilter}>
      <option value="">Filter Role: All</option>
      {#each ROLES as role}
        <option value={role}>{roleLabel(role)}</option>
      {/each}
    </select>

    <select bind:value={laneFilter}>
      <option value="">Filter Lane: All</option>
      {#each LANES as lane}
        <option value={lane}>{laneLabel(lane)}</option>
      {/each}
    </select>

    <button class="ghost" on:click={clearDraft}>Reset</button>
    <button on:click={analyze}>Analyze Draft</button>
  </div>

  <div class="draft-grid">
    <section>
      <h3>Ally Slots</h3>
      <div class="slots">
        {#each [0, 1, 2, 3, 4] as index}
          <select value={allySlots[index]} on:change={(e) => setSlot("ally", index, (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">Ally Slot {index + 1}</option>
            {#each filteredOptions as hero}
              <option value={String(hero.mlid)}>{hero.name} ({hero.mlid})</option>
            {/each}
          </select>
        {/each}
      </div>
    </section>

    <section>
      <h3>Enemy Slots</h3>
      <div class="slots">
        {#each [0, 1, 2, 3, 4] as index}
          <select value={enemySlots[index]} on:change={(e) => setSlot("enemy", index, (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">Enemy Slot {index + 1}</option>
            {#each filteredOptions as hero}
              <option value={String(hero.mlid)}>{hero.name} ({hero.mlid})</option>
            {/each}
          </select>
        {/each}
      </div>
    </section>
  </div>

  {#if loading}
    <Skeleton height="220px" />
  {:else if payload}
    <div class="draft-grid">
      <section>
        <h3>Recommended Picks</h3>
        {#each payload.recommendedPicks as row}
          <div class="line">
            <span>{heroMap.get(row.mlid) ?? `Hero #${row.mlid}`}</span>
            <small>{row.score.toFixed(4)}</small>
          </div>
        {/each}
      </section>
      <section>
        <h3>Recommended Bans</h3>
        {#each payload.recommendedBans as row}
          <div class="line">
            <span>{heroMap.get(row.mlid) ?? `Hero #${row.mlid}`}</span>
            <small>{row.score.toFixed(4)}</small>
          </div>
        {/each}
      </section>
    </div>

    <div class="note-list">
      {#each payload.notes as note}
        <Chip label={note} />
      {/each}
    </div>
  {:else}
    <p class="muted">Pilih slot lalu klik Analyze Draft untuk melihat rekomendasi.</p>
  {/if}
</Card>

<style>
  .ghost {
    background: rgba(59, 73, 97, 0.9);
  }

  .draft-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
    margin-bottom: 10px;
  }

  h3 {
    margin-bottom: 8px;
  }

  .slots {
    display: grid;
    gap: 8px;
  }

  .line {
    border: 1px solid rgba(132, 180, 255, 0.16);
    border-radius: 10px;
    padding: 8px 10px;
    margin-bottom: 7px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .note-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .muted,
  small {
    color: var(--muted);
  }
</style>

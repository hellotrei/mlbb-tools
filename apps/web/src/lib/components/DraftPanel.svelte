<script lang="ts">
  import { HeroAvatar } from "@mlbb/ui";

  export let teamAName: string = "Team A";
  export let teamBName: string = "Team B";
  export let teamAPicks: number[] = [];
  export let teamBPicks: number[] = [];
  export let teamABans: number[] = [];
  export let teamBBans: number[] = [];
  export let heroMap: Map<number, { name: string; imageKey: string }> = new Map();
  export let status: string = "not_started";

  const statusLabels: Record<string, string> = {
    not_started: "Not Started",
    ban_phase: "Ban Phase",
    pick_phase: "Pick Phase",
    completed: "Draft Complete",
  };

  $: statusLabel = statusLabels[status] ?? status;
  $: bansA = teamABans.slice(0, 5).concat(Array(5).fill(null)).slice(0, 5);
  $: bansB = teamBBans.slice(0, 5).concat(Array(5).fill(null)).slice(0, 5);
  $: picksA = teamAPicks.slice(0, 5).concat(Array(5).fill(null)).slice(0, 5);
  $: picksB = teamBPicks.slice(0, 5).concat(Array(5).fill(null)).slice(0, 5);

  function lookup(mlid: number | null) {
    if (mlid == null) return null;
    return heroMap.get(mlid) ?? null;
  }
</script>

<div class="draft-panel">
  <div class="draft-header">
    <span class="draft-status draft-status--{status}">{statusLabel}</span>
  </div>

  <div class="draft-grid">
    <!-- Team A -->
    <div class="team-col team-col--a">
      <div class="team-name team-name--a">{teamAName}</div>

      <div class="slot-row">
        {#each bansA as mlid, i}
          {@const hero = lookup(mlid)}
          <div class="slot slot--ban">
            {#if hero}
              <div class="hero-slot hero-slot--ban">
                <HeroAvatar imageKey={hero.imageKey} name={hero.name} size={32} />
              </div>
              <span class="hero-label">{hero.name}</span>
            {:else}
              <div class="empty-slot empty-slot--ban">
                <span>B{i + 1}</span>
              </div>
              <span class="hero-label hero-label--empty">B{i + 1}</span>
            {/if}
          </div>
        {/each}
      </div>

      <div class="slot-row">
        {#each picksA as mlid, i}
          {@const hero = lookup(mlid)}
          <div class="slot slot--pick">
            {#if hero}
              <div class="hero-slot hero-slot--pick">
                <HeroAvatar imageKey={hero.imageKey} name={hero.name} size={40} />
              </div>
              <span class="hero-label">{hero.name}</span>
            {:else}
              <div class="empty-slot empty-slot--pick">
                <span>P{i + 1}</span>
              </div>
              <span class="hero-label hero-label--empty">P{i + 1}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- VS -->
    <div class="vs-col">
      <span class="vs-label">VS</span>
    </div>

    <!-- Team B -->
    <div class="team-col team-col--b">
      <div class="team-name team-name--b">{teamBName}</div>

      <div class="slot-row">
        {#each bansB as mlid, i}
          {@const hero = lookup(mlid)}
          <div class="slot slot--ban">
            {#if hero}
              <div class="hero-slot hero-slot--ban">
                <HeroAvatar imageKey={hero.imageKey} name={hero.name} size={32} />
              </div>
              <span class="hero-label">{hero.name}</span>
            {:else}
              <div class="empty-slot empty-slot--ban">
                <span>B{i + 1}</span>
              </div>
              <span class="hero-label hero-label--empty">B{i + 1}</span>
            {/if}
          </div>
        {/each}
      </div>

      <div class="slot-row">
        {#each picksB as mlid, i}
          {@const hero = lookup(mlid)}
          <div class="slot slot--pick">
            {#if hero}
              <div class="hero-slot hero-slot--pick">
                <HeroAvatar imageKey={hero.imageKey} name={hero.name} size={40} />
              </div>
              <span class="hero-label">{hero.name}</span>
            {:else}
              <div class="empty-slot empty-slot--pick">
                <span>P{i + 1}</span>
              </div>
              <span class="hero-label hero-label--empty">P{i + 1}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .draft-panel {
    max-width: 820px;
    margin: 0 auto;
    background: rgba(8, 20, 47, 0.85);
    border: 1px solid rgba(0, 229, 255, 0.2);
    border-radius: var(--radius-md);
    padding: 20px 24px;
  }

  .draft-header {
    display: flex;
    justify-content: center;
    margin-bottom: 18px;
  }

  .draft-status {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 4px 14px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(30, 41, 59, 0.6);
    color: #94a3b8;
  }

  .draft-status--ban_phase {
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(56, 10, 10, 0.6);
    color: #fca5a5;
  }

  .draft-status--pick_phase {
    border-color: rgba(250, 204, 21, 0.4);
    background: rgba(78, 53, 0, 0.6);
    color: #fde68a;
  }

  .draft-status--completed {
    border-color: rgba(74, 222, 128, 0.4);
    background: rgba(6, 50, 25, 0.6);
    color: #86efac;
  }

  .draft-grid {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 16px;
    align-items: start;
  }

  .team-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .team-name {
    font-size: 0.85rem;
    font-weight: 700;
    text-align: center;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(0, 229, 255, 0.15);
  }

  .team-name--a {
    color: #60a5fa;
  }

  .team-name--b {
    color: #f87171;
  }

  .slot-row {
    display: flex;
    gap: 6px;
    justify-content: center;
  }

  .slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .hero-label {
    font-size: 0.55rem;
    color: var(--muted);
    max-width: 44px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hero-label--empty {
    opacity: 0.5;
  }

  .empty-slot {
    display: grid;
    place-items: center;
    border: 2px dashed rgba(148, 163, 184, 0.25);
    border-radius: 10px;
    background: rgba(14, 29, 56, 0.35);
  }

  .empty-slot span {
    font-size: 0.6rem;
    font-weight: 700;
    color: rgba(148, 163, 184, 0.45);
  }

  .empty-slot--ban {
    width: 32px;
    height: 32px;
  }

  .empty-slot--pick {
    width: 40px;
    height: 40px;
  }

  .hero-slot--ban {
    filter: saturate(0.6) brightness(0.85);
    opacity: 0.75;
  }

  .vs-col {
    display: flex;
    align-items: center;
    padding-top: 36px;
  }

  .vs-label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: rgba(0, 229, 255, 0.5);
    text-shadow: 0 0 12px rgba(0, 229, 255, 0.2);
  }

  @media (max-width: 640px) {
    .draft-panel {
      padding: 14px 10px;
    }

    .draft-grid {
      gap: 8px;
    }

    .slot-row {
      gap: 4px;
    }
  }
</style>

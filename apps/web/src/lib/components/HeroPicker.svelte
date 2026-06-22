<script lang="ts">
  import { HeroAvatar } from "@mlbb/ui";
  import { ROLES, roleLabel } from "$lib/options";

  export let heroes: Array<{ mlid: number; name: string; imageKey: string; rolePrimary: string }>;
  export let disabledMlids: Set<number> = new Set();
  export let onSelect: (mlid: number) => void = () => {};

  let search = "";
  let activeRole: string | null = null;

  $: query = search.toLowerCase().trim();

  $: filtered = heroes.filter((h) => {
    if (query && !h.name.toLowerCase().includes(query)) return false;
    if (activeRole && h.rolePrimary !== activeRole) return false;
    return true;
  });

  function toggleRole(role: string) {
    activeRole = activeRole === role ? null : role;
  }

  function handleSelect(mlid: number) {
    if (disabledMlids.has(mlid)) return;
    onSelect(mlid);
  }
</script>

<div class="hero-picker">
  <input
    class="hero-search"
    type="text"
    placeholder="Search heroes…"
    bind:value={search}
  />

  <div class="role-bar">
    <button
      class="role-btn"
      class:active={activeRole === null}
      on:click={() => (activeRole = null)}
    >
      All
    </button>
    {#each ROLES as role}
      <button
        class="role-btn"
        class:active={activeRole === role}
        on:click={() => toggleRole(role)}
      >
        {roleLabel(role)}
      </button>
    {/each}
  </div>

  <div class="hero-grid">
    {#each filtered as hero (hero.mlid)}
      <button
        class="hero-card"
        class:disabled={disabledMlids.has(hero.mlid)}
        disabled={disabledMlids.has(hero.mlid)}
        on:click={() => handleSelect(hero.mlid)}
        title={hero.name}
      >
        <HeroAvatar name={hero.name} imageKey={hero.imageKey} size={44} />
        <span class="hero-name">{hero.name}</span>
      </button>
    {/each}
    {#if filtered.length === 0}
      <div class="hero-empty">No heroes match</div>
    {/if}
  </div>
</div>

<style>
  .hero-picker {
    display: grid;
    gap: 8px;
    width: 100%;
  }

  .hero-search {
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(101, 137, 196, 0.3);
    background: rgba(8, 20, 47, 0.9);
    color: #c9ddff;
    font-size: 0.82rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .hero-search::placeholder {
    color: rgba(155, 183, 220, 0.5);
  }

  .hero-search:focus {
    border-color: rgba(96, 165, 250, 0.6);
  }

  .role-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .role-btn {
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(101, 137, 196, 0.25);
    background: rgba(14, 29, 56, 0.6);
    color: #9bb7dc;
    font-size: 0.68rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    text-transform: capitalize;
  }

  .role-btn:hover {
    background: rgba(30, 58, 110, 0.6);
    color: #c9ddff;
  }

  .role-btn.active {
    background: rgba(59, 130, 246, 0.25);
    border-color: rgba(96, 165, 250, 0.5);
    color: #93c5fd;
  }

  .hero-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
    gap: 6px;
    max-height: 300px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(101, 137, 196, 0.35) transparent;
  }

  .hero-grid::-webkit-scrollbar {
    width: 5px;
  }

  .hero-grid::-webkit-scrollbar-track {
    background: transparent;
  }

  .hero-grid::-webkit-scrollbar-thumb {
    background: rgba(101, 137, 196, 0.35);
    border-radius: 999px;
  }

  .hero-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 2px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    color: #c9ddff;
  }

  .hero-card:hover:not(.disabled):not(:disabled) {
    background: rgba(30, 58, 110, 0.4);
    border-color: rgba(96, 165, 250, 0.3);
  }

  .hero-card.disabled,
  .hero-card:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .hero-name {
    font-size: 0.56rem;
    text-align: center;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .hero-empty {
    grid-column: 1 / -1;
    text-align: center;
    color: rgba(155, 183, 220, 0.5);
    font-size: 0.75rem;
    padding: 24px 0;
  }
</style>

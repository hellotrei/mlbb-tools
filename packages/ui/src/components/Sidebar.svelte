<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let items: Array<{ href: string; label: string }> = [];
  export let currentPath = "/";
  export let syncInfo: { tier?: string; stats?: string; counter?: string } | null = null;
  export let refreshing = false;

  const dispatch = createEventDispatcher<{ refresh: void }>();
</script>

<aside class="sidebar">
  <div class="brand">MLBB Tools</div>
  <nav>
    {#each items as item}
      <a href={item.href} class:active={currentPath === item.href}>{item.label}</a>
    {/each}
  </nav>

  <section class="sync-box">
    <h4>Last Sync</h4>
    <div class="sync-item">
      <span>Tier</span>
      <strong>{syncInfo?.tier ?? "-"}</strong>
    </div>
    <div class="sync-item">
      <span>Stats</span>
      <strong>{syncInfo?.stats ?? "-"}</strong>
    </div>
    <div class="sync-item">
      <span>Counter</span>
      <strong>{syncInfo?.counter ?? "-"}</strong>
    </div>
    <button class="refresh-btn" disabled={refreshing} on:click={() => dispatch("refresh")}>
      {refreshing ? "Refreshing..." : "Refresh Data"}
    </button>
  </section>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: 260px;
    padding: 24px 18px;
    border-right: 1px solid var(--border);
    background: rgba(10, 17, 34, 0.84);
    backdrop-filter: blur(6px);
    position: sticky;
    top: 0;
    align-self: start;
    height: 100vh;
  }

  .brand {
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    margin-bottom: 20px;
  }

  nav {
    display: grid;
    gap: 8px;
    margin-bottom: 16px;
  }

  a {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--muted);
    display: block;
    padding: 10px 12px;
    transition: all 180ms ease-out;
  }

  a:hover,
  a.active {
    color: var(--text);
    border-color: rgba(58, 194, 255, 0.3);
    background: rgba(37, 71, 121, 0.35);
  }

  .sync-box {
    margin-top: auto;
    border: 1px solid rgba(137, 186, 255, 0.16);
    border-radius: 16px;
    padding: 12px;
    background: rgba(18, 30, 52, 0.66);
    box-shadow: inset 0 1px 0 rgba(208, 231, 255, 0.05);
    display: grid;
    gap: 10px;
  }

  .sync-box h4 {
    margin: 0;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #a8bfdd;
  }

  .sync-item {
    display: grid;
    gap: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(137, 186, 255, 0.12);
  }

  .sync-item:last-of-type {
    padding-bottom: 0;
    border-bottom: none;
  }

  .sync-item span {
    font-size: 0.62rem;
    color: #8ea9c8;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }

  .sync-item strong {
    color: #dbeaff;
    font-size: 0.79rem;
    font-weight: 600;
    line-height: 1.25;
  }

  .refresh-btn {
    margin-top: 2px;
    border: 1px solid rgba(120, 176, 245, 0.34);
    background: rgba(35, 67, 109, 0.68);
    color: #e4f1ff;
    border-radius: 10px;
    padding: 8px 10px;
    font-size: 0.76rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease;
  }

  .refresh-btn:hover:not(:disabled) {
    border-color: rgba(78, 208, 255, 0.44);
    background: rgba(38, 82, 130, 0.76);
  }

  .refresh-btn:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  @media (max-width: 960px) {
    .sidebar {
      width: 100%;
      height: auto;
      position: static;
      border-right: none;
      border-bottom: 1px solid var(--border);
      padding: 16px;
    }

    nav {
      display: flex;
      gap: 8px;
      overflow: auto;
      padding-bottom: 4px;
      margin-bottom: 12px;
    }

    a {
      white-space: nowrap;
    }

    .sync-box {
      margin-top: 4px;
      gap: 10px;
    }

    .sync-item {
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(137, 186, 255, 0.12);
    }
  }
</style>

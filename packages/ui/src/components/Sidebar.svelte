<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let items: Array<{ href: string; label: string }> = [];
  export let currentPath = "/";
  export let syncInfo: { tier?: string; stats?: string; counter?: string } | null = null;
  export let refreshing = false;

  const dispatch = createEventDispatcher<{ refresh: void }>();
  let mobileSyncMenuOpen = false;
</script>

<aside class="sidebar">
  <div class="brand-row">
    <div class="brand">MLBB Coach</div>
    <div class="mobile-sync-menu">
      <button
        class="mobile-sync-trigger"
        aria-label="Open sync info"
        aria-expanded={mobileSyncMenuOpen}
        on:click={() => { mobileSyncMenuOpen = !mobileSyncMenuOpen; }}
      >
        <span></span>
        <span></span>
        <span></span>
      </button>
      {#if mobileSyncMenuOpen}
        <section class="sync-box mobile-sync-box">
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
      {/if}
    </div>
  </div>
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
  }

  .brand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
    position: relative;
  }

  .mobile-sync-menu {
    display: none;
    position: relative;
    z-index: 120;
  }

  .mobile-sync-trigger {
    width: 34px;
    height: 34px;
    border: 1px solid rgba(137, 186, 255, 0.18);
    border-radius: 10px;
    background: rgba(18, 30, 52, 0.5);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    cursor: pointer;
  }

  .mobile-sync-trigger span {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: #dbeaff;
  }

  .mobile-sync-box {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: min(260px, calc(100vw - 32px));
    margin-top: 0;
    z-index: 160;
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
      position: relative;
      border-right: none;
      border-bottom: 1px solid var(--border);
      padding: 16px;
      z-index: 20;
      overflow: visible;
    }

    .mobile-sync-menu {
      display: block;
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

    .mobile-sync-box {
      background: #121e34;
      box-shadow: 0 18px 40px rgba(2, 8, 22, 0.42);
    }

    aside > .sync-box {
      display: none;
    }

    .sync-item {
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(137, 186, 255, 0.12);
    }
  }
</style>

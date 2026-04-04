<script lang="ts">
  export let items: Array<{ href: string; label: string; icon?: string }> = [];
  export let currentPath = "/";
  export let engine: string = "community";
  export let engineOptions: Array<{ value: string; longLabel: string; shortLabel: string; selectable: boolean }> = [];
  export let selectedEngineSummary = "Community stats, tier, matrix, and community blend.";
  export let onEngineChange: (engine: string) => void = () => {};

  let mobileEngineMenuOpen = false;
  let collapsed = false;
</script>

<aside class="sidebar" class:collapsed>
  <div class="brand-row">
    <div class="brand-wrap">
      <div class="brand"><span class="brand-icon" aria-hidden="true">🎮</span>{collapsed ? "DA" : "Draft Arena"}</div>
      <button
        class="collapse-trigger"
        type="button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        on:click={() => { collapsed = !collapsed; }}
      >
        {collapsed ? "»" : "«"}
      </button>
    </div>
    <div class="mobile-sync-menu">
      <button
        class="mobile-sync-trigger"
        aria-label="Open engine selector"
        aria-expanded={mobileEngineMenuOpen}
        on:click={() => { mobileEngineMenuOpen = !mobileEngineMenuOpen; }}
      >
        <span></span>
        <span></span>
        <span></span>
      </button>
      {#if mobileEngineMenuOpen}
        <section class="sync-box mobile-sync-box">
          <h4>Engine</h4>
          <div class="engine-select-wrap">
            <select
              value={engine}
              on:change={(e) => onEngineChange((e.target as HTMLSelectElement).value)}
              class="engine-select"
            >
              {#each engineOptions as option}
                <option value={option.value} disabled={!option.selectable}>{option.longLabel}</option>
              {/each}
            </select>
          </div>
          <div class="engine-summary">{selectedEngineSummary}</div>
        </section>
      {/if}
    </div>
  </div>
  <nav>
    {#each items as item}
      <a href={item.href} class:active={currentPath === item.href} title={item.label}>
        <span class="nav-icon" aria-hidden="true">{item.icon ?? "•"}</span>
        <span class="nav-label">{item.label}</span>
      </a>
    {/each}
  </nav>

  <section class="sync-box">
    {#if !collapsed}
      <h4>Engine</h4>
    {/if}
    <div class="engine-select-wrap">
      <select
        value={engine}
        on:change={(e) => onEngineChange((e.target as HTMLSelectElement).value)}
        class="engine-select"
        title={collapsed ? `Engine: ${selectedEngineSummary}` : undefined}
      >
        {#each engineOptions as option}
          <option value={option.value} disabled={!option.selectable}>{collapsed ? option.shortLabel : option.longLabel}</option>
        {/each}
      </select>
    </div>
    {#if !collapsed}
      <div class="engine-summary">{selectedEngineSummary}</div>
    {/if}
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
    transition: width 180ms ease, padding 180ms ease;
  }

  .sidebar.collapsed {
    width: 84px;
    padding-left: 12px;
    padding-right: 12px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .brand-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .brand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
    position: relative;
  }

  .brand-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }

  .collapse-trigger {
    width: 30px;
    height: 30px;
    border: 1px solid rgba(137, 186, 255, 0.18);
    border-radius: 10px;
    background: rgba(18, 30, 52, 0.5);
    color: #dbeaff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
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
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    transition: all 180ms ease-out;
    min-height: 42px;
    overflow: hidden;
  }

  .nav-icon {
    width: 18px;
    min-width: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    line-height: 1;
  }

  .nav-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar.collapsed a {
    justify-content: center;
    padding-left: 8px;
    padding-right: 8px;
  }

  .sidebar.collapsed .nav-label {
    font-size: 0;
    line-height: 0;
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
    transition: padding 180ms ease;
  }

  .sidebar.collapsed .sync-box {
    padding: 10px 8px;
  }

  .sync-box h4 {
    margin: 0;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #a8bfdd;
  }

  .engine-loading {
    font-size: 0.74rem;
    color: #8ea9c8;
    font-style: italic;
  }

  .engine-summary {
    font-size: 0.72rem;
    color: #8ea9c8;
    line-height: 1.45;
  }

  .engine-select-wrap {
    position: relative;
    width: 100%;
  }

  .engine-select-wrap::after {
    content: "";
    position: absolute;
    right: 10px;
    top: 50%;
    width: 7px;
    height: 7px;
    border-right: 2px solid #a8bfdd;
    border-bottom: 2px solid #a8bfdd;
    transform: translateY(-65%) rotate(45deg);
    pointer-events: none;
    opacity: 0.85;
    transition: opacity 160ms ease;
  }

  .engine-select-wrap:hover::after {
    opacity: 1;
  }

  .engine-select {
    width: 100%;
    border: 1px solid rgba(120, 176, 245, 0.34);
    background: rgba(35, 67, 109, 0.68);
    color: #e4f1ff;
    border-radius: 10px;
    padding: 8px 28px 8px 10px;
    font-size: 0.76rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease;
    appearance: none;
  }

  .engine-select:hover {
    border-color: rgba(78, 208, 255, 0.44);
    background: rgba(38, 82, 130, 0.76);
  }

  .engine-select:focus {
    outline: none;
    border-color: rgba(78, 208, 255, 0.6);
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

    .sidebar.collapsed {
      width: 100%;
      padding: 16px;
    }

    .mobile-sync-menu {
      display: block;
    }

    .collapse-trigger {
      display: none;
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

    .sidebar.collapsed .nav-label {
      font-size: inherit;
      line-height: inherit;
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
  }
</style>

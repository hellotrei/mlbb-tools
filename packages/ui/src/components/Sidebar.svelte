<script lang="ts">
  type SidebarIconKey = "hero-tier" | "hero-statistics" | "hero-counter" | "draft-master" | "tournament";
  const BRAND_TITLE_SRC = "/branding/draft-arena-title.png";
  const BRAND_MARK_SRC = "/branding/arena-tier-menu.png";
  const SIDEBAR_ICON_SOURCES: Record<SidebarIconKey, string> = {
    "hero-tier": "/branding/arena-tier-menu.png",
    "hero-statistics": "/branding/arena-stats-menu.png",
    "hero-counter": "/branding/counter-lab-menu.png",
    "draft-master": "/branding/draft-room-menu.png",
    tournament: "/branding/tournaments-menu.png"
  };

  export let items: Array<{ href: string; label: string; icon?: string; iconKey?: SidebarIconKey }> = [];
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
      <div class="brand">
        <img class="brand-logo" src={collapsed ? BRAND_MARK_SRC : BRAND_TITLE_SRC} alt="Draft Arena" />
      </div>
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
        {#if item.iconKey}
          <span class="nav-icon" aria-hidden="true">
            <img class="nav-icon-img" src={SIDEBAR_ICON_SOURCES[item.iconKey]} alt="" loading="lazy" decoding="async" />
          </span>
        {:else}
          <span class="nav-icon" aria-hidden="true">{item.icon ?? "•"}</span>
        {/if}
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
    background: rgba(2, 7, 18, 0.84);
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
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .brand-logo {
    display: block;
    width: 186px;
    max-width: 100%;
    height: 30px;
    object-fit: contain;
    object-position: left center;
    filter: drop-shadow(0 1px 5px rgba(0, 201, 255, 0.24));
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
    border: 1px solid rgba(0, 229, 255, 0.18);
    border-radius: 10px;
    background: rgba(6, 23, 46, 0.5);
    color: var(--text);
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
    border: 1px solid rgba(0, 229, 255, 0.18);
    border-radius: 10px;
    background: rgba(6, 23, 46, 0.5);
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
    background: var(--text);
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
    height: 18px;
    min-width: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    line-height: 1;
  }

  .nav-icon-img {
    width: 18px;
    height: 18px;
    object-fit: contain;
    display: block;
    filter: drop-shadow(0 0 6px rgba(0, 200, 255, 0.28));
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

  .sidebar.collapsed .brand-logo {
    width: 32px;
    height: 32px;
    object-position: center;
  }

  a:hover,
  a.active {
    color: var(--text);
    border-color: rgba(0, 229, 255, 0.3);
    background: rgba(0, 71, 199, 0.25);
  }

  .sync-box {
    margin-top: auto;
    border: 1px solid rgba(0, 229, 255, 0.16);
    border-radius: 16px;
    padding: 12px;
    background: rgba(6, 23, 46, 0.66);
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
    color: var(--muted);
  }

  .engine-loading {
    font-size: 0.74rem;
    color: var(--muted);
    font-style: italic;
  }

  .engine-summary {
    font-size: 0.72rem;
    color: var(--muted);
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
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
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
    border: 1px solid rgba(0, 123, 255, 0.34);
    background: rgba(6, 23, 46, 0.68);
    color: var(--text);
    border-radius: 10px;
    padding: 8px 28px 8px 10px;
    font-size: 0.76rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease;
    appearance: none;
  }

  .engine-select:hover {
    border-color: rgba(0, 229, 255, 0.44);
    background: rgba(0, 71, 199, 0.35);
  }

  .engine-select:focus {
    outline: none;
    border-color: rgba(0, 229, 255, 0.6);
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
      background: #06172E;
      box-shadow: 0 18px 40px rgba(2, 7, 18, 0.42);
    }

    aside > .sync-box {
      display: none;
    }
  }
</style>

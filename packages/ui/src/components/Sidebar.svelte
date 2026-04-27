<script lang="ts">
  type SidebarIconKey = "hero-tier" | "hero-statistics" | "hero-counter" | "draft-master" | "tournament";
  const BRAND_TITLE_SRC = "/branding/draft-arena-title.png";
  const BRAND_MARK_SRC = "/branding/draft-arena-mark.png";
  const SIDEBAR_ICON_SOURCES: Record<SidebarIconKey, string> = {
    "hero-tier": "/branding/arena-tier-menu.png",
    "hero-statistics": "/branding/arena-stats-menu.png",
    "hero-counter": "/branding/counter-lab-menu.png",
    "draft-master": "/branding/draft-room-menu.png",
    tournament: "/branding/tournaments-menu.png"
  };

  export let items: Array<{ href: string; label: string; icon?: string; iconKey?: SidebarIconKey }> = [];
  export let currentPath = "/";

  let collapsed = false;
</script>

<aside class="sidebar" class:collapsed>
  <button
    class="collapse-trigger"
    type="button"
    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    aria-expanded={!collapsed}
    on:click={() => { collapsed = !collapsed; }}
  >
    {collapsed ? "»" : "«"}
  </button>
  <div class="brand-row">
    <div class="brand-wrap">
      <div class="brand">
        <a class="brand-home-link" href="/" aria-label="Go to landing page">
          <img class="brand-logo brand-logo--desktop" src={collapsed ? BRAND_MARK_SRC : BRAND_TITLE_SRC} alt="Draft Arena" />
          <img class="brand-logo brand-logo--mobile" src={BRAND_MARK_SRC} alt="" />
        </a>
      </div>
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

  .brand-home-link {
    display: inline-flex;
    text-decoration: none;
  }

  .brand-logo {
    display: block;
    width: 168px;
    max-width: 100%;
    height: 52px;
    object-fit: contain;
    object-position: left center;
    filter: drop-shadow(0 1px 5px rgba(0, 201, 255, 0.24));
  }

  .brand-logo--mobile {
    display: none;
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
    position: absolute;
    right: -15px;
    top: 50%;
    transform: translateY(-50%);
    width: 30px;
    min-height: 40px;
    border: 1px solid rgba(0, 229, 255, 0.18);
    border-radius: 10px;
    background: rgba(6, 23, 46, 0.85);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    z-index: 10;
    transition: border-color 160ms ease, background 160ms ease;
  }

  .collapse-trigger:hover {
    border-color: rgba(0, 229, 255, 0.45);
    background: rgba(0, 71, 199, 0.3);
  }

  nav {
    display: grid;
    gap: 8px;
    margin-bottom: 16px;
  }

  nav a {
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
    width: 22px;
    height: 22px;
    min-width: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    line-height: 1;
  }

  .nav-icon-img {
    width: 22px;
    height: 22px;
    object-fit: contain;
    display: block;
    filter: drop-shadow(0 0 6px rgba(0, 200, 255, 0.28));
  }

  .nav-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar.collapsed nav a {
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

  nav a:hover,
  nav a.active {
    color: var(--text);
    border-color: rgba(0, 229, 255, 0.3);
    background: rgba(0, 71, 199, 0.25);
  }

  .sidebar.collapsed .brand-wrap {
    position: relative;
    justify-content: center;
  }

  .sidebar.collapsed .brand {
    justify-content: center;
    width: 100%;
    overflow: visible;
  }

  .sidebar.collapsed .brand-home-link {
    width: 38px;
    height: 38px;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: rgba(6, 23, 46, 0.28);
    border: 1px solid rgba(0, 229, 255, 0.2);
    overflow: visible;
  }

  @media (max-width: 960px) {
    .sidebar {
      width: 100%;
      height: auto;
      position: sticky;
      top: 0;
      border-right: none;
      border-bottom: 1px solid var(--border);
      padding: 10px 16px;
      z-index: 50;
      overflow: visible;
    }

    .sidebar.collapsed {
      width: 100%;
      padding: 10px 16px;
    }

    .brand-row {
      margin-bottom: 0;
    }

    .brand-logo--desktop {
      display: none;
    }

    .brand-logo--mobile {
      display: block;
      width: 36px;
      height: 36px;
      object-fit: contain;
      object-position: left center;
    }

    .collapse-trigger {
      display: none;
    }

    nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 100;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0;
      padding: 0 0 env(safe-area-inset-bottom);
      margin: 0;
      background: rgba(2, 7, 18, 0.96);
      backdrop-filter: blur(10px);
      border-top: 1px solid rgba(0, 229, 255, 0.15);
      overflow: hidden;
    }

    nav a {
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      min-width: 0;
      padding: 8px 2px 6px;
      text-align: center;
      height: 60px;
      border-radius: 0;
      border: none;
      border-top: 2px solid transparent;
    }

    nav a:hover,
    nav a.active {
      border-color: transparent;
      border-top-color: rgba(0, 229, 255, 0.7);
      background: rgba(0, 71, 199, 0.2);
    }

    .nav-icon,
    .nav-icon-img {
      width: 20px;
      height: 20px;
      min-width: 20px;
    }

    .nav-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1;
      font-size: 0.62rem;
    }

    .sidebar.collapsed .nav-label {
      font-size: 0.62rem;
      line-height: 1;
    }
  }
</style>

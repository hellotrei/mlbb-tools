<script lang="ts">
  export let items: Array<{ href: string; label: string }> = [];
  export let currentPath = "/";
</script>

<aside class="sidebar">
  <div class="brand">MLBB Tools</div>
  <nav>
    {#each items as item}
      <a href={item.href} class:active={currentPath === item.href}>{item.label}</a>
    {/each}
  </nav>
</aside>

<style>
  .sidebar {
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
    }

    a {
      white-space: nowrap;
    }
  }
</style>

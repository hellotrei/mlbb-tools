<script lang="ts">
  import "../app.css";
  import { Sidebar } from "@mlbb/ui";
  import { page } from "$app/stores";

  const items = [
    { href: "/hero-tier", label: "Hero Tier" },
    { href: "/hero-statistics", label: "Hero Statistics" },
    { href: "/counter-pick", label: "Counter Pick" },
    { href: "/draft-master", label: "Draft Master" },
    { href: "/tournaments", label: "Tournaments" }
  ];
</script>

<div class="shell">
  <Sidebar {items} currentPath={$page.url.pathname} />
  <main>
    <slot />
  </main>
</div>

<style>
  .shell {
    display: flex;
    min-height: 100vh;
  }

  main {
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 960px) {
    .shell {
      display: block;
    }
  }
</style>

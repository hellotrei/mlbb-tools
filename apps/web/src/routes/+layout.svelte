<script lang="ts">
  import "../app.css";
  import { invalidateAll } from "$app/navigation";
  import { Sidebar } from "@mlbb/ui";
  import { page } from "$app/stores";
  import { formatSyncDate } from "$lib/datetime";

  export let data: {
    meta: {
      statsFetchedAt?: string | null;
      tierComputedAt?: string | null;
      countersComputedAt?: string | null;
    } | null;
  };

  const items = [
    { href: "/hero-tier", label: "Hero Tier" },
    { href: "/hero-statistics", label: "Hero Statistics" },
    { href: "/counter-pick", label: "Hero Counter" },
    { href: "/draft-master", label: "Draft Master" },
    { href: "/tournaments", label: "Tournaments" }
  ];

  let refreshing = false;

  $: syncInfo = {
    tier: formatSyncDate(data.meta?.tierComputedAt ?? data.meta?.statsFetchedAt ?? null),
    stats: formatSyncDate(data.meta?.statsFetchedAt ?? null),
    counter: formatSyncDate(data.meta?.countersComputedAt ?? null)
  };

  async function handleRefresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await invalidateAll();
    } finally {
      refreshing = false;
    }
  }
</script>

<div class="shell">
  <Sidebar
    {items}
    currentPath={$page.url.pathname}
    syncInfo={syncInfo}
    {refreshing}
    on:refresh={handleRefresh}
  />
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

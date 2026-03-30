<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Sidebar } from "@mlbb/ui";
  import { page } from "$app/stores";
  import { apiUrl } from "$lib/api";
  import {
    engine,
    m7Status,
    mplIdStatus,
    mplPhStatus,
    resolveTournamentEngineStatus
  } from "$lib/stores/engine";

  const items = [
    { href: "/hero-tier", label: "Hero Tier", icon: "🛡️" },
    { href: "/hero-statistics", label: "Hero Statistics", icon: "📊" },
    { href: "/counter-pick", label: "Hero Counter", icon: "⚔️" },
    { href: "/draft-master", label: "Draft Master", icon: "🧠" }
  ];

  onMount(async () => {
    const fetchM7Status = async () => {
      try {
        const res = await fetch(apiUrl("/draft/m7/status"));
        const json = await res.json();
        m7Status.set(resolveTournamentEngineStatus(json, "M7 status is unavailable."));
      } catch {
        m7Status.set(resolveTournamentEngineStatus(null, "M7 status is unavailable."));
      }
    };

    const fetchMplPhStatus = async () => {
      try {
        const res = await fetch(apiUrl("/draft/mpl-ph/status"));
        const json = await res.json();
        mplPhStatus.set(resolveTournamentEngineStatus(json, "MPL PH status is unavailable."));
      } catch {
        mplPhStatus.set(resolveTournamentEngineStatus(null, "MPL PH status is unavailable."));
      }
    };

    const fetchMplIdStatus = async () => {
      try {
        const res = await fetch(apiUrl("/draft/mpl-id/status"));
        const json = await res.json();
        mplIdStatus.set(resolveTournamentEngineStatus(json, "MPL ID status is unavailable."));
      } catch {
        mplIdStatus.set(resolveTournamentEngineStatus(null, "MPL ID status is unavailable."));
      }
    };

    await Promise.all([fetchM7Status(), fetchMplPhStatus(), fetchMplIdStatus()]);
  });

  function isSelectableTournamentStatus(status: { state: string }) {
    return status.state === "available" || status.state === "limited";
  }

  function handleEngineChange(newEngine: string) {
    if (newEngine === "m7" && !isSelectableTournamentStatus($m7Status)) return;
    if (newEngine === "mpl_ph" && !isSelectableTournamentStatus($mplPhStatus)) return;
    if (newEngine === "mpl_id" && !isSelectableTournamentStatus($mplIdStatus)) return;
    if (newEngine === $engine) return;
    engine.set(newEngine as "community" | "m7" | "mpl_ph" | "mpl_id");
    void goto("/hero-tier");
  }
</script>

<div class="shell">
  <Sidebar
    {items}
    currentPath={$page.url.pathname}
    engine={$engine}
    m7Status={$m7Status}
    mplIdStatus={$mplIdStatus}
    mplPhStatus={$mplPhStatus}
    onEngineChange={handleEngineChange}
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

<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Sidebar } from "@mlbb/ui";
  import { page } from "$app/stores";
  import { apiUrl } from "$lib/api";
  import { TOURNAMENT_ENGINE_LIST, tournamentEngineStatusTag, type TournamentEngineId } from "$lib/tournament-engines";
  import {
    engine,
    m7Status,
    mplIdStatus,
    mplPhStatus,
    resolveTournamentEngineStatus
  } from "$lib/stores/engine";

  const STATUS_REFRESH_MS = 60_000;

  const items = [
    { href: "/hero-tier", label: "Arena Tier", iconKey: "hero-tier" },
    { href: "/hero-statistics", label: "Arena Stats", iconKey: "hero-statistics" },
    { href: "/counter-pick", label: "Counter Lab", iconKey: "hero-counter" },
    { href: "/draft-master", label: "Draft Room", iconKey: "draft-master" },
    { href: "/tournaments", label: "Tournaments", iconKey: "tournament" }
  ];

  const setStatusForEngine = (id: TournamentEngineId, payload: unknown, fallbackReason: string) => {
    const resolved = resolveTournamentEngineStatus(payload, fallbackReason);
    if (id === "m7") m7Status.set(resolved);
    else if (id === "mpl_id") mplIdStatus.set(resolved);
    else if (id === "mpl_ph") mplPhStatus.set(resolved);
  };

  const fetchTournamentStatus = async (id: TournamentEngineId, statusPath: string, label: string) => {
    try {
      const res = await fetch(apiUrl(statusPath));
      if (!res.ok) throw new Error("Status request failed.");
      const json = await res.json();
      setStatusForEngine(id, json, `${label} status is unavailable.`);
    } catch {
      setStatusForEngine(id, null, `${label} status is unavailable.`);
    }
  };

  let statusRefreshPromise: Promise<void> | null = null;

  function refreshTournamentStatuses() {
    if (statusRefreshPromise) return statusRefreshPromise;

    statusRefreshPromise = Promise.all(
      TOURNAMENT_ENGINE_LIST.map((config) =>
        fetchTournamentStatus(config.id, config.statusPath, config.shortLabel)
      )
    )
      .then(() => undefined)
      .finally(() => {
        statusRefreshPromise = null;
      });

    return statusRefreshPromise;
  }

  onMount(() => {
    void refreshTournamentStatuses();

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "hidden") return;
      void refreshTournamentStatuses();
    };

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshTournamentStatuses();
    }, STATUS_REFRESH_MS);

    window.addEventListener("focus", handleVisibilityRefresh);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", handleVisibilityRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
    };
  });

  $: tournamentStatusMap = {
    m7: $m7Status,
    mpl_id: $mplIdStatus,
    mpl_ph: $mplPhStatus
  };

  function isSelectableTournamentStatus(status: { state: string }) {
    return status.state === "available" || status.state === "limited";
  }

  $: engineOptions = [
    { value: "community", longLabel: "Community", shortLabel: "C", selectable: true },
    ...TOURNAMENT_ENGINE_LIST.map((config) => {
      const status = tournamentStatusMap[config.id];
      const tag = status ? tournamentEngineStatusTag(status) : "Loading";
      return {
        value: config.id,
        longLabel: `${config.label} (${tag})`,
        shortLabel: `${config.shortLabel} ${tag}`,
        selectable: status ? isSelectableTournamentStatus(status) : false
      };
    })
  ];

  $: selectedEngineSummary = (() => {
    const status = $engine === "community" ? null : tournamentStatusMap[$engine];
    if (!status) return "Community stats, tier, matrix, and community blend.";
    const tag = tournamentEngineStatusTag(status);
    return `${tag}${status.reason ? `: ${status.reason}` : ""}`;
  })();

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
    {engineOptions}
    {selectedEngineSummary}
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

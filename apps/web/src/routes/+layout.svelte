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

  const items = [
    { href: "/hero-tier", label: "Hero Tier", icon: "🛡️" },
    { href: "/hero-statistics", label: "Hero Statistics", icon: "📊" },
    { href: "/counter-pick", label: "Hero Counter", icon: "⚔️" },
    { href: "/draft-master", label: "Draft Master", icon: "🧠" }
  ];

  onMount(async () => {
    const setStatusForEngine = (id: TournamentEngineId, payload: unknown, fallbackReason: string) => {
      const resolved = resolveTournamentEngineStatus(payload, fallbackReason);
      if (id === "m7") m7Status.set(resolved);
      else if (id === "mpl_id") mplIdStatus.set(resolved);
      else if (id === "mpl_ph") mplPhStatus.set(resolved);
    };

    const fetchTournamentStatus = async (id: TournamentEngineId, statusPath: string, label: string) => {
      try {
        const res = await fetch(apiUrl(statusPath));
        const json = await res.json();
        setStatusForEngine(id, json, `${label} status is unavailable.`);
      } catch {
        setStatusForEngine(id, null, `${label} status is unavailable.`);
      }
    };

    await Promise.all(
      TOURNAMENT_ENGINE_LIST.map((config) =>
        fetchTournamentStatus(config.id, config.statusPath, config.shortLabel)
      )
    );
  });

  function statusByEngineId(id: string) {
    if (id === "m7") return $m7Status;
    if (id === "mpl_id") return $mplIdStatus;
    if (id === "mpl_ph") return $mplPhStatus;
    return null;
  }

  function isSelectableTournamentStatus(status: { state: string }) {
    return status.state === "available" || status.state === "limited";
  }

  $: engineOptions = [
    { value: "community", longLabel: "Community", shortLabel: "C", selectable: true },
    ...TOURNAMENT_ENGINE_LIST.map((config) => {
      const status = statusByEngineId(config.id);
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
    const status = statusByEngineId($engine);
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

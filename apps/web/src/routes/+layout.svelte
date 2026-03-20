<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Sidebar } from "@mlbb/ui";
  import { page } from "$app/stores";
  import { apiUrl } from "$lib/api";
  import { engine, m7Available, m7StatusLoaded, m7StatusReason } from "$lib/stores/engine";

  const items = [
    { href: "/hero-tier", label: "Hero Tier", icon: "🛡️" },
    { href: "/hero-statistics", label: "Hero Statistics", icon: "📊" },
    { href: "/counter-pick", label: "Hero Counter", icon: "⚔️" },
    { href: "/draft-master", label: "Draft Master", icon: "🧠" }
  ];

  onMount(async () => {
    try {
      const res = await fetch(apiUrl("/draft/m7/status"));
      const json = await res.json();
      m7Available.set(Boolean(json?.available));
      m7StatusReason.set(String(json?.reason ?? ""));
    } catch {
      m7Available.set(false);
    } finally {
      m7StatusLoaded.set(true);
    }
  });

  function handleEngineChange(newEngine: string) {
    if (newEngine === "m7" && !$m7Available) return;
    if (newEngine === $engine) return;
    engine.set(newEngine as "community" | "m7");
    void goto("/hero-tier");
  }
</script>

<div class="shell">
  <Sidebar
    {items}
    currentPath={$page.url.pathname}
    engine={$engine}
    m7Available={$m7Available}
    m7StatusLoaded={$m7StatusLoaded}
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

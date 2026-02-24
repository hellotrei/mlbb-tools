import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, url }) => {
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const role = url.searchParams.get("role") ?? "";
  const lane = url.searchParams.get("lane") ?? "";
  const rankScope = url.searchParams.get("rankScope") ?? "mythic_glory";
  const densityParam = url.searchParams.get("density");
  const density = densityParam === "comfortable" ? "comfortable" : "compact";

  const params = new URLSearchParams({ timeframe });
  if (role) params.set("role", role);
  if (lane) params.set("lane", lane);
  params.set("rankScope", rankScope);

  const [tierRes, heroesRes, metaRes] = await Promise.all([
    fetch(apiUrl(`/tier?${params.toString()}`)),
    fetch(apiUrl("/heroes")),
    fetch(apiUrl(`/meta/last-updated?timeframe=${timeframe}`))
  ]);

  const tier = await tierRes.json();
  const heroes = await heroesRes.json();
  const meta = await metaRes.json();

  return {
    timeframe,
    role,
    lane,
    rankScope,
    density,
    tier,
    meta,
    heroes: heroes.items ?? []
  };
};

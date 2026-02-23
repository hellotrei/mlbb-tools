import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, url }) => {
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const role = url.searchParams.get("role") ?? "";
  const lane = url.searchParams.get("lane") ?? "";

  const params = new URLSearchParams({ timeframe });
  if (role) params.set("role", role);
  if (lane) params.set("lane", lane);

  const [tierRes, heroesRes] = await Promise.all([
    fetch(apiUrl(`/tier?${params.toString()}`)),
    fetch(apiUrl("/heroes"))
  ]);

  const tier = await tierRes.json();
  const heroes = await heroesRes.json();
  return { timeframe, role, lane, tier, heroes: heroes.items ?? [] };
};

import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, url }) => {
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const rankScope = url.searchParams.get("rankScope") ?? "mythic_glory";
  const heroesRes = await fetch(apiUrl("/heroes"));
  const heroes = await heroesRes.json();

  return {
    timeframe,
    rankScope,
    heroes: heroes.items ?? []
  };
};

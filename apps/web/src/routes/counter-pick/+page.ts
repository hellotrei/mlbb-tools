import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, url }) => {
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const rankScope = url.searchParams.get("rankScope") ?? "mythic_glory";
  let heroes: Array<{
    mlid: number;
    name: string;
    rolePrimary: string;
    roleSecondary?: string | null;
    lanes: string[];
    imageKey: string;
  }> = [];

  try {
    const heroesRes = await fetch(apiUrl("/heroes"));
    if (heroesRes.ok) {
      const payload = await heroesRes.json();
      heroes = payload.items ?? [];
    }
  } catch {
    heroes = [];
  }

  return {
    timeframe,
    rankScope,
    heroes
  };
};

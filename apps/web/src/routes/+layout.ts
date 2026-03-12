import type { LayoutLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: LayoutLoad = async ({ fetch }) => {
  const timeframe = "7d";
  const [metaRes, heroesRes] = await Promise.all([
    fetch(apiUrl(`/meta/last-updated?timeframe=${timeframe}`)).catch(() => null),
    fetch(apiUrl("/heroes")).catch(() => null)
  ]);
  const meta = metaRes?.ok ? await metaRes.json().catch(() => null) : null;
  const heroesPayload = heroesRes?.ok ? await heroesRes.json().catch(() => null) : null;
  return { meta, heroes: heroesPayload?.items ?? [] };
};

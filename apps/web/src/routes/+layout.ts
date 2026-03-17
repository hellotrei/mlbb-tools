import type { LayoutLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: LayoutLoad = async ({ fetch }) => {
  const heroesRes = await fetch(apiUrl("/heroes")).catch(() => null);
  const heroesPayload = heroesRes?.ok ? await heroesRes.json().catch(() => null) : null;
  return { meta: null, heroes: heroesPayload?.items ?? [] };
};

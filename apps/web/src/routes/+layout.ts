import type { LayoutLoad } from "./$types";
import { apiUrl } from "$lib/api";

const HEROES_FETCH_TIMEOUT_MS = 3_000;

export const load: LayoutLoad = async ({ fetch }) => {
  const heroesRes = await fetch(apiUrl("/heroes"), {
    signal: AbortSignal.timeout(HEROES_FETCH_TIMEOUT_MS)
  }).catch(() => null);
  const heroesPayload = heroesRes?.ok ? await heroesRes.json().catch(() => null) : null;
  return { meta: null, heroes: heroesPayload?.items ?? [] };
};

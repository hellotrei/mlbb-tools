import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

const EMPTY_TIER = {
  segment: "all",
  rankScope: "mythic_glory",
  computedAt: null,
  tiers: {
    SS: [],
    S: [],
    A: [],
    B: [],
    C: [],
    D: []
  }
};

const EMPTY_META = {
  timeframe: "7d",
  statsFetchedAt: null,
  tierComputedAt: null,
  countersComputedAt: null
};

async function fetchJsonOr<T>(fetcher: typeof fetch, input: string, fallback: T): Promise<T> {
  try {
    const response = await fetcher(input);
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export const load: PageLoad = async ({ fetch, url, parent }) => {
  const { heroes } = await parent();
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const role = url.searchParams.get("role") ?? "";
  const lane = url.searchParams.get("lane") ?? "";
  const rankScope = url.searchParams.get("rankScope") ?? "mythic_glory";
  const params = new URLSearchParams({ timeframe });
  if (role) params.set("role", role);
  if (lane) params.set("lane", lane);
  params.set("rankScope", rankScope);

  const [tier, meta] = await Promise.all([
    fetchJsonOr(fetch, apiUrl(`/tier?${params.toString()}`), {
      ...EMPTY_TIER,
      rankScope
    }),
    fetchJsonOr(fetch, apiUrl(`/meta/last-updated?timeframe=${timeframe}`), {
      ...EMPTY_META,
      timeframe
    })
  ]);

  return {
    timeframe,
    role,
    lane,
    rankScope,
    tier,
    meta,
    heroes
  };
};

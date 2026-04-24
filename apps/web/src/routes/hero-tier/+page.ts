import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

const API_FETCH_TIMEOUT_MS = 3_000;

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

async function fetchWithTimeout(fetcher: typeof fetch, input: string, timeoutMs: number) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetcher(input, { signal: controller.signal }),
      timeoutPromise
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchJsonOr<T>(fetcher: typeof fetch, input: string, fallback: T): Promise<T> {
  try {
    const response = await fetchWithTimeout(fetcher, input, API_FETCH_TIMEOUT_MS);
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export const load: PageLoad = async ({ fetch, url, parent }) => {
  const { heroes } = await parent();
  const role = url.searchParams.get("role") ?? "";
  const lane = url.searchParams.get("lane") ?? "";
  const params = new URLSearchParams({ timeframe: "7d" });
  if (role) params.set("role", role);
  if (lane) params.set("lane", lane);
  params.set("rankScope", "mythic_glory");

  const [tier, meta] = await Promise.all([
    fetchJsonOr(fetch, apiUrl(`/tier?${params.toString()}`), EMPTY_TIER),
    fetchJsonOr(fetch, apiUrl(`/meta/last-updated?timeframe=7d`), EMPTY_META)
  ]);

  return {
    role,
    lane,
    tier,
    meta,
    heroes
  };
};

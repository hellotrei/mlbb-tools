import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

const API_FETCH_TIMEOUT_MS = 3_000;

const EMPTY_STATS = {
  items: [],
  page: 1,
  limit: 50,
  total: 0,
  lastUpdated: null
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
  const timeframe = url.searchParams.get("timeframe") ?? "7d";
  const role = url.searchParams.get("role") ?? "";
  const lane = url.searchParams.get("lane") ?? "";
  const speciality = url.searchParams.get("speciality") ?? "";
  const sort = url.searchParams.get("sort") ?? "win_rate";
  const order = url.searchParams.get("order") ?? "desc";
  const page = url.searchParams.get("page") ?? "1";
  const limit = url.searchParams.get("limit") ?? "50";
  const params = new URLSearchParams({ timeframe, sort, order, page, limit });
  if (role) params.set("role", role);
  if (lane) params.set("lane", lane);
  if (speciality) params.set("speciality", speciality);

  const stats = await fetchJsonOr(fetch, apiUrl(`/stats?${params.toString()}`), {
    ...EMPTY_STATS,
    page: Number(page) || 1,
    limit: Number(limit) || 50
  });

  return {
    filters: { timeframe, role, lane, speciality, sort, order, page, limit, search: "" },
    stats,
    heroes
  };
};

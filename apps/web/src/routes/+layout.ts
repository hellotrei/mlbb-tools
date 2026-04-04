import type { LayoutLoad } from "./$types";
import { apiUrl } from "$lib/api";

const HEROES_FETCH_TIMEOUT_MS = 3_000;

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

export const load: LayoutLoad = async ({ fetch }) => {
  const heroesRes = await fetchWithTimeout(fetch, apiUrl("/heroes"), HEROES_FETCH_TIMEOUT_MS).catch(() => null);
  const heroesPayload = heroesRes?.ok ? await heroesRes.json().catch(() => null) : null;
  return { meta: null, heroes: heroesPayload?.items ?? [] };
};

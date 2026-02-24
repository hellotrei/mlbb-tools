import type { LayoutLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: LayoutLoad = async ({ fetch }) => {
  const timeframe = "7d";
  try {
    const response = await fetch(apiUrl(`/meta/last-updated?timeframe=${timeframe}`));
    if (!response.ok) {
      return { meta: null };
    }
    const meta = await response.json();
    return { meta };
  } catch {
    return { meta: null };
  }
};

import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, params }) => {
  const overviewRes = await fetch(apiUrl(`/events/${params.id}/overview`), { cache: "no-store" });

  if (!overviewRes.ok) {
    if (overviewRes.status === 404) {
      throw error(404, "Tournament event not found.");
    }
    throw error(500, "Failed to load tournament data.");
  }

  const overviewPayload = await overviewRes.json();

  return {
    event: overviewPayload.event,
    bracket: overviewPayload.bracket,
    standings: overviewPayload.standings
  };
};

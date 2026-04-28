import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const [overviewRes, intelligenceRes] = await Promise.all([
    fetch(apiUrl(`/events/${params.id}/overview`), { cache: "no-store" }),
    fetch(apiUrl(`/events/${params.id}/postmatch-intelligence`), { cache: "no-store" })
  ]);

  if (!overviewRes.ok) {
    if (overviewRes.status === 404) {
      throw error(404, "Tournament event not found.");
    }
    throw error(500, "Failed to load tournament data.");
  }

  const overviewPayload = await overviewRes.json();
  const intelligencePayload = intelligenceRes.ok ? await intelligenceRes.json() : null;

  return {
    event: overviewPayload.event,
    bracket: overviewPayload.bracket,
    standings: overviewPayload.standings,
    postmatchIntelligence: intelligencePayload,
    entry: url.searchParams.get("entry")
  };
};

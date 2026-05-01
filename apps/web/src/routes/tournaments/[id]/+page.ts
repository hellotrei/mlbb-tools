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
  const bracket = overviewPayload.playoffBracket?.rounds
    ? overviewPayload.playoffBracket.rounds.map((round: any) => ({
        ...round,
        id: Number(round.id),
        stage: round.bracket === "main" ? "main" : round.bracket,
        matches: (round.matches ?? []).map((match: any) => ({
          ...match,
          id: Number(match.id),
          result: match.status
        }))
      }))
    : overviewPayload.bracket;

  return {
    event: overviewPayload.event,
    bracket,
    playoffBracket: overviewPayload.playoffBracket ?? null,
    standings: overviewPayload.standings,
    postmatchIntelligence: intelligencePayload,
    entry: url.searchParams.get("entry")
  };
};

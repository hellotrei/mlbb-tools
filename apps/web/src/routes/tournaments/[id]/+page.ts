import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, params, url }) => {
  const tab = url.searchParams.get("tab") === "standings" ? "standings" : "bracket";

  const [eventRes, bracketRes, standingsRes] = await Promise.all([
    fetch(apiUrl(`/events/${params.id}`)),
    fetch(apiUrl(`/events/${params.id}/bracket`)),
    fetch(apiUrl(`/events/${params.id}/standings`))
  ]);

  if (!eventRes.ok) {
    throw error(eventRes.status, "Tournament event not found.");
  }

  if (!bracketRes.ok || !standingsRes.ok) {
    throw error(500, "Failed to load tournament data.");
  }

  const eventPayload = await eventRes.json();
  const bracketPayload = await bracketRes.json();
  const standingsPayload = await standingsRes.json();

  return {
    tab,
    event: eventPayload.event,
    teams: eventPayload.teams,
    rounds: eventPayload.rounds,
    bracket: bracketPayload.rounds,
    standings: standingsPayload.standings
  };
};

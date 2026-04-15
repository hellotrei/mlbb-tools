import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

export const load: PageLoad = async ({ fetch, params }) => {
  const [eventRes, bracketRes, standingsRes] = await Promise.all([
    fetch(apiUrl(`/events/${params.id}`), { cache: "no-store" }),
    fetch(apiUrl(`/events/${params.id}/bracket`), { cache: "no-store" }),
    fetch(apiUrl(`/events/${params.id}/standings`), { cache: "no-store" })
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
    event: eventPayload.event,
    teams: eventPayload.teams,
    rounds: eventPayload.rounds,
    bracket: bracketPayload.rounds,
    standings: standingsPayload.standings
  };
};

import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

type TournamentEvent = {
  id: number;
  slug?: string;
  code: string;
  name: string;
  format: string;
  eventMode?: string;
  totalTeams: number;
  totalRounds: number;
  eventDate: string;
  status: string;
  createdByTelegramUserId: string;
};

export const load: PageLoad = async ({ fetch, parent }) => {
  const { heroes } = await parent();

  let events: TournamentEvent[] = [];
  try {
    const res = await fetch(apiUrl("/events?limit=20"));
    if (res.ok) {
      const payload = await res.json() as { items?: TournamentEvent[] };
      // Show ongoing first, then non-completed, max 3
      const all = payload.items ?? [];
      const live = all.filter((e) => e.status === "ongoing");
      const upcoming = all.filter((e) => e.status !== "ongoing" && e.status !== "completed");
      events = [...live, ...upcoming].slice(0, 3);
    }
  } catch {
    // Graceful fallback — no events shown
  }

  return { events, heroCount: heroes.length };
};

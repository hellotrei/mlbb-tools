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
  adminWhatsapp?: string | null;
  registrationDeadline?: string | null;
};

export const load: PageLoad = async ({ fetch, parent }) => {
  const { heroes } = await parent();

  let events: TournamentEvent[] = [];
  try {
    const res = await fetch(apiUrl("/events?limit=20"));
    if (res.ok) {
      const payload = await res.json() as { items?: TournamentEvent[] };
      // Show ongoing first, then nearest upcoming registrations, max 3
      const all = payload.items ?? [];
      const toEpoch = (value?: string | null): number => {
        if (!value) return Number.MAX_SAFE_INTEGER;
        const ts = Date.parse(value);
        return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
      };
      const live = all
        .filter((e) => e.status === "ongoing")
        .sort((a, b) => toEpoch(b.eventDate) - toEpoch(a.eventDate));
      const upcoming = all
        .filter((e) => e.status !== "ongoing" && e.status !== "completed")
        .sort((a, b) => toEpoch(a.registrationDeadline ?? a.eventDate) - toEpoch(b.registrationDeadline ?? b.eventDate));
      events = [...live, ...upcoming].slice(0, 3);
    }
  } catch {
    // Graceful fallback — no events shown
  }

  return { events, heroCount: heroes.length };
};

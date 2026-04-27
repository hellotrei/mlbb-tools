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

type LandingStats = {
  totalEvents: number;
  liveEvents: number;
  upcomingEvents: number;
  totalTeamSlots: number;
};

export const load: PageLoad = async ({ fetch, parent }) => {
  const { heroes } = await parent();

  let events: TournamentEvent[] = [];
  let stats: LandingStats = {
    totalEvents: 0,
    liveEvents: 0,
    upcomingEvents: 0,
    totalTeamSlots: 0
  };
  try {
    const res = await fetch(apiUrl("/events?limit=20"));
    if (res.ok) {
      const payload = await res.json() as { items?: TournamentEvent[] };
      // Landing should only show upcoming events.
      const all = payload.items ?? [];
      stats = {
        totalEvents: all.length,
        liveEvents: all.filter((event) => event.status === "ongoing").length,
        upcomingEvents: all.filter((event) => event.status !== "ongoing" && event.status !== "completed").length,
        totalTeamSlots: all.reduce((sum, event) => sum + Math.max(0, event.totalTeams), 0)
      };
      const toEpoch = (value?: string | null): number => {
        if (!value) return Number.MAX_SAFE_INTEGER;
        const ts = Date.parse(value);
        return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
      };
      const upcoming = all
        .filter((e) => e.status !== "ongoing" && e.status !== "completed")
        .sort((a, b) => toEpoch(a.registrationDeadline ?? a.eventDate) - toEpoch(b.registrationDeadline ?? b.eventDate));
      events = upcoming.slice(0, 3);
    }
  } catch {
    // Graceful fallback — no events shown
  }

  return { events, heroCount: heroes.length, stats };
};

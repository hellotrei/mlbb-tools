import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

type TournamentEventListResponse = {
  items?: Array<{
    id: number;
    slug: string;
    code: string;
    name: string;
    format: string;
    eventMode?: string;
    playoffFormat?: string;
    regularSeasonFormat?: string;
    totalTeams: number;
    totalRounds: number;
    eventDate: string;
    status: string;
    createdByTelegramUserId: string;
  }>;
};

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch(apiUrl("/events?limit=50"));

  if (!response.ok) {
    return {
      events: []
    };
  }

  const payload = (await response.json()) as TournamentEventListResponse;

  return {
    events: payload.items ?? []
  };
};

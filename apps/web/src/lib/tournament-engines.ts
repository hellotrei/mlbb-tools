import type { RecommendationEngine, TournamentEngineStatus } from "./stores/engine";

export type TournamentEngineId = Exclude<RecommendationEngine, "community">;

export type TournamentEngineConfig = {
  id: TournamentEngineId;
  label: string;
  shortLabel: string;
  pathSlug: string;
  statusPath: string;
  statsPath: string;
  tierPath: string;
  counterBasePath: string;
  analyzePath: string;
  matchupPath: string;
};

export const TOURNAMENT_ENGINES: Record<TournamentEngineId, TournamentEngineConfig> = {
  m7: {
    id: "m7",
    label: "M7 World Championship",
    shortLabel: "M7",
    pathSlug: "m7",
    statusPath: "/draft/m7/status",
    statsPath: "/stats/m7",
    tierPath: "/tier/m7",
    counterBasePath: "/counters/m7",
    analyzePath: "/draft/m7/analyze",
    matchupPath: "/draft/m7/matchup"
  },
  mpl_id: {
    id: "mpl_id",
    label: "MPL ID Regular Season",
    shortLabel: "MPL ID",
    pathSlug: "mpl-id",
    statusPath: "/draft/mpl-id/status",
    statsPath: "/stats/mpl-id",
    tierPath: "/tier/mpl-id",
    counterBasePath: "/counters/mpl-id",
    analyzePath: "/draft/mpl-id/analyze",
    matchupPath: "/draft/mpl-id/matchup"
  },
  mpl_ph: {
    id: "mpl_ph",
    label: "MPL PH Regular Season",
    shortLabel: "MPL PH",
    pathSlug: "mpl-ph",
    statusPath: "/draft/mpl-ph/status",
    statsPath: "/stats/mpl-ph",
    tierPath: "/tier/mpl-ph",
    counterBasePath: "/counters/mpl-ph",
    analyzePath: "/draft/mpl-ph/analyze",
    matchupPath: "/draft/mpl-ph/matchup"
  }
};

export const TOURNAMENT_ENGINE_LIST = Object.values(TOURNAMENT_ENGINES);

export function isTournamentEngine(engine: string): engine is TournamentEngineId {
  return engine in TOURNAMENT_ENGINES;
}

export function tournamentEngineConfig(engine: string): TournamentEngineConfig | null {
  return isTournamentEngine(engine) ? TOURNAMENT_ENGINES[engine] : null;
}

export function tournamentEngineLabel(engine: string) {
  return tournamentEngineConfig(engine)?.label ?? "Tournament";
}

export function tournamentEngineStatusTag(status: TournamentEngineStatus) {
  if (status.state === "available") return "Ready";
  if (status.state === "limited") return "Limited";
  if (status.state === "empty") return "Empty";
  if (status.state === "error") return "Error";
  return "Loading";
}

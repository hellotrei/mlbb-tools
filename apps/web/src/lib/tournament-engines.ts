import type { RecommendationEngine, TournamentEngineStatus } from "./stores/engine";

export type TournamentEngineId = RecommendationEngine;

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
  community: {
    id: "community",
    label: "Community Ranked",
    shortLabel: "Community",
    pathSlug: "community",
    statusPath: "/draft/community/status",
    statsPath: "/stats/community",
    tierPath: "/tier/community",
    counterBasePath: "/counters/community",
    analyzePath: "/draft/community/analyze",
    matchupPath: "/draft/community/matchup"
  },
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
  },
  msc_2026: {
    id: "msc_2026",
    label: "MSC 2026",
    shortLabel: "MSC",
    pathSlug: "msc-2026",
    statusPath: "/draft/msc-2026/status",
    statsPath: "/stats/msc-2026",
    tierPath: "/tier/msc-2026",
    counterBasePath: "/counters/msc-2026",
    analyzePath: "/draft/msc-2026/analyze",
    matchupPath: "/draft/msc-2026/matchup"
  },
  mpl_id_s18: {
    id: "mpl_id_s18",
    label: "MPL ID Season 18",
    shortLabel: "MPL ID S18",
    pathSlug: "mpl-id-s18",
    statusPath: "/draft/mpl-id-s18/status",
    statsPath: "/stats/mpl-id-s18",
    tierPath: "/tier/mpl-id-s18",
    counterBasePath: "/counters/mpl-id-s18",
    analyzePath: "/draft/mpl-id-s18/analyze",
    matchupPath: "/draft/mpl-id-s18/matchup"
  },
  mpl_ph_s18: {
    id: "mpl_ph_s18",
    label: "MPL PH Season 18",
    shortLabel: "MPL PH S18",
    pathSlug: "mpl-ph-s18",
    statusPath: "/draft/mpl-ph-s18/status",
    statsPath: "/stats/mpl-ph-s18",
    tierPath: "/tier/mpl-ph-s18",
    counterBasePath: "/counters/mpl-ph-s18",
    analyzePath: "/draft/mpl-ph-s18/analyze",
    matchupPath: "/draft/mpl-ph-s18/matchup"
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

// ── Unified data access ──────────────────────────────────────────────────────
// All engines (community, m7, mpl_id, mpl_ph) now share the same URL pattern.
// Frontend pages should use these helpers instead of branching on engine type.

import { apiUrl } from "$lib/api";

/**
 * Fetch tier data for any engine.
 * Returns the standard shape: { items: Array<{ mlid, tier, score, ... }> }
 */
export async function fetchTierData(engine: string, signal?: AbortSignal): Promise<{ items: Array<{ mlid: number; tier: string; score: number }> } | null> {
  const config = tournamentEngineConfig(engine);
  if (!config) return null;
  try {
    const res = await fetch(apiUrl(config.tierPath), { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch stats data for any engine.
 * Returns the standard shape: { items: Array<{ mlid, winRate, banRate, pickRate, ... }> }
 */
export async function fetchStatsData(engine: string, signal?: AbortSignal): Promise<{ items: Array<Record<string, unknown>> } | null> {
  const config = tournamentEngineConfig(engine);
  if (!config) return null;
  try {
    const res = await fetch(apiUrl(config.statsPath), { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch counter recommendations for any engine.
 */
export async function fetchCounterData(engine: string, mlid: number, signal?: AbortSignal): Promise<{ items: Array<Record<string, unknown>> } | null> {
  const config = tournamentEngineConfig(engine);
  if (!config) return null;
  try {
    const res = await fetch(apiUrl(`${config.counterBasePath}/${mlid}`), { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Post draft analyze for any engine.
 */
export async function fetchDraftAnalyze(engine: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const config = tournamentEngineConfig(engine);
  if (!config) return null;
  try {
    const res = await fetch(apiUrl(config.analyzePath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Post matchup analysis for any engine.
 */
export async function fetchMatchupData(engine: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const config = tournamentEngineConfig(engine);
  if (!config) return null;
  try {
    const res = await fetch(apiUrl(config.matchupPath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

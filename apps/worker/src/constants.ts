import type { Lane, Role, Timeframe } from "@mlbb/shared";

export const TIMEFRAMES: Timeframe[] = ["1d", "3d", "7d", "15d", "30d"];
export const ROLES: Role[] = ["tank", "fighter", "assassin", "mage", "marksman", "support"];
export const LANES: Lane[] = ["gold", "exp", "mid", "roam", "jungle"];

export const QUEUES = {
  ingest: "ingest-gms",
  tier: "compute-tier",
  counters: "compute-counters",
  synergies: "compute-synergies",
  draft: "compute-draft"
} as const;

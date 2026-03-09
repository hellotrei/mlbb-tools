import type { Lane, Role, Timeframe } from "@mlbb/shared";

export const TIMEFRAMES = ["1d", "3d", "7d", "15d", "30d"] as const satisfies readonly Timeframe[];
export const ROLES = ["tank", "fighter", "assassin", "mage", "marksman", "support"] as const satisfies readonly Role[];
export const LANES = ["gold", "exp", "mid", "roam", "jungle"] as const satisfies readonly Lane[];

export const QUEUES = {
  ingest: "ingest-gms",
  tier: "compute-tier",
  counters: "compute-counters",
  synergies: "compute-synergies"
} as const;

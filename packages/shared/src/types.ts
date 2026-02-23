export type Role = "tank" | "fighter" | "assassin" | "mage" | "marksman" | "support";
export type Lane = "gold" | "exp" | "mid" | "roam" | "jungle";
export type Timeframe = "1d" | "3d" | "7d" | "15d" | "30d";
export type Tier = "SS" | "S" | "A" | "B" | "C" | "D";

export interface HeroMeta {
  mlid: number;
  name: string;
  rolePrimary: Role;
  roleSecondary?: Role | null;
  lanes: Lane[];
  specialities: string[];
  slug: string;
  imageKey: string;
  counters?: number[];
}

export interface HeroStatRow {
  mlid: number;
  winRate: number;
  pickRate: number;
  banRate: number;
  appearance?: number;
  timeframe: Timeframe;
}

export interface TierResultRow {
  mlid: number;
  tier: Tier;
  score: number;
}

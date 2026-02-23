export const TIMEFRAMES = ["1d", "3d", "7d", "15d", "30d"] as const;
export const ROLES = ["tank", "fighter", "assassin", "mage", "marksman", "support"] as const;
export const LANES = ["gold", "exp", "mid", "roam", "jungle"] as const;

export function timeframeLabel(value: string) {
  const map: Record<string, string> = {
    "1d": "Past 1 day",
    "3d": "Past 3 days",
    "7d": "Past 7 days",
    "15d": "Past 15 days",
    "30d": "Past 30 days"
  };
  return map[value] ?? value;
}

export function roleLabel(value: string) {
  const map: Record<string, string> = {
    tank: "Tank",
    fighter: "Fighter",
    assassin: "Assassin",
    mage: "Mage",
    marksman: "Marksman",
    support: "Support"
  };
  return map[value] ?? value;
}

export function laneLabel(value: string) {
  const map: Record<string, string> = {
    gold: "Gold Lane",
    exp: "Exp Lane",
    mid: "Mid Lane",
    roam: "Roam",
    jungle: "Jungle"
  };
  return map[value] ?? value;
}

export interface HeroLite {
  mlid: number;
  name: string;
  rolePrimary: string;
  roleSecondary?: string | null;
  lanes: string[];
  specialities?: string[];
  imageKey?: string;
}

function normalizeRole(input: string): string | null {
  const value = input.toLowerCase().trim();
  if (value.includes("marksman")) return "marksman";
  if (value.includes("assassin")) return "assassin";
  if (value.includes("fighter")) return "fighter";
  if (value.includes("support")) return "support";
  if (value.includes("tank")) return "tank";
  if (value.includes("mage")) return "mage";
  return null;
}

export function heroRoles(hero: HeroLite): string[] {
  const raw = [hero.rolePrimary, hero.roleSecondary ?? ""]
    .flatMap((value) => value.split(/[,&/|]+/g))
    .map((value) => normalizeRole(value))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(raw));
}

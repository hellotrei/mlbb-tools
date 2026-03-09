import type { Lane } from "./types.js";

export type DraftLane = Lane;

export const DRAFT_LANES: DraftLane[] = ["exp", "jungle", "mid", "gold", "roam"];

export interface HeroRolePoolEntry {
  mlid: number;
  lanes: DraftLane[];
}

export interface DraftFeasibilityResult {
  isFeasible: boolean;
  matchedCount: number;
  assignment: Partial<Record<DraftLane, number>>;
  heroToLane: Record<number, DraftLane>;
  missingRoles: DraftLane[];
  unassignedHeroes: number[];
  heroOptions: Record<number, DraftLane[]>;
}

function uniqueMlids(mlids: number[]) {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const mlid of mlids) {
    if (!Number.isInteger(mlid) || mlid <= 0 || seen.has(mlid)) continue;
    out.push(mlid);
    seen.add(mlid);
  }
  return out;
}

function normalizeLanes(lanes: string[]) {
  return Array.from(new Set(lanes.filter((lane): lane is DraftLane => DRAFT_LANES.includes(lane as DraftLane))));
}

export function buildRolePoolMap(entries: HeroRolePoolEntry[]) {
  const pool = new Map<number, DraftLane[]>();
  for (const entry of entries) {
    const mlid = Number(entry.mlid);
    if (!Number.isInteger(mlid) || mlid <= 0) continue;
    const lanes = normalizeLanes(entry.lanes ?? []);
    if (lanes.length === 0) continue;
    pool.set(mlid, lanes);
  }
  return pool;
}

export function evaluateDraftFeasibility(heroMlids: number[], rolePool: Map<number, DraftLane[]>) {
  const heroes = uniqueMlids(heroMlids);
  const heroOptions = new Map<number, DraftLane[]>();

  for (const mlid of heroes) {
    const lanes = normalizeLanes(rolePool.get(mlid) ?? []);
    heroOptions.set(mlid, lanes);
  }

  const orderedHeroes = heroes
    .slice()
    .sort((a, b) => (heroOptions.get(a)?.length ?? 0) - (heroOptions.get(b)?.length ?? 0));

  const laneToHero = new Map<DraftLane, number>();

  const visitHero = (hero: number, visited: Set<DraftLane>): boolean => {
    const options = heroOptions.get(hero) ?? [];
    for (const lane of options) {
      if (visited.has(lane)) continue;
      visited.add(lane);

      const currentHero = laneToHero.get(lane);
      if (!currentHero || visitHero(currentHero, visited)) {
        laneToHero.set(lane, hero);
        return true;
      }
    }
    return false;
  };

  let matchedCount = 0;
  for (const hero of orderedHeroes) {
    if (visitHero(hero, new Set<DraftLane>())) {
      matchedCount += 1;
    }
  }

  const assignment: Partial<Record<DraftLane, number>> = {};
  const heroToLane: Record<number, DraftLane> = {};

  for (const lane of DRAFT_LANES) {
    const hero = laneToHero.get(lane);
    if (!hero) continue;
    assignment[lane] = hero;
    heroToLane[hero] = lane;
  }

  const missingRoles = DRAFT_LANES.filter((lane) => !assignment[lane]);
  const unassignedHeroes = heroes.filter((hero) => !heroToLane[hero]);
  const optionsObject = Object.fromEntries(
    heroes.map((hero) => [hero, (heroOptions.get(hero) ?? []).slice()])
  ) as Record<number, DraftLane[]>;

  return {
    isFeasible: matchedCount === heroes.length && heroes.length <= DRAFT_LANES.length,
    matchedCount,
    assignment,
    heroToLane,
    missingRoles,
    unassignedHeroes,
    heroOptions: optionsObject
  } satisfies DraftFeasibilityResult;
}

import { and, eq } from "drizzle-orm";
import { db, heroes, heroStatsLatest, tierResults } from "@mlbb/db";
import { computeTierResults, type HeroStatRow, type Lane, type Role, type Timeframe } from "@mlbb/shared";
import { LANES, ROLES, TIMEFRAMES } from "../constants.js";

interface HeroContext {
  mlid: number;
  rolePrimary: string;
  roleSecondary: string | null;
  lanes: string[];
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function computeForSegment(
  stats: HeroStatRow[],
  heroById: Map<number, HeroContext>,
  role?: Role,
  lane?: Lane
) {
  const filtered = stats.filter((row) => {
    const hero = heroById.get(row.mlid);
    if (!hero) return false;
    if (role && hero.rolePrimary !== role && hero.roleSecondary !== role) return false;
    if (lane && !hero.lanes.includes(lane)) return false;
    return true;
  });

  const scored = computeTierResults(
    filtered.map((row) => ({
      mlid: row.mlid,
      winRate: row.winRate,
      pickRate: row.pickRate,
      banRate: row.banRate
    }))
  );

  return scored;
}

export async function runComputeTier(timeframe?: Timeframe) {
  const frames = timeframe ? [timeframe] : TIMEFRAMES;

  const heroRows = await db
    .select({
      mlid: heroes.mlid,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes
    })
    .from(heroes);

  const heroById = new Map<number, HeroContext>(
    heroRows.map((hero) => [
      hero.mlid,
      {
        mlid: hero.mlid,
        rolePrimary: hero.rolePrimary,
        roleSecondary: hero.roleSecondary,
        lanes: hero.lanes as string[]
      }
    ])
  );

  for (const frame of frames) {
    const statRows = await db
      .select({
        mlid: heroStatsLatest.mlid,
        timeframe: heroStatsLatest.timeframe,
        winRate: heroStatsLatest.winRate,
        pickRate: heroStatsLatest.pickRate,
        banRate: heroStatsLatest.banRate,
        appearance: heroStatsLatest.appearance
      })
      .from(heroStatsLatest)
      .where(eq(heroStatsLatest.timeframe, frame));

    const stats: HeroStatRow[] = statRows.map((row) => ({
      mlid: row.mlid,
      timeframe: row.timeframe as Timeframe,
      winRate: asNumber(row.winRate),
      pickRate: asNumber(row.pickRate),
      banRate: asNumber(row.banRate),
      appearance: row.appearance ?? undefined
    }));

    const writeSegment = async (segment: string, rows: ReturnType<typeof computeTierResults>) => {
      await db
        .delete(tierResults)
        .where(and(eq(tierResults.timeframe, frame), eq(tierResults.segment, segment)));
      await db
        .insert(tierResults)
        .values({
          timeframe: frame,
          segment,
          computedAt: new Date(),
          rows: rows as unknown as Array<Record<string, unknown>>
        });
    };

    await writeSegment("all", computeForSegment(stats, heroById));

    for (const role of ROLES) {
      await writeSegment(`role:${role}`, computeForSegment(stats, heroById, role));
    }

    for (const lane of LANES) {
      await writeSegment(`lane:${lane}`, computeForSegment(stats, heroById, undefined, lane));
    }

    for (const role of ROLES) {
      for (const lane of LANES) {
        await writeSegment(`role:${role}|lane:${lane}`, computeForSegment(stats, heroById, role, lane));
      }
    }
  }
}

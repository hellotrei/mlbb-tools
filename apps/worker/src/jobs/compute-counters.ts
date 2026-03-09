import { and, eq, sql } from "drizzle-orm";
import { db, counterMatrix, heroes, tierResults } from "@mlbb/db";
import { computeEnhancedCounterScore, type TierResultRow, type Timeframe } from "@mlbb/shared";
import { TIMEFRAMES } from "../constants.js";
import { type HeroMetaLike, loadHeroMetaFile } from "../services/meta.js";

interface HeroLite {
  mlid: number;
  rolePrimary: string;
  roleSecondary: string | null;
  lanes: string[];
}

function roleCompatibility(enemy: HeroLite, candidate: HeroLite): number {
  if (enemy.rolePrimary === candidate.rolePrimary) return 0.4;
  if (enemy.rolePrimary === candidate.roleSecondary) return 0.5;
  return 0.8;
}

function laneCompatibility(enemy: HeroLite, candidate: HeroLite): number {
  const overlap = enemy.lanes.some((lane) => candidate.lanes.includes(lane));
  return overlap ? 0.45 : 0.78;
}

function parseCounterIds(counters: HeroMetaLike["counters"]): number[] {
  if (!Array.isArray(counters)) return [];

  return counters
    .map((item) => {
      if (typeof item === "number") return item;
      if (item && typeof item === "object" && "heroid" in item) return Number(item.heroid);
      return NaN;
    })
    .filter((item) => Number.isFinite(item) && item > 0);
}

export async function runComputeCounters(timeframe?: Timeframe) {
  const frames = timeframe ? [timeframe] : TIMEFRAMES;
  const heroRows = await db
    .select({
      mlid: heroes.mlid,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes
    })
    .from(heroes);

  const heroById = new Map<number, HeroLite>(
    heroRows.map((row) => [
      row.mlid,
      {
        mlid: row.mlid,
        rolePrimary: row.rolePrimary,
        roleSecondary: row.roleSecondary,
        lanes: row.lanes as string[]
      }
    ])
  );

  const meta = await loadHeroMetaFile();
  const metaCounterById = new Map<number, number[]>();
  for (const item of meta) {
    const mlid = Number(item.mlid ?? item.id);
    if (!mlid) continue;
    const counters = parseCounterIds(item.counters);
    if (counters.length === 0) continue;
    metaCounterById.set(mlid, counters);
  }

  for (const frame of frames) {
    const [latestTierRow] = await db
      .select({ rows: tierResults.rows })
      .from(tierResults)
      .where(and(eq(tierResults.timeframe, frame), eq(tierResults.segment, "all")))
      .orderBy(sql`${tierResults.computedAt} DESC`)
      .limit(1);

    const tierRows = (latestTierRow?.rows ?? []) as unknown as TierResultRow[];
    const tierScoreMap = new Map<number, number>(tierRows.map((row) => [row.mlid, row.score]));

    for (const enemy of heroRows) {
      const enemyHero = heroById.get(enemy.mlid);
      if (!enemyHero) continue;

      const preferred = metaCounterById.get(enemy.mlid) ?? [];
      const candidates = heroRows
        .filter((candidate) => candidate.mlid !== enemy.mlid)
        .map((candidate) => {
          const candidateHero = heroById.get(candidate.mlid);
          if (!candidateHero) return null;

          const tierScore = tierScoreMap.get(candidate.mlid) ?? 0;
          const metaIndex = preferred.indexOf(candidate.mlid);
          const isMetaCounter = metaIndex >= 0;
          const bonusBase =
            (roleCompatibility(enemyHero, candidateHero) + laneCompatibility(enemyHero, candidateHero)) / 2;
          const score = computeEnhancedCounterScore(
            tierScore,
            bonusBase,
            isMetaCounter,
            metaIndex,
            preferred.length
          );

          return {
            timeframe: frame,
            enemyMlid: enemy.mlid,
            counterMlid: candidate.mlid,
            score: String(score),
            updatedAt: new Date()
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .sort((a, b) => Number(b.score) - Number(a.score))
        .slice(0, 40);

      if (candidates.length > 0) {
        await db
          .insert(counterMatrix)
          .values(candidates)
          .onConflictDoUpdate({
            target: [counterMatrix.timeframe, counterMatrix.enemyMlid, counterMatrix.counterMlid],
            set: {
              score: sql`excluded.score`,
              updatedAt: new Date()
            }
          });
      }
    }
  }
}

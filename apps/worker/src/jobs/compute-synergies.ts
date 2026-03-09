import { and, eq, sql } from "drizzle-orm";
import { db, synergyMatrix, heroes, tierResults } from "@mlbb/db";
import { computeSynergyScore, type TierResultRow, type Timeframe } from "@mlbb/shared";
import { TIMEFRAMES } from "../constants.js";
import { type HeroMetaLike, loadHeroMetaFile } from "../services/meta.js";

interface HeroLite {
  mlid: number;
  rolePrimary: string;
  roleSecondary: string | null;
  specialities: string[];
}

const COMPLEMENTARY_ROLES: Record<string, string[]> = {
  tank: ["marksman", "mage"],
  support: ["marksman", "assassin"],
  fighter: ["mage", "support"],
  assassin: ["tank", "support"],
  mage: ["tank", "fighter"],
  marksman: ["tank", "support"]
};

function tagSynergyBonus(heroA: HeroLite, heroB: HeroLite): number {
  const comps = COMPLEMENTARY_ROLES[heroA.rolePrimary] ?? [];
  const roleBonus = comps.includes(heroB.rolePrimary) ? 0.15 : 0;

  const sharedCount = heroA.specialities.filter((s) => heroB.specialities.includes(s)).length;
  const tagBonus = sharedCount * 0.05;

  return Math.min(0.3, roleBonus + tagBonus);
}

function parseSynergyIds(synergies: HeroMetaLike["synergies"]): number[] {
  if (!Array.isArray(synergies)) return [];

  return synergies
    .map((item) => {
      if (typeof item === "number") return item;
      if (item && typeof item === "object" && "heroid" in item) return Number(item.heroid);
      return NaN;
    })
    .filter((item) => Number.isFinite(item) && item > 0);
}

export async function runComputeSynergies(timeframe?: Timeframe) {
  const frames = timeframe ? [timeframe] : TIMEFRAMES;
  const heroRows = await db
    .select({
      mlid: heroes.mlid,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      specialities: heroes.specialities
    })
    .from(heroes);

  const heroById = new Map<number, HeroLite>(
    heroRows.map((row) => [
      row.mlid,
      {
        mlid: row.mlid,
        rolePrimary: row.rolePrimary,
        roleSecondary: row.roleSecondary,
        specialities: (row.specialities as string[]) ?? []
      }
    ])
  );

  const meta = await loadHeroMetaFile();
  const metaSynergyById = new Map<number, number[]>();
  for (const item of meta) {
    const mlid = Number(item.mlid ?? item.id);
    if (!mlid) continue;
    const synergies = parseSynergyIds(item.synergies);
    if (synergies.length === 0) continue;
    metaSynergyById.set(mlid, synergies);
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

    for (const hero of heroRows) {
      const heroInfo = heroById.get(hero.mlid);
      if (!heroInfo) continue;

      const preferred = metaSynergyById.get(hero.mlid) ?? [];
      const candidates = heroRows
        .filter((candidate) => candidate.mlid !== hero.mlid)
        .map((candidate) => {
          const candidateInfo = heroById.get(candidate.mlid);
          if (!candidateInfo) return null;

          const tierScore = tierScoreMap.get(candidate.mlid) ?? 0;
          const metaIndex = preferred.indexOf(candidate.mlid);
          const isMetaSynergy = metaIndex >= 0;

          let score: number;
          if (isMetaSynergy) {
            score = computeSynergyScore(tierScore, true, metaIndex, preferred.length);
          } else {
            const bonus = tagSynergyBonus(heroInfo, candidateInfo);
            score = bonus > 0
              ? Number((0.6 * tierScore + 0.4 * bonus).toFixed(4))
              : computeSynergyScore(tierScore, false, 0, 0);
          }

          return {
            timeframe: frame,
            heroMlid: hero.mlid,
            synergyMlid: candidate.mlid,
            score: String(score),
            source: isMetaSynergy ? "meta" : "derived",
            updatedAt: new Date()
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .sort((a, b) => Number(b.score) - Number(a.score))
        .slice(0, 30);

      for (const row of candidates) {
        await db
          .insert(synergyMatrix)
          .values(row)
          .onConflictDoUpdate({
            target: [synergyMatrix.timeframe, synergyMatrix.heroMlid, synergyMatrix.synergyMlid],
            set: {
              score: row.score,
              source: row.source,
              updatedAt: new Date()
            }
          });
      }
    }
  }
}

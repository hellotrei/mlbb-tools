import { and, eq, notInArray } from "drizzle-orm";
import { db, heroes, heroRolePool } from "@mlbb/db";

type DraftLane = "exp" | "jungle" | "mid" | "gold" | "roam";
type HeroRole = "tank" | "fighter" | "assassin" | "mage" | "marksman" | "support";

const KNOWN_LANES = new Set<DraftLane>(["exp", "jungle", "mid", "gold", "roam"]);

const ROLE_TO_LANES: Record<HeroRole, DraftLane[]> = {
  tank: ["exp", "roam"],
  fighter: ["exp", "gold"],
  assassin: ["jungle", "mid"],
  mage: ["mid", "gold"],
  marksman: ["gold", "jungle"],
  support: ["roam", "mid"]
};

// Manual override for known flex heroes where comp strategy often depends on lane swap.
const FLEX_OVERRIDES_BY_SLUG: Record<string, DraftLane[]> = {
  sora: ["exp", "gold"],
  "x-borg": ["exp", "gold"],
  xborg: ["exp", "gold"],
  fredrinn: ["jungle", "exp"],
  joy: ["jungle", "exp"],
  kimmy: ["gold", "mid", "jungle"],
  harith: ["mid", "gold"]
};

function normalizeLane(value: string): DraftLane | null {
  const lane = value.toLowerCase().trim();
  if (lane.includes("exp")) return "exp";
  if (lane.includes("jung")) return "jungle";
  if (lane.includes("mid")) return "mid";
  if (lane.includes("gold")) return "gold";
  if (lane.includes("roam")) return "roam";
  return null;
}

function toRole(value: string | null | undefined): HeroRole | null {
  const role = String(value ?? "").toLowerCase().trim();
  if (role === "tank") return "tank";
  if (role === "fighter") return "fighter";
  if (role === "assassin") return "assassin";
  if (role === "mage") return "mage";
  if (role === "marksman") return "marksman";
  if (role === "support") return "support";
  return null;
}

function buildLaneScores(hero: {
  slug: string;
  lanes: string[];
  rolePrimary: string;
  roleSecondary: string | null;
}) {
  const scores = new Map<DraftLane, { confidence: number; source: string }>();

  const pushLane = (lane: DraftLane | null, confidence: number, source: string) => {
    if (!lane || !KNOWN_LANES.has(lane)) return;
    const prev = scores.get(lane);
    if (!prev || confidence > prev.confidence) {
      scores.set(lane, { confidence, source });
    }
  };

  for (const laneRaw of hero.lanes ?? []) {
    pushLane(normalizeLane(String(laneRaw)), 0.95, "meta");
  }

  const primary = toRole(hero.rolePrimary);
  const secondary = toRole(hero.roleSecondary);

  if (primary) {
    for (const lane of ROLE_TO_LANES[primary]) {
      pushLane(lane, 0.8, "role_primary");
    }
  }

  if (secondary) {
    for (const lane of ROLE_TO_LANES[secondary]) {
      pushLane(lane, 0.65, "role_secondary");
    }
  }

  const overrides = FLEX_OVERRIDES_BY_SLUG[hero.slug] ?? [];
  for (const lane of overrides) {
    pushLane(lane, 0.98, "override");
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1].confidence - a[1].confidence)
    .map(([lane, meta]) => ({ lane, ...meta }));
}

export async function syncHeroRolePool() {
  const heroRows = await db
    .select({
      mlid: heroes.mlid,
      slug: heroes.slug,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes
    })
    .from(heroes);

  for (const hero of heroRows) {
    const lanes = buildLaneScores({
      slug: hero.slug,
      lanes: (hero.lanes ?? []) as string[],
      rolePrimary: hero.rolePrimary,
      roleSecondary: hero.roleSecondary
    });

    if (lanes.length === 0) {
      await db.delete(heroRolePool).where(eq(heroRolePool.mlid, hero.mlid));
      continue;
    }

    for (const lane of lanes) {
      await db
        .insert(heroRolePool)
        .values({
          mlid: hero.mlid,
          lane: lane.lane,
          confidence: lane.confidence.toFixed(3),
          source: lane.source
        })
        .onConflictDoUpdate({
          target: [heroRolePool.mlid, heroRolePool.lane],
          set: {
            confidence: lane.confidence.toFixed(3),
            source: lane.source,
            updatedAt: new Date()
          }
        });
    }

    await db
      .delete(heroRolePool)
      .where(
        and(
          eq(heroRolePool.mlid, hero.mlid),
          notInArray(
            heroRolePool.lane,
            lanes.map((lane) => lane.lane)
          )
        )
      );
  }

}

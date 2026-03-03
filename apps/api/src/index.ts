import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  buildRolePoolMap,
  computeTierResults,
  evaluateDraftFeasibility,
  phaseWeights,
  detectArchetypes,
  archetypeBoost,
  type CountersBody,
  type DraftAnalyzeBody,
  type HeroRolePoolEntry,
  type StatsQuery,
  type TierQuery,
  countersBodySchema,
  draftAnalyzeBodySchema,
  statsQuerySchema,
  tierQuerySchema,
  type Tier,
  type TierResultRow
} from "@mlbb/shared";
import {
  db,
  heroes,
  heroRolePool,
  heroStatsLatest,
  heroStatsSnapshots,
  tierResults,
  counterMatrix,
  counterPickHistory,
  synergyMatrix
} from "@mlbb/db";
import { cacheGet, cacheSet } from "./lib/cache";
import { stableHash } from "./lib/hash";
import { fetchCommunityCounterScores } from "./lib/supabase-counters";

const COUNTER_W = 0.55;
const COMMUNITY_W = 0.25;
const TIER_W = 0.20;
const COVERAGE_MULT_MIN = 0.85;
const ROLE_CAP = 3;

const COUNTER_TIER_WEIGHTS: Record<string, number> = {
  "S+": 1.0,
  SS: 1.0,
  S: 0.83,
  "A+": 0.67,
  A: 0.5,
  "B+": 0.33,
  B: 0.17
};
function counterTierNorm(tier: string | undefined): number {
  return tier ? (COUNTER_TIER_WEIGHTS[tier] ?? 0) : 0;
}

loadEnv({ path: resolve(process.cwd(), "../../.env") });

const port = Number(process.env.API_PORT ?? 8787);
const app = new Hono();
type SqlCondition = ReturnType<typeof sql>;

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  })
);

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function buildSegment(role?: string, lane?: string) {
  if (role && lane) return `role:${role}|lane:${lane}`;
  if (role) return `role:${role}`;
  if (lane) return `lane:${lane}`;
  return "all";
}

function emptyTierBuckets(): Record<Tier, TierResultRow[]> {
  return {
    SS: [],
    S: [],
    A: [],
    B: [],
    C: [],
    D: []
  };
}

function groupTierRows(rows: TierResultRow[]): Record<Tier, TierResultRow[]> {
  const grouped = emptyTierBuckets();
  for (const tierRow of rows) {
    const bucket = grouped[tierRow.tier as Tier];
    if (bucket) bucket.push(tierRow);
  }
  return grouped;
}

async function computeTierByRankScope(query: TierQuery & { rankScope: string }) {
  const [snapshot] = await db
    .select({
      fetchedAt: heroStatsSnapshots.fetchedAt,
      data: heroStatsSnapshots.data
    })
    .from(heroStatsSnapshots)
    .where(and(eq(heroStatsSnapshots.timeframe, query.timeframe), eq(heroStatsSnapshots.rankScope, query.rankScope)))
    .orderBy(desc(heroStatsSnapshots.fetchedAt))
    .limit(1);

  if (!snapshot) {
    return { computedAt: null, rows: [] as TierResultRow[] };
  }

  const heroRows = await db
    .select({
      mlid: heroes.mlid,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes
    })
    .from(heroes);

  const heroById = new Map(
    heroRows.map((hero) => [
      hero.mlid,
      {
        rolePrimary: hero.rolePrimary,
        roleSecondary: hero.roleSecondary,
        lanes: hero.lanes as string[]
      }
    ])
  );

  const snapshotData = (snapshot.data ?? {}) as Record<
    string,
    { winRate?: unknown; pickRate?: unknown; banRate?: unknown }
  >;

  const scored = computeTierResults(
    Object.entries(snapshotData)
      .map(([mlidRaw, stat]) => {
        const mlid = Number(mlidRaw);
        const hero = heroById.get(mlid);
        if (!mlid || !hero) return null;

        if (
          query.role &&
          hero.rolePrimary !== query.role &&
          hero.roleSecondary !== query.role
        ) {
          return null;
        }

        if (query.lane && !hero.lanes.includes(query.lane)) {
          return null;
        }

        return {
          mlid,
          winRate: toNumber(stat.winRate),
          pickRate: toNumber(stat.pickRate),
          banRate: toNumber(stat.banRate)
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  );

  return { computedAt: snapshot.fetchedAt, rows: scored };
}

async function getTierMap(timeframe: string) {
  const tierRow = await db
    .select({ rows: tierResults.rows })
    .from(tierResults)
    .where(and(eq(tierResults.timeframe, timeframe), eq(tierResults.segment, "all")))
    .orderBy(desc(tierResults.computedAt))
    .limit(1);

  const map = new Map<number, Tier>();
  for (const row of ((tierRow[0]?.rows ?? []) as unknown as TierResultRow[])) {
    map.set(row.mlid, row.tier);
  }
  return map;
}

async function getTierMapForScope(timeframe: CountersBody["timeframe"], rankScope: CountersBody["rankScope"]) {
  const scoped = await computeTierByRankScope({ timeframe, rankScope });
  if (scoped.rows.length === 0) {
    return getTierMap(timeframe);
  }

  const map = new Map<number, Tier>();
  for (const row of scoped.rows) {
    map.set(row.mlid, row.tier as Tier);
  }
  return map;
}

async function loadRolePoolMapForMlids(mlids: number[]) {
  const uniqueMlids = Array.from(new Set(mlids.filter((mlid) => Number.isInteger(mlid) && mlid > 0)));
  if (uniqueMlids.length === 0) {
    return buildRolePoolMap([]);
  }

  const roleRows = await db
    .select({
      mlid: heroRolePool.mlid,
      lane: heroRolePool.lane,
      confidence: heroRolePool.confidence
    })
    .from(heroRolePool)
    .where(inArray(heroRolePool.mlid, uniqueMlids))
    .orderBy(desc(heroRolePool.confidence));

  const byHero = new Map<number, string[]>();
  for (const row of roleRows) {
    const list = byHero.get(row.mlid) ?? [];
    if (!list.includes(row.lane)) list.push(row.lane);
    byHero.set(row.mlid, list);
  }

  const missingMlids = uniqueMlids.filter((mlid) => !byHero.has(mlid));
  if (missingMlids.length > 0) {
    const fallbackRows = await db
      .select({ mlid: heroes.mlid, lanes: heroes.lanes })
      .from(heroes)
      .where(inArray(heroes.mlid, missingMlids));

    for (const row of fallbackRows) {
      byHero.set(
        row.mlid,
        Array.from(new Set(((row.lanes ?? []) as string[]).filter(Boolean)))
      );
    }
  }

  const entries: HeroRolePoolEntry[] = uniqueMlids.map((mlid) => ({
    mlid,
    lanes: (byHero.get(mlid) ?? []) as HeroRolePoolEntry["lanes"]
  }));

  return buildRolePoolMap(entries);
}

type DraftTurnType = "pick" | "ban";
type DraftTurnSide = "ally" | "enemy";

function safeArrayLiteral(values: number[]) {
  const normalized = values.filter((value) => Number.isInteger(value) && value > 0);
  return normalized.length > 0 ? `ARRAY[${normalized.join(",")}]` : "ARRAY[0]";
}

function asTurnSide(value: string | undefined): DraftTurnSide {
  return value === "enemy" ? "enemy" : "ally";
}

function asTurnType(value: string | undefined): DraftTurnType {
  return value === "ban" ? "ban" : "pick";
}

function tierNumeric(tier: Tier | undefined) {
  if (tier === "SS") return 100;
  if (tier === "S") return 85;
  if (tier === "A") return 70;
  if (tier === "B") return 55;
  if (tier === "C") return 40;
  if (tier === "D") return 25;
  return 25;
}

function normalizeTierRows(rows: unknown) {
  return (rows as TierResultRow[]).map((row) => ({
    mlid: row.mlid,
    tier: row.tier as Tier,
    score: toNumber(row.score)
  }));
}

function normalizeRate(value: unknown) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  if (numeric > 1.5) return Math.max(0, Math.min(1, numeric / 100));
  return Math.max(0, Math.min(1, numeric));
}

function rate100(value: number | undefined) {
  return Number((Math.max(0, Math.min(1, value ?? 0)) * 100).toFixed(4));
}

function timeframeDays(timeframe: string) {
  if (timeframe === "1d") return 1;
  if (timeframe === "3d") return 3;
  if (timeframe === "7d") return 7;
  if (timeframe === "14d") return 14;
  if (timeframe === "30d") return 30;
  return 7;
}

function inferDraftTurn(body: DraftAnalyzeBody, turnType: DraftTurnType, turnSide: DraftTurnSide): number {
  const allyBans = body.allyBans.length;
  const enemyBans = body.enemyBans.length;
  const allyPicks = body.allyMlids.length;
  const enemyPicks = body.enemyMlids.length;

  if (turnType === "ban" && turnSide === "ally" && allyBans < 3 && enemyBans === 0) return 1;
  if (turnType === "ban" && turnSide === "enemy" && allyBans >= 3 && enemyBans < 3) return 2;
  if (turnType === "ban" && turnSide === "ally" && allyBans >= 3 && enemyBans >= 3 && allyBans < 5) return 3;
  if (turnType === "ban" && turnSide === "enemy" && allyBans >= 5 && enemyBans >= 3 && enemyBans < 5) return 4;
  if (turnType === "pick" && turnSide === "ally" && allyPicks === 0 && enemyPicks === 0) return 5;
  if (turnType === "pick" && turnSide === "enemy" && allyPicks === 1 && enemyPicks === 0) return 6;
  if (turnType === "pick" && turnSide === "ally" && allyPicks === 1 && enemyPicks === 2) return 7;
  if (turnType === "pick" && turnSide === "enemy" && allyPicks === 3 && enemyPicks === 2) return 8;
  if (turnType === "pick" && turnSide === "ally" && allyPicks === 3 && enemyPicks === 4) return 9;
  if (turnType === "pick" && turnSide === "enemy" && allyPicks === 5 && enemyPicks === 4) return 10;
  return turnType === "ban" ? 1 : 5;
}

async function loadRankStatsMap(timeframe: string, rankScope: string) {
  const [snapshot] = await db
    .select({ data: heroStatsSnapshots.data })
    .from(heroStatsSnapshots)
    .where(and(eq(heroStatsSnapshots.timeframe, timeframe), eq(heroStatsSnapshots.rankScope, rankScope)))
    .orderBy(desc(heroStatsSnapshots.fetchedAt))
    .limit(1);

  const statsMap = new Map<number, { winRate: number; banRate: number; pickRate: number }>();
  if (!snapshot?.data) return statsMap;

  const raw = snapshot.data as Record<
    string,
    {
      winRate?: unknown;
      banRate?: unknown;
      pickRate?: unknown;
    }
  >;
  for (const [mlidRaw, stat] of Object.entries(raw)) {
    const mlid = Number(mlidRaw);
    if (!Number.isInteger(mlid) || mlid <= 0) continue;
    statsMap.set(mlid, {
      winRate: normalizeRate(stat?.winRate),
      banRate: normalizeRate(stat?.banRate),
      pickRate: normalizeRate(stat?.pickRate)
    });
  }

  return statsMap;
}

async function loadCounterPickUsageBoostMap(timeframe: string, rankScope: string) {
  try {
    const rows = await db.execute<{ mlid: number; usage_count: number }>(sql`
      SELECT
        (jsonb_array_elements_text(recommended_mlids))::int AS mlid,
        COUNT(*)::int AS usage_count
      FROM counter_pick_history
      WHERE timeframe = ${timeframe}
        AND rank_scope = ${rankScope}
        AND created_at >= NOW() - INTERVAL '21 days'
      GROUP BY mlid
      ORDER BY usage_count DESC
      LIMIT 240
    `);

    const counts = (rows.rows as Array<{ mlid: number; usage_count: number }>).map((row) => ({
      mlid: Number(row.mlid),
      count: Number(row.usage_count)
    }));
    const maxCount = counts.reduce((max, row) => Math.max(max, row.count), 0);

    const usageMap = new Map<number, number>();
    if (maxCount <= 0) return usageMap;

    for (const row of counts) {
      usageMap.set(row.mlid, Number((row.count / maxCount).toFixed(4)));
    }
    return usageMap;
  } catch {
    return new Map<number, number>();
  }
}

async function recordCounterPickHistory(body: CountersBody, recommendationMlids: number[]) {
  const enemyMlids = Array.from(
    new Set((body.enemyMlids ?? []).filter((mlid) => Number.isInteger(mlid) && mlid > 0))
  ).slice(0, 5);
  const recommendedMlids = Array.from(
    new Set(recommendationMlids.filter((mlid) => Number.isInteger(mlid) && mlid > 0))
  ).slice(0, 16);
  if (enemyMlids.length === 0 || recommendedMlids.length === 0) return;

  try {
    await db.insert(counterPickHistory).values({
      timeframe: body.timeframe,
      rankScope: body.rankScope,
      enemyMlids,
      recommendedMlids
    });
  } catch {}
}

app.get("/health", (c) => c.json({ ok: true, service: "api" }));

app.get("/meta/last-updated", zValidator("query", tierQuerySchema.pick({ timeframe: true })), async (c) => {
  const { timeframe } = c.req.valid("query");

  const [statsFetched] = await db
    .select({ value: sql<string | null>`MAX(${heroStatsSnapshots.fetchedAt})` })
    .from(heroStatsSnapshots)
    .where(eq(heroStatsSnapshots.timeframe, timeframe));

  const [tierComputed] = await db
    .select({ value: sql<string | null>`MAX(${tierResults.computedAt})` })
    .from(tierResults)
    .where(eq(tierResults.timeframe, timeframe));

  const [countersComputed] = await db
    .select({ value: sql<string | null>`MAX(${counterMatrix.updatedAt})` })
    .from(counterMatrix)
    .where(eq(counterMatrix.timeframe, timeframe));

  return c.json({
    timeframe,
    statsFetchedAt: statsFetched?.value ?? null,
    tierComputedAt: tierComputed?.value ?? null,
    countersComputedAt: countersComputed?.value ?? null
  });
});

app.get("/draft/meta-snapshot", async (c) => {
  const rankScope = c.req.query("rank") ?? c.req.query("rankScope") ?? "mythic_glory";
  const timeframe = c.req.query("timeframe") ?? "7d";
  const days = timeframeDays(timeframe);

  const [scopedSnapshot] = await db
    .select({
      fetchedAt: heroStatsSnapshots.fetchedAt,
      data: heroStatsSnapshots.data
    })
    .from(heroStatsSnapshots)
    .where(and(eq(heroStatsSnapshots.timeframe, timeframe), eq(heroStatsSnapshots.rankScope, rankScope)))
    .orderBy(desc(heroStatsSnapshots.fetchedAt))
    .limit(1);

  const [fallbackSnapshot] =
    scopedSnapshot
      ? [scopedSnapshot]
      : await db
          .select({
            fetchedAt: heroStatsSnapshots.fetchedAt,
            data: heroStatsSnapshots.data
          })
          .from(heroStatsSnapshots)
          .where(eq(heroStatsSnapshots.timeframe, timeframe))
          .orderBy(desc(heroStatsSnapshots.fetchedAt))
          .limit(1);

  const snapshotData = (fallbackSnapshot?.data ?? {}) as Record<
    string,
    { winRate?: unknown; pickRate?: unknown; banRate?: unknown }
  >;

  const [heroRows, rolePoolRows, latestRows] = await Promise.all([
    db
      .select({
        mlid: heroes.mlid,
        name: heroes.name,
        lanes: heroes.lanes
      })
      .from(heroes)
      .orderBy(asc(heroes.name)),
    db
      .select({
        mlid: heroRolePool.mlid,
        lane: heroRolePool.lane
      })
      .from(heroRolePool),
    db
      .select({
        mlid: heroStatsLatest.mlid,
        winRate: heroStatsLatest.winRate,
        pickRate: heroStatsLatest.pickRate,
        banRate: heroStatsLatest.banRate
      })
      .from(heroStatsLatest)
      .where(eq(heroStatsLatest.timeframe, timeframe))
  ]);

  const latestStats = new Map(
    latestRows.map((row) => [
      row.mlid,
      {
        winRate: normalizeRate(row.winRate),
        pickRate: normalizeRate(row.pickRate),
        banRate: normalizeRate(row.banRate)
      }
    ])
  );

  const laneByHero = new Map<number, string[]>();
  for (const row of rolePoolRows) {
    if (!row.lane) continue;
    const list = laneByHero.get(row.mlid) ?? [];
    if (!list.includes(row.lane)) list.push(row.lane);
    laneByHero.set(row.mlid, list);
  }

  const laneBuckets: Record<string, Array<Record<string, unknown>>> = {
    exp: [],
    jungle: [],
    mid: [],
    gold: [],
    roam: []
  };

  for (const hero of heroRows) {
    const statFromSnapshot = snapshotData[String(hero.mlid)];
    const statFromLatest = latestStats.get(hero.mlid);
    const winRate = normalizeRate(statFromSnapshot?.winRate ?? statFromLatest?.winRate ?? 0);
    const pickRate = normalizeRate(statFromSnapshot?.pickRate ?? statFromLatest?.pickRate ?? 0);
    const banRate = normalizeRate(statFromSnapshot?.banRate ?? statFromLatest?.banRate ?? 0);
    const laneScore = rate100(winRate * 0.58 + pickRate * 0.32 + banRate * 0.1);
    const lanes = laneByHero.get(hero.mlid) ?? ((hero.lanes ?? []) as string[]);
    const uniqueLanes = Array.from(new Set(lanes)).filter((lane) => lane in laneBuckets);
    if (uniqueLanes.length === 0) continue;

    for (const lane of uniqueLanes) {
      laneBuckets[lane]?.push({
        hero_id: hero.mlid,
        hero_name: hero.name,
        lane_score: laneScore,
        stats: {
          win_rate: winRate,
          pick_rate: pickRate,
          ban_rate: banRate,
          avg_kda: 0,
          games_played: 0
        },
        trend: "stable",
        trend_delta: 0,
        highly_contested: banRate >= 0.35
      });
    }
  }

  const lanes = Object.fromEntries(
    Object.entries(laneBuckets).map(([lane, rows]) => [
      lane,
      rows
        .sort((a, b) => toNumber(b.lane_score) - toNumber(a.lane_score))
        .slice(0, 12)
        .map((row, index) => ({ rank: index + 1, ...row }))
    ])
  );

  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return c.json({
    meta_snapshot: {
      patch: "Live",
      period: {
        start: start.toISOString().slice(0, 10),
        end: now.toISOString().slice(0, 10),
        days
      },
      generated_at: now.toISOString(),
      rank_tier: rankScope,
      lanes
    }
  });
});

app.get("/heroes", async (c) => {
  const role = c.req.query("role");
  const lane = c.req.query("lane");
  const search = c.req.query("search");

  const conditions: SqlCondition[] = [];
  if (role) {
    conditions.push(sql`${heroes.rolePrimary} = ${role} OR ${heroes.roleSecondary} = ${role}`);
  }
  if (lane) {
    conditions.push(sql`${heroes.lanes} ? ${lane}`);
  }
  if (search) {
    conditions.push(sql`(${heroes.name} ILIKE ${`%${search}%`} OR ${heroes.slug} ILIKE ${`%${search}%`})`);
  }

  const items = await db
    .select({
      mlid: heroes.mlid,
      name: heroes.name,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes,
      specialities: heroes.specialities,
      slug: heroes.slug,
      imageKey: heroes.imageKey
    })
    .from(heroes)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(heroes.name));

  return c.json({ items, total: items.length });
});

app.get("/heroes/:mlid", async (c) => {
  const mlid = Number(c.req.param("mlid"));
  const [hero] = await db
    .select({
      mlid: heroes.mlid,
      name: heroes.name,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes,
      specialities: heroes.specialities,
      slug: heroes.slug,
      imageKey: heroes.imageKey
    })
    .from(heroes)
    .where(eq(heroes.mlid, mlid))
    .limit(1);

  if (!hero) {
    return c.json({ error: "Hero not found" }, 404);
  }

  return c.json(hero);
});

app.get("/stats", zValidator("query", statsQuerySchema), async (c) => {
  const query = c.req.valid("query") as StatsQuery;
  const cacheKey = `stats:${query.timeframe}:${stableHash(query)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached as Record<string, unknown>);

  const conditions: SqlCondition[] = [sql`${heroStatsLatest.timeframe} = ${query.timeframe}`];

  if (query.role) {
    conditions.push(sql`${heroes.rolePrimary} = ${query.role} OR ${heroes.roleSecondary} = ${query.role}`);
  }
  if (query.lane) {
    conditions.push(sql`${heroes.lanes} ? ${query.lane}`);
  }
  if (query.speciality) {
    conditions.push(sql`${heroes.specialities} ? ${query.speciality}`);
  }
  if (query.search) {
    conditions.push(sql`(${heroes.name} ILIKE ${`%${query.search}%`} OR ${heroes.slug} ILIKE ${`%${query.search}%`})`);
  }

  const sortField =
    query.sort === "pick_rate"
      ? heroStatsLatest.pickRate
      : query.sort === "ban_rate"
        ? heroStatsLatest.banRate
        : query.sort === "appearance"
          ? heroStatsLatest.appearance
          : heroStatsLatest.winRate;

  const offset = (query.page - 1) * query.limit;

  const items = await db
    .select({
      mlid: heroes.mlid,
      name: heroes.name,
      slug: heroes.slug,
      imageKey: heroes.imageKey,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes,
      specialities: heroes.specialities,
      winRate: heroStatsLatest.winRate,
      pickRate: heroStatsLatest.pickRate,
      banRate: heroStatsLatest.banRate,
      appearance: heroStatsLatest.appearance,
      timeframe: heroStatsLatest.timeframe,
      updatedAt: heroStatsLatest.updatedAt
    })
    .from(heroStatsLatest)
    .innerJoin(heroes, eq(heroes.mlid, heroStatsLatest.mlid))
    .where(and(...conditions))
    .orderBy(query.order === "asc" ? asc(sortField) : desc(sortField))
    .limit(query.limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(heroStatsLatest)
    .innerJoin(heroes, eq(heroes.mlid, heroStatsLatest.mlid))
    .where(and(...conditions));

  const [lastUpdatedRow] = await db
    .select({ value: sql<string | null>`MAX(${heroStatsLatest.updatedAt})` })
    .from(heroStatsLatest)
    .where(eq(heroStatsLatest.timeframe, query.timeframe));

  const response = {
    items: items.map((row: (typeof items)[number]) => ({
      ...row,
      winRate: toNumber(row.winRate),
      pickRate: toNumber(row.pickRate),
      banRate: toNumber(row.banRate)
    })),
    page: query.page,
    limit: query.limit,
    total: totalRow?.count ?? 0,
    lastUpdated: lastUpdatedRow?.value ?? null
  };

  await cacheSet(cacheKey, response, 90);
  return c.json(response);
});

app.get("/tier", zValidator("query", tierQuerySchema), async (c) => {
  const query = c.req.valid("query") as TierQuery;
  const segment = buildSegment(query.role, query.lane);
  const cacheKey = `tier:${query.timeframe}:${segment}:rank=${query.rankScope ?? "default"}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached as Record<string, unknown>);

  let computedAt: Date | string | null = null;
  let grouped = emptyTierBuckets();

  if (query.rankScope) {
    const dynamic = await computeTierByRankScope({ ...query, rankScope: query.rankScope });
    computedAt = dynamic.computedAt;
    grouped = groupTierRows(dynamic.rows);
  } else {
    const [row] = await db
      .select({
        computedAt: tierResults.computedAt,
        rows: tierResults.rows
      })
      .from(tierResults)
      .where(and(eq(tierResults.timeframe, query.timeframe), eq(tierResults.segment, segment)))
      .orderBy(desc(tierResults.computedAt))
      .limit(1);

    computedAt = row?.computedAt ?? null;
    grouped = groupTierRows((row?.rows ?? []) as unknown as TierResultRow[]);
  }

  const response = {
    timeframe: query.timeframe,
    segment,
    rankScope: query.rankScope ?? null,
    computedAt,
    tiers: grouped
  };

  await cacheSet(cacheKey, response, 120);
  return c.json(response);
});

app.post("/counters", zValidator("json", countersBodySchema), async (c) => {
  const body = c.req.valid("json") as CountersBody;
  const enemyHash = stableHash(body.enemyMlids.slice().sort((a, b) => a - b));
  const cacheKey = `counters:${body.timeframe}:rank=${body.rankScope}:prefRole=${body.preferredRole ?? "all"}:prefLane=${body.preferredLane ?? "all"}:${enemyHash}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    const cachedPayload = cached as { recommendations?: Array<{ mlid: number }> };
    void recordCounterPickHistory(
      body,
      (cachedPayload.recommendations ?? []).map((row) => Number(row.mlid))
    );
    return c.json(cachedPayload as Record<string, unknown>);
  }

  const results = await db.execute<{ mlid: number; score: number }>(sql`
    SELECT
      counter_mlid AS mlid,
      AVG(score)::float8 AS score
    FROM counter_matrix
    WHERE timeframe = ${body.timeframe}
      AND enemy_mlid = ANY(${sql.raw(`ARRAY[${body.enemyMlids.join(",")} ]`)})
    GROUP BY counter_mlid
    ORDER BY score DESC
    LIMIT 50
  `);
  const counterRows = results.rows as Array<{ mlid: number; score: number }>;

  const pairRowsResult = await db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
    SELECT counter_mlid, enemy_mlid, score::float8 AS score
    FROM counter_matrix
    WHERE timeframe = ${body.timeframe}
      AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(body.enemyMlids))})
    ORDER BY score DESC
    LIMIT 2500
  `);
  const pairRows = pairRowsResult.rows as Array<{ counter_mlid: number; enemy_mlid: number; score: number }>;

  const tierMap = await getTierMapForScope(body.timeframe, body.rankScope);
  const allMlids = Array.from(new Set([...counterRows.map((r) => r.mlid), ...body.enemyMlids]));
  const heroRows =
    allMlids.length === 0
      ? []
      : await db
          .select({
            mlid: heroes.mlid,
            name: heroes.name,
            rolePrimary: heroes.rolePrimary,
            roleSecondary: heroes.roleSecondary,
            lanes: heroes.lanes
          })
          .from(heroes)
          .where(inArray(heroes.mlid, allMlids));

  const heroById = new Map(
    heroRows.map((row) => [
      row.mlid,
      {
        name: row.name,
        rolePrimary: row.rolePrimary,
        roleSecondary: row.roleSecondary,
        lanes: row.lanes as string[]
      }
    ])
  );
  const heroNameByMlid = new Map(heroRows.map((r) => [r.mlid, r.name]));

  const counterToEnemyPairs = new Map<number, Array<{ enemyMlid: number; score: number }>>();
  for (const row of pairRows) {
    const list = counterToEnemyPairs.get(row.counter_mlid) ?? [];
    list.push({ enemyMlid: row.enemy_mlid, score: toNumber(row.score) });
    counterToEnemyPairs.set(row.counter_mlid, list);
  }

  const candidateMlids = counterRows.map((r) => r.mlid);
  const { scoreByMlid: communityScores, totalVotes: communityVoteCount } = await fetchCommunityCounterScores(
    body.enemyMlids,
    candidateMlids,
    heroNameByMlid
  );

  const rawCounterValues = counterRows.map((r) => toNumber(r.score));
  const counterMin = Math.min(...rawCounterValues);
  const counterMax = Math.max(...rawCounterValues);
  const counterRange = counterMax - counterMin;
  const normaliseCounter = (v: number) => (counterRange > 1e-6 ? (v - counterMin) / counterRange : 0.5);

  const enemyCount = body.enemyMlids.length;
  const blendedRows = counterRows.map((row) => {
    const nCounter = normaliseCounter(toNumber(row.score));
    const nCommunity = communityScores.get(row.mlid) ?? 0.5;
    const nTier = counterTierNorm(tierMap.get(row.mlid));

    const pairs = counterToEnemyPairs.get(row.mlid) ?? [];
    const enemiesCountered = body.enemyMlids.filter((eId) => pairs.some((p) => p.enemyMlid === eId)).length;
    const coverageMult = COVERAGE_MULT_MIN + (1 - COVERAGE_MULT_MIN) * (enemiesCountered / enemyCount);

    const blended = (COUNTER_W * nCounter + COMMUNITY_W * nCommunity + TIER_W * nTier) * coverageMult;
    return { mlid: row.mlid, blended };
  });

  const roleCounts = new Map<string, number>();
  const recommendations = blendedRows
    .sort((a, b) => b.blended - a.blended)
    .filter((row) => {
      const hero = heroById.get(row.mlid);
      if (!hero) return false;
      if (body.preferredRole && hero.rolePrimary !== body.preferredRole && hero.roleSecondary !== body.preferredRole) {
        return false;
      }
      if (body.preferredLane && !hero.lanes.includes(body.preferredLane)) return false;
      if (!body.preferredRole) {
        const roleCount = roleCounts.get(hero.rolePrimary) ?? 0;
        if (roleCount >= ROLE_CAP) return false;
        roleCounts.set(hero.rolePrimary, roleCount + 1);
      }
      return true;
    })
    .slice(0, 10)
    .map((row) => ({
      mlid: row.mlid,
      score: Number(row.blended.toFixed(4)),
      tier: tierMap.get(row.mlid),
      countersAgainst: (counterToEnemyPairs.get(row.mlid) ?? [])
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((entry) => entry.enemyMlid),
      communityVotes: communityVoteCount > 0 ? communityVoteCount : undefined
    }));

  const response = { recommendations, communityVotes: communityVoteCount };
  await cacheSet(cacheKey, response, 120);
  void recordCounterPickHistory(
    body,
    recommendations.map((row) => row.mlid)
  );

  return c.json(response);
});

const draftFeasibilityBodySchema = draftAnalyzeBodySchema.pick({
  allyMlids: true,
  enemyMlids: true
});

app.post("/draft/feasibility", zValidator("json", draftFeasibilityBodySchema), async (c) => {
  const body = c.req.valid("json");
  const allMlids = Array.from(new Set([...body.allyMlids, ...body.enemyMlids]));
  const rolePoolMap = await loadRolePoolMapForMlids(allMlids);

  const ally = evaluateDraftFeasibility(body.allyMlids, rolePoolMap);
  const enemy = evaluateDraftFeasibility(body.enemyMlids, rolePoolMap);

  return c.json({
    ally,
    enemy
  });
});

app.post("/draft/analyze", zValidator("json", draftAnalyzeBodySchema), async (c) => {
  const PICK_MIN_RECOMMENDATIONS = 4;
  const PICK_MAX_RECOMMENDATIONS = 6;
  const BAN_MIN_RECOMMENDATIONS = 4;
  const BAN_MAX_RECOMMENDATIONS = 8;
  const body = c.req.valid("json") as DraftAnalyzeBody;
  const turnType = asTurnType((body as DraftAnalyzeBody & { turnType?: string }).turnType);
  const turnSide = asTurnSide((body as DraftAnalyzeBody & { turnSide?: string }).turnSide);
  const inferredTurn = inferDraftTurn(body, turnType, turnSide);
  const allyHash = stableHash(body.allyMlids.slice().sort((a, b) => a - b));
  const enemyHash = stableHash(body.enemyMlids.slice().sort((a, b) => a - b));
  const allyBanHash = stableHash((body.allyBans ?? []).slice().sort((a, b) => a - b));
  const enemyBanHash = stableHash((body.enemyBans ?? []).slice().sort((a, b) => a - b));
  const cacheKey = `draft:v7:${body.timeframe}:mode=${body.mode}:rank=${body.rankScope}:turn=${inferredTurn}:${turnSide}:${turnType}:${allyHash}:${enemyHash}:${allyBanHash}:${enemyBanHash}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached as Record<string, unknown>);

  const actingPicks = turnSide === "ally" ? body.allyMlids : body.enemyMlids;
  const opposingPicks = turnSide === "ally" ? body.enemyMlids : body.allyMlids;

  const bannedSet = new Set([
    ...body.allyMlids,
    ...body.enemyMlids,
    ...(body.allyBans ?? []),
    ...(body.enemyBans ?? [])
  ]);
  const dynamicTier = await computeTierByRankScope({
    timeframe: body.timeframe,
    rankScope: body.rankScope
  });
  const tierRows =
    dynamicTier.rows.length > 0
      ? dynamicTier.rows
      : (
          (
            await db
              .select({ rows: tierResults.rows })
              .from(tierResults)
              .where(and(eq(tierResults.timeframe, body.timeframe), eq(tierResults.segment, "all")))
              .orderBy(desc(tierResults.computedAt))
              .limit(1)
          )[0]?.rows ?? []
        );

  const tierByMlid = new Map(normalizeTierRows(tierRows).map((row) => [row.mlid, row.tier]));
  const heroInfoRows = await db
    .select({
      mlid: heroes.mlid,
      name: heroes.name,
      rolePrimary: heroes.rolePrimary,
      specialities: heroes.specialities
    })
    .from(heroes)
    .orderBy(asc(heroes.name));

  const heroInfoMap = new Map(heroInfoRows.map((row) => [row.mlid, {
    rolePrimary: row.rolePrimary,
    specialities: (row.specialities as string[]) ?? []
  }]));
  const draftHeroNameByMlid = new Map(heroInfoRows.map((r) => [r.mlid, r.name]));

  const candidateMlids = Array.from(
    new Set(heroInfoRows.map((row) => row.mlid))
  ).filter((mlid) => !bannedSet.has(mlid));

  const actingHeroInfos = actingPicks
    .map((mlid) => heroInfoMap.get(mlid))
    .filter((info): info is NonNullable<typeof info> => Boolean(info));
  const detectedArchetypes = actingHeroInfos.length >= 2
    ? detectArchetypes(actingHeroInfos)
    : [];

  const [rolePoolMap, rankStatsMap, counterRowsResult, synergyRowsResult, counterVsAlliesResult, synergyWithEnemyResult, draftCommunityResult] = await Promise.all([
    loadRolePoolMapForMlids(candidateMlids),
    loadRankStatsMap(body.timeframe, body.rankScope),
    opposingPicks.length > 0
      ? db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
          SELECT counter_mlid, enemy_mlid, score::float8 AS score
          FROM counter_matrix
          WHERE timeframe = ${body.timeframe}
            AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(opposingPicks))})
        `)
      : Promise.resolve({ rows: [] as Array<{ counter_mlid: number; enemy_mlid: number; score: number }> }),
    actingPicks.length > 0
      ? db.execute<{ synergy_mlid: number; hero_mlid: number; score: number }>(sql`
          SELECT synergy_mlid, hero_mlid, score::float8 AS score
          FROM synergy_matrix
          WHERE timeframe = ${body.timeframe}
            AND hero_mlid = ANY(${sql.raw(safeArrayLiteral(actingPicks))})
        `)
      : Promise.resolve({ rows: [] as Array<{ synergy_mlid: number; hero_mlid: number; score: number }> }),
    actingPicks.length > 0
      ? db.execute<{ counter_mlid: number; score: number }>(sql`
          SELECT counter_mlid, score::float8 AS score
          FROM counter_matrix
          WHERE timeframe = ${body.timeframe}
            AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(actingPicks))})
        `)
      : Promise.resolve({ rows: [] as Array<{ counter_mlid: number; score: number }> }),
    opposingPicks.length > 0
      ? db.execute<{ synergy_mlid: number; score: number }>(sql`
          SELECT synergy_mlid, score::float8 AS score
          FROM synergy_matrix
          WHERE timeframe = ${body.timeframe}
            AND hero_mlid = ANY(${sql.raw(safeArrayLiteral(opposingPicks))})
        `)
      : Promise.resolve({ rows: [] as Array<{ synergy_mlid: number; score: number }> }),
    opposingPicks.length > 0
      ? fetchCommunityCounterScores(opposingPicks, candidateMlids, draftHeroNameByMlid)
      : Promise.resolve({ scoreByMlid: new Map<number, number>(), totalVotes: 0 })
  ]);

  const counterScoreByMlid = new Map<number, number>();
  for (const row of counterRowsResult.rows as Array<{ counter_mlid: number; enemy_mlid: number; score: number }>) {
    const prev = counterScoreByMlid.get(row.counter_mlid) ?? 0;
    counterScoreByMlid.set(row.counter_mlid, prev + Number(row.score));
  }

  const synergyScoreByMlid = new Map<number, number>();
  for (const row of synergyRowsResult.rows as Array<{ synergy_mlid: number; hero_mlid: number; score: number }>) {
    const prev = synergyScoreByMlid.get(row.synergy_mlid) ?? 0;
    synergyScoreByMlid.set(row.synergy_mlid, prev + Number(row.score));
  }

  const protectionScoreByMlid = new Map<number, number>();
  for (const row of counterVsAlliesResult.rows as Array<{ counter_mlid: number; score: number }>) {
    const prev = protectionScoreByMlid.get(row.counter_mlid) ?? 0;
    protectionScoreByMlid.set(row.counter_mlid, prev + Number(row.score));
  }

  const denialScoreByMlid = new Map<number, number>();
  for (const row of synergyWithEnemyResult.rows as Array<{ synergy_mlid: number; score: number }>) {
    const prev = denialScoreByMlid.get(row.synergy_mlid) ?? 0;
    denialScoreByMlid.set(row.synergy_mlid, prev + Number(row.score));
  }

  const draftCommunityScores = draftCommunityResult.scoreByMlid;
  const draftCommunityVotes = draftCommunityResult.totalVotes;

  const actingPickNumber = actingPicks.length + 1;
  const weights = phaseWeights(actingPickNumber);
  const synergyWeight = 0.05 + 0.15 * Math.min(1, actingPicks.length / 4);
  const pickPhase: "meta" | "flex" | "counter" =
    actingPickNumber <= 2 ? "meta" : actingPickNumber === 3 ? "flex" : "counter";

  const scored = candidateMlids.map((mlid) => {
    const tierScore = tierNumeric(tierByMlid.get(mlid));
    const stat = rankStatsMap.get(mlid);
    const banRate = rate100(stat?.banRate);
    const pickRate = rate100(stat?.pickRate);
    const winRate = rate100(stat?.winRate);
    const lanes = rolePoolMap.get(mlid) ?? [];
    const laneBonus = lanes.includes("jungle") || lanes.includes("mid") ? 100 : 0;
    const flexValue = Math.min(3, lanes.length) / 3 * 100;
    const metaCounterRaw = opposingPicks.length > 0
      ? (counterScoreByMlid.get(mlid) ?? 0) / opposingPicks.length * 100
      : 0;
    const communityCounterRaw = (draftCommunityScores.get(mlid) ?? 0) * 100;
    const communityBlendRatio = 0.20 + 0.15 * Math.min(1, (actingPickNumber - 1) / 4);
    const counterScore = opposingPicks.length > 0
      ? Number(((1 - communityBlendRatio) * metaCounterRaw + communityBlendRatio * communityCounterRaw).toFixed(4))
      : 0;
    const synergyScore = actingPicks.length > 0
      ? Number(((synergyScoreByMlid.get(mlid) ?? 0) / actingPicks.length * 100).toFixed(4))
      : 0;

    const denialScore = opposingPicks.length > 0
      ? Number(((denialScoreByMlid.get(mlid) ?? 0) / opposingPicks.length * 100).toFixed(4))
      : 0;
    const protectionScore = actingPicks.length > 0
      ? Number(((protectionScoreByMlid.get(mlid) ?? 0) / actingPicks.length * 100).toFixed(4))
      : 0;

    const banScore = Number((
      tierScore * 0.25 +
      banRate * 0.25 +
      denialScore * 0.25 +
      protectionScore * 0.25
    ).toFixed(4));

    // Meta score: pure Hero Statistics + Tier, no counter bias
    const metaSW = Math.min(0.08, synergyWeight);
    const metaBase = 1 - metaSW;
    const metaScore = Number((
      tierScore   * 0.42 * metaBase +
      winRate     * 0.28 * metaBase +
      pickRate    * 0.15 * metaBase +
      banRate     * 0.08 * metaBase +
      flexValue   * 0.07 * metaBase +
      synergyScore * metaSW
    ).toFixed(4));

    // Counter pick score: community votes first, then matrix, then synergy
    // When no enemy picks yet: flex + meta as pre-draft counter-flexibility potential
    const counterPickScore = opposingPicks.length > 0 ? Number((
      communityCounterRaw * 0.50 +
      metaCounterRaw      * 0.30 +
      synergyScore        * 0.15 +
      laneBonus           * 0.05
    ).toFixed(4)) : Number((
      flexValue  * 0.45 +
      tierScore  * 0.35 +
      winRate    * 0.20
    ).toFixed(4));

    const heroInfo = heroInfoMap.get(mlid);
    const archBoost = heroInfo && detectedArchetypes.length > 0
      ? archetypeBoost(heroInfo.specialities, heroInfo.rolePrimary, detectedArchetypes) * 100
      : 0;

    const archWeight = detectedArchetypes.length > 0 ? 0.05 : 0;
    const wScale = 1 - synergyWeight - archWeight;
    const pickScore = Number((
      counterScore * weights.counterWeight * wScale +
      tierScore * weights.tierWeight * wScale +
      flexValue * weights.flexWeight * wScale +
      banRate * weights.banRateWeight * wScale +
      pickRate * weights.pickRateWeight * wScale +
      winRate * weights.winRateWeight * wScale +
      laneBonus * weights.laneBonusWeight * wScale +
      synergyScore * synergyWeight +
      archBoost * archWeight
    ).toFixed(4));

    return {
      mlid,
      tier: tierByMlid.get(mlid),
      lanes,
      counterScore,
      synergyScore,
      tierScore,
      banRate,
      pickRate,
      winRate,
      laneBonus,
      flexValue,
      denialScore,
      protectionScore,
      banScore,
      pickScore,
      metaScore,
      counterPickScore
    };
  });

  const phaseReasonPick: Record<typeof pickPhase, string> = {
    meta:    `Pick ${actingPickNumber}/5 — Meta phase: secure S-tier & flex heroes.`,
    flex:    `Pick ${actingPickNumber}/5 — Transition: balancing meta power & counter threat.`,
    counter: `Pick ${actingPickNumber}/5 — Counter phase: targeting confirmed enemy picks.`
  };

  const toRec = (
    row: (typeof scored)[number],
    score: number,
    kind: "ban" | "pick"
  ) => ({
    mlid: row.mlid,
    score,
    tier: row.tier,
    pickPhase: kind === "pick" ? pickPhase : undefined,
    reasons: [kind === "ban"
      ? `Ban score (deny ${(row.denialScore / 100 * 100).toFixed(0)}%, protect ${(row.protectionScore / 100 * 100).toFixed(0)}%).`
      : phaseReasonPick[pickPhase]
    ],
    breakdown: {
      counterImpact: Number((row.counterScore / 100).toFixed(4)),
      tierPower: Number((row.tierScore / 100).toFixed(4)),
      laneCoverage: Number((row.laneBonus / 100).toFixed(4)),
      flexValue: Number((row.flexValue / 100).toFixed(4)),
      feasibilityGain: 0,
      denyValue: Number((row.banRate / 100).toFixed(4)),
      synergyValue: Number((row.synergyScore / 100).toFixed(4)),
      denialValue: Number((row.denialScore / 100).toFixed(4)),
      protectionValue: Number((row.protectionScore / 100).toFixed(4)),
      communitySignal: draftCommunityVotes > 0
        ? Number(((draftCommunityScores.get(row.mlid) ?? 0)).toFixed(4))
        : undefined
    },
    preview: null
  });

  const sortedBan = scored.slice().sort((a, b) => b.banScore - a.banScore);
  const laneCounts = new Map<string, number>();
  const laneCappedBans: typeof sortedBan = [];
  for (const row of sortedBan) {
    const primaryLane = row.lanes[0] ?? "unknown";
    const current = laneCounts.get(primaryLane) ?? 0;
    if (current >= 2) continue;
    laneCounts.set(primaryLane, current + 1);
    laneCappedBans.push(row);
    if (laneCappedBans.length >= BAN_MAX_RECOMMENDATIONS) break;
  }
  const baseBanRows =
    laneCappedBans.length >= BAN_MIN_RECOMMENDATIONS ? laneCappedBans : sortedBan.slice(0, BAN_MAX_RECOMMENDATIONS);
  const recommendedBans = baseBanRows.slice(0, Math.min(BAN_MAX_RECOMMENDATIONS, baseBanRows.length)).map((row) => toRec(row, row.banScore, "ban"));

  const sortedPick = scored.slice().sort((a, b) => b.pickScore - a.pickScore);
  const pickCap = Math.min(PICK_MAX_RECOMMENDATIONS, sortedPick.length);
  const pickFloor = Math.min(PICK_MIN_RECOMMENDATIONS, sortedPick.length);
  const recommendedPicks = sortedPick.slice(0, Math.max(pickFloor, pickCap)).slice(0, PICK_MAX_RECOMMENDATIONS).map((row) => toRec(row, row.pickScore, "pick"));

  // Lane-diverse selector: greedily picks up to `count` heroes capping `maxPerLane` per primary lane
  function selectLaneDiverse<T extends { lanes: string[] }>(
    sortedRows: T[], count: number, maxPerLane = 2
  ): T[] {
    const laneCap = new Map<string, number>();
    const out: T[] = [];
    for (const row of sortedRows) {
      if (out.length >= count) break;
      const lane = row.lanes[0] ?? "unknown";
      if ((laneCap.get(lane) ?? 0) >= maxPerLane) continue;
      laneCap.set(lane, (laneCap.get(lane) ?? 0) + 1);
      out.push(row);
    }
    return out;
  }

  // Meta picks panel (8 candidates): purely Hero Statistics + Tier, no counter bias
  const sortedMeta = scored.slice().sort((a, b) => b.metaScore - a.metaScore);
  const recommendedMetaPicks = selectLaneDiverse(sortedMeta, 8).map((row) => toRec(row, row.metaScore, "pick"));

  // Counter picks panel (8 candidates): community votes + counter matrix + synergy
  const sortedCounter = opposingPicks.length > 0
    ? scored.slice().sort((a, b) => b.counterPickScore - a.counterPickScore)
    : [];
  const recommendedCounterPicks = selectLaneDiverse(sortedCounter, 8).map((row) => toRec(row, row.counterPickScore, "pick"));

  let draftProbability = null;
  if (body.allyMlids.length >= 1 && body.enemyMlids.length >= 1) {
    const allyTierPower = body.allyMlids.reduce(
      (sum, mlid) => sum + tierWeight(tierByMlid.get(mlid)), 0
    );
    const enemyTierPower = body.enemyMlids.reduce(
      (sum, mlid) => sum + tierWeight(tierByMlid.get(mlid)), 0
    );
    const [allyCounterEdge, enemyCounterEdge] = await Promise.all([
      averageCounterEdge(body.timeframe, body.allyMlids, body.enemyMlids),
      averageCounterEdge(body.timeframe, body.enemyMlids, body.allyMlids)
    ]);
    const TIER_W = 4.5;
    const COUNTER_W = 55;
    const LOGISTIC_D = 22;
    const allyScore = allyTierPower * TIER_W + allyCounterEdge * COUNTER_W;
    const enemyScore = enemyTierPower * TIER_W + enemyCounterEdge * COUNTER_W;
    const diff = allyScore - enemyScore;
    const allyWinProb = (1 / (1 + Math.exp(-(diff / LOGISTIC_D)))) * 100;
    draftProbability = {
      allyWinProb: Number(allyWinProb.toFixed(1)),
      enemyWinProb: Number((100 - allyWinProb).toFixed(1)),
      confidence: Math.min(1, (body.allyMlids.length + body.enemyMlids.length) / 10)
    };
  }

  const response = {
    recommendedPicks,
    recommendedBans,
    recommendedMetaPicks,
    recommendedCounterPicks,
    archetype: detectedArchetypes.length > 0 && detectedArchetypes[0] ? {
      primary: detectedArchetypes[0].archetype,
      confidence: Number(detectedArchetypes[0].confidence.toFixed(4)),
      secondary: detectedArchetypes[1]?.archetype ?? null
    } : null,
    draftProbability,
    notes: [
      `Turn context: ${turnSide} ${turnType} (Turn ${inferredTurn}).`,
      `Phase: Pick ${actingPickNumber}/5 — ${pickPhase.toUpperCase()} (counter ${(weights.counterWeight * 100).toFixed(0)}%, tier ${(weights.tierWeight * 100).toFixed(0)}%, flex ${(weights.flexWeight * 100).toFixed(0)}%).`,
      `Counter reference uses ${opposingPicks.length} enemy pick(s) + ${draftCommunityVotes} community votes.`,
      `Rank scope active: ${body.rankScope}.`,
      ...(detectedArchetypes[0]
        ? [`Detected archetype: ${detectedArchetypes[0].archetype} (${(detectedArchetypes[0].confidence * 100).toFixed(0)}%).`]
        : [])
    ]
  };

  await cacheSet(cacheKey, response, 120);
  return c.json(response);
});

const draftMatchupBodySchema = draftAnalyzeBodySchema
  .pick({
    timeframe: true,
    rankScope: true,
    allyMlids: true,
    enemyMlids: true
  })
  .extend({
    allyLaneMlids: z.array(z.number().int().positive()).length(5).optional(),
    enemyLaneMlids: z.array(z.number().int().positive()).length(5).optional()
  })
  .superRefine((value, ctx) => {
    if (value.allyMlids.length !== 5) {
      ctx.addIssue({
        code: "custom",
        path: ["allyMlids"],
        message: "allyMlids must contain exactly 5 heroes."
      });
    }
    if (value.enemyMlids.length !== 5) {
      ctx.addIssue({
        code: "custom",
        path: ["enemyMlids"],
        message: "enemyMlids must contain exactly 5 heroes."
      });
    }
    if ((value.allyLaneMlids && !value.enemyLaneMlids) || (!value.allyLaneMlids && value.enemyLaneMlids)) {
      ctx.addIssue({
        code: "custom",
        path: ["allyLaneMlids"],
        message: "allyLaneMlids and enemyLaneMlids must be provided together."
      });
    }
  });

function tierWeight(tier: Tier | undefined): number {
  if (tier === "SS") return 6;
  if (tier === "S") return 5;
  if (tier === "A") return 4;
  if (tier === "B") return 3;
  if (tier === "C") return 2;
  return 1;
}

async function averageCounterEdge(timeframe: string, counterMlids: number[], enemyMlids: number[]) {
  if (!counterMlids.length || !enemyMlids.length) return 0;

  const result = await db.execute<{ value: number | string | null }>(sql`
    SELECT COALESCE(AVG(score), 0)::float8 AS value
    FROM counter_matrix
    WHERE timeframe = ${timeframe}
      AND counter_mlid = ANY(${sql.raw(`ARRAY[${counterMlids.join(",")}]`)})
      AND enemy_mlid = ANY(${sql.raw(`ARRAY[${enemyMlids.join(",")}]`)})
  `);

  return toNumber(result.rows[0]?.value);
}

function buildTierCounts(mlids: number[], tierMap: Map<number, Tier>) {
  const counts: Record<Tier, number> = {
    SS: 0,
    S: 0,
    A: 0,
    B: 0,
    C: 0,
    D: 0
  };
  for (const mlid of mlids) {
    const tier = tierMap.get(mlid);
    if (tier) counts[tier] += 1;
  }
  return counts;
}

async function topCounterPairs(timeframe: string, counterMlids: number[], enemyMlids: number[], limit = 3) {
  if (counterMlids.length === 0 || enemyMlids.length === 0) {
    return [] as Array<{ counterMlid: number; enemyMlid: number; score: number }>;
  }

  const rows = await db.execute<{ counter_mlid: number; enemy_mlid: number; score: number | string }>(sql`
    SELECT counter_mlid, enemy_mlid, score
    FROM counter_matrix
    WHERE timeframe = ${timeframe}
      AND counter_mlid = ANY(${sql.raw(safeArrayLiteral(counterMlids))})
      AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(enemyMlids))})
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  return (rows.rows as Array<{ counter_mlid: number; enemy_mlid: number; score: number | string }>).map((row) => ({
    counterMlid: row.counter_mlid,
    enemyMlid: row.enemy_mlid,
    score: Number(toNumber(row.score).toFixed(4))
  }));
}

app.post("/draft/matchup", zValidator("json", draftMatchupBodySchema), async (c) => {
  const body = c.req.valid("json");
  const ally = body.allyMlids.slice().sort((a, b) => a - b);
  const enemy = body.enemyMlids.slice().sort((a, b) => a - b);
  const allyLaneMlids = body.allyLaneMlids?.slice();
  const enemyLaneMlids = body.enemyLaneMlids?.slice();
  const laneHash =
    allyLaneMlids && enemyLaneMlids
      ? `:lanes:${stableHash(allyLaneMlids)}:${stableHash(enemyLaneMlids)}`
      : "";
  const cacheKey = `draft:matchup:${body.timeframe}:rank=${body.rankScope}:${stableHash(ally)}:${stableHash(enemy)}${laneHash}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached as Record<string, unknown>);

  const dynamicTier = await computeTierByRankScope({
    timeframe: body.timeframe,
    rankScope: body.rankScope
  });

  const tierRows =
    dynamicTier.rows.length > 0
      ? dynamicTier.rows
      : (
          (
            await db
              .select({ rows: tierResults.rows })
              .from(tierResults)
              .where(and(eq(tierResults.timeframe, body.timeframe), eq(tierResults.segment, "all")))
              .orderBy(desc(tierResults.computedAt))
              .limit(1)
          )[0]?.rows ?? []
        );

  const tierMap = new Map((tierRows as unknown as TierResultRow[]).map((row) => [row.mlid, row.tier as Tier]));

  const allyTierPower = ally.reduce((sum, mlid) => sum + tierWeight(tierMap.get(mlid)), 0);
  const enemyTierPower = enemy.reduce((sum, mlid) => sum + tierWeight(tierMap.get(mlid)), 0);

  const [allyCounterEdge, enemyCounterEdge] = await Promise.all([
    averageCounterEdge(body.timeframe, ally, enemy),
    averageCounterEdge(body.timeframe, enemy, ally)
  ]);

  const rolePoolMap = await loadRolePoolMapForMlids([...ally, ...enemy]);
  const roleConfidenceRows = await db
    .select({
      mlid: heroRolePool.mlid,
      lane: heroRolePool.lane,
      confidence: heroRolePool.confidence
    })
    .from(heroRolePool)
    .where(inArray(heroRolePool.mlid, [...ally, ...enemy]));
  const confidenceMap = new Map<number, Map<string, number>>();
  for (const row of roleConfidenceRows) {
    const laneMap = confidenceMap.get(row.mlid) ?? new Map<string, number>();
    laneMap.set(row.lane, toNumber(row.confidence));
    confidenceMap.set(row.mlid, laneMap);
  }
  const laneOrder = ["exp", "jungle", "mid", "gold", "roam"] as const;
  const laneComfort = (laneMlids: number[] | undefined) => {
    if (!laneMlids || laneMlids.length !== laneOrder.length) return 0;
    let total = 0;
    for (let i = 0; i < laneOrder.length; i += 1) {
      const mlid = laneMlids[i];
      const lane = laneOrder[i];
      if (!mlid || !lane) continue;
      total += confidenceMap.get(mlid)?.get(lane) ?? 0;
    }
    return total / laneOrder.length;
  };
  const [allyFeasibility, enemyFeasibility, allyTopCounters, enemyTopCounters] = await Promise.all([
    Promise.resolve(evaluateDraftFeasibility(ally, rolePoolMap)),
    Promise.resolve(evaluateDraftFeasibility(enemy, rolePoolMap)),
    topCounterPairs(body.timeframe, ally, enemy, 4),
    topCounterPairs(body.timeframe, enemy, ally, 4)
  ]);

  const TIER_WEIGHT = 4.5;
  const COUNTER_WEIGHT = 55;
  const LOGISTIC_DIVISOR = 22;
  const MISSING_LANE_PENALTY = 7;
  const UNRESOLVED_FLEX_PENALTY = 3;
  const LANE_COMFORT_WEIGHT = 12;

  const allyBaseScore = allyTierPower * TIER_WEIGHT + allyCounterEdge * COUNTER_WEIGHT;
  const enemyBaseScore = enemyTierPower * TIER_WEIGHT + enemyCounterEdge * COUNTER_WEIGHT;

  const allyRiskPenalty =
    allyFeasibility.missingRoles.length * MISSING_LANE_PENALTY +
    (allyFeasibility.unassignedHeroes?.length ?? 0) * UNRESOLVED_FLEX_PENALTY;
  const enemyRiskPenalty =
    enemyFeasibility.missingRoles.length * MISSING_LANE_PENALTY +
    (enemyFeasibility.unassignedHeroes?.length ?? 0) * UNRESOLVED_FLEX_PENALTY;
  const allyLaneComfort = laneComfort(allyLaneMlids);
  const enemyLaneComfort = laneComfort(enemyLaneMlids);
  const allyScore = Math.max(0, allyBaseScore - allyRiskPenalty + allyLaneComfort * LANE_COMFORT_WEIGHT);
  const enemyScore = Math.max(0, enemyBaseScore - enemyRiskPenalty + enemyLaneComfort * LANE_COMFORT_WEIGHT);
  const diff = allyScore - enemyScore;
  const allyWinProb = (1 / (1 + Math.exp(-(diff / LOGISTIC_DIVISOR)))) * 100;
  const enemyWinProb = 100 - allyWinProb;

  const verdict =
    Math.abs(diff) < 2
      ? "Balanced draft"
      : diff > 0
        ? "Ally draft advantage"
        : "Enemy draft advantage";

  const allyTierCounts = buildTierCounts(ally, tierMap);
  const enemyTierCounts = buildTierCounts(enemy, tierMap);
  const keyFactors: string[] = [];
  if (Math.abs(allyCounterEdge - enemyCounterEdge) >= 0.08) {
    keyFactors.push(
      allyCounterEdge > enemyCounterEdge
        ? "Ally has stronger direct counter interactions."
        : "Enemy has stronger direct counter interactions."
    );
  }
  if (Math.abs(allyTierPower - enemyTierPower) >= 2) {
    keyFactors.push(
      allyTierPower > enemyTierPower
        ? "Ally has higher tier-weighted core."
        : "Enemy has higher tier-weighted core."
    );
  }
  if (allyFeasibility.missingRoles.length > enemyFeasibility.missingRoles.length) {
    keyFactors.push("Ally composition is less complete in lane coverage.");
  } else if (enemyFeasibility.missingRoles.length > allyFeasibility.missingRoles.length) {
    keyFactors.push("Enemy composition is less complete in lane coverage.");
  }
  if (allyRiskPenalty !== enemyRiskPenalty) {
    keyFactors.push(
      allyRiskPenalty < enemyRiskPenalty
        ? "Ally has lower execution risk from lane/flex structure."
        : "Enemy has lower execution risk from lane/flex structure."
    );
  }
  if (Math.abs(allyLaneComfort - enemyLaneComfort) >= 0.08) {
    keyFactors.push(
      allyLaneComfort > enemyLaneComfort
        ? "Ally lane assignment shows better comfort fit."
        : "Enemy lane assignment shows better comfort fit."
    );
  }
  if (keyFactors.length === 0) {
    keyFactors.push("Both drafts are structurally close; small execution details can decide result.");
  }

  const response = {
    verdict,
    allyScore: Number(allyScore.toFixed(2)),
    enemyScore: Number(enemyScore.toFixed(2)),
    allyWinProb: Number(allyWinProb.toFixed(1)),
    enemyWinProb: Number(enemyWinProb.toFixed(1)),
    components: {
      allyTierPower,
      enemyTierPower,
      allyCounterEdge: Number(allyCounterEdge.toFixed(4)),
      enemyCounterEdge: Number(enemyCounterEdge.toFixed(4)),
      allyLaneComfort: Number(allyLaneComfort.toFixed(4)),
      enemyLaneComfort: Number(enemyLaneComfort.toFixed(4))
    },
    details: {
      ally: {
        coveredLanes: Object.keys(allyFeasibility.assignment),
        missingLanes: allyFeasibility.missingRoles,
        topCounterPairs: allyTopCounters,
        tierCounts: allyTierCounts
      },
      enemy: {
        coveredLanes: Object.keys(enemyFeasibility.assignment),
        missingLanes: enemyFeasibility.missingRoles,
        topCounterPairs: enemyTopCounters,
        tierCounts: enemyTierCounts
      },
      scoreModel: {
        tierWeight: TIER_WEIGHT,
        counterWeight: COUNTER_WEIGHT,
        logisticDivisor: LOGISTIC_DIVISOR,
        allyRiskPenalty: Number(allyRiskPenalty.toFixed(2)),
        enemyRiskPenalty: Number(enemyRiskPenalty.toFixed(2)),
        laneComfortWeight: LANE_COMFORT_WEIGHT
      },
      keyFactors
    }
  };

  await cacheSet(cacheKey, response, 120);
  return c.json(response);
});

serve({
  fetch: app.fetch,
  port
});

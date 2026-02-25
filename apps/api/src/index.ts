import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  buildRolePoolMap,
  computeTierResults,
  evaluateDraftFeasibility,
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
  counterPickHistory
} from "@mlbb/db";
import { cacheGet, cacheSet } from "./lib/cache";
import { stableHash } from "./lib/hash";

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
  if (tier === "SS") return 1;
  if (tier === "S") return 0.9;
  if (tier === "A") return 0.78;
  if (tier === "B") return 0.62;
  if (tier === "C") return 0.48;
  if (tier === "D") return 0.35;
  return 0.42;
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
  } catch {
    // Keep counters endpoint non-blocking even if history table is unavailable.
  }
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
    LIMIT 30
  `);
  const counterRows = results.rows as Array<{ mlid: number; score: number }>;

  const pairRowsResult = await db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
    SELECT counter_mlid, enemy_mlid, score::float8 AS score
    FROM counter_matrix
    WHERE timeframe = ${body.timeframe}
      AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(body.enemyMlids))})
    ORDER BY score DESC
    LIMIT 1600
  `);
  const pairRows = pairRowsResult.rows as Array<{ counter_mlid: number; enemy_mlid: number; score: number }>;

  const tierMap = await getTierMapForScope(body.timeframe, body.rankScope);
  const heroIds = counterRows.map((row) => row.mlid);
  const heroRows =
    heroIds.length === 0
      ? []
      : await db
          .select({
            mlid: heroes.mlid,
            rolePrimary: heroes.rolePrimary,
            roleSecondary: heroes.roleSecondary,
            lanes: heroes.lanes
          })
          .from(heroes)
          .where(inArray(heroes.mlid, heroIds));

  const heroById = new Map(
    heroRows.map((row) => [
      row.mlid,
      {
        rolePrimary: row.rolePrimary,
        roleSecondary: row.roleSecondary,
        lanes: row.lanes as string[]
      }
    ])
  );
  const counterToEnemyPairs = new Map<number, Array<{ enemyMlid: number; score: number }>>();
  for (const row of pairRows) {
    const list = counterToEnemyPairs.get(row.counter_mlid) ?? [];
    list.push({ enemyMlid: row.enemy_mlid, score: toNumber(row.score) });
    counterToEnemyPairs.set(row.counter_mlid, list);
  }

  const recommendations = counterRows
    .filter((row: { mlid: number; score: number }) => {
      const hero = heroById.get(row.mlid);
      if (!hero) return false;
      if (body.preferredRole && hero.rolePrimary !== body.preferredRole && hero.roleSecondary !== body.preferredRole) {
        return false;
      }
      if (body.preferredLane && !hero.lanes.includes(body.preferredLane)) return false;
      return true;
    })
    .map((row: { mlid: number; score: number }) => ({
      mlid: row.mlid,
      score: Number(row.score.toFixed(4)),
      tier: tierMap.get(row.mlid),
      countersAgainst: (counterToEnemyPairs.get(row.mlid) ?? [])
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((entry) => entry.enemyMlid)
    }))
    .slice(0, 10);

  const response = { recommendations };
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
  const PICK_MAX_RECOMMENDATIONS = 8;
  const BAN_MIN_RECOMMENDATIONS = 4;
  const BAN_MAX_RECOMMENDATIONS = 8;
  const body = c.req.valid("json") as DraftAnalyzeBody;
  const turnType = asTurnType((body as DraftAnalyzeBody & { turnType?: string }).turnType);
  const turnSide = asTurnSide((body as DraftAnalyzeBody & { turnSide?: string }).turnSide);
  const allyHash = stableHash(body.allyMlids.slice().sort((a, b) => a - b));
  const enemyHash = stableHash(body.enemyMlids.slice().sort((a, b) => a - b));
  const allyBanHash = stableHash((body.allyBans ?? []).slice().sort((a, b) => a - b));
  const enemyBanHash = stableHash((body.enemyBans ?? []).slice().sort((a, b) => a - b));
  const cacheKey = `draft:${body.timeframe}:mode=${body.mode}:rank=${body.rankScope}:turn=${turnSide}:${turnType}:${allyHash}:${enemyHash}:${allyBanHash}:${enemyBanHash}`;
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

  const tierList = normalizeTierRows(tierRows).filter((row) => !bannedSet.has(row.mlid));
  const tierByMlid = new Map(tierList.map((row) => [row.mlid, row.tier]));
  const tierScoreByMlid = new Map(tierList.map((row) => [row.mlid, row.score]));

  const [counterRowsResult, threatRowsResult] = await Promise.all([
    db.execute<{ mlid: number; score: number }>(sql`
      SELECT
        counter_mlid AS mlid,
        AVG(score)::float8 AS score
      FROM counter_matrix
      WHERE timeframe = ${body.timeframe}
        AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(opposingPicks))})
      GROUP BY counter_mlid
      ORDER BY score DESC
      LIMIT 140
    `),
    db.execute<{ mlid: number; score: number }>(sql`
      SELECT
        counter_mlid AS mlid,
        AVG(score)::float8 AS score
      FROM counter_matrix
      WHERE timeframe = ${body.timeframe}
        AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(actingPicks))})
      GROUP BY counter_mlid
      ORDER BY score DESC
      LIMIT 140
    `)
  ]);

  const counterByMlid = new Map<number, number>(
    (counterRowsResult.rows as Array<{ mlid: number; score: number }>).map((row) => [row.mlid, toNumber(row.score)])
  );
  const threatByMlid = new Map<number, number>(
    (threatRowsResult.rows as Array<{ mlid: number; score: number }>).map((row) => [row.mlid, toNumber(row.score)])
  );

  const seedCandidateMlids = Array.from(
    new Set<number>([
      ...tierList.slice(0, 120).map((row) => row.mlid),
      ...Array.from(counterByMlid.keys()).slice(0, 80),
      ...Array.from(threatByMlid.keys()).slice(0, 80)
    ])
  ).filter((mlid) => !bannedSet.has(mlid));

  const fallbackRows = await db
    .select({ mlid: heroes.mlid })
    .from(heroes)
    .orderBy(asc(heroes.name))
    .limit(260);
  const fallbackMlids = fallbackRows.map((row) => row.mlid).filter((mlid) => !bannedSet.has(mlid));
  const candidateMlids = Array.from(new Set<number>([...seedCandidateMlids, ...fallbackMlids]));

  const [rolePoolMap, rankStatsMap, counterPickUsageMap] = await Promise.all([
    loadRolePoolMapForMlids([...actingPicks, ...candidateMlids]),
    loadRankStatsMap(body.timeframe, body.rankScope),
    loadCounterPickUsageBoostMap(body.timeframe, body.rankScope)
  ]);
  const baseFeasibility = evaluateDraftFeasibility(actingPicks, rolePoolMap);
  const missingLanes = new Set(baseFeasibility.missingRoles);
  const lockedNonFlexLanes = new Set<string>();
  for (const mlid of actingPicks) {
    const lanes = rolePoolMap.get(mlid) ?? [];
    const lane = lanes[0];
    if (lanes.length === 1 && lane) lockedNonFlexLanes.add(lane);
  }

  const scoredCandidates = candidateMlids.map((mlid) => {
    const lanes = rolePoolMap.get(mlid) ?? [];
    const counterRaw = counterByMlid.get(mlid) ?? 0;
    const threatRaw = threatByMlid.get(mlid) ?? 0;
    const normalizedCounter = Math.max(0, Math.min(counterRaw, 1.2)) / 1.2;
    const normalizedThreat = Math.max(0, Math.min(threatRaw, 1.2)) / 1.2;
    const tierScore = tierNumeric(tierByMlid.get(mlid));
    const tierMomentum = Math.max(0, Math.min(tierScoreByMlid.get(mlid) ?? tierScore, 1.2));
    const flexScore = Math.min(3, lanes.length) / 3;
    const stat = rankStatsMap.get(mlid);
    const winRateSignal = stat?.winRate ?? 0;
    const banRateSignal = stat?.banRate ?? 0;
    const counterPickUsageSignal = counterPickUsageMap.get(mlid) ?? 0;
    const coverageLanes = lanes.filter((lane) => missingLanes.has(lane));
    const coverageScore =
      missingLanes.size > 0 ? Math.min(1, coverageLanes.length / missingLanes.size) : 0.4;
    const nextFeasibility = evaluateDraftFeasibility([...actingPicks, mlid], rolePoolMap);
    const feasibilityGain = Math.max(0, nextFeasibility.matchedCount - baseFeasibility.matchedCount);
    const pickActionable = nextFeasibility.matchedCount >= actingPicks.length + 1;
    const beforeMissing = baseFeasibility.missingRoles.slice();
    const afterMissing = nextFeasibility.missingRoles.slice();
    const newlyCovered = beforeMissing.filter((lane) => !afterMissing.includes(lane));

    const pickScore =
      normalizedCounter * 0.22 +
      winRateSignal * 0.3 +
      banRateSignal * 0.14 +
      tierScore * 0.16 +
      tierMomentum * 0.08 +
      coverageScore * 0.08 +
      flexScore * 0.04 +
      feasibilityGain * 0.06 +
      counterPickUsageSignal * 0.06 +
      (pickActionable ? 0.03 : -0.2);

    const banScore =
      banRateSignal * 0.36 +
      normalizedThreat * 0.24 +
      tierScore * 0.18 +
      tierMomentum * 0.08 +
      winRateSignal * 0.08 +
      flexScore * 0.06 +
      counterPickUsageSignal * 0.04;

    const pickBreakdown = {
      counterImpact: Number(normalizedCounter.toFixed(4)),
      tierPower: Number(Math.min(1, tierScore).toFixed(4)),
      laneCoverage: Number(coverageScore.toFixed(4)),
      flexValue: Number(flexScore.toFixed(4)),
      feasibilityGain: Number(Math.min(1, feasibilityGain).toFixed(4)),
      denyValue: Number(Math.max(normalizedThreat, banRateSignal).toFixed(4))
    };
    const banBreakdown = {
      counterImpact: Number(normalizedCounter.toFixed(4)),
      tierPower: Number(Math.min(1, tierScore).toFixed(4)),
      laneCoverage: 0,
      flexValue: Number(flexScore.toFixed(4)),
      feasibilityGain: 0,
      denyValue: Number(Math.max(normalizedThreat, banRateSignal).toFixed(4))
    };

    const pickReasons: string[] = [];
    if (normalizedCounter > 0.45) pickReasons.push("Strong counter into revealed enemy picks.");
    if (coverageLanes.length > 0) pickReasons.push(`Covers lane: ${coverageLanes.join(", ")}.`);
    if (winRateSignal >= 0.54) pickReasons.push("High win rate in current scope.");
    if (banRateSignal >= 0.18) pickReasons.push("Frequently contested in ranked matches.");
    if (flexScore >= 0.67) pickReasons.push("Flexible pick across multiple lanes.");
    if (tierScore >= 0.9) pickReasons.push("Top-tier power in current data scope.");
    if (counterPickUsageSignal >= 0.45) pickReasons.push("Frequently successful in recent counter-pick simulations.");
    if (!pickActionable) pickReasons.push("Can create temporary lane conflict in current assignment.");
    if (pickReasons.length === 0) pickReasons.push("Stable value pick for this phase.");

    const banReasons: string[] = [];
    if (banRateSignal >= 0.18) banReasons.push("High ban pressure in current scope.");
    if (normalizedThreat > 0.45) banReasons.push("Direct threat to your current core.");
    if (tierScore >= 0.9) banReasons.push("Top-tier meta threat.");
    if (flexScore >= 0.67) banReasons.push("Flexible denial value.");
    if (counterPickUsageSignal >= 0.45) banReasons.push("Frequently appears in successful counter-pick plans.");
    if (banReasons.length === 0) banReasons.push("High general impact ban.");

    const tierTag = tierByMlid.get(mlid);
    const isMetaHero = tierTag === "SS" || tierTag === "S" || tierTag === "A";
    const laneMatched = missingLanes.size === 0 || coverageLanes.length > 0;
    const metaPickPriority =
      tierMomentum * 0.5 +
      winRateSignal * 0.3 +
      banRateSignal * 0.2 +
      (laneMatched ? 0.05 : -0.15);
    const counterPickPriority =
      normalizedCounter * 0.48 +
      winRateSignal * 0.2 +
      coverageScore * 0.16 +
      flexScore * 0.08 +
      banRateSignal * 0.08;
    const metaBanPriority = banRateSignal * 0.45 + tierMomentum * 0.35 + winRateSignal * 0.2;
    const counterBanPriority =
      normalizedThreat * 0.46 + banRateSignal * 0.28 + tierMomentum * 0.16 + counterPickUsageSignal * 0.1;
    const hasCounterSignal = normalizedCounter >= 0.08;
    const hasThreatSignal = normalizedThreat >= 0.08;

    return {
      mlid,
      tier: tierTag,
      pickScore: Number(pickScore.toFixed(4)),
      banScore: Number(banScore.toFixed(4)),
      pickReasons,
      banReasons,
      pickBreakdown,
      banBreakdown,
      pickPreview: {
        beforeMissingRoles: beforeMissing,
        afterMissingRoles: afterMissing,
        newlyCoveredRoles: newlyCovered,
        matchedBefore: baseFeasibility.matchedCount,
        matchedAfter: nextFeasibility.matchedCount
      },
      pickActionable,
      laneMatched,
      isMetaHero,
      hasCounterSignal,
      hasThreatSignal,
      metaPickPriority: Number(metaPickPriority.toFixed(4)),
      counterPickPriority: Number(counterPickPriority.toFixed(4)),
      metaBanPriority: Number(metaBanPriority.toFixed(4)),
      counterBanPriority: Number(counterBanPriority.toFixed(4)),
      pickBlockedByLockedLane:
        lockedNonFlexLanes.size > 0 && lanes.length > 0 && lanes.every((lane) => lockedNonFlexLanes.has(lane))
    };
  });

  const combinePriority = <T extends { mlid: number }>(primary: T[], secondary: T[], limit: number) => {
    const merged: T[] = [];
    const seen = new Set<number>();
    for (const row of [...primary, ...secondary]) {
      if (seen.has(row.mlid)) continue;
      merged.push(row);
      seen.add(row.mlid);
      if (merged.length >= limit) break;
    }
    return merged;
  };

  const pickEligible = scoredCandidates.filter((row) => !row.pickBlockedByLockedLane && row.pickActionable && row.laneMatched);

  const metaPickRows = pickEligible
    .filter((row) => row.isMetaHero)
    .sort((a, b) => b.metaPickPriority - a.metaPickPriority || b.pickScore - a.pickScore)
    .map((row) => ({
      mlid: row.mlid,
      score: Number((row.metaPickPriority * 0.62 + row.pickScore * 0.38).toFixed(4)),
      tier: row.tier,
      reasons: ["Meta priority hero.", ...row.pickReasons],
      breakdown: row.pickBreakdown,
      preview: row.pickPreview
    }));

  const counterPickRows = pickEligible
    .filter((row) => !row.isMetaHero && row.hasCounterSignal)
    .sort((a, b) => b.counterPickPriority - a.counterPickPriority || b.pickScore - a.pickScore)
    .map((row) => ({
      mlid: row.mlid,
      score: Number((row.counterPickPriority * 0.62 + row.pickScore * 0.38).toFixed(4)),
      tier: row.tier,
      reasons: ["Counter-to-current-board value.", ...row.pickReasons],
      breakdown: row.pickBreakdown,
      preview: row.pickPreview
    }));

  const recommendedPicksBase = combinePriority(metaPickRows, counterPickRows, PICK_MAX_RECOMMENDATIONS);

  const metaBanRows = scoredCandidates
    .filter((row) => row.isMetaHero)
    .sort((a, b) => b.metaBanPriority - a.metaBanPriority || b.banScore - a.banScore)
    .map((row) => ({
      mlid: row.mlid,
      score: Number((row.metaBanPriority * 0.65 + row.banScore * 0.35).toFixed(4)),
      tier: row.tier,
      reasons: ["Meta ban priority.", ...row.banReasons],
      breakdown: row.banBreakdown,
      preview: null
    }));

  const counterBanRows = scoredCandidates
    .filter((row) => !row.isMetaHero && row.hasThreatSignal)
    .sort((a, b) => b.counterBanPriority - a.counterBanPriority || b.banScore - a.banScore)
    .map((row) => ({
      mlid: row.mlid,
      score: Number((row.counterBanPriority * 0.65 + row.banScore * 0.35).toFixed(4)),
      tier: row.tier,
      reasons: ["Counter threat denial.", ...row.banReasons],
      breakdown: row.banBreakdown,
      preview: null
    }));

  const recommendedBansBase = combinePriority(metaBanRows, counterBanRows, BAN_MAX_RECOMMENDATIONS);

  const fallbackPicks = tierList.slice(0, 8).map((row) => ({
    mlid: row.mlid,
    score: Number(Math.max(0.35, row.score).toFixed(4)),
    tier: row.tier,
    reasons: ["Top tier baseline", "No enough enemy pick signals yet"],
    breakdown: {
      counterImpact: 0.35,
      tierPower: Number(Math.min(1, tierNumeric(row.tier)).toFixed(4)),
      laneCoverage: 0.35,
      flexValue: 0.35,
      feasibilityGain: 0.35,
      denyValue: 0.35
    },
    preview: {
      beforeMissingRoles: baseFeasibility.missingRoles.slice(),
      afterMissingRoles: baseFeasibility.missingRoles.slice(),
      newlyCoveredRoles: [],
      matchedBefore: baseFeasibility.matchedCount,
      matchedAfter: baseFeasibility.matchedCount
    }
  }));

  const ensureMinimum = <T extends { mlid: number }>(list: T[], fallbackList: T[], minCount: number) => {
    if (list.length >= minCount) return list;
    const current = [...list];
    const seen = new Set(current.map((row) => row.mlid));
    for (const row of fallbackList) {
      if (seen.has(row.mlid)) continue;
      current.push(row);
      seen.add(row.mlid);
      if (current.length >= minCount) break;
    }
    return current;
  };

  const recommendedPicks = ensureMinimum(
    recommendedPicksBase.length > 0 ? recommendedPicksBase : fallbackPicks,
    fallbackPicks,
    PICK_MIN_RECOMMENDATIONS
  ).slice(0, PICK_MAX_RECOMMENDATIONS);
  const fallbackBans = fallbackPicks.map((row) => ({ ...row, preview: null }));
  const recommendedBans = ensureMinimum(recommendedBansBase, fallbackBans, BAN_MIN_RECOMMENDATIONS).slice(
    0,
    BAN_MAX_RECOMMENDATIONS
  );

  const response = {
    recommendedPicks,
    recommendedBans,
    notes: [
      "Draft recommendations are heuristic and should be cross-checked with team comfort picks.",
      `Turn context: ${turnSide} ${turnType}.`,
      `Current missing lanes (${turnSide}): ${baseFeasibility.missingRoles.length ? baseFeasibility.missingRoles.join(", ") : "none"}.`,
      `Mode active: ${body.mode}.`,
      `Rank scope active: ${body.rankScope}.`
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
  const cacheKey = `draft:matchup:${body.timeframe}:rank=${body.rankScope}:${stableHash(ally)}:${stableHash(enemy)}`;
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
  const [allyFeasibility, enemyFeasibility, allyTopCounters, enemyTopCounters] = await Promise.all([
    Promise.resolve(evaluateDraftFeasibility(ally, rolePoolMap)),
    Promise.resolve(evaluateDraftFeasibility(enemy, rolePoolMap)),
    topCounterPairs(body.timeframe, ally, enemy, 4),
    topCounterPairs(body.timeframe, enemy, ally, 4)
  ]);

  const allyScore = allyTierPower * 8 + allyCounterEdge * 100;
  const enemyScore = enemyTierPower * 8 + enemyCounterEdge * 100;
  const diff = allyScore - enemyScore;
  const allyWinProb = (1 / (1 + Math.exp(-(diff / 12)))) * 100;
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
      enemyCounterEdge: Number(enemyCounterEdge.toFixed(4))
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

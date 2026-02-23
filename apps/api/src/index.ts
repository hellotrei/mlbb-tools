import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  computeTierResults,
  type CountersBody,
  type DraftAnalyzeBody,
  type StatsQuery,
  type TierQuery,
  countersBodySchema,
  draftAnalyzeBodySchema,
  statsQuerySchema,
  tierQuerySchema,
  type Tier,
  type TierResultRow
} from "@mlbb/shared";
import { db, heroes, heroStatsLatest, heroStatsSnapshots, tierResults, counterMatrix } from "@mlbb/db";
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
  const cacheKey = `counters:${body.timeframe}:${enemyHash}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached as Record<string, unknown>);

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

  const tierMap = await getTierMap(body.timeframe);
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
      tier: tierMap.get(row.mlid)
    }))
    .slice(0, 10);

  const response = { recommendations };
  await cacheSet(cacheKey, response, 120);

  return c.json(response);
});

app.post("/draft/analyze", zValidator("json", draftAnalyzeBodySchema), async (c) => {
  const body = c.req.valid("json") as DraftAnalyzeBody;
  const allyHash = stableHash(body.allyMlids.slice().sort((a, b) => a - b));
  const enemyHash = stableHash(body.enemyMlids.slice().sort((a, b) => a - b));
  const cacheKey = `draft:${body.timeframe}:${allyHash}:${enemyHash}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached as Record<string, unknown>);

  const picks = await db.execute<{ mlid: number; score: number }>(sql`
    SELECT
      counter_mlid AS mlid,
      AVG(score)::float8 AS score
    FROM counter_matrix
    WHERE timeframe = ${body.timeframe}
      AND enemy_mlid = ANY(${sql.raw(`ARRAY[${body.enemyMlids.join(",") || "0"}]`)})
    GROUP BY counter_mlid
    ORDER BY score DESC
    LIMIT 20
  `);
  const pickRows = picks.rows as Array<{ mlid: number; score: number }>;

  const bannedSet = new Set([...body.allyMlids, ...body.enemyMlids]);
  const tierRows = await db
    .select({ rows: tierResults.rows })
    .from(tierResults)
    .where(and(eq(tierResults.timeframe, body.timeframe), eq(tierResults.segment, "all")))
    .orderBy(desc(tierResults.computedAt))
    .limit(1);

  const tierList = ((tierRows[0]?.rows ?? []) as unknown as TierResultRow[]).filter(
    (row) => !bannedSet.has(row.mlid)
  );

  const recommendedPicks = pickRows
    .filter((row: { mlid: number; score: number }) => !bannedSet.has(row.mlid))
    .slice(0, 8)
    .map((row: { mlid: number; score: number }) => ({
      mlid: row.mlid,
      score: Number(row.score.toFixed(4)),
      reasons: ["Counter coverage", "Current timeframe strength"]
    }));

  const recommendedBans = tierList.slice(0, 8).map((row) => ({
    mlid: row.mlid,
    score: Number(row.score.toFixed(4)),
    reasons: ["Top tier threat", "High normalized impact"]
  }));

  const response = {
    recommendedPicks,
    recommendedBans,
    notes: [
      "Draft recommendations are heuristic in v1.",
      "Improve confidence by adding matchup-specific data in future milestones."
    ]
  };

  await cacheSet(cacheKey, response, 120);
  return c.json(response);
});

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
  }
);

import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
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
  closeDbPool,
  heroes,
  heroRolePool,
  heroStatsLatest,
  heroStatsSnapshots,
  tierResults,
  counterMatrix,
  counterPickHistory,
  synergyMatrix,
  tournamentEvents,
  tournamentMatches,
  tournamentRounds,
  tournamentTeams,
  telegramSessions
} from "@mlbb/db";
import { cacheGet, cachePing, cacheSet, closeCache } from "./lib/cache";
import { stableHash } from "./lib/hash";
import { analyzeM7Draft, getM7HeroCounters, getM7HeroList, getM7HeroProfile, getM7Status, matchupM7Draft } from "./lib/m7-engine";
import { analyzeMplIdDraft, getMplIdHeroCounters, getMplIdHeroList, getMplIdHeroProfile, getMplIdStatus, matchupMplIdDraft } from "./lib/mpl-id-engine";
import { analyzeMplPhDraft, getMplPhHeroCounters, getMplPhHeroList, getMplPhHeroProfile, getMplPhStatus, matchupMplPhDraft } from "./lib/mpl-ph-engine";
import { fetchCommunityCounterScores } from "./lib/supabase-counters";

const COMMUNITY_VOTES_KEY = "community:votes";
const VOTE_PRIOR_MIN = 2;
const VOTE_PRIOR_MAX = 8;

interface VotePair { heroMlid: number; counterMlid: number; }

type TournamentHeroProfile = Awaited<ReturnType<typeof getM7HeroProfile>>;
type TournamentHeroListResult = Awaited<ReturnType<typeof getM7HeroList>>;
type TournamentHeroCountersResult = Awaited<ReturnType<typeof getM7HeroCounters>>;
type TournamentAnalyzeResult = Awaited<ReturnType<typeof analyzeM7Draft>>;
type TournamentMatchupResult = Awaited<ReturnType<typeof matchupM7Draft>>;
type TournamentStatusResult = Awaited<ReturnType<typeof getM7Status>>;

type TournamentRouteRegistration = {
  slug: string;
  label: string;
  getStatus: () => Promise<TournamentStatusResult>;
  getHeroList: () => Promise<TournamentHeroListResult>;
  getHeroCounters: (mlid: number) => Promise<TournamentHeroCountersResult>;
  getHeroProfile: (mlid: number) => Promise<TournamentHeroProfile>;
  analyzeDraft: (body: DraftAnalyzeBody) => Promise<TournamentAnalyzeResult>;
  matchupDraft: (body: { allyMlids: number[]; enemyMlids: number[] }) => Promise<TournamentMatchupResult>;
};

function computeScoresFromVotePairs(
  votes: VotePair[],
  enemyMlids: number[],
  candidateMlids: number[]
): { scoreByMlid: Map<number, number>; totalVotes: number } {
  const enemySet = new Set(enemyMlids);
  const votesByEnemy = new Map<number, Map<number, number>>();
  const totalByEnemy = new Map<number, number>();

  for (const v of votes) {
    if (!enemySet.has(v.heroMlid)) continue;
    const inner = votesByEnemy.get(v.heroMlid) ?? new Map<number, number>();
    inner.set(v.counterMlid, (inner.get(v.counterMlid) ?? 0) + 1);
    votesByEnemy.set(v.heroMlid, inner);
    totalByEnemy.set(v.heroMlid, (totalByEnemy.get(v.heroMlid) ?? 0) + 1);
  }

  const numCandidates = candidateMlids.length || 1;
  const rawScores = new Map<number, number>();
  for (const candidateMlid of candidateMlids) {
    let sum = 0;
    for (const enemyMlid of enemyMlids) {
      const inner = votesByEnemy.get(enemyMlid);
      const votesFor = inner?.get(candidateMlid) ?? 0;
      const totalVotesForEnemy = totalByEnemy.get(enemyMlid) ?? 0;
      const prior = Math.max(VOTE_PRIOR_MIN, Math.min(VOTE_PRIOR_MAX, Math.sqrt(totalVotesForEnemy)));
      sum += (votesFor + prior) / (totalVotesForEnemy + prior * numCandidates);
    }
    rawScores.set(candidateMlid, sum / enemyMlids.length);
  }

  const sorted = Array.from(rawScores.values()).sort((a, b) => a - b);
  const n = sorted.length;
  const rawMin = sorted[0] ?? 0;
  const rawMax = sorted[n - 1] ?? 0;
  const scoreByMlid = new Map<number, number>();
  for (const [mlid, raw] of rawScores) {
    let rank = 0;
    for (let i = 0; i < sorted.length; i++) { if ((sorted[i] ?? 0) <= raw) rank = i; }
    const percentile = n > 1 ? rank / (n - 1) : 0.5;
    const rawNorm = rawMax > rawMin ? (raw - rawMin) / (rawMax - rawMin) : 0.5;
    scoreByMlid.set(mlid, Number((percentile * 0.6 + rawNorm * 0.4).toFixed(6)));
  }

  const totalVotes = Array.from(totalByEnemy.values()).reduce((a, b) => a + b, 0);
  return { scoreByMlid, totalVotes };
}

const tournamentHeroParamsSchema = z.object({
  mlid: z.coerce.number().int().positive()
});

const tournamentCounterParamsSchema = z.object({
  mlid: z.coerce.number().int().positive()
});

const tournamentEventIdentifierParamsSchema = z.object({
  id: z.string().trim().min(1).max(64)
});

const tournamentEventIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const tournamentMatchParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  matchId: z.coerce.number().int().positive()
});

const tournamentEventsQuerySchema = z.object({
  createdByTelegramUserId: z.string().trim().min(1).max(64).optional(),
  code: z.string().trim().min(1).max(24).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const tournamentEventModeSchema = z.enum(["regular_season", "playoffs"]);
const tournamentRegularSeasonFormatSchema = z.enum([
  "round_robin",
  "double_round_robin",
  "five_round",
  "custom_round"
]);
const tournamentPairingStrategySchema = z.enum(["default", "shuffle"]);
const playoffSemifinalBestOfSchema = z.coerce.number().int().refine((value) => [1, 3, 5].includes(value));
const playoffFinalBestOfSchema = z.coerce.number().int().refine((value) => [3, 5, 7].includes(value));

const createTournamentEventBodySchema = z.object({
  name: z.string().trim().min(3).max(160),
  eventMode: tournamentEventModeSchema.default("regular_season"),
  regularSeasonFormat: tournamentRegularSeasonFormatSchema.optional(),
  regularSeasonCustomRounds: z.coerce.number().int().min(1).max(10).optional(),
  matchBestOf: z.coerce.number().int().min(1).max(9).default(2),
  playoffSemifinalBestOf: playoffSemifinalBestOfSchema.optional(),
  playoffFinalBestOf: playoffFinalBestOfSchema.optional(),
  totalTeams: z.coerce.number().int().min(2).max(128),
  totalRounds: z.coerce.number().int().min(1).max(128),
  teamNames: z.array(z.string().trim().min(1).max(120)).min(2).max(128),
  eventDate: z.string().trim().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "eventDate must be a valid date string."
  }),
  createdByTelegramUserId: z.string().trim().min(1).max(64),
  telegramChatId: z.string().trim().min(1).max(64).optional()
}).superRefine((value, ctx) => {
  if (value.teamNames.length !== value.totalTeams) {
    ctx.addIssue({
      code: "custom",
      path: ["teamNames"],
      message: "teamNames must match totalTeams."
    });
  }

  if (value.eventMode === "regular_season" && value.totalTeams % 2 !== 0) {
    ctx.addIssue({
      code: "custom",
      path: ["totalTeams"],
      message: "regular season requires an even number of teams."
    });
  }

  if (value.eventMode === "regular_season" && !value.regularSeasonFormat) {
    ctx.addIssue({
      code: "custom",
      path: ["regularSeasonFormat"],
      message: "regularSeasonFormat is required for regular season events."
    });
  }

  if (value.regularSeasonFormat === "custom_round" && !value.regularSeasonCustomRounds) {
    ctx.addIssue({
      code: "custom",
      path: ["regularSeasonCustomRounds"],
      message: "regularSeasonCustomRounds is required for custom round events."
    });
  }

  if (value.eventMode === "playoffs" && value.matchBestOf % 2 === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["matchBestOf"],
      message: "playoffs requires an odd best-of value so every match has a winner."
    });
  }

  if (value.eventMode === "playoffs" && !value.playoffSemifinalBestOf) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffSemifinalBestOf"],
      message: "playoffSemifinalBestOf is required for playoff events."
    });
  }

  if (value.eventMode === "playoffs" && !value.playoffFinalBestOf) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffFinalBestOf"],
      message: "playoffFinalBestOf is required for playoff events."
    });
  }

  const normalized = value.teamNames.map((name) => name.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    ctx.addIssue({
      code: "custom",
      path: ["teamNames"],
      message: "team names must be unique within the event."
    });
  }

  const expectedTotalRounds = calculateTournamentTotalRounds(
    value.eventMode,
    value.totalTeams,
    value.regularSeasonFormat,
    value.regularSeasonCustomRounds
  );
  if (value.totalRounds !== expectedTotalRounds) {
    ctx.addIssue({
      code: "custom",
      path: ["totalRounds"],
      message: `totalRounds must be ${expectedTotalRounds} for the selected tournament setup.`
    });
  }
});

const updateTournamentMatchResultBodySchema = z.object({
  result: z.enum(["team_a_win", "team_b_win", "draw", "bye"]),
  scoreA: z.coerce.number().int().min(0).optional(),
  scoreB: z.coerce.number().int().min(0).optional()
});

function registerTournamentRoutes(config: TournamentRouteRegistration) {
  const { slug, label, getStatus, getHeroList, getHeroCounters, getHeroProfile, analyzeDraft, matchupDraft } = config;

  app.get(`/draft/${slug}/hero/:mlid`, zValidator("param", tournamentHeroParamsSchema), async (c) => {
    const { mlid } = c.req.valid("param");
    const profile = await getHeroProfile(mlid);
    if (!profile) {
      return c.json({ message: `${label} hero profile not found.` }, 404);
    }
    return c.json(profile);
  });

  app.get(`/draft/${slug}/status`, async (c) => {
    const status = await getStatus();
    return c.json(status, status.available ? 200 : 503);
  });

  app.get(`/tier/${slug}`, async (c) => {
    setPublicCache(c, 900, 1800);
    const cacheKey = `tier:${slug}:all`;
    const cached = await cacheGet(cacheKey);
    if (cached) return c.json(cached as Record<string, unknown>);

    const { heroes: aggregates } = await getHeroList();
    const items = aggregates.map((agg) => ({
      mlid: agg.hero.mlid,
      tier: agg.tier,
      score: Number(agg.score.toFixed(4)),
      winRate: Number(agg.winRate.toFixed(4)),
      banRate: Number(agg.banRate.toFixed(4)),
      pickRate: Number(agg.pickRate.toFixed(4)),
      picks: agg.picks,
      bans: agg.bans,
      wins: agg.wins,
      matches: agg.picks + agg.bans,
      rolePool: agg.rolePool
    }));
    const response = { items };
    await cacheSet(cacheKey, response, 900);
    return c.json(response);
  });

  app.get(`/stats/${slug}`, async (c) => {
    setPublicCache(c, 900, 1800);
    const cacheKey = `stats:${slug}:all`;
    const cached = await cacheGet(cacheKey);
    if (cached) return c.json(cached as Record<string, unknown>);

    const { heroes: aggregates } = await getHeroList();
    const items = aggregates.map((agg) => ({
      mlid: agg.hero.mlid,
      winRate: Number(agg.winRate.toFixed(4)),
      banRate: Number(agg.banRate.toFixed(4)),
      pickRate: Number(agg.pickRate.toFixed(4)),
      picks: agg.picks,
      bans: agg.bans,
      wins: agg.wins,
      matchCount: agg.picks + agg.bans,
      rolePool: agg.rolePool,
      score: Number(agg.score.toFixed(4))
    }));
    const response = { items };
    await cacheSet(cacheKey, response, 900);
    return c.json(response);
  });

  app.get(`/counters/${slug}/:mlid`, zValidator("param", tournamentCounterParamsSchema), async (c) => {
    const { mlid } = c.req.valid("param");
    setPublicCache(c, 900, 1800);
    const cacheKey = `counters:${slug}:${mlid}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return c.json(cached as Record<string, unknown>);

    const result = await getHeroCounters(mlid);
    await cacheSet(cacheKey, result, 900);
    return c.json(result);
  });

  app.post(`/draft/${slug}/analyze`, zValidator("json", draftAnalyzeBodySchema), async (c) => {
    const body = c.req.valid("json") as DraftAnalyzeBody;
    const cacheKey = `draft:${slug}:analyze:${stableHash(JSON.stringify(body))}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return c.json(cached as Record<string, unknown>);

    try {
      const response = await analyzeDraft(body);
      await cacheSet(cacheKey, response, 900);
      return c.json(response);
    } catch (error) {
      return c.json(
        { message: error instanceof Error ? error.message : `${label} draft engine is unavailable.` },
        503
      );
    }
  });

  app.post(`/draft/${slug}/matchup`, zValidator("json", draftMatchupBodySchema), async (c) => {
    const body = c.req.valid("json");
    const cacheKey = `draft:${slug}:matchup:${stableHash(JSON.stringify(body))}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return c.json(cached as Record<string, unknown>);

    try {
      const response = await matchupDraft({
        allyMlids: body.allyMlids,
        enemyMlids: body.enemyMlids
      });
      await cacheSet(cacheKey, response, 900);
      return c.json(response);
    } catch (error) {
      return c.json(
        { message: error instanceof Error ? error.message : `${label} matchup engine is unavailable.` },
        503
      );
    }
  });
}

const COUNTER_BLEND_DEFAULTS = {
  community: 0.55,
  counter: 0.25,
  tier: 0.20
} as const;

const COUNTER_BLEND_KEYS = ["community", "counter", "tier"] as const;
type CounterBlendKey = (typeof COUNTER_BLEND_KEYS)[number];
type CachedHeroCatalogRow = {
  mlid: number;
  name: string;
  rolePrimary: string;
  roleSecondary: string | null;
  lanes: string[];
  specialities: string[];
};
type CachedRolePoolEntry = {
  mlid: number;
  lanes: string[];
};
type CachedRankStatsRow = {
  mlid: number;
  winRate: number;
  banRate: number;
  pickRate: number;
};

function parseWeightValue(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const numeric = Number.parseFloat(trimmed.replace("%", ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (trimmed.includes("%") || numeric > 1) return numeric / 100;
  return numeric;
}

function parseEnvNumber(raw: string | undefined, fallback: number, min?: number, max?: number) {
  const value = Number.parseFloat((raw ?? "").trim());
  if (!Number.isFinite(value)) return fallback;
  let out = value;
  if (typeof min === "number") out = Math.max(min, out);
  if (typeof max === "number") out = Math.min(max, out);
  return out;
}

function parseEnvRatio(raw: string | undefined, fallback: number) {
  if (!raw || !raw.trim()) return fallback;
  const parsed = parseWeightValue(raw);
  if (parsed === null || !Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function parseCounterBlendConfig(
  rawWeights: string | undefined,
  rawSources: string | undefined,
  rawCoverageMin: string | undefined
) {
  const activeSources = new Set<CounterBlendKey>();
  const sourceParts = (rawSources ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (sourceParts.length === 0) {
    COUNTER_BLEND_KEYS.forEach((key) => activeSources.add(key));
  } else {
    for (const part of sourceParts) {
      if ((COUNTER_BLEND_KEYS as readonly string[]).includes(part)) {
        activeSources.add(part as CounterBlendKey);
      }
    }
    if (activeSources.size === 0) {
      COUNTER_BLEND_KEYS.forEach((key) => activeSources.add(key));
    }
  }

  const parsed: Record<CounterBlendKey, number> = {
    community: COUNTER_BLEND_DEFAULTS.community,
    counter: COUNTER_BLEND_DEFAULTS.counter,
    tier: COUNTER_BLEND_DEFAULTS.tier
  };

  for (const entry of (rawWeights ?? "").split(/[;,]/).map((part) => part.trim()).filter(Boolean)) {
    const [left, right] = entry.split("=").map((part) => part.trim().toLowerCase());
    if (!left || !right) continue;
    if (!(COUNTER_BLEND_KEYS as readonly string[]).includes(left)) continue;
    const parsedWeight = parseWeightValue(right);
    if (parsedWeight === null) continue;
    parsed[left as CounterBlendKey] = parsedWeight;
  }

  for (const key of COUNTER_BLEND_KEYS) {
    if (!activeSources.has(key)) parsed[key] = 0;
  }

  const weightSum = COUNTER_BLEND_KEYS.reduce((sum, key) => sum + parsed[key], 0);
  if (weightSum <= 0) {
    for (const key of COUNTER_BLEND_KEYS) {
      parsed[key] = COUNTER_BLEND_DEFAULTS[key];
    }
  } else {
    for (const key of COUNTER_BLEND_KEYS) {
      parsed[key] = parsed[key] / weightSum;
    }
  }

  const coverageParsed = Number.parseFloat((rawCoverageMin ?? "").trim());
  const coverageMin = Number.isFinite(coverageParsed) ? Math.max(0, Math.min(1, coverageParsed)) : 0.85;

  return {
    community: parsed.community,
    counter: parsed.counter,
    tier: parsed.tier,
    coverageMin
  };
}

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
loadEnv({ path: resolve(process.cwd(), "../../.env.local"), override: true });

function setPublicCache(c: Context, sMaxAgeSeconds: number, staleWhileRevalidateSeconds: number) {
  c.header("Cache-Control", `public, max-age=60, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`);
}

const counterBlendConfig = parseCounterBlendConfig(
  process.env.COUNTERS_BLEND_WEIGHTS,
  process.env.COUNTERS_BLEND_SOURCES,
  process.env.COUNTERS_COVERAGE_MULT_MIN
);
const COUNTER_W = counterBlendConfig.counter;
const COMMUNITY_W = counterBlendConfig.community;
const TIER_W = counterBlendConfig.tier;
const COVERAGE_MULT_MIN = counterBlendConfig.coverageMin;

const DRAFT_COUNTER_LANE_SATURATION_PENALTY_MAX = parseEnvRatio(
  process.env.DRAFT_COUNTER_LANE_SATURATION_PENALTY_MAX,
  0.18
);
const DRAFT_COUNTER_FLEX_EARLY_BONUS = parseEnvRatio(
  process.env.DRAFT_COUNTER_FLEX_EARLY_BONUS,
  0.1
);
const DRAFT_COUNTER_FLEX_MID_BONUS = parseEnvRatio(
  process.env.DRAFT_COUNTER_FLEX_MID_BONUS,
  0.06
);
const DRAFT_COUNTER_UNCERTAINTY_MAX = parseEnvRatio(
  process.env.DRAFT_COUNTER_UNCERTAINTY_MAX,
  0.35
);
const DRAFT_COUNTER_COMMUNITY_DAMPING_MIN = parseEnvRatio(
  process.env.DRAFT_COUNTER_COMMUNITY_DAMPING_MIN,
  0.45
);
const DRAFT_COUNTER_COMMUNITY_VOTE_REF = parseEnvNumber(
  process.env.DRAFT_COUNTER_COMMUNITY_VOTE_REF,
  250,
  1
);
const DRAFT_COUNTER_DIVERSITY_ROLE_PENALTY = parseEnvRatio(
  process.env.DRAFT_COUNTER_DIVERSITY_ROLE_PENALTY,
  0.06
);
const DRAFT_COUNTER_DIVERSITY_ARCHETYPE_PENALTY = parseEnvRatio(
  process.env.DRAFT_COUNTER_DIVERSITY_ARCHETYPE_PENALTY,
  0.04
);
const DRAFT_COUNTER_DIVERSITY_LANE_PENALTY = parseEnvRatio(
  process.env.DRAFT_COUNTER_DIVERSITY_LANE_PENALTY,
  0.05
);
const DRAFT_COUNTER_DIVERSITY_FLOOR = parseEnvRatio(
  process.env.DRAFT_COUNTER_DIVERSITY_FLOOR,
  0.35
);

const port = Number(process.env.API_PORT ?? 8787);
const app = new Hono();
type SqlCondition = ReturnType<typeof sql>;
const corsOrigins = (process.env.CORS_ORIGINS ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAnyOrigin = corsOrigins.includes("*");
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (allowAnyOrigin) return origin ?? "*";
      if (!origin) return corsOrigins[0] ?? "";
      return corsOrigins.includes(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  })
);
app.use("*", compress());

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  const durationMs = Date.now() - startedAt;
  console.info(`[api] ${c.req.method} ${c.req.path} ${c.res.status} ${durationMs}ms`);
});

app.use("*", async (c, next) => {
  const forwarded = c.req.header("x-forwarded-for") ?? "";
  const clientIp = forwarded.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientIp);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json({ error: "Too many requests" }, 429);
  } else {
    bucket.count += 1;
  }
  await next();
});

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

type TournamentEventRecord = typeof tournamentEvents.$inferSelect;
type TournamentTeamRecord = typeof tournamentTeams.$inferSelect;
type TournamentRoundRecord = typeof tournamentRounds.$inferSelect;
type TournamentMatchRecord = typeof tournamentMatches.$inferSelect;
type TournamentEventMode = z.infer<typeof tournamentEventModeSchema>;
type TournamentRegularSeasonFormat = z.infer<typeof tournamentRegularSeasonFormatSchema>;
type TournamentPairingStrategy = z.infer<typeof tournamentPairingStrategySchema>;
type TournamentStandingRow = {
  teamId: number;
  teamName: string;
  seed: number | null;
  played: number;
  win: number;
  lose: number;
  draw: number;
  bye: number;
  score: number;
  headToHead: number;
  buchholz: number;
  pointDiff: number;
  opponents: number[];
  opponentPoints: Map<number, number>;
};

type TournamentMatchResultValue = "team_a_win" | "team_b_win" | "draw" | "bye";

const TOURNAMENT_STANDING_WIN_POINTS = 1;
const TOURNAMENT_STANDING_DRAW_POINTS = 0.5;
const TOURNAMENT_STANDING_LOSS_POINTS = 0;
const TOURNAMENT_STANDING_BYE_POINTS = 1;

function normalizeTournamentEventMode(value: string | null | undefined): TournamentEventMode {
  return value === "playoffs" ? "playoffs" : "regular_season";
}

function getTournamentEventMode(event: Pick<TournamentEventRecord, "eventMode" | "format">) {
  return normalizeTournamentEventMode(event.eventMode || event.format);
}

function normalizeTournamentRegularSeasonFormat(
  value: string | null | undefined,
  totalRounds = 0
): TournamentRegularSeasonFormat {
  if (value === "double_round_robin") return "double_round_robin";
  if (value === "five_round") return "five_round";
  if (value === "custom_round") return "custom_round";
  if (value === "round_robin") return "round_robin";
  if (value === "swiss") {
    if (totalRounds === 5) return "five_round";
    return "custom_round";
  }
  return "round_robin";
}

function getTournamentRegularSeasonFormat(
  event: Pick<TournamentEventRecord, "eventMode" | "format" | "totalRounds">
) {
  if (getTournamentEventMode(event) !== "regular_season") return null;
  return normalizeTournamentRegularSeasonFormat(event.format, event.totalRounds);
}

function getTournamentMatchBestOf(event: Pick<TournamentEventRecord, "matchBestOf">) {
  return Math.max(1, event.matchBestOf || 2);
}

function getTournamentRoundBestOf(
  event: Pick<
    TournamentEventRecord,
    "eventMode" | "format" | "totalRounds" | "matchBestOf" | "playoffSemifinalBestOf" | "playoffFinalBestOf"
  >,
  roundNumber: number
) {
  const eventMode = getTournamentEventMode(event);
  if (eventMode !== "playoffs") {
    return getTournamentMatchBestOf(event);
  }

  if (roundNumber >= event.totalRounds) {
    return Math.max(3, event.playoffFinalBestOf || 5);
  }

  if (event.totalRounds > 1 && roundNumber === event.totalRounds - 1) {
    return Math.max(1, event.playoffSemifinalBestOf || event.matchBestOf || 1);
  }

  return getTournamentMatchBestOf(event);
}

function formatTournamentRegularSeasonFormatLabel(format: TournamentRegularSeasonFormat | null | undefined) {
  if (format === "double_round_robin") return "Double Round Robin";
  if (format === "five_round") return "5 Round";
  if (format === "custom_round") return "Custom Round";
  return "Round Robin";
}

function tournamentUsesFlexiblePairings(
  event: Pick<TournamentEventRecord, "eventMode" | "format" | "totalRounds">
) {
  const eventMode = getTournamentEventMode(event);
  if (eventMode === "playoffs") return true;
  const regularSeasonFormat = getTournamentRegularSeasonFormat(event);
  return regularSeasonFormat === "five_round" || regularSeasonFormat === "custom_round";
}

function getTournamentRequiredWins(mode: TournamentEventMode, matchBestOf: number) {
  return Math.floor(matchBestOf / 2) + 1;
}

function tournamentAllowsBo1RegularSeasonDraw(mode: TournamentEventMode, matchBestOf: number) {
  return mode === "regular_season" && matchBestOf === 1;
}

function tournamentUsesDrawSeries(mode: TournamentEventMode, matchBestOf: number) {
  return mode === "regular_season" && matchBestOf % 2 === 0;
}

function getTournamentByeScore(mode: TournamentEventMode, matchBestOf: number) {
  if (tournamentUsesDrawSeries(mode, matchBestOf)) {
    return { scoreA: matchBestOf, scoreB: 0 };
  }
  return { scoreA: getTournamentRequiredWins(mode, matchBestOf), scoreB: 0 };
}

function getTournamentResultScore(
  result: TournamentMatchResultValue,
  eventMode: TournamentEventMode,
  matchBestOf: number
) {
  if (tournamentAllowsBo1RegularSeasonDraw(eventMode, matchBestOf)) {
    if (result === "team_a_win") return { scoreA: 1, scoreB: 0 };
    if (result === "team_b_win") return { scoreA: 0, scoreB: 1 };
    if (result === "draw") return { scoreA: 0, scoreB: 0 };
    return { scoreA: 1, scoreB: 0 };
  }

  if (tournamentUsesDrawSeries(eventMode, matchBestOf)) {
    if (result === "team_a_win") return { scoreA: matchBestOf, scoreB: 0 };
    if (result === "team_b_win") return { scoreA: 0, scoreB: matchBestOf };
    if (result === "draw") return { scoreA: matchBestOf / 2, scoreB: matchBestOf / 2 };
    return { scoreA: matchBestOf, scoreB: 0 };
  }

  const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
  if (result === "team_a_win") return { scoreA: requiredWins, scoreB: 0 };
  if (result === "team_b_win") return { scoreA: 0, scoreB: requiredWins };
  if (result === "draw") {
    const drawScore = Math.floor(matchBestOf / 2);
    return { scoreA: drawScore, scoreB: drawScore };
  }
  return getTournamentByeScore(eventMode, matchBestOf);
}

function resolveTournamentMatchResult(
  eventMode: TournamentEventMode,
  matchBestOf: number,
  scoreA: number,
  scoreB: number,
  hasOpponent: boolean
) {
  if (!hasOpponent) {
    const byeScore = getTournamentByeScore(eventMode, matchBestOf);
    if (scoreA !== byeScore.scoreA || scoreB !== byeScore.scoreB) {
      return { error: `Bye result must use a ${byeScore.scoreA}-${byeScore.scoreB} score.` };
    }
    return { result: "bye" as const, winnerTeamIdSide: "team_a" as const };
  }

  if (scoreA < 0 || scoreB < 0) {
    return { error: "Scores must be zero or greater." };
  }

  if (eventMode === "playoffs") {
    const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
    if (scoreA === scoreB) {
      return { error: "Playoff matches must produce a winner." };
    }
    if (Math.max(scoreA, scoreB) !== requiredWins || Math.min(scoreA, scoreB) >= requiredWins) {
      return { error: `Playoff BO${matchBestOf} matches must finish when one team reaches ${requiredWins} win(s).` };
    }
    return {
      result: (scoreA > scoreB ? "team_a_win" : "team_b_win") as const,
      winnerTeamIdSide: (scoreA > scoreB ? "team_a" : "team_b") as const
    };
  }

  if (tournamentAllowsBo1RegularSeasonDraw(eventMode, matchBestOf)) {
    if (scoreA === 0 && scoreB === 0) {
      return { result: "draw" as const, winnerTeamIdSide: null };
    }
    if ((scoreA === 1 && scoreB === 0) || (scoreA === 0 && scoreB === 1)) {
      return {
        result: (scoreA > scoreB ? "team_a_win" : "team_b_win") as const,
        winnerTeamIdSide: (scoreA > scoreB ? "team_a" : "team_b") as const
      };
    }
    return { error: "Regular season BO1 matches must use 1-0, 0-1, or 0-0 for Draw (20m+)." };
  }

  if (tournamentUsesDrawSeries(eventMode, matchBestOf)) {
    if (scoreA + scoreB !== matchBestOf) {
      return { error: `Regular season BO${matchBestOf} matches must use exactly ${matchBestOf} game(s).` };
    }
    if (scoreA === scoreB) {
      return { result: "draw" as const, winnerTeamIdSide: null };
    }
    return {
      result: (scoreA > scoreB ? "team_a_win" : "team_b_win") as const,
      winnerTeamIdSide: (scoreA > scoreB ? "team_a" : "team_b") as const
    };
  }

  const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
  if (scoreA === scoreB) {
    return { error: `BO${matchBestOf} matches must produce a winner.` };
  }
  if (Math.max(scoreA, scoreB) !== requiredWins || Math.min(scoreA, scoreB) >= requiredWins) {
    return { error: `BO${matchBestOf} matches must finish when one team reaches ${requiredWins} win(s).` };
  }
  return {
    result: (scoreA > scoreB ? "team_a_win" : "team_b_win") as const,
    winnerTeamIdSide: (scoreA > scoreB ? "team_a" : "team_b") as const
  };
}

function validateTournamentResultScore(
  result: TournamentMatchResultValue,
  scoreA: number,
  scoreB: number,
  hasOpponent: boolean,
  eventMode: TournamentEventMode,
  matchBestOf: number
) {
  const resolved = resolveTournamentMatchResult(eventMode, matchBestOf, scoreA, scoreB, hasOpponent);
  if ("error" in resolved) return resolved.error;
  return resolved.result === result ? null : "Submitted score does not match the selected result.";
}

function compareTournamentStandingRows(left: TournamentStandingRow, right: TournamentStandingRow) {
  if (right.score !== left.score) return right.score - left.score;
  if (right.headToHead !== left.headToHead) return right.headToHead - left.headToHead;
  if (right.buchholz !== left.buchholz) return right.buchholz - left.buchholz;
  if (right.pointDiff !== left.pointDiff) return right.pointDiff - left.pointDiff;
  if (right.win !== left.win) return right.win - left.win;
  if (left.lose !== right.lose) return left.lose - right.lose;
  if (left.bye !== right.bye) return left.bye - right.bye;
  if (right.draw !== left.draw) return right.draw - left.draw;
  if (right.played !== left.played) return right.played - left.played;

  const leftSeed = left.seed ?? Number.MAX_SAFE_INTEGER;
  const rightSeed = right.seed ?? Number.MAX_SAFE_INTEGER;
  if (leftSeed !== rightSeed) return leftSeed - rightSeed;

  return left.teamName.localeCompare(right.teamName);
}

function formatTournamentPointDiff(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function generateTournamentEventCode() {
  return `EVT-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function createUniqueTournamentEventCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateTournamentEventCode();
    const [existing] = await db
      .select({ id: tournamentEvents.id })
      .from(tournamentEvents)
      .where(eq(tournamentEvents.code, code))
      .limit(1);
    if (!existing) return code;
  }

  throw new Error("Failed to generate a unique event code.");
}

function serializeTournamentEvent(event: TournamentEventRecord) {
  return {
    id: event.id,
    code: event.code,
    name: event.name,
    format: event.format,
    eventMode: getTournamentEventMode(event),
    regularSeasonFormat: getTournamentRegularSeasonFormat(event),
    matchBestOf: getTournamentMatchBestOf(event),
    playoffSemifinalBestOf: event.playoffSemifinalBestOf,
    playoffFinalBestOf: event.playoffFinalBestOf,
    totalTeams: event.totalTeams,
    totalRounds: event.totalRounds,
    eventDate: event.eventDate.toISOString(),
    status: event.status,
    createdByTelegramUserId: event.createdByTelegramUserId,
    telegramChatId: event.telegramChatId,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

function buildInitialSwissMatches(
  teams: Array<{ id: number; name: string; seed: number | null }>
) {
  const orderedTeams = teams
    .slice()
    .sort((left, right) => (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER));
  const half = Math.ceil(orderedTeams.length / 2);
  const topHalf = orderedTeams.slice(0, half);
  const bottomHalf = orderedTeams.slice(half);
  const matches: Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }> = [];

  for (let index = 0; index < topHalf.length; index += 1) {
    const teamA = topHalf[index];
    const teamB = bottomHalf[index] ?? null;
    if (!teamA) continue;
    matches.push({
      teamAId: teamA.id,
      teamBId: teamB?.id ?? null,
      result: teamB ? "pending" : "bye",
      pairingOrder: matches.length + 1,
      winnerTeamId: teamB ? null : teamA.id
    });
  }

  return matches;
}

function buildRoundRobinSchedule(
  teams: Array<{ id: number; seed: number | null }>
) {
  const participants = sortTeamsBySeed(teams).map((team) => team.id);
  if (participants.length === 0) return [] as Array<Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }>>;

  const working: Array<number | null> = participants.slice();
  if (working.length % 2 === 1) {
    working.push(null);
  }

  const rounds: Array<Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }>> = [];

  for (let roundIndex = 0; roundIndex < working.length - 1; roundIndex += 1) {
    const roundPairings: Array<{
      teamAId: number;
      teamBId: number | null;
      result: "pending" | "bye";
      pairingOrder: number;
      winnerTeamId: number | null;
    }> = [];

    for (let index = 0; index < working.length / 2; index += 1) {
      let teamAId = working[index] ?? null;
      let teamBId = working[working.length - 1 - index] ?? null;
      if (index === 0 && roundIndex % 2 === 1) {
        [teamAId, teamBId] = [teamBId, teamAId];
      }

      if (!teamAId && !teamBId) continue;
      if (!teamAId || !teamBId) {
        const byeTeamId = teamAId ?? teamBId;
        if (!byeTeamId) continue;
        roundPairings.push({
          teamAId: byeTeamId,
          teamBId: null,
          result: "bye",
          pairingOrder: roundPairings.length + 1,
          winnerTeamId: byeTeamId
        });
        continue;
      }

      roundPairings.push({
        teamAId,
        teamBId,
        result: "pending",
        pairingOrder: roundPairings.length + 1,
        winnerTeamId: null
      });
    }

    rounds.push(roundPairings);

    const fixed = working[0];
    const rotating = working.slice(1);
    const last = rotating.pop();
    if (last === undefined) break;
    working.splice(0, working.length, fixed, last, ...rotating);
  }

  return rounds;
}

function buildRoundRobinRoundPairings(
  teams: Array<{ id: number; seed: number | null }>,
  roundNumber: number,
  format: TournamentRegularSeasonFormat
) {
  const baseSchedule = buildRoundRobinSchedule(teams);
  if (baseSchedule.length === 0) {
    return [] as Array<{
      teamAId: number;
      teamBId: number | null;
      result: "pending" | "bye";
      pairingOrder: number;
      winnerTeamId: number | null;
    }>;
  }

  if (format !== "double_round_robin") {
    const roundPairings = baseSchedule[roundNumber - 1] ?? [];
    return roundPairings.map((pairing, index) => ({
      ...pairing,
      pairingOrder: index + 1
    }));
  }

  const baseRoundIndex = Math.floor((roundNumber - 1) / 2);
  const roundPairings = baseSchedule[baseRoundIndex] ?? [];
  const reverseSides = roundNumber % 2 === 0;

  return roundPairings.map((pairing, index) => {
    if (!reverseSides) {
      return {
        ...pairing,
        pairingOrder: index + 1
      };
    }

    return {
      teamAId: pairing.teamBId ?? pairing.teamAId,
      teamBId: pairing.teamBId ? pairing.teamAId : null,
      result: pairing.teamBId ? "pending" : "bye",
      pairingOrder: index + 1,
      winnerTeamId: pairing.teamBId ? null : pairing.teamAId
    };
  });
}

function buildTournamentBracket(
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  teams: TournamentTeamRecord[]
) {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const matchesByRound = new Map<number, TournamentMatchRecord[]>();

  for (const match of matches) {
    const bucket = matchesByRound.get(match.roundId) ?? [];
    bucket.push(match);
    matchesByRound.set(match.roundId, bucket);
  }

  return rounds
    .slice()
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      createdAt: round.createdAt.toISOString(),
      matches: (matchesByRound.get(round.id) ?? [])
        .slice()
        .sort((left, right) => left.pairingOrder - right.pairingOrder)
        .map((match) => ({
          id: match.id,
          pairingOrder: match.pairingOrder,
          result: match.result,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          winnerTeamId: match.winnerTeamId,
          updatedAt: match.updatedAt.toISOString(),
          teamA: (() => {
            const team = teamById.get(match.teamAId);
            return team ? { id: team.id, name: team.name, seed: team.seed, captainWhatsapp: team.captainWhatsapp } : null;
          })(),
          teamB: (() => {
            const team = match.teamBId ? teamById.get(match.teamBId) : null;
            return team ? { id: team.id, name: team.name, seed: team.seed, captainWhatsapp: team.captainWhatsapp } : null;
          })()
        }))
    }));
}

function buildTournamentStandingRows(teams: TournamentTeamRecord[], matches: TournamentMatchRecord[]) {
  const rows = new Map(
    teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        teamName: team.name,
        seed: team.seed,
        played: 0,
        win: 0,
        lose: 0,
        draw: 0,
        bye: 0,
        score: 0,
        headToHead: 0,
        buchholz: 0,
        pointDiff: 0,
        opponents: [] as number[],
        opponentPoints: new Map<number, number>()
      } as TournamentStandingRow
    ])
  );

  for (const match of matches) {
    if (match.result === "pending") continue;

    const teamA = rows.get(match.teamAId);
    const teamB = match.teamBId ? rows.get(match.teamBId) : null;
    if (!teamA) continue;

    if (match.result === "bye") {
      teamA.played += 1;
      teamA.bye += 1;
      teamA.score += TOURNAMENT_STANDING_BYE_POINTS;
      continue;
    }

    if (!teamB) continue;

    const scoreA = match.scoreA ?? 0;
    const scoreB = match.scoreB ?? 0;

    teamA.played += 1;
    teamB.played += 1;
    teamA.pointDiff += scoreA - scoreB;
    teamB.pointDiff += scoreB - scoreA;
    teamA.opponents.push(teamB.teamId);
    teamB.opponents.push(teamA.teamId);

    if (match.result === "team_a_win") {
      teamA.win += 1;
      teamB.lose += 1;
      teamA.score += TOURNAMENT_STANDING_WIN_POINTS;
      teamB.score += TOURNAMENT_STANDING_LOSS_POINTS;
      teamA.opponentPoints.set(teamB.teamId, (teamA.opponentPoints.get(teamB.teamId) ?? 0) + TOURNAMENT_STANDING_WIN_POINTS);
      teamB.opponentPoints.set(teamA.teamId, (teamB.opponentPoints.get(teamA.teamId) ?? 0) + TOURNAMENT_STANDING_LOSS_POINTS);
      continue;
    }

    if (match.result === "team_b_win") {
      teamB.win += 1;
      teamA.lose += 1;
      teamB.score += TOURNAMENT_STANDING_WIN_POINTS;
      teamA.score += TOURNAMENT_STANDING_LOSS_POINTS;
      teamB.opponentPoints.set(teamA.teamId, (teamB.opponentPoints.get(teamA.teamId) ?? 0) + TOURNAMENT_STANDING_WIN_POINTS);
      teamA.opponentPoints.set(teamB.teamId, (teamA.opponentPoints.get(teamB.teamId) ?? 0) + TOURNAMENT_STANDING_LOSS_POINTS);
      continue;
    }

    if (match.result === "draw") {
      teamA.draw += 1;
      teamB.draw += 1;
      teamA.score += TOURNAMENT_STANDING_DRAW_POINTS;
      teamB.score += TOURNAMENT_STANDING_DRAW_POINTS;
      teamA.opponentPoints.set(teamB.teamId, (teamA.opponentPoints.get(teamB.teamId) ?? 0) + TOURNAMENT_STANDING_DRAW_POINTS);
      teamB.opponentPoints.set(teamA.teamId, (teamB.opponentPoints.get(teamA.teamId) ?? 0) + TOURNAMENT_STANDING_DRAW_POINTS);
    }
  }

  const ordered = Array.from(rows.values());
  for (const row of ordered) {
    row.buchholz = Number(
      row.opponents.reduce((sum, opponentId) => sum + (rows.get(opponentId)?.score ?? 0), 0).toFixed(2)
    );
    row.score = Number(row.score.toFixed(2));
  }

  const scoreGroups = new Map<number, TournamentStandingRow[]>();
  for (const row of ordered) {
    const bucket = scoreGroups.get(row.score) ?? [];
    bucket.push(row);
    scoreGroups.set(row.score, bucket);
  }

  for (const group of scoreGroups.values()) {
    for (const row of group) {
      row.headToHead = Number(
        group
          .filter((candidate) => candidate.teamId !== row.teamId)
          .reduce((sum, candidate) => sum + (row.opponentPoints.get(candidate.teamId) ?? 0), 0)
          .toFixed(2)
      );
    }
  }

  ordered.sort(compareTournamentStandingRows);

  return ordered;
}

function buildTournamentStandings(teams: TournamentTeamRecord[], matches: TournamentMatchRecord[]) {
  return buildTournamentStandingRows(teams, matches).map((row, index) => ({
    rank: index + 1,
    teamId: row.teamId,
    teamName: row.teamName,
    seed: row.seed,
    played: row.played,
    win: row.win,
    lose: row.lose,
    draw: row.draw,
    bye: row.bye,
    score: row.score,
    headToHead: row.headToHead,
    buchholz: row.buchholz,
    pointDiff: row.pointDiff
  }));
}

function tournamentMatchupKey(teamAId: number, teamBId: number) {
  return teamAId < teamBId ? `${teamAId}:${teamBId}` : `${teamBId}:${teamAId}`;
}

function buildSwissScoreGroups(standings: TournamentStandingRow[]) {
  const groups: TournamentStandingRow[][] = [];

  for (const row of standings) {
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup[0]?.score !== row.score) {
      groups.push([row]);
      continue;
    }

    lastGroup.push(row);
  }

  for (let index = 0; index < groups.length - 1; index += 1) {
    const group = groups[index];
    if (!group || group.length % 2 === 0) continue;

    const floated = group.pop();
    if (!floated) continue;

    groups[index + 1]?.unshift(floated);
  }

  return groups;
}

function findBestSwissOpponentIndex(
  current: TournamentStandingRow,
  queue: TournamentStandingRow[],
  rematchKeys: Set<string>
) {
  let bestIndex = -1;

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (!candidate) continue;

    if (bestIndex < 0) {
      bestIndex = index;
      continue;
    }

    const bestCandidate = queue[bestIndex];
    if (!bestCandidate) {
      bestIndex = index;
      continue;
    }

    const candidateIsRematch = rematchKeys.has(tournamentMatchupKey(current.teamId, candidate.teamId));
    const bestIsRematch = rematchKeys.has(tournamentMatchupKey(current.teamId, bestCandidate.teamId));
    if (candidateIsRematch !== bestIsRematch) {
      if (!candidateIsRematch) bestIndex = index;
      continue;
    }

    const candidateScoreGap = Math.abs(current.score - candidate.score);
    const bestScoreGap = Math.abs(current.score - bestCandidate.score);
    if (candidateScoreGap !== bestScoreGap) {
      if (candidateScoreGap < bestScoreGap) bestIndex = index;
      continue;
    }

    if (compareTournamentStandingRows(candidate, bestCandidate) < 0) {
      bestIndex = index;
    }
  }

  return bestIndex;
}

function appendSwissPairings(
  queue: TournamentStandingRow[],
  rematchKeys: Set<string>,
  pairings: Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }>
) {
  while (queue.length > 1) {
    const current = queue.shift();
    if (!current) break;

    let opponentIndex = findBestSwissOpponentIndex(current, queue, rematchKeys);
    if (opponentIndex < 0) opponentIndex = 0;

    const [opponent] = queue.splice(opponentIndex, 1);
    if (!opponent) {
      queue.unshift(current);
      break;
    }

    pairings.push({
      teamAId: current.teamId,
      teamBId: opponent.teamId,
      result: "pending",
      pairingOrder: pairings.length + 1,
      winnerTeamId: null
    });
    rematchKeys.add(tournamentMatchupKey(current.teamId, opponent.teamId));
  }
}

function buildSwissRoundPairings(teams: TournamentTeamRecord[], matches: TournamentMatchRecord[]) {
  const standings = buildTournamentStandingRows(teams, matches);
  const rematchKeys = new Set(
    matches
      .filter((match) => match.teamBId && match.result !== "pending")
      .map((match) => tournamentMatchupKey(match.teamAId, match.teamBId as number))
  );

  let byeTeamId: number | null = null;
  if (standings.length % 2 === 1) {
    const byePool = standings.filter((row) => row.bye === 0);
    const targetPool = byePool.length > 0 ? byePool : standings;
    byeTeamId = targetPool[targetPool.length - 1]?.teamId ?? null;
  }

  const queue = standings.filter((row) => row.teamId !== byeTeamId);
  const pairings: Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }> = [];

  const scoreGroups = buildSwissScoreGroups(queue);
  for (const group of scoreGroups) {
    appendSwissPairings(group.slice(), rematchKeys, pairings);
  }

  const pairedTeamIds = new Set(
    pairings.flatMap((pairing) => [pairing.teamAId, pairing.teamBId].filter((teamId): teamId is number => teamId !== null))
  );
  const leftovers = queue.filter((row) => !pairedTeamIds.has(row.teamId));
  if (leftovers.length > 1) {
    appendSwissPairings(leftovers, rematchKeys, pairings);
  }

  if (byeTeamId) {
    pairings.push({
      teamAId: byeTeamId,
      teamBId: null,
      result: "bye",
      pairingOrder: pairings.length + 1,
      winnerTeamId: byeTeamId
    });
  }

  return pairings;
}

function calculateTournamentTotalRounds(
  eventMode: TournamentEventMode,
  totalTeams: number,
  regularSeasonFormat?: TournamentRegularSeasonFormat,
  regularSeasonCustomRounds?: number
) {
  if (eventMode === "playoffs") {
    return Math.max(1, Math.ceil(Math.log2(Math.max(2, totalTeams))));
  }

  const format = normalizeTournamentRegularSeasonFormat(regularSeasonFormat, regularSeasonCustomRounds ?? 0);
  if (format === "double_round_robin") {
    return Math.max(1, (totalTeams - 1) * 2);
  }
  if (format === "five_round") {
    return 5;
  }
  if (format === "custom_round") {
    return Math.max(1, Math.min(10, regularSeasonCustomRounds ?? 1));
  }
  return Math.max(1, totalTeams - 1);
}

function sortTeamsBySeed<T extends { seed: number | null }>(teams: T[]) {
  return teams
    .slice()
    .sort((left, right) => (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER));
}

function shuffleInPlace<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = randomBytes(4).readUInt32BE(0) % (index + 1);
    const current = items[index];
    items[index] = items[randomIndex] as T;
    items[randomIndex] = current as T;
  }
  return items;
}

function buildTournamentMatchupCountMap(matches: TournamentMatchRecord[]) {
  const counts = new Map<string, number>();
  for (const match of matches) {
    if (!match.teamBId || match.result === "pending") continue;
    const key = tournamentMatchupKey(match.teamAId, match.teamBId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function buildRecentOpponentsMap(rounds: TournamentRoundRecord[], matches: TournamentMatchRecord[], recentRoundCount = 2) {
  const recentRoundIds = rounds
    .slice()
    .sort((left, right) => right.roundNumber - left.roundNumber)
    .slice(0, recentRoundCount)
    .map((round) => round.id);
  const recentRoundIdSet = new Set(recentRoundIds);
  const opponentsByTeam = new Map<number, Set<number>>();

  for (const match of matches) {
    if (!match.teamBId || match.result === "pending" || !recentRoundIdSet.has(match.roundId)) continue;
    const teamAOpponents = opponentsByTeam.get(match.teamAId) ?? new Set<number>();
    teamAOpponents.add(match.teamBId);
    opponentsByTeam.set(match.teamAId, teamAOpponents);

    const teamBOpponents = opponentsByTeam.get(match.teamBId) ?? new Set<number>();
    teamBOpponents.add(match.teamAId);
    opponentsByTeam.set(match.teamBId, teamBOpponents);
  }

  return opponentsByTeam;
}

function buildSeededKnockoutPairings(
  teams: Array<{ id: number; seed: number | null }>
) {
  const orderedTeams = sortTeamsBySeed(teams);
  const queue = orderedTeams.slice();
  const pairings: Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }> = [];

  if (queue.length % 2 === 1) {
    const byeTeam = queue.shift();
    if (byeTeam) {
      pairings.push({
        teamAId: byeTeam.id,
        teamBId: null,
        result: "bye",
        pairingOrder: pairings.length + 1,
        winnerTeamId: byeTeam.id
      });
    }
  }

  while (queue.length > 1) {
    const teamA = queue.shift();
    const teamB = queue.pop();
    if (!teamA) break;
    pairings.push({
      teamAId: teamA.id,
      teamBId: teamB?.id ?? null,
      result: teamB ? "pending" : "bye",
      pairingOrder: pairings.length + 1,
      winnerTeamId: teamB ? null : teamA.id
    });
  }

  return pairings;
}

function pickShuffleOpponentIndex(
  currentTeamId: number,
  candidates: Array<{ teamId: number }>,
  matchupCounts: Map<string, number>,
  recentOpponents: Map<number, Set<number>>
) {
  const recentSet = recentOpponents.get(currentTeamId) ?? new Set<number>();
  const phases = [
    (candidateId: number) =>
      (matchupCounts.get(tournamentMatchupKey(currentTeamId, candidateId)) ?? 0) < 2 && !recentSet.has(candidateId),
    (candidateId: number) =>
      (matchupCounts.get(tournamentMatchupKey(currentTeamId, candidateId)) ?? 0) < 2,
    () => true
  ];

  for (const phase of phases) {
    const indexes = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => phase(candidate.teamId))
      .map(({ index }) => index);
    if (indexes.length === 0) continue;
    return indexes[randomBytes(4).readUInt32BE(0) % indexes.length] ?? -1;
  }

  return -1;
}

function buildShuffledPairings(
  teams: Array<{ id: number; seed: number | null }>,
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  byeTeamId: number | null
) {
  const matchupCounts = buildTournamentMatchupCountMap(matches);
  const recentOpponents = buildRecentOpponentsMap(rounds, matches, 2);
  const queue = shuffleInPlace(teams.filter((team) => team.id !== byeTeamId).map((team) => ({ teamId: team.id })));
  const pairings: Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }> = [];

  while (queue.length > 1) {
    const current = queue.shift();
    if (!current) break;
    const opponentIndex = pickShuffleOpponentIndex(current.teamId, queue, matchupCounts, recentOpponents);
    const resolvedOpponentIndex = opponentIndex >= 0 ? opponentIndex : 0;
    const [opponent] = queue.splice(resolvedOpponentIndex, 1);
    if (!opponent) {
      queue.unshift(current);
      break;
    }
    pairings.push({
      teamAId: current.teamId,
      teamBId: opponent.teamId,
      result: "pending",
      pairingOrder: pairings.length + 1,
      winnerTeamId: null
    });
    const key = tournamentMatchupKey(current.teamId, opponent.teamId);
    matchupCounts.set(key, (matchupCounts.get(key) ?? 0) + 1);
  }

  if (byeTeamId) {
    pairings.push({
      teamAId: byeTeamId,
      teamBId: null,
      result: "bye",
      pairingOrder: pairings.length + 1,
      winnerTeamId: byeTeamId
    });
  }

  return pairings;
}

function buildRegularSeasonShufflePairings(
  teams: TournamentTeamRecord[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[]
) {
  const standings = buildTournamentStandingRows(teams, matches);
  let byeTeamId: number | null = null;
  if (standings.length % 2 === 1) {
    const byePool = standings.filter((row) => row.bye === 0);
    const targetPool = byePool.length > 0 ? byePool : standings;
    byeTeamId = targetPool[targetPool.length - 1]?.teamId ?? null;
  }

  return buildShuffledPairings(
    standings.map((row) => ({ id: row.teamId, seed: row.seed })),
    rounds,
    matches,
    byeTeamId
  );
}

function buildPlayoffParticipants(teams: TournamentTeamRecord[], roundMatches: TournamentMatchRecord[]) {
  const advancingTeamIds = roundMatches
    .map((match) => match.winnerTeamId)
    .filter((teamId): teamId is number => Number.isInteger(teamId) && teamId > 0);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return sortTeamsBySeed(
    advancingTeamIds
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is TournamentTeamRecord => Boolean(team))
  );
}

function buildNextRoundPairings(
  event: TournamentEventRecord,
  teams: TournamentTeamRecord[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  nextRoundNumber: number,
  strategy: TournamentPairingStrategy
): TournamentRoundPairing[] {
  const eventMode = getTournamentEventMode(event);
  if (eventMode === "playoffs") {
    const currentRound = activeTournamentRound(rounds);
    if (!currentRound) return [];
    const currentRoundMatches = matches
      .filter((match) => match.roundId === currentRound.id)
      .sort((left, right) => left.pairingOrder - right.pairingOrder);
    const participants = buildPlayoffParticipants(teams, currentRoundMatches);
    if (participants.length === 0) return [];
    if (strategy === "shuffle") {
      const byeTeamId = participants.length % 2 === 1 ? participants[0]?.id ?? null : null;
      return buildShuffledPairings(participants, rounds, matches, byeTeamId);
    }
    return buildSeededKnockoutPairings(participants);
  }

  const regularSeasonFormat = getTournamentRegularSeasonFormat(event);
  if (regularSeasonFormat === "round_robin" || regularSeasonFormat === "double_round_robin") {
    return buildRoundRobinRoundPairings(teams, nextRoundNumber, regularSeasonFormat);
  }

  if (strategy === "shuffle") {
    return buildRegularSeasonShufflePairings(teams, rounds, matches);
  }

  return buildSwissRoundPairings(teams, matches);
}

async function loadTournamentEventById(eventId: number) {
  const [event] = await db
    .select()
    .from(tournamentEvents)
    .where(eq(tournamentEvents.id, eventId))
    .limit(1);

  return event ?? null;
}

async function loadTournamentTeamById(teamId: number) {
  const [team] = await db
    .select()
    .from(tournamentTeams)
    .where(eq(tournamentTeams.id, teamId))
    .limit(1);

  return team ?? null;
}

async function loadTournamentEventByIdentifier(eventIdOrCode: number | string) {
  if (typeof eventIdOrCode === "number") {
    return loadTournamentEventById(eventIdOrCode);
  }

  const normalized = eventIdOrCode.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    return loadTournamentEventById(Number(normalized));
  }

  return loadTournamentEventByCode(normalized);
}

async function loadTournamentBundle(eventIdOrCode: number | string) {
  const event = await loadTournamentEventByIdentifier(eventIdOrCode);
  if (!event) return null;
  const eventId = event.id;

  const [teams, rounds, matches] = await Promise.all([
    db
      .select()
      .from(tournamentTeams)
      .where(eq(tournamentTeams.eventId, eventId))
      .orderBy(asc(tournamentTeams.seed), asc(tournamentTeams.createdAt)),
    db
      .select()
      .from(tournamentRounds)
      .where(eq(tournamentRounds.eventId, eventId))
      .orderBy(asc(tournamentRounds.roundNumber)),
    db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.eventId, eventId))
      .orderBy(asc(tournamentMatches.roundId), asc(tournamentMatches.pairingOrder))
  ]);

  return { event, teams, rounds, matches };
}

function prepareTournamentNextRoundContext(bundle: Awaited<ReturnType<typeof loadTournamentBundle>>) {
  if (!bundle) {
    return { error: "Event not found." } as const;
  }

  const activeRound = activeTournamentRound(bundle.rounds);
  const pendingMatches = activeRound
    ? bundle.matches.filter((match) => match.roundId === activeRound.id && match.result === "pending")
    : [];

  if (pendingMatches.length > 0) {
    return { error: "Current round still has pending matches." } as const;
  }

  const nextRoundNumber = (activeRound?.roundNumber ?? 0) + 1;
  if (nextRoundNumber > bundle.event.totalRounds) {
    return {
      completed: true,
      bundle
    } as const;
  }

  return {
    completed: false,
    bundle,
    activeRound,
    nextRoundNumber
  } as const;
}

async function previewTournamentNextRound(
  eventId: number,
  strategy: TournamentPairingStrategy
) {
  const bundle = await loadTournamentBundle(eventId);
  const context = prepareTournamentNextRoundContext(bundle);
  if ("error" in context || context.completed) {
    return context;
  }

  const pairings = buildNextRoundPairings(
    context.bundle.event,
    context.bundle.teams,
    context.bundle.rounds,
    context.bundle.matches,
    context.nextRoundNumber,
    strategy
  );
  if (pairings.length === 0) {
    return { error: "Unable to generate pairings." } as const;
  }

  return {
    completed: false,
    bundle: context.bundle,
    activeRound: context.activeRound,
    nextRoundNumber: context.nextRoundNumber,
    pairings,
    strategy
  } as const;
}

async function persistTournamentNextRound(
  eventId: number,
  activeRoundId: number | null,
  nextRoundNumber: number,
  pairings: TournamentRoundPairing[]
) {
  const updatedAt = new Date();
  const created = await db.transaction(async (tx) => {
    if (activeRoundId) {
      await tx
        .update(tournamentRounds)
        .set({ status: "finished" })
        .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, activeRoundId)));
    }

    const [round] = await tx
      .insert(tournamentRounds)
      .values({
        eventId,
        roundNumber: nextRoundNumber,
        status: "active"
      })
      .returning();

    const matches = await tx
      .insert(tournamentMatches)
      .values(
        pairings.map((pairing) => ({
          eventId,
          roundId: round.id,
          teamAId: pairing.teamAId,
          teamBId: pairing.teamBId,
          result: pairing.result,
          pairingOrder: pairing.pairingOrder,
          winnerTeamId: pairing.winnerTeamId
        }))
      )
      .returning();

    await tx
      .update(tournamentEvents)
      .set({
        status: "ongoing",
        updatedAt
      })
      .where(eq(tournamentEvents.id, eventId));

    return { round, matches };
  });

  const refreshed = await loadTournamentBundle(eventId);
  if (!refreshed) {
    return { error: "Event not found." } as const;
  }

  return {
    bundle: refreshed,
    round: created.round
  } as const;
}

async function generateTournamentNextRound(
  eventId: number,
  strategy: TournamentPairingStrategy
) {
  const preview = await previewTournamentNextRound(eventId, strategy);
  if ("error" in preview || preview.completed) {
    return preview;
  }

  const created = await persistTournamentNextRound(
    eventId,
    preview.activeRound?.id ?? null,
    preview.nextRoundNumber,
    preview.pairings
  );
  if ("error" in created) {
    return created;
  }

  return {
    completed: false,
    bundle: created.bundle,
    round: created.round
  } as const;
}

async function refreshTournamentRoundStatus(eventId: number, roundId: number) {
  const roundMatches = await db
    .select({ result: tournamentMatches.result })
    .from(tournamentMatches)
    .where(and(eq(tournamentMatches.eventId, eventId), eq(tournamentMatches.roundId, roundId)));

  const nextStatus = roundMatches.every((match) => match.result !== "pending") ? "finished" : "active";
  await db
    .update(tournamentRounds)
    .set({
      status: nextStatus
    })
    .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, roundId)));

  return nextStatus;
}

async function saveTournamentMatchScore(
  event: TournamentEventRecord,
  round: TournamentRoundRecord,
  match: TournamentMatchRecord,
  scoreA: number,
  scoreB: number
) {
  const eventMode = getTournamentEventMode(event);
  const matchBestOf = getTournamentRoundBestOf(event, round.roundNumber);
  const resolved = resolveTournamentMatchResult(
    eventMode,
    matchBestOf,
    scoreA,
    scoreB,
    Boolean(match.teamBId)
  );
  if ("error" in resolved) return { error: resolved.error } as const;

  const winnerTeamId =
    resolved.winnerTeamIdSide === "team_a"
      ? match.teamAId
      : resolved.winnerTeamIdSide === "team_b"
        ? match.teamBId
        : null;

  const updatedAt = new Date();
  await db
    .update(tournamentMatches)
    .set({
      scoreA,
      scoreB,
      result: resolved.result,
      winnerTeamId,
      updatedAt
    })
    .where(and(eq(tournamentMatches.eventId, event.id), eq(tournamentMatches.id, match.id)));

  await refreshTournamentRoundStatus(event.id, match.roundId);

  return { result: resolved.result } as const;
}

async function createTournamentEventRecord(input: {
  name: string;
  eventMode: TournamentEventMode;
  regularSeasonFormat?: TournamentRegularSeasonFormat;
  matchBestOf: number;
  playoffSemifinalBestOf?: number;
  playoffFinalBestOf?: number;
  totalTeams: number;
  totalRounds: number;
  teamNames: string[];
  eventDate: string | Date;
  createdByTelegramUserId: string;
  telegramChatId?: string;
}) {
  const eventDate = input.eventDate instanceof Date ? input.eventDate : new Date(input.eventDate);
  const teamNames = input.teamNames.map((name) => name.trim());
  const eventCode = await createUniqueTournamentEventCode();
  const normalizedFormat = input.eventMode === "regular_season"
    ? normalizeTournamentRegularSeasonFormat(input.regularSeasonFormat, input.totalRounds)
    : "playoffs";
  const usesFlexiblePairings = tournamentUsesFlexiblePairings({
    eventMode: input.eventMode,
    format: normalizedFormat,
    totalRounds: input.totalRounds
  });

  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(tournamentEvents)
      .values({
        code: eventCode,
        name: input.name,
        format: normalizedFormat,
        eventMode: input.eventMode,
        matchBestOf: input.matchBestOf,
        playoffSemifinalBestOf: input.playoffSemifinalBestOf ?? null,
        playoffFinalBestOf: input.playoffFinalBestOf ?? null,
        totalTeams: input.totalTeams,
        totalRounds: input.totalRounds,
        eventDate,
        status: "ongoing",
        createdByTelegramUserId: input.createdByTelegramUserId,
        telegramChatId: input.telegramChatId ?? null
      })
      .returning();

    const teams = await tx
      .insert(tournamentTeams)
      .values(
        teamNames.map((name, index) => ({
          eventId: event.id,
          name,
          seed: index + 1
        }))
      )
      .returning();

    if (usesFlexiblePairings) {
      return { event, teams, round: null, matches: [] };
    }

    const [round] = await tx
      .insert(tournamentRounds)
      .values({
        eventId: event.id,
        roundNumber: 1,
        status: "active"
      })
      .returning();

    const initialMatches =
      input.eventMode === "playoffs"
        ? buildSeededKnockoutPairings(teams)
        : (() => {
          const regularSeasonFormat = normalizeTournamentRegularSeasonFormat(input.regularSeasonFormat, input.totalRounds);
          if (regularSeasonFormat === "round_robin" || regularSeasonFormat === "double_round_robin") {
            return buildRoundRobinRoundPairings(teams, 1, regularSeasonFormat);
          }
          return buildInitialSwissMatches(teams);
        })();
    const matches = await tx
      .insert(tournamentMatches)
      .values(
        initialMatches.map((match) => ({
          eventId: event.id,
          roundId: round.id,
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          result: match.result,
          pairingOrder: match.pairingOrder,
          winnerTeamId: match.winnerTeamId
        }))
      )
      .returning();

    return { event, teams, round, matches };
  });
}

const TELEGRAM_SESSION_TTL_MS = 15 * 60_000;
type TelegramSessionStep =
  | "AWAITING_EVENT_NAME"
  | "AWAITING_EVENT_DATE"
  | "AWAITING_EVENT_MODE"
  | "AWAITING_REGULAR_SEASON_FORMAT"
  | "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS"
  | "AWAITING_MATCH_BEST_OF"
  | "AWAITING_MATCH_BEST_OF_CUSTOM"
  | "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF"
  | "AWAITING_PLAYOFF_FINAL_BEST_OF"
  | "AWAITING_TOTAL_TEAMS"
  | "AWAITING_TEAM_NAMES"
  | "AWAITING_TEAM_NAMES_REVIEW"
  | "AWAITING_CONFIRMATION"
  | "AWAITING_CONTACT_PERSON_DECISION"
  | "AWAITING_CONTACT_TEAM_SELECTION"
  | "AWAITING_CONTACT_PHONE"
  | "AWAITING_VIEW_EVENT_SELECTION";

type TelegramSessionPayload = {
  eventName?: string;
  eventMode?: TournamentEventMode;
  regularSeasonFormat?: TournamentRegularSeasonFormat;
  regularSeasonCustomRounds?: number;
  matchBestOf?: number;
  playoffSemifinalBestOf?: number;
  playoffFinalBestOf?: number;
  totalTeams?: number;
  totalRounds?: number;
  eventDate?: string;
  teamNames?: string[];
  createdEventId?: number;
  selectedContactTeamId?: number;
  eventOptions?: Array<{ id: number; code: string; name: string }>;
};

type TournamentRoundPairing = {
  teamAId: number;
  teamBId: number | null;
  result: "pending" | "bye";
  pairingOrder: number;
  winnerTeamId: number | null;
};

type TournamentNextRoundPreviewCache = {
  eventId: number;
  activeRoundId: number | null;
  roundNumber: number;
  strategy: TournamentPairingStrategy;
  pairings: TournamentRoundPairing[];
};

type TelegramUpdate = {
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string };
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number | string };
    message?: {
      message_id?: number;
      chat?: { id?: number | string; type?: string };
    };
  };
};

function getTelegramBotToken() {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

function getTelegramWebhookSecret() {
  return (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
}

function getTournamentWebBaseUrl() {
  return (process.env.WEB_APP_BASE_URL ?? process.env.PUBLIC_WEB_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function buildTournamentEventWebUrl(event: Pick<TournamentEventRecord, "code">) {
  const webBaseUrl = getTournamentWebBaseUrl();
  if (!webBaseUrl) return null;

  return `${webBaseUrl}/tournaments/${event.code.toLowerCase()}`;
}

function formatTournamentDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(date);
}

function tournamentNextRoundPreviewCacheKey(telegramUserId: string, eventId: number) {
  return `telegram:tournament-next-round-preview:${telegramUserId}:${eventId}`;
}

async function loadTournamentNextRoundPreview(telegramUserId: string, eventId: number) {
  return cacheGet<TournamentNextRoundPreviewCache>(tournamentNextRoundPreviewCacheKey(telegramUserId, eventId));
}

async function saveTournamentNextRoundPreview(telegramUserId: string, preview: TournamentNextRoundPreviewCache) {
  await cacheSet(tournamentNextRoundPreviewCacheKey(telegramUserId, preview.eventId), preview, 15 * 60);
}

async function clearTournamentNextRoundPreview(telegramUserId: string, eventId: number) {
  await cacheSet(tournamentNextRoundPreviewCacheKey(telegramUserId, eventId), { cleared: true }, 1);
}

function normalizeTelegramText(text: string | undefined) {
  return (text ?? "").trim();
}

function normalizeWhatsappContactInput(text: string) {
  const digitsOnly = text.trim().replace(/\s+/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digitsOnly)) return null;

  const normalized = digitsOnly.startsWith("0")
    ? `62${digitsOnly.slice(1)}`
    : digitsOnly;

  if (normalized.length < 10 || normalized.length > 16) return null;
  return normalized;
}

function normalizeTelegramChatId(chatId: number | string | undefined | null) {
  return chatId === undefined || chatId === null ? null : String(chatId);
}

function isTelegramGroupChat(chatType: string | undefined, chatId: number | string | undefined | null) {
  if (chatType === "group" || chatType === "supergroup") return true;
  const numericChatId = typeof chatId === "number" ? chatId : Number(chatId);
  return Number.isFinite(numericChatId) && numericChatId < 0;
}

function canAccessTournamentEvent(
  event: Pick<TournamentEventRecord, "createdByTelegramUserId" | "telegramChatId">,
  telegramUserId: string,
  telegramChatId: string | null
) {
  if (event.createdByTelegramUserId === telegramUserId) return true;
  return Boolean(event.telegramChatId && telegramChatId && event.telegramChatId === telegramChatId);
}

async function maybeShareTournamentEventToChat(
  event: TournamentEventRecord,
  telegramUserId: string,
  telegramChatId: string | null,
  groupChat: boolean
) {
  if (!groupChat || !telegramChatId || event.createdByTelegramUserId !== telegramUserId) {
    return event;
  }

  if (event.telegramChatId === telegramChatId) {
    return event;
  }

  const [updatedEvent] = await db
    .update(tournamentEvents)
    .set({
      telegramChatId,
      updatedAt: new Date()
    })
    .where(eq(tournamentEvents.id, event.id))
    .returning();

  return updatedEvent ?? event;
}

function parsePositiveIntegerInput(text: string) {
  const value = Number.parseInt(text.trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeRegularSeasonFormatInput(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "round_robin") return "round_robin" as const;
  if (normalized === "double_round_robin" || normalized === "double_roundrobin") {
    return "double_round_robin" as const;
  }
  if (normalized === "5_round" || normalized === "five_round") return "five_round" as const;
  if (normalized === "custom_round") return "custom_round" as const;
  return null;
}

function normalizeEventDateInput(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [, day, month, year] = match;
  const dayNumber = Number.parseInt(day ?? "", 10);
  const monthNumber = Number.parseInt(month ?? "", 10);
  const yearNumber = Number.parseInt(year ?? "", 10);
  if (!dayNumber || !monthNumber || !yearNumber) return null;
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== yearNumber
    || date.getUTCMonth() !== monthNumber - 1
    || date.getUTCDate() !== dayNumber
  ) {
    return null;
  }
  return date.toISOString();
}

function parseTeamNamesInput(text: string) {
  return text
    .split(/\r?\n|,/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizeTournamentTeamLookupName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseBulkCaptainContactInput(
  text: string,
  teams: TournamentTeamRecord[]
) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const teamByName = new Map(
    teams.map((team) => [normalizeTournamentTeamLookupName(team.name), team])
  );

  const saved: Array<{ teamId: number; teamName: string; captainWhatsapp: string }> = [];
  const unknownTeams: string[] = [];
  const invalidNumbers: string[] = [];
  let matchedRows = 0;

  for (const line of lines) {
    if (!/\s-\s/.test(line)) continue;

    const [rawLeft, ...rest] = line.split(/\s-\s/);
    const rawPhone = rest.join(" - ").trim();
    const teamLabel = (rawLeft ?? "").replace(/^\d+[\).\s-]*/, "").trim();
    if (!teamLabel || !rawPhone) continue;

    matchedRows += 1;
    const team = teamByName.get(normalizeTournamentTeamLookupName(teamLabel));
    if (!team) {
      unknownTeams.push(teamLabel);
      continue;
    }

    const captainWhatsapp = normalizeWhatsappContactInput(rawPhone);
    if (!captainWhatsapp) {
      invalidNumbers.push(team.name);
      continue;
    }

    saved.push({
      teamId: team.id,
      teamName: team.name,
      captainWhatsapp
    });
  }

  if (matchedRows === 0) {
    return null;
  }

  return {
    saved,
    unknownTeams,
    invalidNumbers
  };
}

function isTelegramAffirmative(text: string) {
  return ["y", "yes", "ok", "confirm", "ya"].includes(text.trim().toLowerCase());
}

function isTelegramNegative(text: string) {
  return ["n", "no", "cancel", "batal"].includes(text.trim().toLowerCase());
}

function createStepTitle(step: string, hint: string) {
  return [`Create Event ${step}`, hint].join("\n");
}

function formatTelegramEventModeLabel(mode: TournamentEventMode | undefined) {
  return mode === "playoffs" ? "Playoffs" : "Regular Season";
}

function formatTelegramRegularSeasonFormatLabel(format: TournamentRegularSeasonFormat | undefined) {
  return formatTournamentRegularSeasonFormatLabel(format);
}

function buildEventModeKeyboard() {
  return [
    [
      { text: "Regular Season", callback_data: "create_event_mode:regular_season" },
      { text: "Playoffs", callback_data: "create_event_mode:playoffs" }
    ],
  ];
}

function buildRegularSeasonFormatKeyboard() {
  return [
    [
      { text: "Round Robin", callback_data: "create_regular_format:round_robin" },
      { text: "Double Round Robin", callback_data: "create_regular_format:double_round_robin" }
    ],
    [
      { text: "5 Round", callback_data: "create_regular_format:five_round" },
      { text: "Custom Round", callback_data: "create_regular_format:custom_round" }
    ]
  ];
}

function buildRegularSeasonMatchBestOfKeyboard() {
  return [
    [
      { text: "BO1", callback_data: "create_match_best_of:1" },
      { text: "BO2", callback_data: "create_match_best_of:2" }
    ],
    [
      { text: "BO3", callback_data: "create_match_best_of:3" },
      { text: "Custom BO", callback_data: "create_match_best_of:custom" }
    ]
  ];
}

function buildPlayoffEarlyBestOfKeyboard() {
  return [
    [
      { text: "BO1", callback_data: "create_match_best_of:1" },
      { text: "BO3", callback_data: "create_match_best_of:3" }
    ],
    [
      { text: "BO5", callback_data: "create_match_best_of:5" }
    ]
  ];
}

function buildPlayoffSemifinalBestOfKeyboard() {
  return [
    [
      { text: "BO1", callback_data: "create_playoff_semifinal_best_of:1" },
      { text: "BO3", callback_data: "create_playoff_semifinal_best_of:3" }
    ],
    [
      { text: "BO5", callback_data: "create_playoff_semifinal_best_of:5" }
    ]
  ];
}

function buildPlayoffFinalBestOfKeyboard() {
  return [
    [
      { text: "BO3", callback_data: "create_playoff_final_best_of:3" },
      { text: "BO5", callback_data: "create_playoff_final_best_of:5" }
    ],
    [
      { text: "BO7", callback_data: "create_playoff_final_best_of:7" }
    ]
  ];
}

function buildTotalTeamsKeyboard(eventMode: TournamentEventMode | undefined) {
  const mode = eventMode ?? "regular_season";
  return [
    [
      { text: "8 Teams", callback_data: `create_total_teams:${mode}:8` },
      { text: "16 Teams", callback_data: `create_total_teams:${mode}:16` }
    ],
    [
      { text: "24 Teams", callback_data: `create_total_teams:${mode}:24` }
    ]
  ];
}

async function sendCreateEventNamePrompt(chatId: number | string) {
  await sendTelegramMessage(chatId, createStepTitle("· Name", "Send tournament name."));
}

async function sendCreateEventDatePrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    createStepTitle("· Date", "Send the event date with format DD-MM-YYYY.")
  );
}

async function sendCreateEventModePrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    createStepTitle("· Mode", "Choose the tournament mode."),
    {
      inlineKeyboard: buildEventModeKeyboard()
    }
  );
}

async function sendCreateEventRegularSeasonFormatPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    createStepTitle(
      "· Regular Season Format",
      "Choose Round Robin, Double Round Robin, 5 Round, or Custom Round."
    ),
    {
      inlineKeyboard: buildRegularSeasonFormatKeyboard()
    }
  );
}

async function sendCreateEventRegularSeasonCustomRoundsPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    createStepTitle("· Custom Round", "Send custom regular season rounds from 1 to 10.")
  );
}

async function sendCreateEventMatchBestOfPrompt(chatId: number | string, payload: TelegramSessionPayload) {
  const eventMode = payload.eventMode;
  const modeLabel = formatTelegramEventModeLabel(eventMode);
  const hint =
    eventMode === "playoffs"
      ? `${modeLabel}: choose Best Of to Win for the early rounds.`
      : `${modeLabel}: choose Match Best Of to Win.`;
  await sendTelegramMessage(
    chatId,
    createStepTitle("· Match BO", hint),
    {
      inlineKeyboard: eventMode === "playoffs"
        ? buildPlayoffEarlyBestOfKeyboard()
        : buildRegularSeasonMatchBestOfKeyboard()
    }
  );
}

async function sendCreateEventPlayoffSemifinalBestOfPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    createStepTitle("· Semifinal BO", "Choose Best Of to Win for the semifinal stage."),
    {
      inlineKeyboard: buildPlayoffSemifinalBestOfKeyboard()
    }
  );
}

async function sendCreateEventPlayoffFinalBestOfPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    createStepTitle("· Final BO", "Choose Best Of to Win for the final stage."),
    {
      inlineKeyboard: buildPlayoffFinalBestOfKeyboard()
    }
  );
}

function buildCreateEventConfigLines(payload: TelegramSessionPayload) {
  const lines = [`Mode: ${formatTelegramEventModeLabel(payload.eventMode)}`];
  if (payload.eventMode === "regular_season") {
    lines.push(`Format: ${formatTelegramRegularSeasonFormatLabel(payload.regularSeasonFormat)}`);
    lines.push(`Match Best Of: BO${payload.matchBestOf ?? 2}`);
    if (payload.regularSeasonFormat === "custom_round") {
      lines.push(`Custom Rounds: ${payload.regularSeasonCustomRounds ?? "-"}`);
    }
    lines.push("Playoffs: Top 4 teams advance");
    return lines;
  }

  lines.push(`Early Rounds BO: BO${payload.matchBestOf ?? 1}`);
  lines.push(`Semifinal BO: BO${payload.playoffSemifinalBestOf ?? "-"}`);
  lines.push(`Final BO: BO${payload.playoffFinalBestOf ?? "-"}`);
  return lines;
}

async function sendCreateEventTeamsPrompt(
  chatId: number | string,
  payload: TelegramSessionPayload
) {
  const modeLabel = formatTelegramEventModeLabel(payload.eventMode);
  const teamHint =
    payload.eventMode === "playoffs"
      ? "Choose total teams from the buttons below or send a number manually."
      : "Choose total teams from the buttons below or send an even number manually.";
  await sendTelegramMessage(
    chatId,
    createStepTitle(
      "· Teams",
      `${modeLabel}. ${teamHint} Preset: 8, 16, 24.`
    ),
    {
      inlineKeyboard: buildTotalTeamsKeyboard(payload.eventMode)
    }
  );
}

async function sendCreateEventTeamNamesPrompt(
  chatId: number | string,
  totalTeams: number,
  payload: TelegramSessionPayload
) {
  await sendTelegramMessage(
    chatId,
    [
      "Create Event · Team Names",
      ...buildCreateEventConfigLines(payload),
      `Send ${totalTeams} team names. Use one line per team or separate with commas.`,
      "",
      "Example:",
      "Team Alpha",
      "Team Beta",
      "Team Gamma"
    ].join("\n")
  );
}

async function sendCreateEventTeamNamesReview(chatId: number | string, payload: TelegramSessionPayload) {
  await sendTelegramMessage(
    chatId,
    [
      "Review team list",
      ...buildCreateEventConfigLines(payload),
      `I found ${payload.teamNames?.length ?? 0} teams:`,
      ...(payload.teamNames ?? []).map((name, index) => `${index + 1}. ${name}`),
      "",
      "Choose Looks Good to continue or Re-enter Teams to send the list again."
    ].join("\n"),
    {
      inlineKeyboard: [
        [{ text: "Looks Good", callback_data: "create_team_names_confirm" }],
        [{ text: "Re-enter Teams", callback_data: "create_team_names_retry" }]
      ]
    }
  );
}

async function sendCreateEventConfirmation(chatId: number | string, payload: TelegramSessionPayload) {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "Confirm", callback_data: "create_confirm" }],
    [
      { text: "Edit Name", callback_data: "create_edit:event_name" },
      { text: "Edit Date", callback_data: "create_edit:event_date" }
    ],
    [
      { text: "Edit Mode", callback_data: "create_edit:event_mode" }
    ],
    [
      { text: "Edit Match BO", callback_data: "create_edit:match_best_of" }
    ],
    [{ text: "Edit Teams Count", callback_data: "create_edit:total_teams" }],
    [{ text: "Edit Team Names", callback_data: "create_edit:team_names" }],
    [{ text: "Cancel", callback_data: "create_cancel" }]
  ];

  if (payload.eventMode === "regular_season") {
    keyboard.splice(3, 0, [{ text: "Edit Format", callback_data: "create_edit:regular_format" }]);
  }

  await sendTelegramMessage(
    chatId,
    [
      "Confirm event creation",
      `Tournament: ${payload.eventName ?? "-"}`,
      ...buildCreateEventConfigLines(payload),
      `Teams: ${payload.totalTeams ?? "-"}`,
      `Rounds: ${payload.totalRounds ?? "-"}`,
      `Date: ${payload.eventDate ? formatTournamentDate(payload.eventDate) : "-"}`,
      "Team list:",
      ...(payload.teamNames ?? []).map((name, index) => `${index + 1}. ${name}`)
    ].join("\n"),
    {
      inlineKeyboard: keyboard
    }
  );
}

function buildCreateContactTeamLabel(team: Pick<TournamentTeamRecord, "name" | "captainWhatsapp">) {
  return `${team.captainWhatsapp ? "✅" : "⏳"} ${team.name}'s capt contact`;
}

function countTeamsWithCaptainWhatsapp(teams: Array<Pick<TournamentTeamRecord, "captainWhatsapp">>) {
  return teams.filter((team) => Boolean(team.captainWhatsapp)).length;
}

async function sendCreateEventContactDecisionPrompt(
  chatId: number | string,
  event: Pick<TournamentEventRecord, "id" | "name">
) {
  await sendTelegramMessage(
    chatId,
    [
      `Event ${event.name} is ready.`,
      "Do you want to add captain WhatsApp contact now?",
      "This step is optional and you can skip it."
    ].join("\n"),
    {
      inlineKeyboard: [
        [{ text: "Add Contact Person", callback_data: `create_contact_start:${event.id}` }],
        [{ text: "Skip", callback_data: `create_contact_skip:${event.id}` }]
      ]
    }
  );
}

async function sendCreateEventContactMenu(chatId: number | string, eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  const completedContacts = countTeamsWithCaptainWhatsapp(bundle.teams);
  const keyboard = bundle.teams.map((team) => ([
    { text: buildCreateContactTeamLabel(team), callback_data: `create_contact_team:${bundle.event.id}:${team.id}` }
  ]));
  keyboard.push([{ text: "Done", callback_data: `create_contact_done:${bundle.event.id}` }]);

  await sendTelegramMessage(
    chatId,
    [
      `${bundle.event.name} captain contacts`,
      `Saved: ${completedContacts}/${bundle.teams.length}`,
      "Choose a team to add or update WhatsApp contact.",
      "You can also paste bulk data with format: Team Name - 628xxxx or Team Name - 08xxxx.",
      "Send done anytime to finish."
    ].join("\n"),
    {
      inlineKeyboard: keyboard
    }
  );
}

async function sendCreateEventContactPhonePrompt(chatId: number | string, eventId: number, teamId: number) {
  const team = await loadTournamentTeamById(teamId);
  if (!team || team.eventId !== eventId) {
    await sendTelegramMessage(chatId, "Team not found.");
    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      `Send captain WhatsApp number for ${team.name}.`,
      "Use country code and numbers only.",
      "Example format: 6281234567890"
    ].join("\n"),
    {
      inlineKeyboard: [[{ text: "Back to Contact Menu", callback_data: `create_contact_back:${eventId}` }]]
    }
  );
}

function hasCompleteCreateEventDraft(payload: TelegramSessionPayload) {
  const hasBase =
    Boolean(
      payload.eventName &&
      payload.eventMode &&
      payload.matchBestOf &&
      payload.totalTeams &&
      payload.totalRounds &&
      payload.eventDate &&
      payload.teamNames &&
      payload.teamNames.length === payload.totalTeams
    );
  if (!hasBase) return false;

  if (payload.eventMode === "regular_season") {
    if (!payload.regularSeasonFormat) return false;
    if (payload.regularSeasonFormat === "custom_round" && !payload.regularSeasonCustomRounds) {
      return false;
    }
    return true;
  }

  return Boolean(payload.playoffSemifinalBestOf && payload.playoffFinalBestOf);
}

async function createTournamentEventFromTelegramPayload(
  payload: TelegramSessionPayload,
  telegramUserId: string,
  telegramChatId: string | null
) {
  const parsed = createTournamentEventBodySchema.parse({
    name: payload.eventName ?? "",
    eventMode: payload.eventMode ?? "regular_season",
    regularSeasonFormat: payload.regularSeasonFormat,
    regularSeasonCustomRounds: payload.regularSeasonCustomRounds,
    matchBestOf: payload.matchBestOf ?? 2,
    playoffSemifinalBestOf: payload.playoffSemifinalBestOf,
    playoffFinalBestOf: payload.playoffFinalBestOf,
    totalTeams: payload.totalTeams ?? 0,
    totalRounds: payload.totalRounds ?? calculateTournamentTotalRounds(
      payload.eventMode ?? "regular_season",
      payload.totalTeams ?? 0,
      payload.regularSeasonFormat,
      payload.regularSeasonCustomRounds
    ),
    teamNames: payload.teamNames ?? [],
    eventDate: payload.eventDate ?? "",
    createdByTelegramUserId: telegramUserId,
    telegramChatId: telegramChatId ?? undefined
  });

  return createTournamentEventRecord(parsed);
}

async function finalizeTelegramCreatedEvent(chatId: number | string, telegramUserId: string, eventId: number) {
  const event = await loadTournamentEventById(eventId);
  await clearTelegramSession(telegramUserId);

  if (!event) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  await sendTelegramMessage(chatId, `Event created successfully.\nCode: ${event.code}`);
  await sendTournamentManageMenu(chatId, event.id);
}

async function telegramApi(method: string, payload: Record<string, unknown>) {
  const token = getTelegramBotToken();
  if (!token) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN is not configured");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.warn(`[telegram] ${method} failed with status ${response.status}`);
    }
  } catch (error) {
    console.warn("[telegram] request failed", error);
  }
}

async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: {
    inlineKeyboard?: Array<Array<{
      text: string;
      url?: string;
      callback_data?: string;
      copy_text?: { text: string };
    }>>;
  }
) {
  const replyMarkup =
    options?.inlineKeyboard && options.inlineKeyboard.length > 0
      ? { inline_keyboard: options.inlineKeyboard }
      : undefined;

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup
  });
}

async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string) {
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });
}

async function loadTelegramSession(telegramUserId: string) {
  const [session] = await db
    .select()
    .from(telegramSessions)
    .where(eq(telegramSessions.telegramUserId, telegramUserId))
    .orderBy(desc(telegramSessions.updatedAt))
    .limit(1);

  if (!session) return null;
  if (session.expiredAt.getTime() <= Date.now()) {
    await db.delete(telegramSessions).where(eq(telegramSessions.id, session.id));
    return null;
  }

  return session;
}

async function saveTelegramSession(
  telegramUserId: string,
  currentCommand: string,
  step: TelegramSessionStep,
  payloadJson: TelegramSessionPayload
) {
  const existing = await loadTelegramSession(telegramUserId);
  const now = new Date();
  const expiredAt = new Date(now.getTime() + TELEGRAM_SESSION_TTL_MS);

  if (existing) {
    await db
      .update(telegramSessions)
      .set({
        currentCommand,
        step,
        payloadJson,
        expiredAt,
        updatedAt: now
      })
      .where(eq(telegramSessions.id, existing.id));
    return;
  }

  await db.insert(telegramSessions).values({
    telegramUserId,
    currentCommand,
    step,
    payloadJson,
    expiredAt,
    createdAt: now,
    updatedAt: now
  });
}

async function clearTelegramSession(telegramUserId: string) {
  await db.delete(telegramSessions).where(eq(telegramSessions.telegramUserId, telegramUserId));
}

async function loadTournamentEventByCode(code: string) {
  const normalizedCode = code.trim().toUpperCase();
  const [event] = await db
    .select()
    .from(tournamentEvents)
    .where(eq(tournamentEvents.code, normalizedCode))
    .limit(1);

  return event ?? null;
}

async function listTournamentEventsForTelegramUser(
  telegramUserId: string,
  telegramChatId: string | null,
  limit = 5
) {
  const scope = telegramChatId
    ? or(
      eq(tournamentEvents.createdByTelegramUserId, telegramUserId),
      eq(tournamentEvents.telegramChatId, telegramChatId)
    )
    : eq(tournamentEvents.createdByTelegramUserId, telegramUserId);

  return db
    .select()
    .from(tournamentEvents)
    .where(scope)
    .orderBy(desc(tournamentEvents.createdAt))
    .limit(limit);
}

function buildTournamentEventKeyboard(event: Pick<TournamentEventRecord, "code">) {
  const url = buildTournamentEventWebUrl(event);
  if (!url) return undefined;

  return [[{ text: "Open Web", url }]];
}

function getTournamentBracketMenuLabel(event: Pick<TournamentEventRecord, "eventMode" | "format">) {
  return getTournamentEventMode(event) === "regular_season" ? "View Schedule" : "View Bracket";
}

async function sendTelegramStartMenu(chatId: number | string) {
  await sendTelegramMessage(
      chatId,
      [
      "Bot ini dipakai untuk mengelola event tournament di website Draft Arena.",
      "",
      "Fungsi utama:",
      "- buat event baru dari Telegram",
      "- lihat daftar event yang Anda buat atau yang sudah dishare ke group ini",
      "- input hasil pertandingan per round sesuai mode event",
      "- lihat schedule atau bracket dan standings",
      "",
      "Cara pakai singkat:",
      "1. Pilih Create New Event untuk membuat event.",
      "2. Isi tournament name, event date, mode event, format/BO sesuai mode, total teams, dan team names.",
      "3. Regular Season mendukung Round Robin, Double Round Robin, 5 Round, dan Custom Round.",
      "4. Playoffs memakai BO terpisah untuk early rounds, semifinal, dan final.",
      "5. Pilih View Event untuk manage ronde, input hasil pertandingan, dan generate round berikutnya.",
      "6. Kalau event dibuka dari group, creator akan share akses event ke group itu sehingga member group yang sama bisa ikut manage.",
      "7. Generate Next Round akan mengikuti jadwal tetap atau menampilkan preview Default Match / Shuffle Match tergantung format event.",
      "",
      "Menu:"
    ].join("\n"),
    {
      inlineKeyboard: [
        [{ text: "Create New Event", callback_data: "start_create_event" }],
        [{ text: "View Event", callback_data: "start_view_event" }]
      ]
    }
  );
}

function formatTournamentEventSummary(event: TournamentEventRecord) {
  const eventMode = getTournamentEventMode(event);
  const regularSeasonFormat = getTournamentRegularSeasonFormat(event);
  return [
    `Event: ${event.name}`,
    `Code: ${event.code}`,
    `Mode: ${formatTelegramEventModeLabel(eventMode)}`,
    eventMode === "regular_season"
      ? `Format: ${formatTournamentRegularSeasonFormatLabel(regularSeasonFormat)}`
      : null,
    eventMode === "regular_season"
      ? `Match Best Of: BO${getTournamentMatchBestOf(event)}`
      : `Early Rounds BO: BO${getTournamentMatchBestOf(event)}`,
    eventMode === "playoffs"
      ? `Semifinal BO: BO${event.playoffSemifinalBestOf ?? "-"}`
      : null,
    eventMode === "playoffs"
      ? `Final BO: BO${event.playoffFinalBestOf ?? "-"}`
      : null,
    `Teams: ${event.totalTeams}`,
    `Rounds: ${event.totalRounds}`,
    eventMode === "regular_season" ? "Playoffs: Top 4 teams advance" : null,
    `Date: ${formatTournamentDate(event.eventDate)}`,
    `Status: ${event.status}`
  ].filter(Boolean).join("\n");
}

async function sendTournamentEventDetails(chatId: number | string, event: TournamentEventRecord) {
  await sendTelegramMessage(chatId, formatTournamentEventSummary(event), {
    inlineKeyboard: buildTournamentEventKeyboard(event)
  });
}

async function sendTournamentNextRoundPairingMenu(chatId: number | string, eventId: number) {
  await sendTelegramMessage(
    chatId,
    "Choose the pairing method for the next round.",
    {
      inlineKeyboard: [
        [{ text: "Default Match", callback_data: `next_round_pick:${eventId}:default` }],
        [{ text: "Shuffle Match", callback_data: `next_round_pick:${eventId}:shuffle` }],
        [{ text: "Back to Event", callback_data: `event_manage:${eventId}` }]
      ]
    }
  );
}

async function sendTournamentNextRoundPreviewMenu(
  chatId: number | string,
  bundle: NonNullable<Awaited<ReturnType<typeof loadTournamentBundle>>>,
  roundNumber: number,
  strategy: TournamentPairingStrategy,
  pairings: TournamentRoundPairing[]
) {
  const teamById = new Map(bundle.teams.map((team) => [team.id, team.name]));
  const lines = pairings
    .slice()
    .sort((left, right) => left.pairingOrder - right.pairingOrder)
    .map((pairing) => {
      const teamA = teamById.get(pairing.teamAId) ?? "Team A";
      if (!pairing.teamBId) {
        return `Match ${pairing.pairingOrder}: ${teamA} gets BYE`;
      }

      const teamB = teamById.get(pairing.teamBId) ?? "Team B";
      return `Match ${pairing.pairingOrder}: ${teamA} vs ${teamB}`;
    });

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "Confirm Pairings", callback_data: `next_round_confirm:${bundle.event.id}` }]
  ];

  if (strategy === "shuffle") {
    keyboard.push([{ text: "Shuffle Match Again", callback_data: `next_round_pick:${bundle.event.id}:shuffle` }]);
    keyboard.push([{ text: "Use Default Match", callback_data: `next_round_pick:${bundle.event.id}:default` }]);
  } else {
    keyboard.push([{ text: "Shuffle Match", callback_data: `next_round_pick:${bundle.event.id}:shuffle` }]);
  }

  keyboard.push([{ text: "Back to Pairing Menu", callback_data: `next_round:${bundle.event.id}` }]);
  keyboard.push([{ text: "Back to Event", callback_data: `event_manage:${bundle.event.id}` }]);

  await sendTelegramMessage(
    chatId,
    [
      `${bundle.event.name} · Round ${roundNumber} Preview`,
      `Pairing mode: ${strategy === "shuffle" ? "Shuffle Match" : "Default Match"}`,
      "",
      ...lines,
      "",
      strategy === "shuffle"
        ? "Pilih Confirm Pairings atau Shuffle Match Again sampai pairing sesuai."
        : "Pilih Confirm Pairings untuk membuat round ini."
    ].join("\n"),
    {
      inlineKeyboard: keyboard
    }
  );
}

function formatTournamentRoundShareSummary(
  bundle: NonNullable<Awaited<ReturnType<typeof loadTournamentBundle>>>,
  roundNumber: number
) {
  const round = bundle.rounds.find((item) => item.roundNumber === roundNumber);
  if (!round) return null;

  const teamById = new Map(bundle.teams.map((team) => [team.id, team.name]));
  const lines = bundle.matches
    .filter((match) => match.roundId === round.id)
    .slice()
    .sort((left, right) => left.pairingOrder - right.pairingOrder)
    .map((match) => {
      const teamA = teamById.get(match.teamAId) ?? "Team A";
      if (!match.teamBId) {
        return `Match ${match.pairingOrder}: ${teamA} gets BYE`;
      }

      const teamB = teamById.get(match.teamBId) ?? "Team B";
      return `Match ${match.pairingOrder}: ${teamA} vs ${teamB}`;
    });

  const webUrl = buildTournamentEventWebUrl(bundle.event);

  return [
    `${bundle.event.name} · Round ${round.roundNumber} · BO${getTournamentMatchBestOf(bundle.event)}`,
    "",
    ...lines,
    ...(webUrl
      ? [
          "",
          `Open link ${webUrl} to see detail contact person and detail match`,
          "",
          "Explore https://mlbbdraftarena.vercel.app for Hero Tier, Hero Statistics, Counter, Draft Master, and tournament engines powered by data from M7, MPL PH, and MPL ID.",
          "You are not just playing the game, you are mastering the game."
        ]
      : [])
  ].join("\n");
}

function formatTournamentFinishShareSummary(
  bundle: NonNullable<Awaited<ReturnType<typeof loadTournamentBundle>>>
) {
  const standings = buildTournamentStandings(bundle.teams, bundle.matches);
  const mode = getTournamentEventMode(bundle.event);

  if (mode === "regular_season") {
    const topTeams = standings.slice(0, 4);
    if (topTeams.length === 0) return null;

    return [
      `🎉 ${bundle.event.name} · Regular Season Completed`,
      "",
      "🔥 Congratulations to the Top 4 teams advancing to Playoffs:",
      ...topTeams.map((team) => `${team.rank}. ${team.teamName}`),
      "",
      "🙏 Thank you to all other teams for participating in this event.",
      "👋 See you next event."
    ].join("\n");
  }

  const champion = standings[0];
  if (!champion) return null;

  return [
    `🏆 ${bundle.event.name} · Playoffs Completed`,
    "",
    `🥇 Congratulations to ${champion.teamName} for becoming the champion.`,
    "",
    "🙏 Thank you to all other teams for participating in this event.",
    "👋 See you next event."
  ].join("\n");
}

async function finishTournamentEvent(eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    return { error: "Event not found." } as const;
  }

  const currentRound = activeTournamentRound(bundle.rounds);
  if (!currentRound) {
    return { error: "No rounds available." } as const;
  }

  const pendingMatches = bundle.matches.filter((match) => match.roundId === currentRound.id && match.result === "pending");
  if (pendingMatches.length > 0) {
    return { error: "Current round still has pending matches." } as const;
  }

  if (currentRound.roundNumber < bundle.event.totalRounds) {
    return { error: "Event still has remaining rounds." } as const;
  }

  await db
    .update(tournamentRounds)
    .set({
      status: "finished"
    })
    .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, currentRound.id)));

  await db
    .update(tournamentEvents)
    .set({
      status: "completed",
      updatedAt: new Date()
    })
    .where(eq(tournamentEvents.id, eventId));

  const refreshed = await loadTournamentBundle(eventId);
  return { bundle: refreshed ?? bundle } as const;
}

function activeTournamentRound(rounds: TournamentRoundRecord[]) {
  return rounds.find((round) => round.status === "active")
    ?? rounds.slice().sort((left, right) => right.roundNumber - left.roundNumber)[0]
    ?? null;
}

async function sendTournamentManageMenu(chatId: number | string, eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  const currentRound = activeTournamentRound(bundle.rounds);
  const currentRoundPending = currentRound
    ? bundle.matches.filter((match) => match.roundId === currentRound.id && match.result === "pending").length
    : 0;
  const usesFlexiblePairings = tournamentUsesFlexiblePairings(bundle.event);
  const canGenerateNextRound =
    currentRound
      ? currentRoundPending === 0 && currentRound.roundNumber < bundle.event.totalRounds
      : usesFlexiblePairings && bundle.event.totalRounds > 0;
  const canFinishEvent =
    currentRound &&
    currentRoundPending === 0 &&
    currentRound.roundNumber >= bundle.event.totalRounds &&
    bundle.event.status !== "completed";

  const keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
  const webKeyboard = buildTournamentEventKeyboard(bundle.event);
  if (webKeyboard && webKeyboard[0]?.[0]) {
    keyboard.push([{ text: webKeyboard[0][0].text, url: webKeyboard[0][0].url }]);
  }
  keyboard.push([
    {
      text: "View Standings",
      callback_data: `standings_view:${bundle.event.id}`
    },
    {
      text: getTournamentBracketMenuLabel(bundle.event),
      callback_data: `bracket_view:${bundle.event.id}`
    }
  ]);
  if (currentRound) {
    keyboard.push([
      {
        text: `Manage Round ${currentRound.roundNumber}`,
        callback_data: `round_manage:${bundle.event.id}:${currentRound.id}`
      }
    ]);
  }
  if (canGenerateNextRound) {
    keyboard.push([
      {
        text: "Generate Next Round",
        callback_data: `next_round:${bundle.event.id}`
      }
    ]);
  }
  if (canFinishEvent) {
    keyboard.push([
      {
        text: "Finish Event",
        callback_data: `finish_event:${bundle.event.id}`
      }
    ]);
  }
  keyboard.push([
    {
      text: "Delete Event",
      callback_data: `delete_event_prompt:${bundle.event.id}`
    }
  ]);
  keyboard.push([
    {
      text: "Back to Events",
      callback_data: "events_list"
    }
  ]);

  await sendTelegramMessage(
    chatId,
    [
      formatTournamentEventSummary(bundle.event),
      currentRound
        ? `Current round: ${currentRound.roundNumber} (${currentRoundPending} pending matches)`
        : usesFlexiblePairings
          ? "No rounds generated yet. Use Generate Next Round to start Round 1."
          : "No rounds available."
    ].join("\n"),
    {
      inlineKeyboard: keyboard
    }
  );
}

async function sendTournamentStandingsSummary(chatId: number | string, eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  const standings = buildTournamentStandings(bundle.teams, bundle.matches);
  const lines = standings.map((row) =>
    `${row.rank}. ${row.teamName} | P:${row.played} W:${row.win} L:${row.lose} D:${row.draw} Bye:${row.bye} | Pts:${row.score} | H2H:${row.headToHead} | BH:${row.buchholz} | Diff:${formatTournamentPointDiff(row.pointDiff)}`
  );

  await sendTelegramMessage(
    chatId,
    [
      `${bundle.event.name} standings`,
      ...lines,
      getTournamentEventMode(bundle.event) === "regular_season" ? "" : null,
      getTournamentEventMode(bundle.event) === "regular_season" ? "Top 4 teams advance to playoffs." : null
    ].join("\n"),
    {
      inlineKeyboard: [[{ text: "Back to Event", callback_data: `event_manage:${bundle.event.id}` }]]
    }
  );
}

async function sendTournamentBracketSummary(chatId: number | string, eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  const teamById = new Map(bundle.teams.map((team) => [team.id, team.name]));
  const sections = bundle.rounds
    .slice()
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => {
      const roundMatches = bundle.matches
        .filter((match) => match.roundId === round.id)
        .sort((left, right) => left.pairingOrder - right.pairingOrder)
        .map((match) => {
          const teamA = teamById.get(match.teamAId) ?? "Team A";
          const teamB = match.teamBId ? (teamById.get(match.teamBId) ?? "Team B") : "BYE";
          const score =
            match.result === "pending"
              ? "pending"
              : `${match.scoreA ?? "-"}-${match.scoreB ?? "-"}`;
          return `Match ${match.pairingOrder}: ${teamA} vs ${teamB} (${score})`;
        });
      return [`Round ${round.roundNumber} - ${round.status}`, ...roundMatches].join("\n");
    });

  await sendTelegramMessage(
    chatId,
    [
      `${bundle.event.name} ${getTournamentEventMode(bundle.event) === "regular_season" ? "schedule" : "bracket"}`,
      ...(sections.length > 0 ? sections : ["No rounds generated yet."])
    ].join("\n\n"),
    {
      inlineKeyboard: [[{ text: "Back to Event", callback_data: `event_manage:${bundle.event.id}` }]]
    }
  );
}

async function sendTournamentRoundManageMenu(chatId: number | string, eventId: number, roundId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  const round = bundle.rounds.find((item) => item.id === roundId);
  if (!round) {
    await sendTelegramMessage(chatId, "Round not found.");
    return;
  }

  const roundMatches = bundle.matches
    .filter((match) => match.roundId === round.id)
    .sort((left, right) => left.pairingOrder - right.pairingOrder);
  const teamById = new Map(bundle.teams.map((team) => [team.id, team]));

  const keyboard = roundMatches.map((match) => {
    const teamA = teamById.get(match.teamAId)?.name ?? "Team A";
    const teamB = match.teamBId ? (teamById.get(match.teamBId)?.name ?? "Team B") : "BYE";
    const statusIcon = match.result === "pending" ? "⏳" : "✅";
    const scoreSuffix =
      match.result === "pending"
        ? ""
        : ` (${match.scoreA ?? "-"}-${match.scoreB ?? "-"})`;
    return [
      {
        text: `${statusIcon} Match ${match.pairingOrder}: ${teamA} vs ${teamB}${scoreSuffix}`,
        callback_data: `match_manage:${bundle.event.id}:${round.id}:${match.id}`
      }
    ];
  });

  const pendingMatches = roundMatches.filter((match) => match.result === "pending").length;
  if (pendingMatches === 0 && round.roundNumber < bundle.event.totalRounds) {
    keyboard.push([
      {
        text: "Generate Next Round",
        callback_data: `next_round:${bundle.event.id}`
      }
    ]);
  }
  if (pendingMatches === 0 && round.roundNumber >= bundle.event.totalRounds && bundle.event.status !== "completed") {
    keyboard.push([
      {
        text: "Finish Event",
        callback_data: `finish_event:${bundle.event.id}`
      }
    ]);
  }
  keyboard.push([
    {
      text: "Back to Event",
      callback_data: `event_manage:${bundle.event.id}`
    }
  ]);

  await sendTelegramMessage(
    chatId,
    `Round ${round.roundNumber} tasks (${pendingMatches} pending matches). Select a match to set the result.`,
    {
      inlineKeyboard: keyboard
    }
  );
}

function buildTournamentScoreOptions(event: TournamentEventRecord, roundNumber: number) {
  const eventMode = getTournamentEventMode(event);
  const matchBestOf = getTournamentRoundBestOf(event, roundNumber);

  if (tournamentAllowsBo1RegularSeasonDraw(eventMode, matchBestOf)) {
    return [
      { scoreA: 1, scoreB: 0, label: "1-0" },
      { scoreA: 0, scoreB: 0, label: "Draw (20m+)" },
      { scoreA: 0, scoreB: 1, label: "0-1" }
    ];
  }

  if (tournamentUsesDrawSeries(eventMode, matchBestOf)) {
    return Array.from({ length: matchBestOf + 1 }, (_, scoreA) => {
      const scoreB = matchBestOf - scoreA;
      return {
        scoreA,
        scoreB,
        label: `${scoreA}-${scoreB}`
      };
    }).sort((left, right) => right.scoreA - left.scoreA);
  }

  const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
  return [
    ...Array.from({ length: requiredWins }, (_, index) => ({
      scoreA: requiredWins,
      scoreB: index,
      label: `${requiredWins}-${index}`
    })),
    ...Array.from({ length: requiredWins }, (_, index) => ({
      scoreA: requiredWins - 1 - index,
      scoreB: requiredWins,
      label: `${requiredWins - 1 - index}-${requiredWins}`
    }))
  ];
}

async function sendTournamentMatchManageMenu(chatId: number | string, eventId: number, roundId: number, matchId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  const round = bundle.rounds.find((item) => item.id === roundId);
  const match = bundle.matches.find((item) => item.id === matchId && item.roundId === roundId);
  if (!round || !match) {
    await sendTelegramMessage(chatId, "Match not found.");
    return;
  }

  const teamById = new Map(bundle.teams.map((team) => [team.id, team]));
  const teamA = teamById.get(match.teamAId)?.name ?? "Team A";
  const teamB = match.teamBId ? (teamById.get(match.teamBId)?.name ?? "Team B") : "BYE";
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const eventMode = getTournamentEventMode(bundle.event);
  const matchBestOf = getTournamentRoundBestOf(bundle.event, round.roundNumber);

  if (!match.teamBId) {
    const byeScore = getTournamentByeScore(eventMode, matchBestOf);
    keyboard.push([
      {
        text: `${teamA} gets BYE (${byeScore.scoreA}-${byeScore.scoreB})`,
        callback_data: `match_score:${bundle.event.id}:${round.id}:${match.id}:${byeScore.scoreA}-${byeScore.scoreB}`
      }
    ]);
  } else {
    for (const option of buildTournamentScoreOptions(bundle.event, round.roundNumber)) {
      const label =
        option.scoreA === 0 && option.scoreB === 0 && tournamentAllowsBo1RegularSeasonDraw(eventMode, matchBestOf)
          ? `${teamA} Draw (20m+)`
          : `${teamA} ${option.label}`;
      keyboard.push([
        {
          text: label,
          callback_data: `match_score:${bundle.event.id}:${round.id}:${match.id}:${option.scoreA}-${option.scoreB}`
        }
      ]);
    }
    if (match.result !== "pending") {
      keyboard.push([
        {
          text: "Reset Result",
          callback_data: `match_reset:${bundle.event.id}:${round.id}:${match.id}`
        }
      ]);
    }
  }
  keyboard.push([
    {
      text: "Back to Round",
      callback_data: `round_manage:${bundle.event.id}:${round.id}`
    }
  ]);

  await sendTelegramMessage(
    chatId,
    [
      `Round ${round.roundNumber} - Match ${match.pairingOrder}`,
      `${teamA} vs ${teamB}`,
      `Current status: ${match.result === "pending" ? "pending" : `${match.scoreA ?? "-"}-${match.scoreB ?? "-"}`}`,
      `${formatTelegramEventModeLabel(eventMode)} · BO${matchBestOf}. Pilih skor dari POV ${teamA}.`,
      eventMode === "regular_season"
        ? matchBestOf === 1
          ? "Standing points: win = 1, draw = 0.5, loss = 0, bye = 1. Untuk BO1 Regular Season, pilih Draw (20m+) jika match berakhir lebih dari 20 menit."
          : "Standing points: win = 1, draw = 0.5, loss = 0, bye = 1."
        : "Bracket akan otomatis mengikuti skor yang dipilih."
    ].join("\n"),
    {
      inlineKeyboard: keyboard
    }
  );
}

async function sendTournamentEventListMenu(chatId: number | string, telegramUserId: string) {
  const events = await listTournamentEventsForTelegramUser(telegramUserId, normalizeTelegramChatId(chatId), 8);
  if (events.length === 0) {
    await sendTelegramMessage(chatId, "No recent events found in your account or this chat. Use /create-new-event first.");
    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      "Recent events in your account or this chat:",
      ...events.map((event, index) => `${index + 1}. ${event.name} (${event.code})`),
      "Reply with the event number or event code, or use the buttons below."
    ].join("\n"),
    {
      inlineKeyboard: events.map((event) => [
        {
          text: `${event.name} (${event.code})`,
          callback_data: `event_manage:${event.id}`
        }
      ])
    }
  );
}

async function handleTelegramCreateEventStep(
  chatId: number | string,
  telegramUserId: string,
  telegramChatId: string | null,
  text: string,
  session: typeof telegramSessions.$inferSelect
) {
  const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;

  if (session.step === "AWAITING_EVENT_NAME") {
    const eventName = text.trim();
    if (eventName.length < 3 || eventName.length > 160) {
      await sendTelegramMessage(chatId, "Tournament name must be between 3 and 160 characters.");
      return;
    }

    const nextPayload = {
      ...payload,
      eventName
    };

    if (hasCompleteCreateEventDraft(nextPayload)) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONFIRMATION", nextPayload);
      await sendCreateEventConfirmation(chatId, nextPayload);
      return;
    }

    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_DATE", nextPayload);
    await sendCreateEventDatePrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_EVENT_DATE") {
    const eventDate = normalizeEventDateInput(text);
    if (!eventDate) {
      await sendTelegramMessage(chatId, "Invalid date. Use DD-MM-YYYY.");
      return;
    }

    const nextPayload = {
      ...payload,
      eventDate
    };

    if (hasCompleteCreateEventDraft(nextPayload)) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONFIRMATION", nextPayload);
      await sendCreateEventConfirmation(chatId, nextPayload);
      return;
    }

    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_MODE", nextPayload);
    await sendCreateEventModePrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_EVENT_MODE") {
    const normalizedMode = text.trim().toLowerCase();
    const eventMode =
      normalizedMode === "playoffs" || normalizedMode === "playoff"
        ? "playoffs"
        : normalizedMode === "regular season" || normalizedMode === "regular_season" || normalizedMode === "regular"
          ? "regular_season"
          : null;
    if (!eventMode) {
      await sendTelegramMessage(chatId, 'Choose "Regular Season" or "Playoffs".');
      return;
    }

    const nextPayload = {
      ...payload,
      eventMode,
      regularSeasonFormat: undefined,
      regularSeasonCustomRounds: undefined,
      playoffSemifinalBestOf: undefined,
      playoffFinalBestOf: undefined,
      matchBestOf: undefined,
      totalTeams: undefined,
      totalRounds: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "regular_season" ? "AWAITING_REGULAR_SEASON_FORMAT" : "AWAITING_MATCH_BEST_OF",
      nextPayload
    );
    if (eventMode === "regular_season") {
      await sendCreateEventRegularSeasonFormatPrompt(chatId);
    } else {
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    }
    return;
  }

  if (session.step === "AWAITING_REGULAR_SEASON_FORMAT") {
    const regularSeasonFormat = normalizeRegularSeasonFormatInput(text);
    if (!regularSeasonFormat) {
      await sendTelegramMessage(chatId, 'Choose "Round Robin", "Double Round Robin", "5 Round", or "Custom Round".');
      return;
    }

    const nextPayload = {
      ...payload,
      regularSeasonFormat,
      regularSeasonCustomRounds: undefined,
      totalTeams: undefined,
      totalRounds: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      regularSeasonFormat === "custom_round" ? "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS" : "AWAITING_MATCH_BEST_OF",
      nextPayload
    );
    if (regularSeasonFormat === "custom_round") {
      await sendCreateEventRegularSeasonCustomRoundsPrompt(chatId);
    } else {
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    }
    return;
  }

  if (session.step === "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS") {
    const regularSeasonCustomRounds = parsePositiveIntegerInput(text);
    if (!regularSeasonCustomRounds || regularSeasonCustomRounds > 10) {
      await sendTelegramMessage(chatId, "Custom round must be a number from 1 to 10.");
      return;
    }

    const nextPayload = {
      ...payload,
      regularSeasonCustomRounds,
      totalRounds: regularSeasonCustomRounds,
      totalTeams: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
    await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    return;
  }

  if (session.step === "AWAITING_MATCH_BEST_OF") {
    const matchBestOf = parsePositiveIntegerInput(text);
    const eventMode = payload.eventMode ?? "regular_season";
    if (!matchBestOf || matchBestOf > 9) {
      await sendTelegramMessage(chatId, "Match Best Of must be a number between 1 and 9.");
      return;
    }
    if (eventMode === "playoffs" && matchBestOf % 2 === 0) {
      await sendTelegramMessage(chatId, "Playoffs only allows odd BO values like BO1, BO3, or BO5.");
      return;
    }
    if (eventMode === "playoffs" && ![1, 3, 5].includes(matchBestOf)) {
      await sendTelegramMessage(chatId, "Playoff early rounds only allow BO1, BO3, or BO5.");
      return;
    }

    const nextPayload = {
      ...payload,
      eventMode,
      matchBestOf,
      totalTeams: undefined,
      totalRounds: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "playoffs" ? "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF" : "AWAITING_TOTAL_TEAMS",
      nextPayload
    );
    if (eventMode === "playoffs") {
      await sendCreateEventPlayoffSemifinalBestOfPrompt(chatId);
    } else {
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
    }
    return;
  }

  if (session.step === "AWAITING_MATCH_BEST_OF_CUSTOM") {
    const matchBestOf = parsePositiveIntegerInput(text);
    if (!matchBestOf || matchBestOf > 9) {
      await sendTelegramMessage(chatId, "Custom BO must be a number between 1 and 9.");
      return;
    }

    const nextPayload = {
      ...payload,
      matchBestOf,
      totalTeams: undefined,
      totalRounds: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", nextPayload);
    await sendCreateEventTeamsPrompt(chatId, nextPayload);
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF") {
    const playoffSemifinalBestOf = parsePositiveIntegerInput(text);
    if (!playoffSemifinalBestOf || ![1, 3, 5].includes(playoffSemifinalBestOf)) {
      await sendTelegramMessage(chatId, "Semifinal BO only allows BO1, BO3, or BO5.");
      return;
    }

    const nextPayload = {
      ...payload,
      playoffSemifinalBestOf
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_FINAL_BEST_OF", nextPayload);
    await sendCreateEventPlayoffFinalBestOfPrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_FINAL_BEST_OF") {
    const playoffFinalBestOf = parsePositiveIntegerInput(text);
    if (!playoffFinalBestOf || ![3, 5, 7].includes(playoffFinalBestOf)) {
      await sendTelegramMessage(chatId, "Final BO only allows BO3, BO5, or BO7.");
      return;
    }

    const nextPayload = {
      ...payload,
      playoffFinalBestOf
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", nextPayload);
    await sendCreateEventTeamsPrompt(chatId, nextPayload);
    return;
  }

  if (session.step === "AWAITING_TOTAL_TEAMS") {
    const totalTeams = parsePositiveIntegerInput(text);
    const eventMode = payload.eventMode ?? "regular_season";
    if (!totalTeams || totalTeams < 2 || totalTeams > 128) {
      await sendTelegramMessage(chatId, "Total teams must be a number between 2 and 128.");
      return;
    }
    if (eventMode === "regular_season" && totalTeams % 2 !== 0) {
      await sendTelegramMessage(chatId, "Regular Season requires an even number of teams.");
      return;
    }

    const totalRounds = calculateTournamentTotalRounds(
      eventMode,
      totalTeams,
      payload.regularSeasonFormat,
      payload.regularSeasonCustomRounds
    );
    const nextPayload = {
      ...payload,
      totalTeams,
      totalRounds
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
    await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    return;
  }

  if (session.step === "AWAITING_TEAM_NAMES") {
    const teamNames = parseTeamNamesInput(text);
    const totalTeams = payload.totalTeams ?? 0;

    if (teamNames.length !== totalTeams) {
      await sendTelegramMessage(chatId, `Expected ${totalTeams} team names, but received ${teamNames.length}.`);
      return;
    }

    const normalizedNames = teamNames.map((name) => name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      await sendTelegramMessage(chatId, "Team names must be unique.");
      return;
    }

    const nextPayload = {
      ...payload,
      teamNames
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES_REVIEW", nextPayload);
    await sendCreateEventTeamNamesReview(chatId, nextPayload);
    return;
  }

  if (session.step === "AWAITING_TEAM_NAMES_REVIEW") {
    await sendTelegramMessage(chatId, "Use the buttons below the review message to continue or re-enter the team list.");
    return;
  }

  if (session.step === "AWAITING_CONTACT_PERSON_DECISION") {
    const eventId = payload.createdEventId;
    if (!eventId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Contact setup session expired.");
      return;
    }

    const normalized = text.trim().toLowerCase();
    if (normalized === "skip" || isTelegramNegative(text)) {
      await finalizeTelegramCreatedEvent(chatId, telegramUserId, eventId);
      return;
    }

    if (normalized === "add" || isTelegramAffirmative(text)) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_TEAM_SELECTION", payload);
      await sendCreateEventContactMenu(chatId, eventId);
      return;
    }

    await sendTelegramMessage(chatId, "Use Add Contact Person or Skip.");
    return;
  }

  if (session.step === "AWAITING_CONTACT_TEAM_SELECTION") {
    const eventId = payload.createdEventId;
    if (!eventId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Contact setup session expired.");
      return;
    }

    const normalized = text.trim().toLowerCase();
    if (normalized === "done" || normalized === "skip" || isTelegramNegative(text)) {
      await finalizeTelegramCreatedEvent(chatId, telegramUserId, eventId);
      return;
    }

    const bundle = await loadTournamentBundle(eventId);
    if (!bundle) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Event not found.");
      return;
    }

    const bulkParsed = parseBulkCaptainContactInput(text, bundle.teams);
    if (bulkParsed) {
      if (bulkParsed.saved.length > 0) {
        for (const item of bulkParsed.saved) {
          await db
            .update(tournamentTeams)
            .set({ captainWhatsapp: item.captainWhatsapp })
            .where(eq(tournamentTeams.id, item.teamId));
        }
      }

      const lines = [
        "Captain contact import finished.",
        `Saved: ${bulkParsed.saved.length}`
      ];

      if (bulkParsed.unknownTeams.length > 0) {
        lines.push("", "Team not found:");
        lines.push(...bulkParsed.unknownTeams.map((name) => `- ${name}`));
      }

      if (bulkParsed.invalidNumbers.length > 0) {
        lines.push("", "Invalid number:");
        lines.push(...bulkParsed.invalidNumbers.map((name) => `- ${name}`));
      }

      if (bulkParsed.saved.length === 0 && bulkParsed.unknownTeams.length === 0 && bulkParsed.invalidNumbers.length === 0) {
        lines.push("No data imported.");
      }

      await sendTelegramMessage(chatId, lines.join("\n"));
      await sendCreateEventContactMenu(chatId, eventId);
      return;
    }

    await sendTelegramMessage(
      chatId,
      "Choose a team from the contact menu, paste bulk contact data, or send done to finish."
    );
    return;
  }

  if (session.step === "AWAITING_CONTACT_PHONE") {
    const eventId = payload.createdEventId;
    const teamId = payload.selectedContactTeamId;
    if (!eventId || !teamId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Contact setup session expired.");
      return;
    }

    if (isTelegramNegative(text)) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_TEAM_SELECTION", {
        ...payload,
        selectedContactTeamId: undefined
      });
      await sendCreateEventContactMenu(chatId, eventId);
      return;
    }

    const captainWhatsapp = normalizeWhatsappContactInput(text);
    if (!captainWhatsapp) {
      await sendTelegramMessage(
        chatId,
        "Invalid WhatsApp number. Use country code and digits only, for example 6281234567890."
      );
      return;
    }

    const team = await loadTournamentTeamById(teamId);
    if (!team || team.eventId !== eventId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Team not found.");
      return;
    }

    await db
      .update(tournamentTeams)
      .set({ captainWhatsapp })
      .where(eq(tournamentTeams.id, team.id));

    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_TEAM_SELECTION", {
      ...payload,
      selectedContactTeamId: undefined
    });
    await sendTelegramMessage(chatId, `Saved captain contact for ${team.name}.`);
    await sendCreateEventContactMenu(chatId, eventId);
    return;
  }

  if (session.step === "AWAITING_CONFIRMATION") {
    if (isTelegramNegative(text)) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Event creation cancelled.");
      return;
    }

    if (!isTelegramAffirmative(text)) {
      await sendTelegramMessage(chatId, 'Reply "yes" to confirm or "cancel" to abort.');
      return;
    }

    try {
      const created = await createTournamentEventFromTelegramPayload(payload, telegramUserId, telegramChatId);
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_PERSON_DECISION", {
        createdEventId: created.event.id
      });
      await sendCreateEventContactDecisionPrompt(chatId, created.event);
      return;
    } catch (error) {
      console.warn("[telegram] create event failed", error);
      await sendTelegramMessage(chatId, "Failed to create event. Restart with /create-new-event.");
      return;
    }
  }
}

async function handleTelegramViewEventStep(
  chatId: number | string,
  telegramUserId: string,
  telegramChatId: string | null,
  groupChat: boolean,
  text: string,
  session: typeof telegramSessions.$inferSelect
) {
  const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
  if (session.step !== "AWAITING_VIEW_EVENT_SELECTION") return;

  const selectionIndex = Number.parseInt(text.trim(), 10);
  let selectedEvent: TournamentEventRecord | null = null;

  if (Number.isInteger(selectionIndex) && selectionIndex > 0 && payload.eventOptions?.[selectionIndex - 1]) {
    selectedEvent = await loadTournamentEventById(payload.eventOptions[selectionIndex - 1].id);
  } else {
    selectedEvent = await loadTournamentEventByCode(text);
  }

  if (!selectedEvent) {
    await sendTelegramMessage(chatId, "Event not found. Reply with a valid event code or listed number.");
    return;
  }

  if (!canAccessTournamentEvent(selectedEvent, telegramUserId, telegramChatId)) {
    await sendTelegramMessage(chatId, "You do not have access to this event.");
    return;
  }

  await maybeShareTournamentEventToChat(selectedEvent, telegramUserId, telegramChatId, groupChat);
  await clearTelegramSession(telegramUserId);
  await sendTournamentManageMenu(chatId, selectedEvent.id);
}

async function handleTelegramCallbackQuery(update: TelegramUpdate["callback_query"]) {
  const callbackQueryId = update?.id;
  const chatId = update?.message?.chat?.id;
  const chatType = update?.message?.chat?.type;
  const rawData = update?.data ?? "";
  const telegramUserId = update?.from?.id ? String(update.from.id) : "";
  const telegramChatId = normalizeTelegramChatId(chatId);
  const groupChat = isTelegramGroupChat(chatType, chatId);

  if (!callbackQueryId || !chatId || !rawData || !telegramUserId) return;

  if (rawData === "events_list") {
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTournamentEventListMenu(chatId, telegramUserId);
    return;
  }

  if (rawData === "start_create_event") {
    await saveTelegramSession(telegramUserId, "/create-new-event", "AWAITING_EVENT_NAME", {});
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventNamePrompt(chatId);
    return;
  }

  if (rawData === "start_view_event") {
    const events = await listTournamentEventsForTelegramUser(telegramUserId, telegramChatId, 8);
    await saveTelegramSession(telegramUserId, "/view-event", "AWAITING_VIEW_EVENT_SELECTION", {
      eventOptions: events.map((event) => ({
        id: event.id,
        code: event.code,
        name: event.name
      }))
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTournamentEventListMenu(chatId, telegramUserId);
    return;
  }

  if (rawData.startsWith("create_event_mode:")) {
    const session = await loadTelegramSession(telegramUserId);
    const eventMode = normalizeTournamentEventMode(rawData.split(":")[1]);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = {
      ...payload,
      eventMode,
      regularSeasonFormat: undefined,
      regularSeasonCustomRounds: undefined,
      playoffSemifinalBestOf: undefined,
      playoffFinalBestOf: undefined,
      matchBestOf: undefined,
      totalTeams: undefined,
      totalRounds: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "regular_season" ? "AWAITING_REGULAR_SEASON_FORMAT" : "AWAITING_MATCH_BEST_OF",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (eventMode === "regular_season") {
      await sendCreateEventRegularSeasonFormatPrompt(chatId);
    } else {
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    }
    return;
  }

  if (rawData.startsWith("create_regular_format:")) {
    const session = await loadTelegramSession(telegramUserId);
    const regularSeasonFormat = normalizeRegularSeasonFormatInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !regularSeasonFormat) {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = {
      ...payload,
      regularSeasonFormat,
      regularSeasonCustomRounds: undefined,
      totalTeams: undefined,
      totalRounds: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      regularSeasonFormat === "custom_round" ? "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS" : "AWAITING_MATCH_BEST_OF",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (regularSeasonFormat === "custom_round") {
      await sendCreateEventRegularSeasonCustomRoundsPrompt(chatId);
    } else {
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    }
    return;
  }

  if (rawData.startsWith("create_match_best_of:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const matchBestOfRaw = rawData.split(":")[1] ?? "";
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const eventMode = payload.eventMode ?? "regular_season";
    if (matchBestOfRaw === "custom") {
      if (eventMode === "playoffs") {
        await answerTelegramCallbackQuery(callbackQueryId, "Playoffs does not use custom BO.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF_CUSTOM", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendTelegramMessage(chatId, "Send custom Match Best Of value. Example: 5");
      return;
    }

    const matchBestOf = parsePositiveIntegerInput(matchBestOfRaw);
    if (!matchBestOf || matchBestOf > 9) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid BO value.");
      return;
    }
    if (eventMode === "playoffs" && matchBestOf % 2 === 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Playoffs only allows odd BO values.");
      return;
    }
    if (eventMode === "playoffs" && ![1, 3, 5].includes(matchBestOf)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Playoff early rounds only allow BO1, BO3, or BO5.");
      return;
    }

    const nextPayload = {
      ...payload,
      matchBestOf,
      totalTeams: undefined,
      totalRounds: undefined,
      teamNames: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "playoffs" ? "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF" : "AWAITING_TOTAL_TEAMS",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (eventMode === "playoffs") {
      await sendCreateEventPlayoffSemifinalBestOfPrompt(chatId);
    } else {
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
    }
    return;
  }

  if (rawData.startsWith("create_playoff_semifinal_best_of:")) {
    const session = await loadTelegramSession(telegramUserId);
    const playoffSemifinalBestOf = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !playoffSemifinalBestOf || ![1, 3, 5].includes(playoffSemifinalBestOf)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid semifinal BO value.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_FINAL_BEST_OF", {
      ...payload,
      playoffSemifinalBestOf
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventPlayoffFinalBestOfPrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_playoff_final_best_of:")) {
    const session = await loadTelegramSession(telegramUserId);
    const playoffFinalBestOf = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !playoffFinalBestOf || ![3, 5, 7].includes(playoffFinalBestOf)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid final BO value.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = {
      ...payload,
      playoffFinalBestOf
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventTeamsPrompt(chatId, nextPayload);
    return;
  }

  if (rawData.startsWith("create_total_teams:")) {
    const session = await loadTelegramSession(telegramUserId);
    const [, modeRaw, totalTeamsRaw] = rawData.split(":");
    const totalTeams = parsePositiveIntegerInput(totalTeamsRaw ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !totalTeams || totalTeams < 2) {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const eventMode = normalizeTournamentEventMode(modeRaw);
    if (eventMode === "regular_season" && totalTeams % 2 !== 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Regular Season requires an even number of teams.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const totalRounds = calculateTournamentTotalRounds(
      eventMode,
      totalTeams,
      payload.regularSeasonFormat,
      payload.regularSeasonCustomRounds
    );
    const nextPayload = {
      ...payload,
      eventMode,
      totalTeams,
      totalRounds
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    return;
  }

  if (rawData === "create_team_names_confirm") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONFIRMATION", payload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventConfirmation(chatId, payload);
    return;
  }

  if (rawData === "create_team_names_retry") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", {
      ...payload,
      teamNames: undefined
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventTeamNamesPrompt(chatId, payload.totalTeams ?? 0, payload);
    return;
  }

  if (rawData === "create_confirm") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;

    try {
      const created = await createTournamentEventFromTelegramPayload(payload, telegramUserId, telegramChatId);
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_PERSON_DECISION", {
        createdEventId: created.event.id
      });
      await answerTelegramCallbackQuery(callbackQueryId, "Event created. Add contact or skip.");
      await sendCreateEventContactDecisionPrompt(chatId, created.event);
      return;
    } catch (error) {
      console.warn("[telegram] create event failed", error);
      await answerTelegramCallbackQuery(callbackQueryId, "Create event failed.");
      await sendTelegramMessage(chatId, "Failed to create event. Restart with /create-new-event.");
      return;
    }
  }

  if (rawData.startsWith("create_contact_")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const [contactAction, eventIdRaw, teamIdRaw] = rawData.split(":");
    const eventId = Number.parseInt(eventIdRaw ?? "", 10);
    const teamId = Number.parseInt(teamIdRaw ?? "", 10);

    if (!Number.isInteger(eventId) || !payload.createdEventId || payload.createdEventId !== eventId) {
      await answerTelegramCallbackQuery(callbackQueryId, "Contact setup session expired.");
      return;
    }

    const event = await loadTournamentEventById(eventId);
    if (!event) {
      await answerTelegramCallbackQuery(callbackQueryId, "Event not found.");
      return;
    }

    if (!canAccessTournamentEvent(event, telegramUserId, telegramChatId)) {
      await answerTelegramCallbackQuery(callbackQueryId, "You do not have access to this event.");
      return;
    }

    if (contactAction === "create_contact_start" || contactAction === "create_contact_back") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_TEAM_SELECTION", {
        ...payload,
        selectedContactTeamId: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventContactMenu(chatId, eventId);
      return;
    }

    if (contactAction === "create_contact_skip" || contactAction === "create_contact_done") {
      await answerTelegramCallbackQuery(callbackQueryId, "Contact setup finished.");
      await finalizeTelegramCreatedEvent(chatId, telegramUserId, eventId);
      return;
    }

    if (contactAction === "create_contact_team") {
      if (!Number.isInteger(teamId)) {
        await answerTelegramCallbackQuery(callbackQueryId, "Team not found.");
        return;
      }

      const team = await loadTournamentTeamById(teamId);
      if (!team || team.eventId !== eventId) {
        await answerTelegramCallbackQuery(callbackQueryId, "Team not found.");
        return;
      }

      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_PHONE", {
        ...payload,
        selectedContactTeamId: team.id
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventContactPhonePrompt(chatId, eventId, team.id);
      return;
    }
  }

  if (rawData === "create_cancel") {
    await clearTelegramSession(telegramUserId);
    await answerTelegramCallbackQuery(callbackQueryId, "Cancelled.");
    await sendTelegramMessage(chatId, "Event creation cancelled.");
    return;
  }

  if (rawData.startsWith("create_edit:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Create event session not found.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const target = rawData.split(":")[1] ?? "";

    if (target === "event_name") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_NAME", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventNamePrompt(chatId);
      return;
    }

    if (target === "event_date") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_DATE", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventDatePrompt(chatId);
      return;
    }

    if (target === "event_mode") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_MODE", {
        ...payload,
        eventMode: undefined,
        regularSeasonFormat: undefined,
        regularSeasonCustomRounds: undefined,
        playoffSemifinalBestOf: undefined,
        playoffFinalBestOf: undefined,
        matchBestOf: undefined,
        totalTeams: undefined,
        totalRounds: undefined,
        teamNames: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventModePrompt(chatId);
      return;
    }

    if (target === "regular_format") {
      if (payload.eventMode !== "regular_season") {
        await answerTelegramCallbackQuery(callbackQueryId, "Regular season format only applies to Regular Season.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_FORMAT", {
        ...payload,
        regularSeasonFormat: undefined,
        regularSeasonCustomRounds: undefined,
        totalTeams: undefined,
        totalRounds: undefined,
        teamNames: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventRegularSeasonFormatPrompt(chatId);
      return;
    }

    if (target === "match_best_of") {
      const nextPayload = {
        ...payload,
        matchBestOf: undefined,
        playoffSemifinalBestOf: payload.eventMode === "playoffs" ? undefined : payload.playoffSemifinalBestOf,
        playoffFinalBestOf: payload.eventMode === "playoffs" ? undefined : payload.playoffFinalBestOf,
        totalTeams: undefined,
        totalRounds: undefined,
        teamNames: undefined
      };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
      return;
    }

    if (target === "total_teams") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", {
        ...payload,
        totalTeams: undefined,
        totalRounds: undefined,
        teamNames: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventTeamsPrompt(chatId, payload);
      return;
    }

    if (target === "team_names") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventTeamNamesPrompt(chatId, payload.totalTeams ?? 0, payload);
      return;
    }
  }

  const [action, eventIdRaw, roundIdRaw, matchIdRaw, resultRaw] = rawData.split(":");
  const eventId = eventIdRaw ? Number.parseInt(eventIdRaw, 10) : null;
  const roundId = roundIdRaw ? Number.parseInt(roundIdRaw, 10) : null;
  const matchId = matchIdRaw ? Number.parseInt(matchIdRaw, 10) : null;

  if (!eventId || Number.isNaN(eventId)) {
    await answerTelegramCallbackQuery(callbackQueryId, "Invalid action.");
    return;
  }

  const event = await loadTournamentEventById(eventId);
  if (!event) {
    await answerTelegramCallbackQuery(callbackQueryId, "Event not found.");
    return;
  }

  if (!canAccessTournamentEvent(event, telegramUserId, telegramChatId)) {
    await answerTelegramCallbackQuery(callbackQueryId, "You do not have access to this event.");
    return;
  }

  await maybeShareTournamentEventToChat(event, telegramUserId, telegramChatId, groupChat);

  if (action === "event_manage") {
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTournamentManageMenu(chatId, eventId);
    return;
  }

  if (action === "standings_view") {
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTournamentStandingsSummary(chatId, eventId);
    return;
  }

  if (action === "bracket_view") {
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTournamentBracketSummary(chatId, eventId);
    return;
  }

  if (action === "round_manage") {
    await answerTelegramCallbackQuery(callbackQueryId);
    if (roundId && !Number.isNaN(roundId)) {
      await sendTournamentRoundManageMenu(chatId, eventId, roundId);
    }
    return;
  }

  if (action === "match_manage") {
    await answerTelegramCallbackQuery(callbackQueryId);
    if (roundId && matchId && !Number.isNaN(roundId) && !Number.isNaN(matchId)) {
      await sendTournamentMatchManageMenu(chatId, eventId, roundId, matchId);
    }
    return;
  }

  if (action === "match_score") {
    if (!roundId || Number.isNaN(roundId) || !matchId || Number.isNaN(matchId) || !resultRaw) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid result action.");
      return;
    }

    const bundle = await loadTournamentBundle(eventId);
    const round = bundle?.rounds.find((item) => item.id === roundId);
    const match = bundle?.matches.find((item) => item.id === matchId && item.roundId === roundId);
    if (!bundle || !round || !match) {
      await answerTelegramCallbackQuery(callbackQueryId, "Match not found.");
      return;
    }

    const [scoreARaw, scoreBRaw] = resultRaw.split("-");
    const scoreA = Number.parseInt(scoreARaw ?? "", 10);
    const scoreB = Number.parseInt(scoreBRaw ?? "", 10);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid score selection.");
      return;
    }

    const saved = await saveTournamentMatchScore(bundle.event, round, match, scoreA, scoreB);
    if ("error" in saved) {
      await answerTelegramCallbackQuery(callbackQueryId, saved.error);
      return;
    }

    await answerTelegramCallbackQuery(callbackQueryId, "Result saved.");
    await sendTournamentRoundManageMenu(chatId, eventId, match.roundId);
    return;
  }

  if (action === "match_result") {
    if (!roundId || Number.isNaN(roundId) || !matchId || Number.isNaN(matchId) || !resultRaw) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid result action.");
      return;
    }

    const bundle = await loadTournamentBundle(eventId);
    const round = bundle?.rounds.find((item) => item.id === roundId);
    const match = bundle?.matches.find((item) => item.id === matchId && item.roundId === roundId);
    if (!bundle || !round || !match) {
      await answerTelegramCallbackQuery(callbackQueryId, "Match not found.");
      return;
    }

    const presetScore = getTournamentResultScore(
      resultRaw as TournamentMatchResultValue,
      getTournamentEventMode(bundle.event),
      getTournamentRoundBestOf(bundle.event, round.roundNumber)
    );
    const payload = updateTournamentMatchResultBodySchema.parse({
      result: resultRaw,
      scoreA: presetScore.scoreA,
      scoreB: presetScore.scoreB
    });

    const validationError = validateTournamentResultScore(
      payload.result,
      payload.scoreA ?? 0,
      payload.scoreB ?? 0,
      Boolean(match.teamBId),
      getTournamentEventMode(bundle.event),
      getTournamentRoundBestOf(bundle.event, round.roundNumber)
    );
    if (validationError) {
      await answerTelegramCallbackQuery(callbackQueryId, validationError);
      return;
    }

    const saved = await saveTournamentMatchScore(bundle.event, round, match, presetScore.scoreA, presetScore.scoreB);
    if ("error" in saved) {
      await answerTelegramCallbackQuery(callbackQueryId, saved.error);
      return;
    }
    await answerTelegramCallbackQuery(callbackQueryId, "Result saved.");
    await sendTournamentRoundManageMenu(chatId, eventId, match.roundId);
    return;
  }

  if (action === "match_reset") {
    if (!roundId || Number.isNaN(roundId) || !matchId || Number.isNaN(matchId)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid reset action.");
      return;
    }

    await db
      .update(tournamentMatches)
      .set({
        scoreA: null,
        scoreB: null,
        result: "pending",
        winnerTeamId: null,
        updatedAt: new Date()
      })
      .where(and(eq(tournamentMatches.eventId, eventId), eq(tournamentMatches.id, matchId)));

    await db
      .update(tournamentRounds)
      .set({
        status: "active"
      })
      .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, roundId)));

    await db
      .update(tournamentEvents)
      .set({
        status: "ongoing",
        updatedAt: new Date()
      })
      .where(eq(tournamentEvents.id, eventId));

    await answerTelegramCallbackQuery(callbackQueryId, "Result reset.");
    await sendTournamentRoundManageMenu(chatId, eventId, roundId);
    return;
  }

  if (action === "next_round") {
    if (!tournamentUsesFlexiblePairings(event)) {
      const generated = await generateTournamentNextRound(eventId, "default");
      if ("error" in generated) {
        await answerTelegramCallbackQuery(callbackQueryId, generated.error);
        return;
      }

      if (generated.completed) {
        await answerTelegramCallbackQuery(callbackQueryId, "Final round already reached. Use Finish Event.");
        await sendTournamentManageMenu(chatId, eventId);
        return;
      }

      await answerTelegramCallbackQuery(callbackQueryId, "Next fixed round generated.");
      await sendTournamentManageMenu(chatId, eventId);
      return;
    }

    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTournamentNextRoundPairingMenu(chatId, eventId);
    return;
  }

  if (action === "next_round_pick") {
    const strategy = (resultRaw ?? roundIdRaw) === "shuffle" ? "shuffle" : "default";
    const preview = await previewTournamentNextRound(eventId, strategy);
    if ("error" in preview) {
      await answerTelegramCallbackQuery(callbackQueryId, preview.error);
      return;
    }

    if (preview.completed) {
      await answerTelegramCallbackQuery(callbackQueryId, "Final round already reached. Use Finish Event.");
      await sendTournamentManageMenu(chatId, eventId);
      return;
    }

    await saveTournamentNextRoundPreview(telegramUserId, {
      eventId,
      activeRoundId: preview.activeRound?.id ?? null,
      roundNumber: preview.nextRoundNumber,
      strategy,
      pairings: preview.pairings
    });

    await answerTelegramCallbackQuery(
      callbackQueryId,
      `${strategy === "shuffle" ? "Shuffle Match" : "Default Match"} preview ready.`
    );
    await sendTournamentNextRoundPreviewMenu(
      chatId,
      preview.bundle,
      preview.nextRoundNumber,
      strategy,
      preview.pairings
    );
    return;
  }

  if (action === "next_round_confirm") {
    const preview = await loadTournamentNextRoundPreview(telegramUserId, eventId);
    if (!preview || preview.eventId !== eventId || !Array.isArray(preview.pairings) || preview.pairings.length === 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pairing preview expired. Generate again.");
      await sendTournamentNextRoundPairingMenu(chatId, eventId);
      return;
    }

    const bundle = await loadTournamentBundle(eventId);
    const context = prepareTournamentNextRoundContext(bundle);
    if ("error" in context) {
      await answerTelegramCallbackQuery(callbackQueryId, context.error);
      return;
    }

    if (context.completed) {
      await clearTournamentNextRoundPreview(telegramUserId, eventId);
      await answerTelegramCallbackQuery(callbackQueryId, "Final round already reached. Use Finish Event.");
      await sendTournamentManageMenu(chatId, eventId);
      return;
    }

    if ((context.activeRound?.id ?? null) !== preview.activeRoundId || context.nextRoundNumber !== preview.roundNumber) {
      await clearTournamentNextRoundPreview(telegramUserId, eventId);
      await answerTelegramCallbackQuery(callbackQueryId, "Pairing preview is outdated. Generate again.");
      await sendTournamentNextRoundPairingMenu(chatId, eventId);
      return;
    }

    const created = await persistTournamentNextRound(
      eventId,
      preview.activeRoundId,
      preview.roundNumber,
      preview.pairings
    );
    if ("error" in created) {
      await answerTelegramCallbackQuery(callbackQueryId, created.error);
      return;
    }

    await clearTournamentNextRoundPreview(telegramUserId, eventId);
    await answerTelegramCallbackQuery(
      callbackQueryId,
      `Round ${preview.roundNumber} generated with ${preview.strategy === "shuffle" ? "Shuffle Match" : "Default Match"}.`
    );
    const roundShareSummary = formatTournamentRoundShareSummary(created.bundle, created.round.roundNumber);
    if (roundShareSummary) {
      await sendTelegramMessage(chatId, roundShareSummary, {
        inlineKeyboard: [[{ text: "Copy Message", copy_text: { text: roundShareSummary } }]]
      });
    }
    await sendTournamentManageMenu(chatId, eventId);
    return;
  }

  if (action === "finish_event") {
    const finished = await finishTournamentEvent(eventId);
    if ("error" in finished) {
      await answerTelegramCallbackQuery(callbackQueryId, finished.error);
      return;
    }

    await answerTelegramCallbackQuery(callbackQueryId, "Event finished.");
    const finishShareSummary = formatTournamentFinishShareSummary(finished.bundle);
    if (finishShareSummary) {
      await sendTelegramMessage(chatId, finishShareSummary, {
        inlineKeyboard: [[{ text: "Copy Message", copy_text: { text: finishShareSummary } }]]
      });
    }
    await sendTournamentManageMenu(chatId, eventId);
    return;
  }

  if (action === "delete_event_prompt") {
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTelegramMessage(
      chatId,
      `Delete event ${event.name}?\nThis action will remove rounds, matches, and teams in this event.`,
      {
        inlineKeyboard: [
          [{ text: "Yes, Delete Event", callback_data: `delete_event_confirm:${eventId}` }],
          [{ text: "Cancel", callback_data: `event_manage:${eventId}` }]
        ]
      }
    );
    return;
  }

  if (action === "delete_event_confirm") {
    await db.delete(tournamentEvents).where(eq(tournamentEvents.id, eventId));
    await answerTelegramCallbackQuery(callbackQueryId, "Event deleted.");
    await sendTelegramMessage(chatId, `Event ${event.name} deleted.`);
    await sendTournamentEventListMenu(chatId, telegramUserId);
    return;
  }
}

async function handleTelegramIncomingMessage(update: TelegramUpdate) {
  if (update.callback_query) {
    await handleTelegramCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const fromId = message?.from?.id;
  const text = normalizeTelegramText(message?.text);

  if (!chatId || !fromId || !text) return;

  const telegramUserId = String(fromId);
  const telegramChatId = normalizeTelegramChatId(chatId);
  const groupChat = isTelegramGroupChat(chatType, chatId);
  const session = await loadTelegramSession(telegramUserId);

  if (text === "/cancel") {
    const payload = (session?.payloadJson ?? {}) as TelegramSessionPayload;
    if (
      session?.currentCommand === "/create-new-event"
      && payload.createdEventId
      && (
        session.step === "AWAITING_CONTACT_PERSON_DECISION"
        || session.step === "AWAITING_CONTACT_TEAM_SELECTION"
        || session.step === "AWAITING_CONTACT_PHONE"
      )
    ) {
      await finalizeTelegramCreatedEvent(chatId, telegramUserId, payload.createdEventId);
      return;
    }

    await clearTelegramSession(telegramUserId);
    await sendTelegramMessage(chatId, "Current session cleared.");
    return;
  }

  if (text.startsWith("/")) {
    const [rawCommand, ...args] = text.split(/\s+/);
    const command = rawCommand.split("@")[0];
    const arg = args.join(" ").trim();

    if (command === "/start") {
      await clearTelegramSession(telegramUserId);
      await sendTelegramStartMenu(chatId);
      return;
    }

    if (command === "/create-new-event") {
      await saveTelegramSession(telegramUserId, command, "AWAITING_EVENT_NAME", {});
      await sendCreateEventNamePrompt(chatId);
      return;
    }

    if (command === "/view-event") {
      if (arg) {
        const event = await loadTournamentEventByCode(arg);
        if (!event) {
          await sendTelegramMessage(chatId, "Event code not found.");
          return;
        }
        if (!canAccessTournamentEvent(event, telegramUserId, telegramChatId)) {
          await sendTelegramMessage(chatId, "You do not have access to this event.");
          return;
        }
        await maybeShareTournamentEventToChat(event, telegramUserId, telegramChatId, groupChat);
        await clearTelegramSession(telegramUserId);
        await sendTournamentManageMenu(chatId, event.id);
        return;
      }

      const events = await listTournamentEventsForTelegramUser(telegramUserId, telegramChatId, 8);
      await saveTelegramSession(telegramUserId, command, "AWAITING_VIEW_EVENT_SELECTION", {
        eventOptions: events.map((event) => ({
          id: event.id,
          code: event.code,
          name: event.name
        }))
      });
      await sendTournamentEventListMenu(chatId, telegramUserId);
      return;
    }

    await sendTelegramMessage(chatId, "Unknown command. Use /create-new-event or /view-event.");
    return;
  }

  if (!session) {
    await sendTelegramMessage(chatId, "Use /create-new-event or /view-event.");
    return;
  }

  if (session.currentCommand === "/create-new-event") {
    await handleTelegramCreateEventStep(chatId, telegramUserId, telegramChatId, text, session);
    return;
  }

  if (session.currentCommand === "/view-event") {
    await handleTelegramViewEventStep(chatId, telegramUserId, telegramChatId, groupChat, text, session);
  }
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
  let [snapshot] = await db
    .select({
      fetchedAt: heroStatsSnapshots.fetchedAt,
      data: heroStatsSnapshots.data
    })
    .from(heroStatsSnapshots)
    .where(and(eq(heroStatsSnapshots.timeframe, query.timeframe), eq(heroStatsSnapshots.rankScope, query.rankScope)))
    .orderBy(desc(heroStatsSnapshots.fetchedAt))
    .limit(1);

  if (!snapshot && query.rankScope !== "all_rank") {
    const [fallback] = await db
      .select({ fetchedAt: heroStatsSnapshots.fetchedAt, data: heroStatsSnapshots.data })
      .from(heroStatsSnapshots)
      .where(and(eq(heroStatsSnapshots.timeframe, query.timeframe), eq(heroStatsSnapshots.rankScope, "all_rank")))
      .orderBy(desc(heroStatsSnapshots.fetchedAt))
      .limit(1);
    if (fallback) snapshot = fallback;
  }

  if (!snapshot) {
    return { computedAt: null, rows: [] as TierResultRow[] };
  }

  const heroRows = await loadHeroCatalog();

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

async function loadGlobalTierByRankScope(timeframe: string, rankScope: string) {
  const cacheKey = `tier-scoped:${timeframe}:${rankScope}`;
  const cached = await cacheGet<{ computedAt: string | null; rows: TierResultRow[] }>(cacheKey);
  if (cached) return cached;

  const computed = await computeTierByRankScope({ timeframe, rankScope });
  const payload = {
    computedAt: computed.computedAt ? new Date(computed.computedAt).toISOString() : null,
    rows: computed.rows
  };
  void cacheSet(cacheKey, payload, 900);
  return payload;
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
  const tierCacheKey = `tier-map:${timeframe}:${rankScope}`;
  const cached = await cacheGet<Record<string, Tier>>(tierCacheKey);
  if (cached) {
    return new Map<number, Tier>(Object.entries(cached).map(([k, v]) => [Number(k), v]));
  }

  const map = await getTierMap(timeframe);
  void cacheSet(tierCacheKey, Object.fromEntries(map), 1800);
  return map;
}

async function loadHeroCatalog() {
  const cacheKey = "heroes:catalog:v1";
  const cached = await cacheGet<CachedHeroCatalogRow[]>(cacheKey);
  if (cached) return cached;

  const rows = await db
    .select({
      mlid: heroes.mlid,
      name: heroes.name,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes,
      specialities: heroes.specialities
    })
    .from(heroes)
    .orderBy(asc(heroes.name));

  const catalog = rows.map((row) => ({
    mlid: row.mlid,
    name: row.name,
    rolePrimary: row.rolePrimary,
    roleSecondary: row.roleSecondary,
    lanes: ((row.lanes ?? []) as string[]).filter(Boolean),
    specialities: ((row.specialities ?? []) as string[]).filter(Boolean)
  }));
  void cacheSet(cacheKey, catalog, 1800);
  return catalog;
}

async function loadRolePoolCatalog() {
  const cacheKey = "role-pool:catalog:v1";
  const cached = await cacheGet<CachedRolePoolEntry[]>(cacheKey);
  if (cached) return cached;

  const [roleRows, heroRows] = await Promise.all([
    db
      .select({
        mlid: heroRolePool.mlid,
        lane: heroRolePool.lane,
        confidence: heroRolePool.confidence
      })
      .from(heroRolePool)
      .orderBy(desc(heroRolePool.confidence)),
    db
      .select({ mlid: heroes.mlid, lanes: heroes.lanes })
      .from(heroes)
  ]);

  const byHero = new Map<number, string[]>();
  for (const row of roleRows) {
    const list = byHero.get(row.mlid) ?? [];
    if (!list.includes(row.lane)) list.push(row.lane);
    byHero.set(row.mlid, list);
  }

  for (const row of heroRows) {
    if (byHero.has(row.mlid)) continue;
    byHero.set(
      row.mlid,
      Array.from(new Set(((row.lanes ?? []) as string[]).filter(Boolean)))
    );
  }

  const entries = Array.from(byHero.entries()).map(([mlid, lanes]) => ({ mlid, lanes }));
  void cacheSet(cacheKey, entries, 1800);
  return entries;
}

async function loadRolePoolMapForMlids(mlids: number[]) {
  const uniqueMlids = Array.from(new Set(mlids.filter((mlid) => Number.isInteger(mlid) && mlid > 0)));
  if (uniqueMlids.length === 0) {
    return buildRolePoolMap([]);
  }

  const catalog = await loadRolePoolCatalog();
  const byHero = new Map<number, string[]>(catalog.map((entry) => [entry.mlid, entry.lanes]));

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

function minTierForContext(mode: DraftAnalyzeBody["mode"], rankScope: DraftAnalyzeBody["rankScope"]): Tier {
  if (mode === "tournament") return "S";
  if (mode === "custom") return "A";
  if (["mythic_glory", "mythic_honor", "mythic"].includes(rankScope)) return "A";
  if (["legend", "epic"].includes(rankScope)) return "B";
  return "C";
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

type DraftPhaseWeights = ReturnType<typeof phaseWeights>;

function normalizePhaseWeights(weights: DraftPhaseWeights): DraftPhaseWeights {
  const safe = {
    counterWeight: Math.max(0.001, weights.counterWeight),
    tierWeight: Math.max(0.001, weights.tierWeight),
    flexWeight: Math.max(0.001, weights.flexWeight),
    banRateWeight: Math.max(0.001, weights.banRateWeight),
    pickRateWeight: Math.max(0.001, weights.pickRateWeight),
    winRateWeight: Math.max(0.001, weights.winRateWeight),
    laneBonusWeight: Math.max(0.001, weights.laneBonusWeight)
  };
  const sum = safe.counterWeight +
    safe.tierWeight +
    safe.flexWeight +
    safe.banRateWeight +
    safe.pickRateWeight +
    safe.winRateWeight +
    safe.laneBonusWeight;
  if (sum <= 0) return phaseWeights(1);
  return {
    counterWeight: safe.counterWeight / sum,
    tierWeight: safe.tierWeight / sum,
    flexWeight: safe.flexWeight / sum,
    banRateWeight: safe.banRateWeight / sum,
    pickRateWeight: safe.pickRateWeight / sum,
    winRateWeight: safe.winRateWeight / sum,
    laneBonusWeight: safe.laneBonusWeight / sum
  };
}

function tunePhaseWeights(
  base: DraftPhaseWeights,
  context: {
    enemyPickCount: number;
    missingRoleCount: number;
    flexPickedCount: number;
  }
): DraftPhaseWeights {
  const enemyInfo = Math.max(0, Math.min(1, context.enemyPickCount / 4));
  const coverageUrgency = Math.max(0, Math.min(1, context.missingRoleCount / 3));
  const flexPressure = Math.max(0, Math.min(1, Math.max(0, context.flexPickedCount - 1) / 2));

  const tuned: DraftPhaseWeights = {
    ...base,
    counterWeight: base.counterWeight * (0.55 + enemyInfo * 0.7),
    tierWeight: base.tierWeight * (1 - coverageUrgency * 0.18 + flexPressure * 0.08),
    flexWeight: base.flexWeight * (0.8 + coverageUrgency * 0.6) * (1 - flexPressure * 0.25),
    banRateWeight: base.banRateWeight * (1 - coverageUrgency * 0.12),
    pickRateWeight: base.pickRateWeight * (1 - coverageUrgency * 0.18),
    winRateWeight: base.winRateWeight * (1 - coverageUrgency * 0.08),
    laneBonusWeight: base.laneBonusWeight * (0.9 + coverageUrgency * 0.5 + flexPressure * 0.2)
  };

  return normalizePhaseWeights(tuned);
}

type PickStageProfile = {
  stage: "early" | "mid" | "late";
  progress: number;
  stabilityBlend: number;
  metaStabilityBlend: number;
  counterVolatility: number;
  coverageWeight: number;
  laneConflictWeight: number;
  communityWeightScale: number;
  synergyWeightScale: number;
  counterReliabilityFloor: number;
};

function pickStageProfile(pickNumber: number): PickStageProfile {
  const progress = Math.max(0, Math.min(1, (pickNumber - 1) / 4));
  const midBias = 1 - Math.min(1, Math.abs(progress - 0.5) * 2);
  const stage: PickStageProfile["stage"] = progress < 0.35 ? "early" : progress < 0.8 ? "mid" : "late";
  return {
    stage,
    progress,
    stabilityBlend: Number((0.28 - 0.18 * progress).toFixed(4)),
    metaStabilityBlend: Number((0.22 - 0.12 * progress).toFixed(4)),
    counterVolatility: Number((0.42 + 0.48 * progress).toFixed(4)),
    coverageWeight: Number((0.06 + 0.10 * midBias + 0.03 * progress).toFixed(4)),
    laneConflictWeight: Number((0.03 + 0.03 * midBias).toFixed(4)),
    communityWeightScale: Number((0.85 + 0.25 * progress).toFixed(4)),
    synergyWeightScale: Number((0.9 + 0.2 * midBias + 0.1 * progress).toFixed(4)),
    counterReliabilityFloor: Number((0.40 + 0.35 * progress).toFixed(4))
  };
}

async function loadRankStatsMap(timeframe: string, rankScope: string) {
  const cacheKey = `rank-stats:${timeframe}:${rankScope}`;
  const cached = await cacheGet<CachedRankStatsRow[]>(cacheKey);
  if (cached) {
    return new Map(cached.map((row) => [row.mlid, {
      winRate: row.winRate,
      banRate: row.banRate,
      pickRate: row.pickRate
    }]));
  }

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

  void cacheSet(
    cacheKey,
    Array.from(statsMap.entries()).map(([mlid, stat]) => ({ mlid, ...stat })),
    900
  );
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


app.get("/debug/community-votes", async (c) => {
  const raw = await cacheGet<unknown>(COMMUNITY_VOTES_KEY);
  const isArray = Array.isArray(raw);
  return c.json({
    redisKey: COMMUNITY_VOTES_KEY,
    found: raw !== null,
    isArray,
    length: isArray ? (raw as unknown[]).length : null,
    sample: isArray ? (raw as unknown[]).slice(0, 3) : raw
  });
});

app.get("/", (c) =>
  c.json({
    service: "api",
    ok: true,
    endpoints: {
      health: "/health",
      healthFull: "/health/full"
    }
  })
);

app.get("/health", async (c) => {
  const dbOk = await db
    .execute(sql`SELECT 1`)
    .then((r) => r.rows.length > 0)
    .catch(() => false);
  return c.json({ ok: dbOk, service: "api" }, dbOk ? 200 : 503);
});

app.get("/health/full", async (c) => {
  const [dbOk, redisOk] = await Promise.all([
    db
      .execute(sql`SELECT 1`)
      .then((r) => r.rows.length > 0)
      .catch(() => false),
    cachePing()
  ]);
  const ok = dbOk && redisOk;
  return c.json(
    { ok, service: "api", checks: { db: dbOk, redis: redisOk } },
    ok ? 200 : 503
  );
});

app.post("/telegram/webhook", async (c) => {
  const secret = getTelegramWebhookSecret();
  const incomingSecret = (c.req.header("x-telegram-bot-api-secret-token") ?? "").trim();

  if (secret && incomingSecret !== secret) {
    return c.json({ error: "Invalid telegram webhook secret." }, 401);
  }

  const token = getTelegramBotToken();
  if (!token) {
    return c.json({ error: "Telegram bot is not configured." }, 503);
  }

  const update = await c.req.json<TelegramUpdate>().catch(() => null);
  if (!update) {
    return c.json({ error: "Invalid telegram payload." }, 400);
  }

  await handleTelegramIncomingMessage(update);
  return c.json({ ok: true });
});

app.post("/events", zValidator("json", createTournamentEventBodySchema), async (c) => {
  const body = c.req.valid("json");
  const created = await createTournamentEventRecord(body);

  return c.json({
    event: serializeTournamentEvent(created.event),
    teams: created.teams.map((team) => ({
      id: team.id,
      name: team.name,
      captainWhatsapp: team.captainWhatsapp,
      seed: team.seed,
      createdAt: team.createdAt.toISOString()
    })),
    bracket: buildTournamentBracket(created.round ? [created.round] : [], created.matches, created.teams),
    standings: buildTournamentStandings(created.teams, created.matches)
  }, 201);
});

app.get("/events", zValidator("query", tournamentEventsQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const conditions: SqlCondition[] = [];

  if (query.createdByTelegramUserId) {
    conditions.push(eq(tournamentEvents.createdByTelegramUserId, query.createdByTelegramUserId));
  }
  if (query.code) {
    conditions.push(eq(tournamentEvents.code, query.code));
  }

  const items = await db
    .select()
    .from(tournamentEvents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tournamentEvents.createdAt))
    .limit(query.limit);

  return c.json({
    items: items.map(serializeTournamentEvent),
    total: items.length
  });
});

app.get("/events/:id", zValidator("param", tournamentEventIdentifierParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const bundle = await loadTournamentBundle(id);

  if (!bundle) {
    return c.json({ error: "Event not found" }, 404);
  }

  return c.json({
    event: serializeTournamentEvent(bundle.event),
    teams: bundle.teams.map((team) => ({
      id: team.id,
      name: team.name,
      captainWhatsapp: team.captainWhatsapp,
      seed: team.seed,
      createdAt: team.createdAt.toISOString()
    })),
    rounds: bundle.rounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      createdAt: round.createdAt.toISOString()
    }))
  });
});

app.get("/events/:id/bracket", zValidator("param", tournamentEventIdentifierParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const bundle = await loadTournamentBundle(id);

  if (!bundle) {
    return c.json({ error: "Event not found" }, 404);
  }

  return c.json({
    event: serializeTournamentEvent(bundle.event),
    rounds: buildTournamentBracket(bundle.rounds, bundle.matches, bundle.teams)
  });
});

app.get("/events/:id/standings", zValidator("param", tournamentEventIdentifierParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const bundle = await loadTournamentBundle(id);

  if (!bundle) {
    return c.json({ error: "Event not found" }, 404);
  }

  return c.json({
    event: serializeTournamentEvent(bundle.event),
    standings: buildTournamentStandings(bundle.teams, bundle.matches)
  });
});

app.post(
  "/events/:id/matches/:matchId/result",
  zValidator("param", tournamentMatchParamsSchema),
  zValidator("json", updateTournamentMatchResultBodySchema),
  async (c) => {
    const { id, matchId } = c.req.valid("param");
    const body = c.req.valid("json");
    const bundle = await loadTournamentBundle(id);

    if (!bundle) {
      return c.json({ error: "Event not found" }, 404);
    }

    const match = bundle.matches.find((item) => item.id === matchId);
    if (!match) {
      return c.json({ error: "Match not found" }, 404);
    }
    const round = bundle.rounds.find((item) => item.id === match.roundId);
    if (!round) {
      return c.json({ error: "Round not found" }, 404);
    }

    const presetScore = getTournamentResultScore(
      body.result,
      getTournamentEventMode(bundle.event),
      getTournamentRoundBestOf(bundle.event, round.roundNumber)
    );
    const scoreA = body.scoreA ?? presetScore.scoreA;
    const scoreB = body.scoreB ?? presetScore.scoreB;
    const validationError = validateTournamentResultScore(
      body.result,
      scoreA,
      scoreB,
      Boolean(match.teamBId),
      getTournamentEventMode(bundle.event),
      getTournamentRoundBestOf(bundle.event, round.roundNumber)
    );
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const saved = await saveTournamentMatchScore(bundle.event, round, match, scoreA, scoreB);
    if ("error" in saved) {
      return c.json({ error: saved.error }, 400);
    }

    const refreshed = await loadTournamentBundle(id);
    if (!refreshed) {
      return c.json({ error: "Event not found" }, 404);
    }
    const roundStatus = refreshed.rounds.find((round) => round.id === match.roundId)?.status ?? "finished";

    return c.json({
      event: serializeTournamentEvent(refreshed.event),
      roundStatus,
      standings: buildTournamentStandings(refreshed.teams, refreshed.matches)
    });
  }
);

app.post("/events/:id/generate-next-round", zValidator("param", tournamentEventIdParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const generated = await generateTournamentNextRound(id, "default");
  if ("error" in generated) {
    return c.json({ error: generated.error }, generated.error === "Event not found." ? 404 : 400);
  }

  const refreshed = generated.bundle;
  if (generated.completed) {
    return c.json({
      event: serializeTournamentEvent(refreshed.event),
      standings: buildTournamentStandings(refreshed.teams, refreshed.matches),
      message: "Event has already reached its final round. Use Finish Event to close it."
    });
  }

  return c.json({
    event: serializeTournamentEvent(refreshed.event),
    round: generated.round
      ? {
          id: generated.round.id,
          roundNumber: generated.round.roundNumber,
          status: generated.round.status,
          createdAt: generated.round.createdAt.toISOString()
        }
      : null,
    bracket: buildTournamentBracket(refreshed.rounds, refreshed.matches, refreshed.teams),
    standings: buildTournamentStandings(refreshed.teams, refreshed.matches)
  });
});

app.get("/meta/last-updated", zValidator("query", tierQuerySchema.pick({ timeframe: true })), async (c) => {
  const { timeframe } = c.req.valid("query");
  setPublicCache(c, 300, 600);

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
  setPublicCache(c, 1800, 3600);
  const role = c.req.query("role");
  const lane = c.req.query("lane");
  const search = c.req.query("search");
  const cacheKey = `heroes:list:role=${role ?? "all"}:lane=${lane ?? "all"}:search=${search ?? ""}`;
  const cached = await cacheGet<{ items: unknown[]; total: number }>(cacheKey);
  if (cached) return c.json(cached);

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

  const response = { items, total: items.length };
  await cacheSet(cacheKey, response, 1800);
  return c.json(response);
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
  setPublicCache(c, 300, 600);
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

  await cacheSet(cacheKey, response, 600);
  return c.json(response);
});

app.get("/tier", zValidator("query", tierQuerySchema), async (c) => {
  const query = c.req.valid("query") as TierQuery;
  setPublicCache(c, 300, 600);
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

  await cacheSet(cacheKey, response, 900);
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

  const communityCacheKey = `community:${body.timeframe}:${enemyHash}`;

  const [counterResult, pairResult, tierMap, cachedCommunity, allVotes, heroRows] = await Promise.all([
    db.execute<{ mlid: number; score: number }>(sql`
      SELECT counter_mlid AS mlid, AVG(score)::float8 AS score
      FROM counter_matrix
      WHERE timeframe = ${body.timeframe}
        AND enemy_mlid = ANY(${sql.raw(`ARRAY[${body.enemyMlids.join(",")}]`)})
      GROUP BY counter_mlid ORDER BY score DESC LIMIT 50
    `),
    db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
      SELECT counter_mlid, enemy_mlid, score::float8 AS score
      FROM counter_matrix
      WHERE timeframe = ${body.timeframe}
        AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(body.enemyMlids))})
      ORDER BY score DESC LIMIT 2500
    `),
    getTierMapForScope(body.timeframe, body.rankScope),
    cacheGet<{ scoreByMlid: Record<string, number>; totalVotes: number }>(communityCacheKey),
    cacheGet<VotePair[]>(COMMUNITY_VOTES_KEY),
    loadHeroCatalog()
  ]);

  const counterRows = counterResult.rows as Array<{ mlid: number; score: number }>;
  const pairRows = pairResult.rows as Array<{ counter_mlid: number; enemy_mlid: number; score: number }>;

  const heroById = new Map(heroRows.map((row) => [row.mlid, { name: row.name, rolePrimary: row.rolePrimary, roleSecondary: row.roleSecondary, lanes: row.lanes as string[] }]));
  const heroNameByMlid = new Map(heroRows.map((r) => [r.mlid, r.name]));

  const counterToEnemyPairs = new Map<number, Array<{ enemyMlid: number; score: number }>>();
  for (const row of pairRows) {
    const list = counterToEnemyPairs.get(row.counter_mlid) ?? [];
    list.push({ enemyMlid: row.enemy_mlid, score: toNumber(row.score) });
    counterToEnemyPairs.set(row.counter_mlid, list);
  }

  const candidateMlids = counterRows.map((r) => r.mlid);
  let communityScores: Map<number, number>;
  let communityVoteCount: number;

  if (cachedCommunity) {
    communityScores = new Map(Object.entries(cachedCommunity.scoreByMlid).map(([k, v]) => [Number(k), v]));
    communityVoteCount = cachedCommunity.totalVotes;
  } else if (allVotes) {
    const local = computeScoresFromVotePairs(allVotes, body.enemyMlids, candidateMlids);
    communityScores = local.scoreByMlid;
    communityVoteCount = local.totalVotes;
    void cacheSet(communityCacheKey, { scoreByMlid: Object.fromEntries(communityScores), totalVotes: communityVoteCount }, 1800);
  } else {
    communityScores = new Map();
    communityVoteCount = 0;
  }

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
  await cacheSet(cacheKey, response, 600);
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
  const dynamicTier = await loadGlobalTierByRankScope(
    body.timeframe,
    body.rankScope
  );
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
  const heroInfoRows = await loadHeroCatalog();

  const heroInfoMap = new Map(heroInfoRows.map((row) => [row.mlid, {
    rolePrimary: row.rolePrimary,
    specialities: row.specialities ?? []
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
          LIMIT 3000
        `)
      : Promise.resolve({ rows: [] as Array<{ counter_mlid: number; enemy_mlid: number; score: number }> }),
    actingPicks.length > 0
      ? db.execute<{ synergy_mlid: number; hero_mlid: number; score: number }>(sql`
          SELECT synergy_mlid, hero_mlid, score::float8 AS score
          FROM synergy_matrix
          WHERE timeframe = ${body.timeframe}
            AND hero_mlid = ANY(${sql.raw(safeArrayLiteral(actingPicks))})
          LIMIT 3000
        `)
      : Promise.resolve({ rows: [] as Array<{ synergy_mlid: number; hero_mlid: number; score: number }> }),
    actingPicks.length > 0
      ? db.execute<{ counter_mlid: number; score: number }>(sql`
          SELECT counter_mlid, score::float8 AS score
          FROM counter_matrix
          WHERE timeframe = ${body.timeframe}
            AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(actingPicks))})
          LIMIT 3000
        `)
      : Promise.resolve({ rows: [] as Array<{ counter_mlid: number; score: number }> }),
    opposingPicks.length > 0
      ? db.execute<{ synergy_mlid: number; score: number }>(sql`
          SELECT synergy_mlid, score::float8 AS score
          FROM synergy_matrix
          WHERE timeframe = ${body.timeframe}
            AND hero_mlid = ANY(${sql.raw(safeArrayLiteral(opposingPicks))})
          LIMIT 3000
        `)
      : Promise.resolve({ rows: [] as Array<{ synergy_mlid: number; score: number }> }),
    opposingPicks.length > 0
      ? fetchCommunityCounterScores(opposingPicks, candidateMlids, draftHeroNameByMlid)
      : Promise.resolve({ scoreByMlid: new Map<number, number>(), totalVotes: 0 })
  ]);

  const counterScoreByMlid = new Map<number, number>();
  const counterToEnemyPairs = new Map<number, Set<number>>();
  for (const row of counterRowsResult.rows as Array<{ counter_mlid: number; enemy_mlid: number; score: number }>) {
    const prev = counterScoreByMlid.get(row.counter_mlid) ?? 0;
    counterScoreByMlid.set(row.counter_mlid, prev + Number(row.score));
    const enemies = counterToEnemyPairs.get(row.counter_mlid) ?? new Set<number>();
    enemies.add(row.enemy_mlid);
    counterToEnemyPairs.set(row.counter_mlid, enemies);
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
  const draftMatchupConfidence = (draftCommunityResult as any).matchupConfidence ?? 0;

  const globalReliability = draftCommunityVotes > 0
    ? Math.max(0.25, Math.min(1, Math.log10(draftCommunityVotes + 1) / 2.6))
    : 0;
  const communityReliability = draftCommunityVotes > 0
    ? Number((globalReliability * 0.4 + draftMatchupConfidence * 0.6).toFixed(4))
    : 0;

  const actingPickNumber = actingPicks.length + 1;
  const actingFeasibility = evaluateDraftFeasibility(actingPicks, rolePoolMap);
  const opposingFeasibility = evaluateDraftFeasibility(opposingPicks, rolePoolMap);
  const opposingMissingRoles = new Set(opposingFeasibility.missingRoles);
  const opposingMissingCount = opposingFeasibility.missingRoles.length;
  const actingPickPressure = Math.min(1, actingPicks.length / 5);
  const actingMissingRoles = new Set<string>(actingFeasibility.missingRoles);
  const actingLaneCounts = new Map<string, number>();
  for (const lane of Object.values(actingFeasibility.heroToLane)) {
    actingLaneCounts.set(lane, (actingLaneCounts.get(lane) ?? 0) + 1);
  }
  for (const mlid of actingFeasibility.unassignedHeroes) {
    const lane = (rolePoolMap.get(mlid) ?? [])[0];
    if (!lane) continue;
    actingLaneCounts.set(lane, (actingLaneCounts.get(lane) ?? 0) + 1);
  }
  const lockedSingleLanes = new Set<string>();
  for (const mlid of actingPicks) {
    const lanes = rolePoolMap.get(mlid) ?? [];
    if (lanes.length === 1 && lanes[0]) lockedSingleLanes.add(lanes[0]);
  }
  const flexPickedCount = actingPicks.reduce((count, mlid) => {
    const lanes = rolePoolMap.get(mlid) ?? [];
    return lanes.length > 1 ? count + 1 : count;
  }, 0);
  const flexScale = Math.max(0.6, 1 - Math.max(0, flexPickedCount - 1) * 0.12);
  const stageProfile = pickStageProfile(actingPickNumber);
  const baseWeights = phaseWeights(actingPickNumber);
  const weights = tunePhaseWeights(baseWeights, {
    enemyPickCount: opposingPicks.length,
    missingRoleCount: actingMissingRoles.size,
    flexPickedCount
  });
  const synergyWeight = Math.min(
    0.28,
    (0.05 + 0.15 * Math.min(1, actingPicks.length / 4)) * stageProfile.synergyWeightScale
  );
  const pickPhase: "meta" | "flex" | "counter" =
    actingPickNumber <= 2 ? "meta" : actingPickNumber === 3 ? "flex" : "counter";

  const draftCounterRawByMlid = new Map<number, number>();
  for (const mlid of candidateMlids) {
    const raw = opposingPicks.length > 0
      ? (counterScoreByMlid.get(mlid) ?? 0) / opposingPicks.length
      : 0;
    draftCounterRawByMlid.set(mlid, raw);
  }
  const draftCounterRawValues = candidateMlids.map((mlid) => draftCounterRawByMlid.get(mlid) ?? 0);
  const draftCounterMin = Math.min(...draftCounterRawValues);
  const draftCounterMax = Math.max(...draftCounterRawValues);
  const draftCounterRange = draftCounterMax - draftCounterMin;
  const normalizeDraftCounter = (value: number) =>
    draftCounterRange > 1e-6 ? (value - draftCounterMin) / draftCounterRange : 0.5;

  const scored = candidateMlids.map((mlid) => {
    const tierScore = tierNumeric(tierByMlid.get(mlid));
    const stat = rankStatsMap.get(mlid);
    const banRate = rate100(stat?.banRate);
    const pickRate = rate100(stat?.pickRate);
    const winRate = rate100(stat?.winRate);
    const lanes = rolePoolMap.get(mlid) ?? [];
    const fullyBlockedByLockedSingleLane =
      lanes.length > 0 && lanes.every((lane) => lockedSingleLanes.has(lane));
    if (fullyBlockedByLockedSingleLane) {
      return null;
    }
    const coveredMissing = lanes.filter((lane) => actingMissingRoles.has(lane));
    const coverageBoost = actingMissingRoles.size > 0
      ? (coveredMissing.length / actingMissingRoles.size) * 100
      : 0;
    const laneConflictPenalty = lanes.some((lane) => lockedSingleLanes.has(lane)) ? 100 : 0;
    const laneBonus = lanes.includes("jungle") || lanes.includes("mid") ? 100 : 0;
    const flexValue = Math.min(3, lanes.length) / 3 * 100 * flexScale;
    const metaCounterRaw = opposingPicks.length > 0
      ? (counterScoreByMlid.get(mlid) ?? 0) / opposingPicks.length * 100
      : 0;
    const communityCounterRaw = (draftCommunityScores.get(mlid) ?? 0) * 100;
    const communityBlendRatio = Math.min(
      0.65,
      (0.18 + 0.17 * Math.min(1, (actingPickNumber - 1) / 4)) *
      communityReliability *
      stageProfile.communityWeightScale
    );
    const counterInfoReliability = opposingPicks.length > 0 ? Math.min(1, 0.25 + opposingPicks.length * 0.22) : 0;
    const counterReliability = opposingPicks.length > 0
      ? Math.max(stageProfile.counterReliabilityFloor, counterInfoReliability)
      : 0;
    const counterBlendRaw = (1 - communityBlendRatio) * metaCounterRaw + communityBlendRatio * communityCounterRaw;
    const counterScore = opposingPicks.length > 0
      ? Number(
          (counterBlendRaw * counterReliability).toFixed(4)
        )
      : 0;
    const synergyScore = actingPicks.length > 0
      ? Number(((synergyScoreByMlid.get(mlid) ?? 0) / actingPicks.length * 100).toFixed(4))
      : 0;
    const stabilityBase = Number((tierScore * 0.44 + winRate * 0.34 + pickRate * 0.22).toFixed(4));

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

    const metaSW = Math.min(0.08, synergyWeight);
    const metaBase = 1 - metaSW;

    const enemyCounterThreat = opposingPicks.length > 0
      ? Math.min(12, ((protectionScoreByMlid.get(mlid) ?? 0) / opposingPicks.length) * 15)
      : 0;

    const metaRawScore = Number((
      tierScore * 0.40 * metaBase +
      winRate * 0.27 * metaBase +
      pickRate * 0.14 * metaBase +
      banRate * 0.07 * metaBase +
      flexValue * 0.05 * metaBase +
      coverageBoost * 0.07 * metaBase +
      (100 - laneConflictPenalty) * 0.03 * metaBase +
      synergyScore * metaSW -
      enemyCounterThreat * metaBase
    ).toFixed(4));

    const adjustedMetaStability = stageProfile.metaStabilityBlend * 0.75;
    const metaScore = Number((
      metaRawScore * (1 - adjustedMetaStability) +
      stabilityBase * adjustedMetaStability
    ).toFixed(4));

    const heroInfo = heroInfoMap.get(mlid);
    const archBoost = heroInfo && detectedArchetypes.length > 0
      ? archetypeBoost(heroInfo.specialities, heroInfo.rolePrimary, detectedArchetypes) * 100
      : 0;
   
    const counterPickScoreData = opposingPicks.length > 0
      ? (() => {
          const nCounter = normalizeDraftCounter(draftCounterRawByMlid.get(mlid) ?? 0);
          const communityRaw = draftCommunityScores.get(mlid) ?? 0.5;
          const communityVoteRatio = 1 - Math.exp(-draftCommunityVotes / DRAFT_COUNTER_COMMUNITY_VOTE_REF);
          const communityDamping =
            DRAFT_COUNTER_COMMUNITY_DAMPING_MIN +
            (1 - DRAFT_COUNTER_COMMUNITY_DAMPING_MIN) * Math.max(0, Math.min(1, communityVoteRatio));
          const nCommunity = communityRaw * communityDamping + 0.5 * (1 - communityDamping);
          const nTier = counterTierNorm(tierByMlid.get(mlid));
          const matchedEnemyCount = opposingPicks.filter((enemyMlid) =>
            counterToEnemyPairs.get(mlid)?.has(enemyMlid)
          ).length;
          const coverageMult = COVERAGE_MULT_MIN +
            (1 - COVERAGE_MULT_MIN) * (matchedEnemyCount / Math.max(1, opposingPicks.length));
          const componentCounter = COUNTER_W * nCounter;
          const componentCommunity = COMMUNITY_W * nCommunity;
          const componentTier = TIER_W * nTier;
          const baseBlend = (componentCounter + componentCommunity + componentTier) * coverageMult;
          const laneLoad = lanes.length > 0
            ? lanes.reduce((max, lane) => Math.max(max, actingLaneCounts.get(lane) ?? 0), 0)
            : 0;
          const laneSaturationPenalty = DRAFT_COUNTER_LANE_SATURATION_PENALTY_MAX * Math.max(0, laneLoad) / 3;
          const laneSaturationMult = 1 - Math.min(DRAFT_COUNTER_LANE_SATURATION_PENALTY_MAX, laneSaturationPenalty);
          const stageFlexBonus = stageProfile.stage === "early"
            ? DRAFT_COUNTER_FLEX_EARLY_BONUS
            : stageProfile.stage === "mid"
              ? DRAFT_COUNTER_FLEX_MID_BONUS
              : 0;
          const flexBonusMult = lanes.length > 1 ? 1 + stageFlexBonus : 1;
          const uncertaintyMult = 1 - (1 - Math.min(1, opposingPicks.length / 3)) * DRAFT_COUNTER_UNCERTAINTY_MAX;
          const finalBlend = baseBlend * laneSaturationMult * flexBonusMult * uncertaintyMult;
          return {
            score: Number((finalBlend * 100).toFixed(4)),
            nCounter: Number(nCounter.toFixed(4)),
            nCommunity: Number(nCommunity.toFixed(4)),
            nTier: Number(nTier.toFixed(4)),
            componentCounter: Number(componentCounter.toFixed(4)),
            componentCommunity: Number(componentCommunity.toFixed(4)),
            componentTier: Number(componentTier.toFixed(4)),
            coverageMult: Number(coverageMult.toFixed(4)),
            laneSaturationMult: Number(laneSaturationMult.toFixed(4)),
            flexBonusMult: Number(flexBonusMult.toFixed(4)),
            uncertaintyMult: Number(uncertaintyMult.toFixed(4)),
            communityDamping: Number(communityDamping.toFixed(4))
          };
        })()
      : (() => {
          const rawPreCounter = Number((
            flexValue * 0.35 +
            tierScore * 0.30 +
            winRate * 0.20 +
            coverageBoost * 0.15
          ).toFixed(4));
          return {
            score: Number((rawPreCounter * 0.72 + stabilityBase * 0.28).toFixed(4)),
            nCounter: 0,
            nCommunity: 0,
            nTier: 0,
            componentCounter: 0,
            componentCommunity: 0,
            componentTier: 0,
            coverageMult: 1,
            laneSaturationMult: 1,
            flexBonusMult: 1,
            uncertaintyMult: 1,
            communityDamping: 0
          };
        })();
    const counterPickScore = counterPickScoreData.score;
  

    const archWeight = detectedArchetypes.length > 0 ? 0.05 : 0;
    const wScale = 1 - synergyWeight - archWeight;
    const pickRawScore = Number((
      counterScore * weights.counterWeight * wScale +
      tierScore * weights.tierWeight * wScale +
      flexValue * weights.flexWeight * wScale +
      banRate * weights.banRateWeight * wScale +
      pickRate * weights.pickRateWeight * wScale +
      winRate * weights.winRateWeight * wScale +
      laneBonus * weights.laneBonusWeight * wScale +
      coverageBoost * stageProfile.coverageWeight * wScale +
      (100 - laneConflictPenalty) * stageProfile.laneConflictWeight * wScale +
      synergyScore * synergyWeight +
      archBoost * archWeight
    ).toFixed(4));
    const pickScore = Number((
      pickRawScore * (1 - stageProfile.stabilityBlend) +
      stabilityBase * stageProfile.stabilityBlend
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
      coverageBoost,
      denialScore,
      protectionScore,
      banScore,
      pickScore,
      metaScore,
      counterPickScore,
      counterPickScoreData
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));

  const tierFloorScore = tierNumeric(minTierForContext(body.mode, body.rankScope));
  const tierBaselineScore = tierNumeric("C");
  const filterRowsByTier = <T extends { tier?: Tier }>(rows: T[], minCount: number) => {
    const filtered = rows.filter((row) => tierNumeric(row.tier) >= tierFloorScore);
    if (filtered.length >= minCount) return filtered;
    const fallback = rows.filter((row) => tierNumeric(row.tier) >= tierBaselineScore);
    if (fallback.length >= minCount) return fallback;
    return rows;
  };

  const phaseReasonPick: Record<typeof pickPhase, string> = {
    meta:    `Pick ${actingPickNumber}/5 — Meta phase: secure S-tier & flex heroes.`,
    flex:    `Pick ${actingPickNumber}/5 — Transition: balancing meta power & counter threat.`,
    counter: `Pick ${actingPickNumber}/5 — Counter phase: targeting confirmed enemy picks.`
  };

  const toRec = (
    row: (typeof scored)[number],
    score: number,
    kind: "ban" | "pick" | "counter"
  ) => ({
    mlid: row.mlid,
    score,
    tier: row.tier,
    pickPhase: kind !== "ban" ? pickPhase : undefined,
    reasons: [
      kind === "ban"
        ? `Ban score (deny ${(row.denialScore / 100 * 100).toFixed(0)}%, protect ${(row.protectionScore / 100 * 100).toFixed(0)}%).`
        : kind === "counter"
          ? `Counter blend: matrix ${(row.counterPickScoreData.componentCounter * 100).toFixed(1)}%, community ${(row.counterPickScoreData.componentCommunity * 100).toFixed(1)}%, tier ${(row.counterPickScoreData.componentTier * 100).toFixed(1)}%.`
          : phaseReasonPick[pickPhase],
      ...(kind === "counter"
        ? [`Adjustment: coverage x${row.counterPickScoreData.coverageMult.toFixed(2)}, lane x${row.counterPickScoreData.laneSaturationMult.toFixed(2)}, flex x${row.counterPickScoreData.flexBonusMult.toFixed(2)}, uncertainty x${row.counterPickScoreData.uncertaintyMult.toFixed(2)}.`]
        : [])
    ],
    breakdown: {
      counterImpact: Number((row.counterScore / 100).toFixed(4)),
      tierPower: Number((row.tierScore / 100).toFixed(4)),
      laneCoverage: Number((row.laneBonus / 100).toFixed(4)),
      flexValue: Number((row.flexValue / 100).toFixed(4)),
      feasibilityGain: Number((row.coverageBoost / 100).toFixed(4)),
      denyValue: Number((row.banRate / 100).toFixed(4)),
      synergyValue: Number((row.synergyScore / 100).toFixed(4)),
      denialValue: Number((row.denialScore / 100).toFixed(4)),
      protectionValue: Number((row.protectionScore / 100).toFixed(4)),
      communitySignal: draftCommunityVotes > 0
        ? Number(((draftCommunityScores.get(row.mlid) ?? 0)).toFixed(4))
        : undefined,
      counterMatrixSignal: Number(row.counterPickScoreData.nCounter.toFixed(4)),
      counterTierSignal: Number(row.counterPickScoreData.nTier.toFixed(4)),
      counterCoverageMult: Number(row.counterPickScoreData.coverageMult.toFixed(4)),
      counterLaneSaturationMult: Number(row.counterPickScoreData.laneSaturationMult.toFixed(4)),
      counterFlexBonusMult: Number(row.counterPickScoreData.flexBonusMult.toFixed(4)),
      counterUncertaintyMult: Number(row.counterPickScoreData.uncertaintyMult.toFixed(4)),
      counterCommunityDamping: Number(row.counterPickScoreData.communityDamping.toFixed(4))
    },
    preview: null
  });

  const shouldUseLaneAwareBanScoring = body.mode === "tournament" || body.mode === "custom";
  const enhancedBanScoreCache = new Map<number, number>();
  const enhancedBanScore = (row: (typeof scored)[number]) => {
    const cached = enhancedBanScoreCache.get(row.mlid);
    if (cached !== undefined) return cached;
    const laneMatches = row.lanes.filter((lane) => opposingMissingRoles.has(lane));
    const laneNeedCoverage = opposingMissingCount > 0
      ? laneMatches.length / Math.max(1, Math.min(opposingMissingCount, 5))
      : 0;
    const laneNeedBoost = laneNeedCoverage > 0 ? 1 + laneNeedCoverage * 0.9 : 1;

    const totalPicks = actingPicks.length + opposingPicks.length;
    const midDraftProgress = Math.min(1, totalPicks / 6);
    const isMidDraftBan = totalPicks > 0;

    const heroStrength = row.tierScore * 0.5 + row.winRate * 0.3 + row.pickRate * 0.2;
    const heroLaneDominance = heroStrength * (laneNeedCoverage > 0 ? laneNeedBoost : 0.85);

    const counterThreat = row.protectionScore * (1 + actingPickPressure * 0.4) * (isMidDraftBan ? 1 + midDraftProgress * 0.3 : 1);

    const eliteTierInLane = laneNeedCoverage > 0
      ? (row.tier === "SS" ? 1.45 : row.tier === "S" ? 1.22 : 1.0)
      : 1.0;
    const tierBoost = (row.tier === "SS" ? 1.18 : row.tier === "S" ? 1.08 : 1) * eliteTierInLane;

    const comboMultiplier = isMidDraftBan && laneNeedCoverage > 0
      ? 1 + laneNeedBoost * 0.4 + midDraftProgress * 0.35
      : 1;
    const comboScore = row.denialScore * comboMultiplier;

    const lanePressure = laneNeedCoverage * 140;

    const composite = isMidDraftBan
      ? counterThreat * 0.30 +
        comboScore    * 0.30 +
        heroLaneDominance * 0.22 +
        lanePressure  * 0.12 +
        row.banScore  * 0.06
      : counterThreat * 0.34 +
        comboScore    * 0.28 +
        heroLaneDominance * 0.22 +
        lanePressure  * 0.10 +
        row.banScore  * 0.06;

    const score = composite * tierBoost;
    enhancedBanScoreCache.set(row.mlid, score);
    return score;
  };

  const sortedBan = scored.slice().sort((a, b) => {
    const left = shouldUseLaneAwareBanScoring ? enhancedBanScore(a) : a.banScore;
    const right = shouldUseLaneAwareBanScoring ? enhancedBanScore(b) : b.banScore;
    if (right !== left) return right - left;
    return b.banScore - a.banScore;
  });
  const filteredBanRows = filterRowsByTier(sortedBan, BAN_MIN_RECOMMENDATIONS);
  const laneCounts = new Map<string, number>();
  const laneCappedBans: typeof sortedBan = [];
  for (const row of filteredBanRows) {
    const primaryLane = row.lanes[0] ?? "unknown";
    const current = laneCounts.get(primaryLane) ?? 0;
    if (current >= 2) continue;
    laneCounts.set(primaryLane, current + 1);
    laneCappedBans.push(row);
    if (laneCappedBans.length >= BAN_MAX_RECOMMENDATIONS) break;
  }
  const baseBanRows =
    laneCappedBans.length >= BAN_MIN_RECOMMENDATIONS ? laneCappedBans : filteredBanRows.slice(0, BAN_MAX_RECOMMENDATIONS);
  const recommendedBans = baseBanRows.slice(0, Math.min(BAN_MAX_RECOMMENDATIONS, baseBanRows.length)).map((row) => toRec(row, row.banScore, "ban"));

  function selectLaneDiverse<T extends { lanes: string[] }>(
    sortedRows: T[], count: number, maxPerLane = 2
  ): T[] {
    const laneCap = new Map<string, number>();
    const seenLanes = new Set<string>();
    const out: T[] = [];
    const keyOf = (row: T) => row.lanes[0] ?? "unknown";
    const canTake = (lane: string) => (laneCap.get(lane) ?? 0) < maxPerLane;
    const pushRow = (row: T, lane: string) => {
      laneCap.set(lane, (laneCap.get(lane) ?? 0) + 1);
      seenLanes.add(lane);
      out.push(row);
    };

    for (const row of sortedRows) {
      if (out.length >= count) break;
      const lane = keyOf(row);
      if (seenLanes.has(lane) || !canTake(lane)) continue;
      pushRow(row, lane);
    }

    for (const row of sortedRows) {
      if (out.length >= count) break;
      if (out.includes(row)) continue;
      const lane = keyOf(row);
      if (!canTake(lane)) continue;
      pushRow(row, lane);
    }
    return out;
  }

  function selectCounterDiverse(
    sortedRows: (typeof scored),
    count: number
  ) {
    const out: (typeof scored)[number][] = [];
    const laneCounts = new Map<string, number>();
    const roleCounts = new Map<string, number>();
    const archetypeCounts = new Map<string, number>();

    while (out.length < count) {
      let best: (typeof scored)[number] | null = null;
      let bestScore = -Infinity;

      for (const row of sortedRows) {
        if (out.includes(row)) continue;
        const lane = row.lanes[0] ?? "unknown";
        const role = heroInfoMap.get(row.mlid)?.rolePrimary ?? "unknown";
        const specs = heroInfoMap.get(row.mlid)?.specialities ?? [];
        const lanePenalty = (laneCounts.get(lane) ?? 0) * DRAFT_COUNTER_DIVERSITY_LANE_PENALTY;
        const rolePenalty = (roleCounts.get(role) ?? 0) * DRAFT_COUNTER_DIVERSITY_ROLE_PENALTY;
        const overlapSpecs = specs.filter((name) => (archetypeCounts.get(name) ?? 0) > 0).length;
        const archetypePenalty = overlapSpecs * DRAFT_COUNTER_DIVERSITY_ARCHETYPE_PENALTY;
        const diversityMult = Math.max(
          DRAFT_COUNTER_DIVERSITY_FLOOR,
          1 - lanePenalty - rolePenalty - archetypePenalty
        );
        const adjusted = row.counterPickScore * diversityMult;
        if (adjusted > bestScore) {
          best = row;
          bestScore = adjusted;
        }
      }

      if (!best) break;
      out.push(best);
      const lane = best.lanes[0] ?? "unknown";
      const role = heroInfoMap.get(best.mlid)?.rolePrimary ?? "unknown";
      laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      for (const spec of heroInfoMap.get(best.mlid)?.specialities ?? []) {
        archetypeCounts.set(spec, (archetypeCounts.get(spec) ?? 0) + 1);
      }
    }
    return out;
  }

  const sortedPick = filterRowsByTier(
    scored.slice().sort((a, b) => b.pickScore - a.pickScore),
    PICK_MIN_RECOMMENDATIONS
  );
  const pickFloor = Math.min(PICK_MIN_RECOMMENDATIONS, sortedPick.length);
  const basePickRows = selectLaneDiverse(sortedPick, PICK_MAX_RECOMMENDATIONS, 3);
  const recommendedPicks = (basePickRows.length >= pickFloor ? basePickRows : sortedPick.slice(0, PICK_MAX_RECOMMENDATIONS))
    .slice(0, PICK_MAX_RECOMMENDATIONS)
    .map((row) => toRec(row, row.pickScore, "pick"));

  const sortedMeta = filterRowsByTier(
    scored.slice().sort((a, b) => b.metaScore - a.metaScore),
    4
  );
  const recommendedMetaPicks = selectLaneDiverse(sortedMeta, 8).map((row) => toRec(row, row.metaScore, "pick"));

  const sortedCounter = filterRowsByTier(
    scored.slice().sort((a, b) => b.counterPickScore - a.counterPickScore),
    4
  );
  const counterDiverseRows = opposingPicks.length > 0
    ? selectCounterDiverse(sortedCounter, 8)
    : [];
  const recommendedCounterPicks = opposingPicks.length > 0
    ? (counterDiverseRows.length >= 4 ? counterDiverseRows : selectLaneDiverse(sortedCounter, 8))
        .map((row) => toRec(row, row.counterPickScore, "counter"))
    : selectLaneDiverse(sortedMeta, 8).map((row) => toRec(row, row.metaScore, "pick"));

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
      `Weight tuning context: ${stageProfile.stage} phase (p=${stageProfile.progress.toFixed(2)}), enemy picks ${opposingPicks.length}, missing lanes ${actingMissingRoles.size}, flex picks ${flexPickedCount}.`,
      `Counter reference uses ${opposingPicks.length} enemy pick(s) + ${draftCommunityVotes} community votes (matchup confidence: ${(draftMatchupConfidence * 100).toFixed(0)}%).`,
      `Rank scope active: ${body.rankScope}.`,
      ...(detectedArchetypes[0]
        ? [`Detected archetype: ${detectedArchetypes[0].archetype} (${(detectedArchetypes[0].confidence * 100).toFixed(0)}%).`]
        : [])
    ]
  };

  await cacheSet(cacheKey, response, 600);
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

  const dynamicTier = await loadGlobalTierByRankScope(body.timeframe, body.rankScope);

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

  await cacheSet(cacheKey, response, 600);
  return c.json(response);
});

registerTournamentRoutes({
  slug: "m7",
  label: "M7",
  getStatus: getM7Status,
  getHeroList: getM7HeroList,
  getHeroCounters: getM7HeroCounters,
  getHeroProfile: getM7HeroProfile,
  analyzeDraft: analyzeM7Draft,
  matchupDraft: matchupM7Draft
});

registerTournamentRoutes({
  slug: "mpl-ph",
  label: "MPL PH",
  getStatus: getMplPhStatus,
  getHeroList: getMplPhHeroList,
  getHeroCounters: getMplPhHeroCounters,
  getHeroProfile: getMplPhHeroProfile,
  analyzeDraft: analyzeMplPhDraft,
  matchupDraft: matchupMplPhDraft
});

registerTournamentRoutes({
  slug: "mpl-id",
  label: "MPL ID",
  getStatus: getMplIdStatus,
  getHeroList: getMplIdHeroList,
  getHeroCounters: getMplIdHeroCounters,
  getHeroProfile: getMplIdHeroProfile,
  analyzeDraft: analyzeMplIdDraft,
  matchupDraft: matchupMplIdDraft
});

export default app;

if (process.env.VERCEL !== "1") {
  const server = serve({
    fetch: app.fetch,
    port
  });

  async function shutdown(signal: string) {
    console.info(`[api] received ${signal}, shutting down`);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await Promise.all([closeDbPool(), closeCache()]);
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });
}

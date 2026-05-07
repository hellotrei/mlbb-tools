import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Hono, type Context } from "hono";
import { handle } from "@hono/node-server/vercel";
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
  tournamentMatchDraftLogs,
  tournamentRounds,
  tournamentTeams,
  telegramSessions,
  eventSubscribers
} from "@mlbb/db";
import { cacheGet, cacheDel, cachePing, cacheSet, closeCache } from "./lib/cache";
import { stableHash } from "./lib/hash";
import { analyzeM7Draft, getM7HeroCounters, getM7HeroList, getM7HeroProfile, getM7PostmatchIntelligence, getM7Status, matchupM7Draft } from "./lib/m7-engine";
import { analyzeMplIdDraft, getMplIdHeroCounters, getMplIdHeroList, getMplIdHeroProfile, getMplIdPostmatchIntelligence, getMplIdStatus, matchupMplIdDraft } from "./lib/mpl-id-engine";
import { analyzeMplPhDraft, getMplPhHeroCounters, getMplPhHeroList, getMplPhHeroProfile, getMplPhPostmatchIntelligence, getMplPhStatus, matchupMplPhDraft } from "./lib/mpl-ph-engine";
import { fetchCommunityCounterScores } from "./lib/supabase-counters";
import {
  buildPlayoffBracketView,
  debugPlayoffBracketFlow,
  inferPlayoffMatchFlow,
  repairPlayoffBracketFlow,
  submitPlayoffMatchResult
} from "./tournaments/playoffs-engine";

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
type TournamentPostmatchResult = Awaited<ReturnType<typeof getM7PostmatchIntelligence>>;

type TournamentRouteRegistration = {
  slug: string;
  label: string;
  getStatus: () => Promise<TournamentStatusResult>;
  getHeroList: () => Promise<TournamentHeroListResult>;
  getHeroCounters: (mlid: number) => Promise<TournamentHeroCountersResult>;
  getHeroProfile: (mlid: number) => Promise<TournamentHeroProfile>;
  analyzeDraft: (body: DraftAnalyzeBody) => Promise<TournamentAnalyzeResult>;
  matchupDraft: (body: { allyMlids: number[]; enemyMlids: number[] }) => Promise<TournamentMatchupResult>;
  getPostmatchIntelligence: () => Promise<TournamentPostmatchResult>;
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
  id: z.string().trim().min(1).max(220)
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
  "custom_round",
  "swiss_stage"
]);
const tournamentPlayoffFormatSchema = z.enum([
  "single_elimination",
  "double_elimination"
]);
const playoffSeedPolicySchema = z.enum([
  "balanced",
  "strict_rank",
  "avoid_same_group"
]);
const TOURNAMENT_DEFAULT_ADVANCE_TO_PLAYOFFS = 4;
const TOURNAMENT_SWISS_VALID_TEAM_COUNTS = [8, 16, 32];
const TOURNAMENT_DE_MIN_TEAMS = 8;
const TOURNAMENT_SE_MIN_TEAMS = 4;

function getSwissRegularSeasonRounds(totalTeams: number): number {
  return totalTeams <= 8 ? 3 : 5;
}

function getSwissWinThreshold(totalTeams: number): number {
  return totalTeams <= 8 ? 2 : 3;
}

function getSwissAdvanceToPlayoffs(totalTeams: number): number {
  return Math.floor(totalTeams / 2);
}

function isSwissStageComplete(
  teams: TournamentTeamRecord[],
  matches: TournamentMatchRecord[],
  totalTeams: number
): boolean {
  const winThreshold = getSwissWinThreshold(totalTeams);
  const standings = buildTournamentStandingRows(teams, matches);
  return standings.every((row) => row.win >= winThreshold || row.lose >= winThreshold);
}
const tournamentPairingStrategySchema = z.enum(["default", "shuffle"]);
const playoffSemifinalBestOfSchema = z.coerce.number().int().refine((value) => [1, 3, 5].includes(value));
const playoffFinalBestOfSchema = z.coerce.number().int().refine((value) => [3, 5, 7].includes(value));
const playoffThirdPlaceBestOfSchema = z.coerce.number().int().refine((value) => [1, 3, 5].includes(value));
const advanceToPlayoffsSchema = z.coerce.number().int().min(2).max(128);

const createTournamentEventBodySchema = z.object({
  name: z.string().trim().min(3).max(160),
  eventMode: tournamentEventModeSchema.default("regular_season"),
  regularSeasonFormat: tournamentRegularSeasonFormatSchema.optional(),
  playoffFormat: tournamentPlayoffFormatSchema.optional(),
  regularSeasonCustomRounds: z.coerce.number().int().min(1).max(10).optional(),
  matchBestOf: z.coerce.number().int().min(1).max(9).default(2),
  playoffSemifinalBestOf: playoffSemifinalBestOfSchema.optional(),
  playoffFinalBestOf: playoffFinalBestOfSchema.optional(),
  playoffThirdPlaceBestOf: playoffThirdPlaceBestOfSchema.optional(),
  swissDeciderBestOf: z.coerce.number().int().refine((v) => [1, 3].includes(v)).optional(),
  playoffSeedPolicy: playoffSeedPolicySchema.optional(),
  playoffSeedMetadata: z.record(z.unknown()).optional(),
  playoffAdvanceCount: z.coerce.number().int().min(2).optional(),
  advanceToPlayoffs: advanceToPlayoffsSchema.optional(),
  totalTeams: z.coerce.number().int().min(2).max(128),
  totalRounds: z.coerce.number().int().min(1).max(128),
  teamNames: z.array(z.string().trim().min(1).max(120).refine((name) => !hasEmoji(name), {
    message: "Team names must not contain emoji characters."
  })).min(2).max(128),
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

  if (value.eventMode === "playoffs" && !value.playoffFormat) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffFormat"],
      message: "playoffFormat is required for playoff events."
    });
  }

  const advanceToPlayoffs = value.advanceToPlayoffs ?? Math.min(TOURNAMENT_DEFAULT_ADVANCE_TO_PLAYOFFS, value.totalTeams);
  if (value.eventMode === "regular_season" && advanceToPlayoffs > value.totalTeams) {
    ctx.addIssue({
      code: "custom",
      path: ["advanceToPlayoffs"],
      message: "advanceToPlayoffs cannot be greater than totalTeams."
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

  const isAdvanceCountMode = value.eventMode === "playoffs"
    && value.playoffAdvanceCount !== undefined
    && value.playoffAdvanceCount >= 4;

  if (value.eventMode === "playoffs" && !isAdvanceCountMode && !value.playoffSemifinalBestOf) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffSemifinalBestOf"],
      message: "playoffSemifinalBestOf is required for playoff events."
    });
  }

  if (value.eventMode === "playoffs" && !isAdvanceCountMode && !value.playoffFinalBestOf) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffFinalBestOf"],
      message: "playoffFinalBestOf is required for playoff events."
    });
  }

  if (value.eventMode === "regular_season" && value.regularSeasonFormat === "swiss_stage") {
    if (!TOURNAMENT_SWISS_VALID_TEAM_COUNTS.includes(value.totalTeams)) {
      ctx.addIssue({
        code: "custom",
        path: ["totalTeams"],
        message: `Swiss stage supports ${TOURNAMENT_SWISS_VALID_TEAM_COUNTS.join(", ")} teams.`
      });
    }
  }

  if (value.eventMode === "regular_season" && value.playoffThirdPlaceBestOf) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffThirdPlaceBestOf"],
      message: "playoffThirdPlaceBestOf only applies to playoff events."
    });
  }
  if (value.eventMode === "regular_season" && value.playoffSeedPolicy) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffSeedPolicy"],
      message: "playoffSeedPolicy only applies to playoff events."
    });
  }
  if (value.eventMode === "regular_season" && value.playoffSeedMetadata) {
    ctx.addIssue({
      code: "custom",
      path: ["playoffSeedMetadata"],
      message: "playoffSeedMetadata only applies to playoff events."
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
    value.regularSeasonCustomRounds,
    value.playoffFormat
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

const updateTournamentMatchDraftLogBodySchema = z.object({
  teamAPicks: z.array(z.coerce.number().int().positive()).max(10).default([]),
  teamBPicks: z.array(z.coerce.number().int().positive()).max(10).default([]),
  teamABans: z.array(z.coerce.number().int().positive()).max(10).default([]),
  teamBBans: z.array(z.coerce.number().int().positive()).max(10).default([]),
  source: z.enum(["manual", "imported"]).default("manual"),
  notes: z.string().trim().max(1000).optional()
});

function registerTournamentRoutes(config: TournamentRouteRegistration) {
  const { slug, label, getStatus, getHeroList, getHeroCounters, getHeroProfile, analyzeDraft, matchupDraft, getPostmatchIntelligence } = config;

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

  app.get(`/draft/${slug}/postmatch-intelligence`, async (c) => {
    const cacheKey = `postmatch:${slug}:intelligence:v1`;
    const cached = await cacheGet<{
      methodologyNote: string;
      draftLogCoverage: number;
      items: unknown[];
      reason?: string;
      cachedAt?: string;
      stale?: boolean;
    }>(cacheKey);

    if (cached) {
      return c.json(cached);
    }

    try {
      const payload = await getPostmatchIntelligence();
      const response = {
        ...payload,
        cachedAt: new Date().toISOString(),
        stale: false
      };
      // Tournament schedule updates relatively infrequently; keep Redis cache longer.
      await cacheSet(cacheKey, response, 7 * 24 * 60 * 60);
      return c.json(response);
    } catch (error) {
      const stale = await cacheGet<{
        methodologyNote: string;
        draftLogCoverage: number;
        items: unknown[];
        reason?: string;
        cachedAt?: string;
        stale?: boolean;
      }>(cacheKey);

      if (stale) {
        return c.json(
          {
            ...stale,
            stale: true,
            reason:
              error instanceof Error
                ? `Serving stale cache due to upstream failure: ${error.message}`
                : `Serving stale cache due to upstream failure.`
          },
          200
        );
      }

      return c.json(
        {
          methodologyNote: `${label} postmatch intelligence is temporarily unavailable.`,
          draftLogCoverage: 0,
          items: [],
          reason: error instanceof Error ? error.message : `${label} postmatch intelligence is unavailable.`
        },
        503
      );
    }
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

// Temporarily disabled to isolate webhook body parsing issues on Vercel runtime.
// app.use(
//   "*",
//   cors({
//     origin: (origin) => {
//       if (allowAnyOrigin) return origin ?? "*";
//       if (!origin) return corsOrigins[0] ?? "";
//       return corsOrigins.includes(origin) ? origin : "";
//     },
//     allowMethods: ["GET", "POST", "OPTIONS"],
//     allowHeaders: ["Content-Type", "Authorization"]
//   })
// );

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
type TournamentMatchDraftLogRecord = typeof tournamentMatchDraftLogs.$inferSelect;
type TournamentEventMode = z.infer<typeof tournamentEventModeSchema>;
type TournamentRegularSeasonFormat = z.infer<typeof tournamentRegularSeasonFormatSchema>;
type TournamentPlayoffFormat = z.infer<typeof tournamentPlayoffFormatSchema>;
type TournamentPlayoffSeedPolicy = z.infer<typeof playoffSeedPolicySchema>;
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
type DraftLaneName = "exp" | "jungle" | "mid" | "gold" | "roam";

const TOURNAMENT_STANDING_WIN_POINTS = 1;
const TOURNAMENT_STANDING_DRAW_POINTS = 0.5;
const TOURNAMENT_STANDING_LOSS_POINTS = 0;
const TOURNAMENT_STANDING_BYE_POINTS = 1;

function normalizeTournamentEventMode(value: string | null | undefined): TournamentEventMode {
  return value === "playoffs" ? "playoffs" : "regular_season";
}

function normalizeTournamentPlayoffFormat(value: string | null | undefined): TournamentPlayoffFormat {
  if (value === "double_elimination") return "double_elimination";
  return "single_elimination";
}

function getTournamentEventMode(event: Pick<TournamentEventRecord, "eventMode" | "format">) {
  return normalizeTournamentEventMode(event.eventMode || event.format);
}

function getTournamentPlayoffFormat(
  event: Pick<TournamentEventRecord, "eventMode" | "format">
) {
  if (getTournamentEventMode(event) !== "playoffs") return null;
  return normalizeTournamentPlayoffFormat(event.format);
}

function inferPreferredLaneFromRoles(rolePrimary: string, roleSecondary?: string | null): DraftLaneName[] {
  const roles = [rolePrimary, roleSecondary].filter(Boolean).map((role) => String(role).toLowerCase());
  const result: DraftLaneName[] = [];
  if (roles.includes("fighter")) result.push("exp");
  if (roles.includes("assassin")) result.push("jungle");
  if (roles.includes("mage")) result.push("mid");
  if (roles.includes("marksman")) result.push("gold");
  if (roles.includes("support")) result.push("roam");
  if (roles.includes("tank")) {
    result.push("roam");
    result.push("exp");
  }
  return Array.from(new Set(result));
}

async function buildPostmatchLaneRecommendations(limitPerLane = 1) {
  const rows = await db
    .select({
      mlid: heroes.mlid,
      name: heroes.name,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes,
      winRate: heroStatsLatest.winRate,
      pickRate: heroStatsLatest.pickRate,
      banRate: heroStatsLatest.banRate
    })
    .from(heroStatsLatest)
    .innerJoin(heroes, eq(heroes.mlid, heroStatsLatest.mlid))
    .where(eq(heroStatsLatest.timeframe, "7d"))
    .orderBy(desc(heroStatsLatest.pickRate))
    .limit(200);

  const laneBuckets = new Map<DraftLaneName, Array<{
    lane: DraftLaneName;
    mlid: number;
    heroName: string;
    rolePrimary: string;
    confidence: "High Confidence" | "Medium Confidence";
    reason: string;
  }>>();
  const supportedLanes: DraftLaneName[] = ["exp", "jungle", "mid", "gold", "roam"];
  for (const lane of supportedLanes) laneBuckets.set(lane, []);

  for (const row of rows) {
    const declaredLanes = ((row.lanes ?? []) as string[]).map((lane) => lane.toLowerCase());
    const inferred = inferPreferredLaneFromRoles(row.rolePrimary, row.roleSecondary);
    const laneCandidates = new Set<DraftLaneName>();
    for (const lane of supportedLanes) {
      if (declaredLanes.includes(lane)) laneCandidates.add(lane);
    }
    for (const lane of inferred) laneCandidates.add(lane);

    const pickRate = toNumber(row.pickRate);
    const winRate = toNumber(row.winRate);
    const confidence: "High Confidence" | "Medium Confidence" = pickRate >= 10 && winRate >= 50
      ? "High Confidence"
      : "Medium Confidence";

    for (const lane of laneCandidates) {
      const bucket = laneBuckets.get(lane);
      if (!bucket) continue;
      bucket.push({
        lane,
        mlid: row.mlid,
        heroName: row.name,
        rolePrimary: row.rolePrimary,
        confidence,
        reason: `${row.name} offers stable ${lane.toUpperCase()} pressure from latest engine sample.`
      });
    }
  }

  const recommendations: Array<{
    lane: DraftLaneName;
    mlid: number;
    heroName: string;
    rolePrimary: string;
    confidence: "High Confidence" | "Medium Confidence";
    reason: string;
  }> = [];
  const usedMlids = new Set<number>();

  for (const lane of supportedLanes) {
    const bucket = laneBuckets.get(lane) ?? [];
    let picked = 0;
    for (const item of bucket) {
      if (picked >= limitPerLane) break;
      if (usedMlids.has(item.mlid)) continue;
      recommendations.push(item);
      usedMlids.add(item.mlid);
      picked += 1;
    }
  }

  return recommendations;
}

function normalizeDraftMlids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0)
    )
  );
}

async function buildTournamentPostmatchIntelligence(eventIdOrCode: number | string) {
  const bundle = await loadTournamentBundle(eventIdOrCode);
  if (!bundle) return null;

  const teamById = new Map(bundle.teams.map((team) => [team.id, team]));
  const roundById = new Map(bundle.rounds.map((round) => [round.id, round]));
  const [laneRecommendations, heroCatalog, draftLogs] = await Promise.all([
    buildPostmatchLaneRecommendations(1),
    loadHeroCatalog(),
    db
      .select()
      .from(tournamentMatchDraftLogs)
      .where(eq(tournamentMatchDraftLogs.eventId, bundle.event.id))
  ]);
  const heroByMlid = new Map(heroCatalog.map((hero) => [hero.mlid, hero]));
  const draftLogByMatchId = new Map<number, TournamentMatchDraftLogRecord>(draftLogs.map((log) => [log.matchId, log]));

  const completedMatches = bundle.matches
    .filter((match) =>
      match.result !== "pending"
      && Boolean(match.teamBId)
      && match.scoreA !== null
      && match.scoreB !== null
      && Boolean(match.winnerTeamId)
    )
    .sort((left, right) => {
      const leftRound = roundById.get(left.roundId)?.roundNumber ?? 0;
      const rightRound = roundById.get(right.roundId)?.roundNumber ?? 0;
      if (rightRound !== leftRound) return rightRound - leftRound;
      return (right.pairingOrder ?? 0) - (left.pairingOrder ?? 0);
    })
    .slice(0, 8);

  const rawItems = await Promise.all(completedMatches.map(async (match) => {
    const teamA = match.teamAId ? (teamById.get(match.teamAId) ?? null) : null;
    const teamB = match.teamBId ? (teamById.get(match.teamBId) ?? null) : null;
    const winner = match.winnerTeamId ? (teamById.get(match.winnerTeamId) ?? null) : null;
    const loser = winner?.id === teamA?.id ? teamB : teamA;
    const round = roundById.get(match.roundId) ?? null;
    const scoreA = match.scoreA ?? 0;
    const scoreB = match.scoreB ?? 0;
    const scoreDiff = Math.abs(scoreA - scoreB);
    const isWinnerTeamA = winner?.id === teamA?.id;
    const winnerScore = isWinnerTeamA ? scoreA : scoreB;
    const loserScore = isWinnerTeamA ? scoreB : scoreA;
    const swingLabel = scoreDiff >= 2 ? "strong conversion edge" : "tight series control";

    const draftLog = draftLogByMatchId.get(match.id) ?? null;
    const winnerPicksRaw = draftLog
      ? (winner?.id === teamA?.id ? normalizeDraftMlids(draftLog.teamAPicks) : normalizeDraftMlids(draftLog.teamBPicks))
      : [];
    const loserPicksRaw = draftLog
      ? (loser?.id === teamA?.id ? normalizeDraftMlids(draftLog.teamAPicks) : normalizeDraftMlids(draftLog.teamBPicks))
      : [];

    const winnerPicks = winnerPicksRaw.filter((mlid) => heroByMlid.has(mlid));
    const loserPicks = loserPicksRaw.filter((mlid) => heroByMlid.has(mlid));
    const hasMatchDraftLog = winnerPicks.length > 0 && loserPicks.length > 0;

    let loserSuggestions = laneRecommendations
      .slice(0, 3)
      .map((entry) => ({
        lane: entry.lane,
        mlid: entry.mlid,
        heroName: entry.heroName,
        confidence: entry.confidence,
        reason: entry.reason,
        swapOutHeroName: null as string | null
      }));

    if (hasMatchDraftLog) {
      const counterRowsResult = await db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
        SELECT counter_mlid, enemy_mlid, score::float8 AS score
        FROM counter_matrix
        WHERE timeframe = ${"7d"}
          AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(winnerPicks))})
        LIMIT 3000
      `);
      const scoreByCounter = new Map<number, number>();
      for (const row of counterRowsResult.rows) {
        const current = scoreByCounter.get(row.counter_mlid) ?? 0;
        scoreByCounter.set(row.counter_mlid, current + toNumber(row.score));
      }

      const rankedCandidates = Array.from(scoreByCounter.entries())
        .map(([mlid, score]) => ({ mlid, score }))
        .filter((entry) => !loserPicks.includes(entry.mlid))
        .sort((left, right) => right.score - left.score)
        .slice(0, 20);

      const loserPickByLane = new Map<DraftLaneName, number>();
      for (const mlid of loserPicks) {
        const hero = heroByMlid.get(mlid);
        if (!hero) continue;
        const lanes = ((hero.lanes ?? []) as string[]).map((lane) => lane.toLowerCase());
        for (const lane of ["exp", "jungle", "mid", "gold", "roam"] as DraftLaneName[]) {
          if (!lanes.includes(lane)) continue;
          if (!loserPickByLane.has(lane)) loserPickByLane.set(lane, mlid);
        }
      }

      const seenLanes = new Set<DraftLaneName>();
      const computedSuggestions: Array<{
        lane: DraftLaneName;
        mlid: number;
        heroName: string;
        confidence: "High Confidence" | "Medium Confidence";
        reason: string;
        swapOutHeroName: string | null;
      }> = [];

      for (const candidate of rankedCandidates) {
        if (computedSuggestions.length >= 3) break;
        const hero = heroByMlid.get(candidate.mlid);
        if (!hero) continue;
        const heroLanes = ((hero.lanes ?? []) as string[]).map((lane) => lane.toLowerCase());
        const preferredLane = (["exp", "jungle", "mid", "gold", "roam"] as DraftLaneName[]).find((lane) =>
          heroLanes.includes(lane)
        );
        if (!preferredLane || seenLanes.has(preferredLane)) continue;
        const swapOutMlid = loserPickByLane.get(preferredLane) ?? null;
        const swapOutHeroName = swapOutMlid ? (heroByMlid.get(swapOutMlid)?.name ?? null) : null;
        computedSuggestions.push({
          lane: preferredLane,
          mlid: candidate.mlid,
          heroName: hero.name,
          confidence: candidate.score >= 1.2 ? "High Confidence" : "Medium Confidence",
          reason: `${hero.name} shows stronger counter response versus ${winner?.name ?? "opponent"} core picks.`,
          swapOutHeroName
        });
        seenLanes.add(preferredLane);
      }

      if (computedSuggestions.length > 0) {
        loserSuggestions = computedSuggestions;
      }
    }

    const confidence = hasMatchDraftLog
      ? (scoreDiff >= 2 ? "High Confidence" : "Medium Confidence")
      : (scoreDiff >= 2 ? "Medium Confidence" : "Experimental");
    const confidenceReason = hasMatchDraftLog
      ? (
        scoreDiff >= 2
          ? "Backed by match draft logs plus a clear score conversion edge."
          : "Backed by match draft logs, but scoreline remains tight."
      )
      : (
        scoreDiff >= 2
          ? "Template-based recommendation without draft logs; scoreline adds moderate confidence."
          : "Template-based recommendation without draft logs; treat as directional guidance."
      );

    return {
      matchId: match.id,
      roundNumber: round?.roundNumber ?? null,
      roundLabel: round?.label ?? `Round ${round?.roundNumber ?? "-"}`,
      scoreline: `${winnerScore}-${loserScore}`,
      winnerTeam: winner ? { id: winner.id, name: winner.name } : null,
      loserTeam: loser ? { id: loser.id, name: loser.name } : null,
      winnerAnalysis: [
        `${winner?.name ?? "Winner"} secured ${swingLabel} in ${round?.label ?? `Round ${round?.roundNumber ?? "-"}`}.`,
        scoreDiff >= 2
          ? "They maintained cleaner objective conversion and safer fight entry windows."
          : "They closed key timing windows better in high-pressure phases."
      ],
      loserAnalysis: [
        `${loser?.name ?? "Loser"} dropped leverage during critical mid-to-late setup windows.`,
        "Review lane fit and swap heroes into the strongest final setup."
      ],
      loserRecommendations: loserSuggestions,
      confidence,
      confidenceReason,
      dataMode: hasMatchDraftLog ? "match_draft_log_enabled" : "template_without_match_draft_log"
    };
  }));
  const items = rawItems.filter((item) => item.winnerTeam && item.loserTeam);
  const draftLogBackedCount = items.filter((item) => item.dataMode === "match_draft_log_enabled").length;
  const draftLogCoverage = items.length > 0 ? Number((draftLogBackedCount / items.length).toFixed(2)) : 0;

  return {
    event: {
      id: bundle.event.id,
      name: bundle.event.name
    },
    methodologyNote:
      "V2 intelligence combines official match outcomes with lane-aware recommendations. Match-level draft logs increase recommendation specificity.",
    draftLogCoverage,
    items
  };
}

function normalizeTournamentRegularSeasonFormat(
  value: string | null | undefined,
  totalRounds = 0
): TournamentRegularSeasonFormat {
  if (value === "double_round_robin") return "double_round_robin";
  if (value === "five_round") return "five_round";
  if (value === "custom_round") return "custom_round";
  if (value === "round_robin") return "round_robin";
  if (value === "swiss_stage") return "swiss_stage";
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

function resolveTournamentAdvanceToPlayoffs(totalTeams: number, advanceToPlayoffs?: number | null) {
  const maxValue = Math.max(2, totalTeams || TOURNAMENT_DEFAULT_ADVANCE_TO_PLAYOFFS);
  const fallbackValue = Math.min(TOURNAMENT_DEFAULT_ADVANCE_TO_PLAYOFFS, maxValue);
  if (!Number.isFinite(advanceToPlayoffs)) return fallbackValue;

  const value = Math.trunc(advanceToPlayoffs ?? fallbackValue);
  if (value < 2) return fallbackValue;
  if (value > maxValue) return maxValue;
  return value;
}

function getTournamentAdvanceToPlayoffs(
  event: Pick<TournamentEventRecord, "advanceToPlayoffs" | "totalTeams">
) {
  return resolveTournamentAdvanceToPlayoffs(event.totalTeams, event.advanceToPlayoffs);
}

function getTournamentRoundBestOf(
  event: Pick<
    TournamentEventRecord,
    "eventMode"
    | "format"
    | "totalTeams"
    | "totalRounds"
    | "matchBestOf"
    | "playoffSemifinalBestOf"
    | "playoffFinalBestOf"
    | "playoffThirdPlaceBestOf"
  >,
  roundNumber: number,
  pairingOrder = 1,
  roundStage?: string | null,
  matchBestOfOverride?: number | null
) {
  if (Number.isInteger(matchBestOfOverride) && (matchBestOfOverride ?? 0) > 0) {
    return Math.max(1, matchBestOfOverride ?? 1);
  }

  const eventMode = getTournamentEventMode(event);
  if (eventMode !== "playoffs") {
    return getTournamentMatchBestOf(event);
  }

  const playoffFormat = getTournamentPlayoffFormat(event);
  if (playoffFormat === "double_elimination") {
    if (roundStage === "grand_final") {
      return Math.max(3, event.playoffFinalBestOf || 5);
    }
    if (roundStage === "third_place") {
      return Math.max(1, event.playoffThirdPlaceBestOf || event.matchBestOf || 1);
    }
    if (roundStage === "upper" || roundStage === "lower") {
      const upperRounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, event.totalTeams))));
      const isDeepStage = roundStage === "upper"
        ? roundNumber >= Math.max(1, upperRounds)
        : roundNumber >= Math.max(1, upperRounds + 1);
      return isDeepStage
        ? Math.max(1, event.playoffSemifinalBestOf || event.matchBestOf || 1)
        : getTournamentMatchBestOf(event);
    }
  }

  if (
    roundNumber >= event.totalRounds
    && pairingOrder > 1
    && Number.isInteger(event.playoffThirdPlaceBestOf)
    && (event.playoffThirdPlaceBestOf ?? 0) > 0
  ) {
    return Math.max(1, event.playoffThirdPlaceBestOf || event.matchBestOf || 1);
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
  if (format === "swiss_stage") return "Swiss Stage";
  return "Round Robin";
}

function formatTournamentPlayoffFormatLabel(format: TournamentPlayoffFormat | null | undefined) {
  if (format === "double_elimination") return "Knockout Double Elimination";
  return "Knockout Single Elimination";
}

function tournamentUsesFlexiblePairings(
  event: Pick<TournamentEventRecord, "eventMode" | "format" | "totalRounds">
) {
  const eventMode = getTournamentEventMode(event);
  if (eventMode === "playoffs") return true;
  const regularSeasonFormat = getTournamentRegularSeasonFormat(event);
  return regularSeasonFormat === "five_round" || regularSeasonFormat === "custom_round" || regularSeasonFormat === "swiss_stage";
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
    return scoreA > scoreB
      ? { result: "team_a_win" as const, winnerTeamIdSide: "team_a" as const }
      : { result: "team_b_win" as const, winnerTeamIdSide: "team_b" as const };
  }

  if (tournamentAllowsBo1RegularSeasonDraw(eventMode, matchBestOf)) {
    if (scoreA === 0 && scoreB === 0) {
      return { result: "draw" as const, winnerTeamIdSide: null };
    }
    if ((scoreA === 1 && scoreB === 0) || (scoreA === 0 && scoreB === 1)) {
      return scoreA > scoreB
        ? { result: "team_a_win" as const, winnerTeamIdSide: "team_a" as const }
        : { result: "team_b_win" as const, winnerTeamIdSide: "team_b" as const };
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
    return scoreA > scoreB
      ? { result: "team_a_win" as const, winnerTeamIdSide: "team_a" as const }
      : { result: "team_b_win" as const, winnerTeamIdSide: "team_b" as const };
  }

  const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
  if (scoreA === scoreB) {
    return { error: `BO${matchBestOf} matches must produce a winner.` };
  }
  if (Math.max(scoreA, scoreB) !== requiredWins || Math.min(scoreA, scoreB) >= requiredWins) {
    return { error: `BO${matchBestOf} matches must finish when one team reaches ${requiredWins} win(s).` };
  }
  return scoreA > scoreB
    ? { result: "team_a_win" as const, winnerTeamIdSide: "team_a" as const }
    : { result: "team_b_win" as const, winnerTeamIdSide: "team_b" as const };
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

function toIsoTimestamp(value: Date | string | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value;
  }
  return "";
}

function serializeTournamentEvent(event: TournamentEventRecord) {
  const eventBannerImageUrl = resolveTournamentEventBannerImageUrl(event);
  return {
    id: event.id,
    slug: toTournamentEventSlug(event.name),
    code: event.code,
    name: event.name,
    format: event.format,
    eventMode: getTournamentEventMode(event),
    regularSeasonFormat: getTournamentRegularSeasonFormat(event),
    playoffFormat: getTournamentPlayoffFormat(event),
    matchBestOf: getTournamentMatchBestOf(event),
    playoffSemifinalBestOf: event.playoffSemifinalBestOf,
    playoffFinalBestOf: event.playoffFinalBestOf,
    playoffThirdPlaceBestOf: event.playoffThirdPlaceBestOf,
    swissDeciderBestOf: event.swissDeciderBestOf,
    playoffSeedPolicy: event.playoffSeedPolicy ?? null,
    playoffSeedMetadata: event.playoffSeedMetadata ?? null,
    advanceToPlayoffs: getTournamentAdvanceToPlayoffs(event),
    totalTeams: event.totalTeams,
    totalRounds: event.totalRounds,
    eventDate: toIsoTimestamp(event.eventDate),
    status: event.status,
    createdByTelegramUserId: event.createdByTelegramUserId,
    telegramChatId: event.telegramChatId,
    createdAt: toIsoTimestamp(event.createdAt),
    updatedAt: toIsoTimestamp(event.updatedAt),
    grandFinalTeamALogoUrl: event.grandFinalTeamALogoUrl ?? null,
    grandFinalTeamBLogoUrl: event.grandFinalTeamBLogoUrl ?? null,
    grandFinalYoutubeUrl: event.grandFinalYoutubeUrl ?? null,
    eventBannerImageUrl,
    adminWhatsapp: event.adminWhatsapp ?? null,
    registrationDeadline: event.registrationDeadline ? toIsoTimestamp(event.registrationDeadline) : null
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

    const fixed = working[0] ?? null;
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
      stage: round.stage,
      stageNumber: round.stageNumber,
      label: round.label,
      status: round.status,
      createdAt: toIsoTimestamp(round.createdAt),
      matches: (matchesByRound.get(round.id) ?? [])
        .slice()
        .sort((left, right) => left.pairingOrder - right.pairingOrder)
        .map((match) => ({
          id: match.id,
          pairingOrder: match.pairingOrder,
          result: match.result,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          matchBestOf: match.matchBestOf,
          winnerTeamId: match.winnerTeamId,
          updatedAt: toIsoTimestamp(match.updatedAt),
          teamA: (() => {
            const team = match.teamAId ? teamById.get(match.teamAId) : null;
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

    if (!match.teamAId) continue;
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

function getTournamentStandingsMatches(
  event: Pick<TournamentEventRecord, "eventMode" | "format" | "totalRounds">,
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[]
) {
  if (getTournamentRegularSeasonFormat(event) !== "swiss_stage") {
    return matches;
  }

  const swissRoundIds = new Set(
    rounds
      .filter((round) => round.stage === "swiss")
      .map((round) => round.id)
  );
  if (swissRoundIds.size === 0) {
    return matches;
  }

  return matches.filter((match) => swissRoundIds.has(match.roundId));
}

function buildTournamentStandingsForEvent(
  event: Pick<TournamentEventRecord, "eventMode" | "format" | "totalRounds">,
  rounds: TournamentRoundRecord[],
  teams: TournamentTeamRecord[],
  matches: TournamentMatchRecord[]
) {
  return buildTournamentStandings(teams, getTournamentStandingsMatches(event, rounds, matches));
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
      .flatMap((match) => (
        match.teamAId && match.teamBId && match.result !== "pending"
          ? [tournamentMatchupKey(match.teamAId, match.teamBId)]
          : []
      ))
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
  regularSeasonCustomRounds?: number,
  playoffFormat?: TournamentPlayoffFormat,
  playoffAdvanceCount?: number
) {
  if (eventMode === "playoffs") {
    const normalizedPlayoffFormat = normalizeTournamentPlayoffFormat(playoffFormat);
    const upperRounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, totalTeams))));
    if (normalizedPlayoffFormat === "double_elimination") {
      return Math.max(2, upperRounds + Math.max(0, (upperRounds - 1) * 2) + 1);
    }
    if (playoffAdvanceCount !== undefined && playoffAdvanceCount >= 4 && playoffAdvanceCount < totalTeams) {
      return Math.max(1, Math.round(Math.log2(totalTeams / playoffAdvanceCount)));
    }
    return upperRounds;
  }

  const format = normalizeTournamentRegularSeasonFormat(regularSeasonFormat, regularSeasonCustomRounds ?? 0);
  if (format === "swiss_stage") {
    return getSwissRegularSeasonRounds(totalTeams);
  }
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
    if (!match.teamAId || !match.teamBId || match.result === "pending") continue;
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
    if (!match.teamAId || !match.teamBId || match.result === "pending" || !recentRoundIdSet.has(match.roundId)) continue;
    const teamAOpponents = opponentsByTeam.get(match.teamAId) ?? new Set<number>();
    teamAOpponents.add(match.teamBId);
    opponentsByTeam.set(match.teamAId, teamAOpponents);

    const teamBOpponents = opponentsByTeam.get(match.teamBId) ?? new Set<number>();
    teamBOpponents.add(match.teamAId);
    opponentsByTeam.set(match.teamBId, teamBOpponents);
  }

  return opponentsByTeam;
}

function buildProperSeededBracketOrder(n: number): number[] {
  if (n <= 1) return [1];
  if (n === 2) return [1, 2];
  const nextPow2 = Math.pow(2, Math.ceil(Math.log2(n)));
  if (nextPow2 === 2) return [1, 2];
  const half = nextPow2 / 2;
  const halfOrder = buildProperSeededBracketOrder(half);
  const result: number[] = [];
  for (const seed of halfOrder) {
    result.push(seed);
    result.push(nextPow2 + 1 - seed);
  }
  return result.filter(s => s <= n);
}

function buildSeededKnockoutPairings(
  teams: Array<{ id: number; seed: number | null }>
) {
  const orderedTeams = sortTeamsBySeed(teams);
  const n = orderedTeams.length;
  const pairings: Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }> = [];

  if (n === 0) return pairings;
  if (n === 1) {
    const team = orderedTeams[0]!;
    pairings.push({ teamAId: team.id, teamBId: null, result: "bye", pairingOrder: 1, winnerTeamId: team.id });
    return pairings;
  }

  const frameSize = Math.pow(2, Math.ceil(Math.log2(Math.max(2, n))));
  const slotOrder = buildProperSeededBracketOrder(frameSize);
  const slots = slotOrder.map((seedPos) => orderedTeams[seedPos - 1] ?? null);

  for (let index = 0; index < slots.length; index += 2) {
    const teamA = slots[index];
    const teamB = slots[index + 1] ?? null;
    if (!teamA && !teamB) continue;
    if (!teamA || !teamB) {
      const byeTeam = teamA ?? teamB;
      if (!byeTeam) continue;
      pairings.push({
        teamAId: byeTeam.id,
        teamBId: null,
        result: "bye",
        pairingOrder: pairings.length + 1,
        winnerTeamId: byeTeam.id
      });
      continue;
    }
    pairings.push({
      teamAId: teamA.id,
      teamBId: teamB.id,
      result: "pending",
      pairingOrder: pairings.length + 1,
      winnerTeamId: null
    });
  }

  return pairings;
}

function buildShuffledSeededKnockoutPairings(
  teams: Array<{ id: number; seed: number | null }>
) {
  const shuffled = shuffleInPlace(teams.slice()).map((team, index) => ({
    id: team.id,
    seed: index + 1
  }));
  return buildSeededKnockoutPairings(shuffled);
}

function buildFirstRoundSeedIndexPairs(teamCount: number): Array<[number, number]> {
  if (teamCount < 2) return [];
  const slotOrder = buildProperSeededBracketOrder(teamCount);
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < slotOrder.length; index += 2) {
    const seedA = slotOrder[index];
    const seedB = slotOrder[index + 1];
    if (!seedA || !seedB) continue;
    pairs.push([seedA - 1, seedB - 1]);
  }
  return pairs;
}

function countRoundOneSameSourceConflicts(
  entries: RegularSeasonPlayoffSeedEntry[],
  pairs: Array<[number, number]>
) {
  let conflicts = 0;
  for (const [leftSeedIndex, rightSeedIndex] of pairs) {
    const left = entries[leftSeedIndex];
    const right = entries[rightSeedIndex];
    if (!left || !right) continue;
    if (left.sourceEventId === right.sourceEventId) conflicts += 1;
  }
  return conflicts;
}

function cloneRegularSeasonSeedEntries(entries: RegularSeasonPlayoffSeedEntry[]) {
  return entries.map((entry) => ({ ...entry }));
}

function shuffleEntriesWithinSameRank(entries: RegularSeasonPlayoffSeedEntry[]) {
  const rankBuckets = new Map<number, number[]>();
  for (let index = 0; index < entries.length; index += 1) {
    const rank = entries[index]?.rank;
    if (!rank) continue;
    const bucket = rankBuckets.get(rank) ?? [];
    bucket.push(index);
    rankBuckets.set(rank, bucket);
  }

  const shuffled = cloneRegularSeasonSeedEntries(entries);
  for (const indexes of rankBuckets.values()) {
    const values = indexes.map((index) => shuffled[index]).filter((entry): entry is RegularSeasonPlayoffSeedEntry => Boolean(entry));
    for (let i = values.length - 1; i > 0; i -= 1) {
      const randomIndex = randomBytes(4).readUInt32BE(0) % (i + 1);
      const temp = values[i];
      values[i] = values[randomIndex]!;
      values[randomIndex] = temp!;
    }
    for (let i = 0; i < indexes.length; i += 1) {
      const index = indexes[i]!;
      const value = values[i];
      if (!value) continue;
      shuffled[index] = value;
    }
  }
  return shuffled;
}

function improveRegularSeasonSeedingByRankSwaps(
  entries: RegularSeasonPlayoffSeedEntry[],
  pairs: Array<[number, number]>
) {
  if (entries.length < 4 || pairs.length === 0) return cloneRegularSeasonSeedEntries(entries);
  const candidate = cloneRegularSeasonSeedEntries(entries);
  let currentConflicts = countRoundOneSameSourceConflicts(candidate, pairs);

  while (true) {
    let bestSwap: [number, number] | null = null;
    let bestConflicts = currentConflicts;

    for (let left = 0; left < candidate.length; left += 1) {
      const leftEntry = candidate[left];
      if (!leftEntry) continue;
      for (let right = left + 1; right < candidate.length; right += 1) {
        const rightEntry = candidate[right];
        if (!rightEntry || leftEntry.rank !== rightEntry.rank) continue;

        [candidate[left], candidate[right]] = [candidate[right]!, candidate[left]!];
        const conflictsAfterSwap = countRoundOneSameSourceConflicts(candidate, pairs);
        [candidate[left], candidate[right]] = [candidate[right]!, candidate[left]!];

        if (conflictsAfterSwap < bestConflicts) {
          bestConflicts = conflictsAfterSwap;
          bestSwap = [left, right];
        }
      }
    }

    if (!bestSwap || bestConflicts >= currentConflicts) break;
    const [left, right] = bestSwap;
    [candidate[left], candidate[right]] = [candidate[right]!, candidate[left]!];
    currentConflicts = bestConflicts;
  }

  return candidate;
}

function optimizeRegularSeasonSeedEntries(
  entries: RegularSeasonPlayoffSeedEntry[],
  pairs: Array<[number, number]>,
  policy: TournamentPlayoffSeedPolicy
) {
  if (policy === "strict_rank") return cloneRegularSeasonSeedEntries(entries);

  const baseOptimized = improveRegularSeasonSeedingByRankSwaps(entries, pairs);
  if (policy !== "avoid_same_group") return baseOptimized;

  let best = baseOptimized;
  let bestConflicts = countRoundOneSameSourceConflicts(best, pairs);
  if (bestConflicts === 0) return best;

  const restartCount = Math.min(64, Math.max(12, Math.floor(entries.length / 2)));
  for (let restart = 0; restart < restartCount; restart += 1) {
    const shuffled = shuffleEntriesWithinSameRank(entries);
    const optimized = improveRegularSeasonSeedingByRankSwaps(shuffled, pairs);
    const conflicts = countRoundOneSameSourceConflicts(optimized, pairs);
    if (conflicts < bestConflicts) {
      best = optimized;
      bestConflicts = conflicts;
      if (bestConflicts === 0) break;
    }
  }

  return best;
}

function buildPlayoffSeedEntriesFromRegularSeasonGroups(
  groupStandings: RegularSeasonGroupStanding[],
  policy: TournamentPlayoffSeedPolicy
): RegularSeasonSeedBuildResult {
  const entries: RegularSeasonPlayoffSeedEntry[] = [];
  const maxTeamsPerGroup = Math.max(...groupStandings.map(group => group.teams.length));

  for (let rankIndex = 0; rankIndex < maxTeamsPerGroup; rankIndex += 1) {
    for (const group of groupStandings) {
      const teamName = group.teams[rankIndex];
      if (!teamName) continue;
      entries.push({
        teamName,
        sourceEventId: group.sourceEventId,
        sourceEventName: group.sourceEventName,
        rank: rankIndex + 1
      });
    }
  }

  const firstRoundPairs = buildFirstRoundSeedIndexPairs(entries.length);
  const initialConflictCount = countRoundOneSameSourceConflicts(entries, firstRoundPairs);
  const optimizedEntries = optimizeRegularSeasonSeedEntries(entries, firstRoundPairs, policy);
  const finalConflictCount = countRoundOneSameSourceConflicts(optimizedEntries, firstRoundPairs);

  return {
    entries: optimizedEntries,
    initialConflictCount,
    finalConflictCount
  };
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

  if (byeTeamId) {
    pairings.push({
      teamAId: byeTeamId,
      teamBId: null,
      result: "bye",
      pairingOrder: 1,
      winnerTeamId: byeTeamId
    });
  }

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

  return pairings;
}

function pickRandomByeTeamId(participants: Array<{ id: number }>): number | null {
  if (participants.length % 2 !== 1) return null;
  const index = randomBytes(4).readUInt32BE(0) % participants.length;
  return participants[index]?.id ?? null;
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
    .filter((teamId): teamId is number => typeof teamId === "number" && Number.isInteger(teamId) && teamId > 0);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return advancingTeamIds
    .map((teamId) => teamsById.get(teamId))
    .filter((team): team is TournamentTeamRecord => Boolean(team));
}

function isPlayoffByeMatch(match: Pick<TournamentMatchRecord, "teamBId" | "result">) {
  return !match.teamBId || match.result === "bye";
}

function shouldCreateLoserFromPlayoffMatch(match: Pick<TournamentMatchRecord, "teamBId" | "result">) {
  return !isPlayoffByeMatch(match);
}

function buildBracketOrderedKnockoutPairings(
  teams: Array<{ id: number; seed: number | null }>
) {
  const queue = teams.slice();
  const pairings: Array<{
    teamAId: number;
    teamBId: number | null;
    result: "pending" | "bye";
    pairingOrder: number;
    winnerTeamId: number | null;
  }> = [];

  while (queue.length > 0) {
    const teamA = queue.shift();
    const teamB = queue.shift() ?? null;
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

function buildPlayoffEliminatedParticipants(teams: TournamentTeamRecord[], roundMatches: TournamentMatchRecord[]) {
  const eliminatedTeamIds = roundMatches
    .map((match) => {
      if (!shouldCreateLoserFromPlayoffMatch(match)) return null;
      if (match.result === "team_a_win") return match.teamBId;
      if (match.result === "team_b_win") return match.teamAId;
      return null;
    })
    .filter((teamId): teamId is number => typeof teamId === "number" && Number.isInteger(teamId) && teamId > 0);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return sortTeamsBySeed(
    eliminatedTeamIds
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is TournamentTeamRecord => Boolean(team))
  );
}

function withRoundMeta(
  pairings: TournamentRoundPairing[],
  stage: string,
  stageNumber: number,
  label: string
) {
  return pairings.map((pairing) => ({
    ...pairing,
    stage,
    stageNumber,
    label
  }));
}

function buildPlayoffSwissRoundPairings(
  teams: TournamentTeamRecord[],
  matches: TournamentMatchRecord[],
  roundNumber: number
) {
  const activeRows = buildTournamentStandingRows(teams, matches)
    .filter((row) => row.win < 3 && row.lose < 3);
  if (activeRows.length === 0) return [] as TournamentRoundPairing[];

  const rematchKeys = new Set(
    matches
      .flatMap((match) => (
        match.teamAId && match.teamBId && match.result !== "pending"
          ? [tournamentMatchupKey(match.teamAId, match.teamBId)]
          : []
      ))
  );

  let byeTeamId: number | null = null;
  if (activeRows.length % 2 === 1) {
    const byePool = activeRows.filter((row) => row.bye === 0);
    const targetPool = byePool.length > 0 ? byePool : activeRows;
    byeTeamId = targetPool[targetPool.length - 1]?.teamId ?? null;
  }

  const queue = activeRows.filter((row) => row.teamId !== byeTeamId);
  const pairings: TournamentRoundPairing[] = [];
  const scoreGroups = buildSwissScoreGroups(queue);
  for (const group of scoreGroups) {
    const localQueue = group.slice();
    while (localQueue.length > 1) {
      const current = localQueue.shift();
      if (!current) break;
      let opponentIndex = findBestSwissOpponentIndex(current, localQueue, rematchKeys);
      if (opponentIndex < 0) opponentIndex = 0;
      const [opponent] = localQueue.splice(opponentIndex, 1);
      if (!opponent) {
        localQueue.unshift(current);
        break;
      }
      const isDeciderMatch =
        current.win >= 2 || current.lose >= 2 || opponent.win >= 2 || opponent.lose >= 2;
      pairings.push({
        teamAId: current.teamId,
        teamBId: opponent.teamId,
        matchBestOf: isDeciderMatch ? 3 : 1,
        result: "pending",
        pairingOrder: pairings.length + 1,
        winnerTeamId: null
      });
      rematchKeys.add(tournamentMatchupKey(current.teamId, opponent.teamId));
    }
  }

  if (byeTeamId) {
    pairings.push({
      teamAId: byeTeamId,
      teamBId: null,
      matchBestOf: 1,
      result: "bye",
      pairingOrder: pairings.length + 1,
      winnerTeamId: byeTeamId
    });
  }

  return withRoundMeta(pairings, "swiss", roundNumber, `Swiss Stage Round ${roundNumber}`);
}

function buildPlayoffSwissRoundOnePairings(
  teams: TournamentTeamRecord[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  strategy: TournamentPairingStrategy
) {
  const seededTeams = sortTeamsBySeed(teams);
  if (strategy === "shuffle") {
    return withRoundMeta(
      buildShuffledPairings(seededTeams, rounds, matches, null).map((pairing) => ({
        ...pairing,
        matchBestOf: 1
      })),
      "swiss",
      1,
      "Swiss Stage Round 1"
    );
  }

  return withRoundMeta(
    buildInitialSwissMatches(seededTeams).map((pairing) => ({
      ...pairing,
      matchBestOf: 1
    })),
    "swiss",
    1,
    "Swiss Stage Round 1"
  );
}

function buildRegularSeasonSwissRoundPairings(
  event: TournamentEventRecord,
  teams: TournamentTeamRecord[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  nextRoundNumber: number,
  strategy: TournamentPairingStrategy
): TournamentRoundPairing[] {
  const winThreshold = getSwissWinThreshold(event.totalTeams);

  // Only pair teams that are still active (haven't qualified or been eliminated)
  const activeStandings = buildTournamentStandingRows(teams, matches)
    .filter((row) => row.win < winThreshold && row.lose < winThreshold);
  const activeTeamIds = new Set(activeStandings.map((r) => r.teamId));
  const activeTeams = teams.filter((t) => activeTeamIds.has(t.id));

  const pairings = nextRoundNumber === 1
    ? buildPlayoffSwissRoundOnePairings(teams, rounds, matches, strategy).map((p) => ({
        ...p,
        matchBestOf: null
      }))
    : withRoundMeta(
        buildSwissRoundPairings(activeTeams, matches),
        "swiss",
        nextRoundNumber,
        `Swiss Stage Round ${nextRoundNumber}`
      );

  const deciderBestOf = event.swissDeciderBestOf ?? null;
  if (!deciderBestOf) return pairings;

  const standings = buildTournamentStandingRows(teams, matches);
  const winsByTeamId = new Map(standings.map((s) => [s.teamId, s.win]));

  return pairings.map((p) => {
    const aWins = p.teamAId ? (winsByTeamId.get(p.teamAId) ?? 0) : 0;
    const bWins = p.teamBId ? (winsByTeamId.get(p.teamBId) ?? 0) : 0;
    if (aWins === winThreshold - 1 || bWins === winThreshold - 1) {
      return { ...p, matchBestOf: deciderBestOf };
    }
    return p;
  });
}

function buildDoubleEliminationNextStage(
  totalTeams: number,
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[]
) {
  const upperRounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, totalTeams))));
  const playoffRounds = rounds
    .filter((round) => ["upper", "lower", "grand_final"].includes(round.stage))
    .slice()
    .sort((left, right) => left.roundNumber - right.roundNumber);
  const lastRound = playoffRounds[playoffRounds.length - 1] ?? null;

  if (!lastRound) {
    return { stage: "upper", stageNumber: 1, label: "Upper Bracket Round 1" } as const;
  }

  if (lastRound.stage === "upper") {
    if (lastRound.stageNumber === 1) {
      return { stage: "lower", stageNumber: 1, label: "Lower Bracket Round 1" } as const;
    }
    if (lastRound.stageNumber < upperRounds) {
      const lowerStageNumber = (lastRound.stageNumber * 2) - 2;
      return { stage: "lower", stageNumber: lowerStageNumber, label: `Lower Bracket Round ${lowerStageNumber}` } as const;
    }
    return {
      stage: "lower",
      stageNumber: Math.max(1, (upperRounds * 2) - 2),
      label: `Lower Bracket Final`
    } as const;
  }

  if (lastRound.stage === "lower") {
    const lastLowerStage = lastRound.stageNumber;
    const finalLowerStage = Math.max(1, (upperRounds * 2) - 2);
    if (lastLowerStage >= finalLowerStage) {
      return { stage: "grand_final", stageNumber: 1, label: "Grand Final" } as const;
    }
    if (lastLowerStage % 2 === 1) {
      const nextUpperStageNumber = Math.floor((lastLowerStage + 3) / 2);
      return {
        stage: "upper",
        stageNumber: nextUpperStageNumber,
        label: nextUpperStageNumber >= upperRounds ? "Upper Bracket Final" : `Upper Bracket Round ${nextUpperStageNumber}`
      } as const;
    }
    return {
      stage: "lower",
      stageNumber: lastLowerStage + 1,
      label: `Lower Bracket Round ${lastLowerStage + 1}`
    } as const;
  }

  if (lastRound.stage === "grand_final") {
    if (lastRound.stageNumber >= 2) return null;
    const grandFinalMatch = matches
      .filter((m) => m.roundId === lastRound.id)
      .slice()
      .sort((a, b) => a.pairingOrder - b.pairingOrder)[0];
    if (!grandFinalMatch || grandFinalMatch.result === "pending" || !grandFinalMatch.teamBId) {
      return null;
    }
    const lowerBracketWonFirstFinal = grandFinalMatch.winnerTeamId === grandFinalMatch.teamBId;
    if (lowerBracketWonFirstFinal) {
      return { stage: "grand_final", stageNumber: 2, label: "Grand Final Reset" } as const;
    }
  }

  return null;
}

function getDEFinalLowerStage(totalTeams: number) {
  const upperRounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, totalTeams))));
  return Math.max(1, (upperRounds * 2) - 2);
}

function getDEUpperSourceStageForLowerEven(lowerStageNumber: number) {
  return Math.floor(lowerStageNumber / 2) + 1;
}

function buildDEPairingSourceLabels(
  totalTeams: number,
  stage: string,
  stageNumber: number,
  pairingOrder: number
) {
  const upperRounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, totalTeams))));
  const finalLowerStage = getDEFinalLowerStage(totalTeams);
  if (stage === "upper") {
    if (stageNumber <= 1) return null;
    return {
      left: `W: UB R${stageNumber - 1} M#${(pairingOrder * 2) - 1}`,
      right: `W: UB R${stageNumber - 1} M#${pairingOrder * 2}`
    };
  }

  if (stage === "lower") {
    if (stageNumber === 1) {
      return {
        left: `L: UB R1 M#${(pairingOrder * 2) - 1}`,
        right: `L: UB R1 M#${pairingOrder * 2}`
      };
    }
    if (stageNumber % 2 === 0) {
      const ubSourceStage = getDEUpperSourceStageForLowerEven(stageNumber);
      return {
        left: `W: LB R${stageNumber - 1} M#${pairingOrder}`,
        right: `L: UB R${ubSourceStage} M#${pairingOrder}`
      };
    }
    if (stageNumber >= 3) {
      return {
        left: `W: LB R${stageNumber - 1} M#${(pairingOrder * 2) - 1}`,
        right: `W: LB R${stageNumber - 1} M#${pairingOrder * 2}`
      };
    }
  }

  if (stage === "grand_final") {
    if (stageNumber >= 2) {
      return {
        left: "W: Grand Final M#1",
        right: "L: Grand Final M#1"
      };
    }
    return {
      left: `W: UB R${upperRounds} M#1`,
      right: `W: LB R${finalLowerStage} M#1`
    };
  }

  return null;
}

function formatDEFlowSourceLabel(source: unknown, totalTeams?: number) {
  if (!source || typeof source !== "object") return null;
  const value = source as { type?: unknown; ref?: unknown; seed?: unknown };
  if (value.type === "bye") return "BYE";
  if (value.type === "seed" && typeof value.seed === "number") return `Seed #${value.seed}`;
  if (typeof value.ref !== "string") return null;

  const [stage, stageNumber, pairingOrder] = value.ref.split(":");
  const stageLabel =
    stage === "upper" ? "UB" :
    stage === "lower" ? "LB" :
    stage === "grand_final" ? "Grand Final" :
    stage?.toUpperCase();
  if (!stageLabel || !stageNumber || !pairingOrder) return null;

  const prefix =
    value.type === "winner" ? "W" :
    value.type === "loser" ? "L" :
    null;
  if (prefix === "W" && totalTeams && stage === "upper" && Number(stageNumber) === Math.max(1, Math.ceil(Math.log2(Math.max(2, totalTeams)))) && Number(pairingOrder) === 1) {
    return "W: Upper Final";
  }
  if (prefix === "W" && totalTeams && stage === "lower" && Number(stageNumber) === getDEFinalLowerStage(totalTeams) && Number(pairingOrder) === 1) {
    return "W: Lower Final";
  }
  return prefix ? `${prefix}: ${stageLabel} R${stageNumber} M#${pairingOrder}` : null;
}

function buildDEPreviewSourceLabels(
  totalTeams: number,
  stage: string,
  stageNumber: number,
  pairingOrder: number,
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[]
) {
  const base = buildDEPairingSourceLabels(totalTeams, stage, stageNumber, pairingOrder);
  if (!base) return null;

  if (stage === "lower" && stageNumber % 2 === 0) {
    const ubSourceStage = getDEUpperSourceStageForLowerEven(stageNumber);
    const hasLeftSource = getRoundMatchesByStage(rounds, matches, "lower", stageNumber - 1)
      .some((match) => match.pairingOrder === pairingOrder);
    const hasRightSource = getRoundMatchesByStage(rounds, matches, "upper", ubSourceStage)
      .some((match) => match.pairingOrder === pairingOrder);
    return {
      left: hasLeftSource ? base.left : "BYE",
      right: hasRightSource ? base.right : "BYE"
    };
  }

  return base;
}

function getRoundMatchesByStage(
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  stage: string,
  stageNumber: number
) {
  const round = rounds.find((candidate) => candidate.stage === stage && candidate.stageNumber === stageNumber);
  if (!round) return [] as TournamentMatchRecord[];
  return matches
    .filter((match) => match.roundId === round.id)
    .slice()
    .sort((left, right) => left.pairingOrder - right.pairingOrder);
}

type DETeamSource = {
  team: TournamentTeamRecord;
  source: { type: "winner" | "loser"; ref: string };
};

type DEFlowSource =
  | { type: "seed"; seed: number }
  | { type: "winner" | "loser"; ref: string }
  | { type: "bye" };

type DETopologyMatch = {
  stage: "upper" | "lower" | "grand_final";
  stageNumber: number;
  label: string;
  pairingOrder: number;
  sourceA: DEFlowSource;
  sourceB: DEFlowSource;
  teamAId: number | null;
  teamBId: number | null;
  result: "pending" | "bye";
  winnerTeamId: number | null;
};

type DETopologyRound = {
  roundNumber: number;
  stage: "upper" | "lower" | "grand_final";
  stageNumber: number;
  label: string;
  status: "active" | "upcoming";
  matches: DETopologyMatch[];
};

function parseDEFlowRef(ref: string | undefined) {
  if (!ref) return null;
  const [stage, stageNumberRaw, pairingOrderRaw] = ref.split(":");
  const stageNumber = Number(stageNumberRaw);
  const pairingOrder = Number(pairingOrderRaw);
  if (!stage || !Number.isInteger(stageNumber) || !Number.isInteger(pairingOrder)) return null;
  return { stage, stageNumber, pairingOrder } as const;
}

function buildDEMatchRef(stage: string, stageNumber: number, pairingOrder: number) {
  return `${stage}:${stageNumber}:${pairingOrder}`;
}

function sourceTeamIdFromTopology(
  source: DEFlowSource,
  teamBySeed: Map<number, TournamentTeamRecord>,
  byeWinnerByRef: Map<string, number>
) {
  if (source.type === "seed") return teamBySeed.get(source.seed)?.id ?? null;
  if (source.type === "winner") return byeWinnerByRef.get(source.ref) ?? null;
  return null;
}

function buildFixedDoubleEliminationTopology(teams: TournamentTeamRecord[]): DETopologyRound[] {
  const orderedTeams = sortTeamsBySeed(teams);
  const teamBySeed = new Map(orderedTeams.map((team, index) => [index + 1, team]));
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(2, orderedTeams.length))));
  const upperRoundCount = Math.max(1, Math.ceil(Math.log2(bracketSize)));
  const finalLowerStage = Math.max(1, (upperRoundCount * 2) - 2);
  const byeWinnerByRef = new Map<string, number>();
  const rounds: DETopologyRound[] = [];
  const matchesByStage = new Map<string, DETopologyMatch[]>();

  const labelFor = (stage: "upper" | "lower" | "grand_final", stageNumber: number) => {
    if (stage === "upper") return stageNumber >= upperRoundCount ? "Upper Bracket Final" : `Upper Bracket Round ${stageNumber}`;
    if (stage === "lower") return stageNumber >= finalLowerStage ? "Lower Bracket Final" : `Lower Bracket Round ${stageNumber}`;
    return stageNumber >= 2 ? "Grand Final Reset" : "Grand Final";
  };

  const stageKey = (stage: string, stageNumber: number) => `${stage}:${stageNumber}`;
  const addRound = (
    stage: "upper" | "lower" | "grand_final",
    stageNumber: number,
    matches: Array<Omit<DETopologyMatch, "stage" | "stageNumber" | "label">>
  ) => {
    const label = labelFor(stage, stageNumber);
    const roundMatches = matches.map((match) => ({ ...match, stage, stageNumber, label }));
    for (const match of roundMatches) {
      const ref = buildDEMatchRef(stage, stageNumber, match.pairingOrder);
      if (match.result === "bye" && match.winnerTeamId !== null) {
        byeWinnerByRef.set(ref, match.winnerTeamId);
      }
    }
    matchesByStage.set(stageKey(stage, stageNumber), roundMatches);
    rounds.push({
      roundNumber: rounds.length + 1,
      stage,
      stageNumber,
      label,
      status: stage === "upper" && stageNumber === 1 ? "active" : "upcoming",
      matches: roundMatches
    });
  };

  const createMatch = (pairingOrder: number, rawSourceA: DEFlowSource, rawSourceB: DEFlowSource) => {
    let sourceA = rawSourceA;
    let sourceB = rawSourceB;
    let teamAId = sourceTeamIdFromTopology(sourceA, teamBySeed, byeWinnerByRef);
    let teamBId = sourceTeamIdFromTopology(sourceB, teamBySeed, byeWinnerByRef);
    if (!teamAId && teamBId && sourceA.type === "bye") {
      [sourceA, sourceB] = [sourceB, sourceA];
      [teamAId, teamBId] = [teamBId, teamAId];
    }
    const hasResolvedBye = teamAId !== null && teamBId === null && sourceB.type === "bye";
    return {
      pairingOrder,
      sourceA,
      sourceB,
      teamAId,
      teamBId,
      result: hasResolvedBye ? "bye" as const : "pending" as const,
      winnerTeamId: hasResolvedBye ? teamAId : null
    };
  };

  const seedOrder = buildProperSeededBracketOrder(bracketSize);
  const upperRoundOne: Array<Omit<DETopologyMatch, "stage" | "stageNumber" | "label">> = [];
  for (let index = 0; index < seedOrder.length; index += 2) {
    upperRoundOne.push(createMatch(
      upperRoundOne.length + 1,
      seedOrder[index]! <= orderedTeams.length ? { type: "seed", seed: seedOrder[index]! } : { type: "bye" },
      seedOrder[index + 1]! <= orderedTeams.length ? { type: "seed", seed: seedOrder[index + 1]! } : { type: "bye" }
    ));
  }
  addRound("upper", 1, upperRoundOne);

  const lowerRoundHadTrailingBye = new Map<number, boolean>();
  const buildLowerMatches = (stageNumber: number, entrants: DEFlowSource[], rebalanceTrailingBye: boolean) => {
    const orderedEntrants = entrants.slice();
    if (rebalanceTrailingBye && orderedEntrants.length % 2 === 1 && lowerRoundHadTrailingBye.get(stageNumber - 1) && orderedEntrants.length > 1) {
      const trailing = orderedEntrants.pop()!;
      orderedEntrants.unshift(trailing);
    }
    const matchCount = Math.ceil(orderedEntrants.length / 2);
    const lowerMatches: Array<Omit<DETopologyMatch, "stage" | "stageNumber" | "label">> = [];
    for (let pairingOrder = 1; pairingOrder <= matchCount; pairingOrder += 1) {
      lowerMatches.push(createMatch(
        pairingOrder,
        orderedEntrants[(pairingOrder * 2) - 2] ?? { type: "bye" },
        orderedEntrants[(pairingOrder * 2) - 1] ?? { type: "bye" }
      ));
    }
    lowerRoundHadTrailingBye.set(stageNumber, lowerMatches.some((match) => match.sourceB.type === "bye"));
    return lowerMatches;
  };

  const ubRoundOneRealLosers = (matchesByStage.get(stageKey("upper", 1)) ?? [])
    .filter((match) => match.sourceA.type === "seed" && match.sourceB.type === "seed")
    .map((match) => ({ type: "loser", ref: buildDEMatchRef("upper", 1, match.pairingOrder) } satisfies DEFlowSource));
  addRound("lower", 1, buildLowerMatches(1, ubRoundOneRealLosers, false));

  const addUpperRound = (stageNumber: number) => {
    const matchCount = bracketSize / Math.pow(2, stageNumber);
    const upperMatches: Array<Omit<DETopologyMatch, "stage" | "stageNumber" | "label">> = [];
    for (let pairingOrder = 1; pairingOrder <= matchCount; pairingOrder += 1) {
      upperMatches.push(createMatch(
        pairingOrder,
        { type: "winner", ref: buildDEMatchRef("upper", stageNumber - 1, (pairingOrder * 2) - 1) },
        { type: "winner", ref: buildDEMatchRef("upper", stageNumber - 1, pairingOrder * 2) }
      ));
    }
    addRound("upper", stageNumber, upperMatches);
  };

  const addLowerRound = (lowerStage: number) => {
    const previousLower = matchesByStage.get(stageKey("lower", lowerStage - 1)) ?? [];
    const previousWinners = previousLower.map((match) => ({
      type: "winner",
      ref: buildDEMatchRef("lower", lowerStage - 1, match.pairingOrder)
    } satisfies DEFlowSource));
    const entrants = lowerStage % 2 === 0
      ? [
          ...previousWinners,
          ...(matchesByStage.get(stageKey("upper", getDEUpperSourceStageForLowerEven(lowerStage))) ?? []).map((match) => ({
            type: "loser",
            ref: buildDEMatchRef("upper", getDEUpperSourceStageForLowerEven(lowerStage), match.pairingOrder)
          } satisfies DEFlowSource))
        ]
      : previousWinners;
    addRound("lower", lowerStage, buildLowerMatches(lowerStage, entrants, lowerStage % 2 === 1));
  };

  for (let upperStage = 2; upperStage <= upperRoundCount; upperStage += 1) {
    addUpperRound(upperStage);
    const lowerEvenStage = (upperStage * 2) - 2;
    if (lowerEvenStage <= finalLowerStage) addLowerRound(lowerEvenStage);
    const lowerOddStage = lowerEvenStage + 1;
    if (lowerOddStage < finalLowerStage) addLowerRound(lowerOddStage);
  }

  addRound("grand_final", 1, [
    createMatch(
      1,
      { type: "winner", ref: buildDEMatchRef("upper", upperRoundCount, 1) },
      { type: "winner", ref: buildDEMatchRef("lower", finalLowerStage, 1) }
    )
  ]);

  return rounds;
}

function findMatchByFlowRef(
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  ref: string | undefined
) {
  const parsed = parseDEFlowRef(ref);
  if (!parsed) return null;
  const round = rounds.find((candidate) => candidate.stage === parsed.stage && candidate.stageNumber === parsed.stageNumber);
  if (!round) return null;
  return matches.find((match) => match.roundId === round.id && match.pairingOrder === parsed.pairingOrder) ?? null;
}

function getLowerByeWinnerTeamIds(
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  stageNumber: number
) {
  if (stageNumber <= 0) return new Set<number>();
  const lowerRound = rounds.find((candidate) => candidate.stage === "lower" && candidate.stageNumber === stageNumber);
  if (!lowerRound) return new Set<number>();
  const ids = matches
    .filter((match) => match.roundId === lowerRound.id && match.result === "bye" && match.winnerTeamId !== null)
    .map((match) => match.winnerTeamId as number);
  return new Set(ids);
}

function sourceComesFromRealWinner(
  entry: DETeamSource,
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[]
) {
  if (entry.source.type !== "winner") return false;
  const sourceMatch = findMatchByFlowRef(rounds, matches, entry.source.ref);
  if (!sourceMatch) return false;
  return sourceMatch.result !== "bye";
}

function rebalanceLowerByeAssignment(
  entrants: DETeamSource[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  lowerStageNumber: number
) {
  if (entrants.length % 2 === 0 || entrants.length === 0) return entrants;

  const previousLowerByeWinners = getLowerByeWinnerTeamIds(rounds, matches, lowerStageNumber - 1);
  const lastIndex = entrants.length - 1;
  const lastEntrant = entrants[lastIndex];
  if (!lastEntrant || !previousLowerByeWinners.has(lastEntrant.team.id)) {
    return entrants;
  }

  const candidates = entrants
    .slice(0, lastIndex)
    .filter((entry) => !previousLowerByeWinners.has(entry.team.id));
  if (candidates.length === 0) return entrants;

  const preferred = candidates.filter((entry) => sourceComesFromRealWinner(entry, rounds, matches));
  const pool = preferred.length > 0 ? preferred : candidates;
  const selected = pool
    .slice()
    .sort((left, right) => {
      const leftSeed = left.team.seed ?? Number.MIN_SAFE_INTEGER;
      const rightSeed = right.team.seed ?? Number.MIN_SAFE_INTEGER;
      return rightSeed - leftSeed;
    })[0];
  if (!selected) return entrants;

  const selectedIndex = entrants.findIndex((entry) => entry.team.id === selected.team.id);
  if (selectedIndex < 0 || selectedIndex === lastIndex) return entrants;
  const selectedEntrant = entrants[selectedIndex];
  const lastEntrantForSwap = entrants[lastIndex];
  if (!selectedEntrant || !lastEntrantForSwap) return entrants;

  const reordered = entrants.slice();
  [reordered[selectedIndex], reordered[lastIndex]] = [lastEntrantForSwap, selectedEntrant];
  return reordered;
}

function resolveTeamByMatchOutcome(
  teams: TournamentTeamRecord[],
  match: TournamentMatchRecord | undefined,
  outcome: "winner" | "loser"
) {
  if (!match) return null;
  const teamA = match.teamAId ? (teams.find((team) => team.id === match.teamAId) ?? null) : null;
  const teamB = match.teamBId ? (teams.find((team) => team.id === match.teamBId) ?? null) : null;

  if (!teamB) {
    return outcome === "winner" ? teamA : null;
  }
  if (match.result === "pending" || !match.winnerTeamId) return null;

  if (outcome === "winner") {
    return teams.find((team) => team.id === match.winnerTeamId) ?? null;
  }

  const loserTeamId = match.winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
  return teams.find((team) => team.id === loserTeamId) ?? null;
}

function resolveTeamSourceByMatchOutcome(
  teams: TournamentTeamRecord[],
  match: TournamentMatchRecord | undefined,
  stage: string,
  stageNumber: number,
  outcome: "winner" | "loser"
) {
  const team = resolveTeamByMatchOutcome(teams, match, outcome);
  if (!team || !match) return null;
  return {
    team,
    source: { type: outcome, ref: `${stage}:${stageNumber}:${match.pairingOrder}` }
  } satisfies DETeamSource;
}

function buildDELowerEvenPlan(
  teams: TournamentTeamRecord[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  lowerStageNumber: number
) {
  const ubSourceStage = getDEUpperSourceStageForLowerEven(lowerStageNumber);
  const previousLowerWinners = getRoundMatchesByStage(rounds, matches, "lower", lowerStageNumber - 1)
    .map((match) => resolveTeamSourceByMatchOutcome(teams, match, "lower", lowerStageNumber - 1, "winner"))
    .filter((entry): entry is DETeamSource => Boolean(entry));
  const droppedUpperTeams = getRoundMatchesByStage(rounds, matches, "upper", ubSourceStage)
    .map((match) => resolveTeamSourceByMatchOutcome(teams, match, "upper", ubSourceStage, "loser"))
    .filter((entry): entry is DETeamSource => Boolean(entry));
  const pool = [...previousLowerWinners, ...droppedUpperTeams];
  const matchCount = Math.ceil(pool.length / 2);
  const totalSlots = matchCount * 2;
  const byeCount = Math.max(0, totalSlots - pool.length);

  return {
    previousLowerWinners,
    droppedUpperTeams,
    pool,
    matchCount,
    byeCount
  };
}

function buildDELowerStagePairingsFromSlots(
  teams: TournamentTeamRecord[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  nextStage: { stage: "lower"; stageNumber: number; label: string }
) {
  const pairings: TournamentRoundPairing[] = [];

  const pushPairing = (pairingOrder: number, sourceA: DETeamSource | null, sourceB: DETeamSource | null) => {
    if (!sourceA && !sourceB) return;
    const teamA = sourceA ?? sourceB;
    const teamB = sourceA && sourceB ? sourceB : null;
    if (!teamA) return;
    pairings.push({
      teamAId: teamA.team.id,
      teamBId: teamB?.team.id ?? null,
      result: teamB ? "pending" : "bye",
      pairingOrder,
      winnerTeamId: teamB ? null : teamA.team.id,
      playoffFlow: {
        sourceA: teamA.source,
        sourceB: teamB?.source ?? { type: "bye" }
      }
    });
  };

  if (nextStage.stageNumber === 1) {
    const ubRound1Matches = getRoundMatchesByStage(rounds, matches, "upper", 1);
    const slotCount = Math.ceil(ubRound1Matches.length / 2);
    for (let pairingOrder = 1; pairingOrder <= slotCount; pairingOrder += 1) {
      const leftMatch = ubRound1Matches.find((match) => match.pairingOrder === (pairingOrder * 2) - 1);
      const rightMatch = ubRound1Matches.find((match) => match.pairingOrder === pairingOrder * 2);
      pushPairing(
        pairingOrder,
        resolveTeamSourceByMatchOutcome(teams, leftMatch, "upper", 1, "loser"),
        resolveTeamSourceByMatchOutcome(teams, rightMatch, "upper", 1, "loser")
      );
    }
    return withRoundMeta(pairings, nextStage.stage, nextStage.stageNumber, nextStage.label);
  }

  if (nextStage.stageNumber % 2 === 0) {
    const ubSourceStage = getDEUpperSourceStageForLowerEven(nextStage.stageNumber);
    const ubSourceRound = rounds.find((r) => r.stage === "upper" && r.stageNumber === ubSourceStage);
    const ubSourceMatches = ubSourceRound ? matches.filter((m) => m.roundId === ubSourceRound.id) : [];
    if (!ubSourceRound || ubSourceMatches.some((m) => m.result === "pending")) {
      console.info("[tournament][de] block lower-even generation: source upper round not ready", {
        nextLowerStage: nextStage.stageNumber,
        ubSourceStage
      });
      return [] as TournamentRoundPairing[];
    }

    const prevLowerRound = rounds.find((r) => r.stage === "lower" && r.stageNumber === nextStage.stageNumber - 1);
    const prevLowerMatches = prevLowerRound ? matches.filter((m) => m.roundId === prevLowerRound.id) : [];
    if (!prevLowerRound || prevLowerMatches.some((m) => m.result === "pending")) {
      return [] as TournamentRoundPairing[];
    }

    const plan = buildDELowerEvenPlan(teams, rounds, matches, nextStage.stageNumber);
    const balancedPool = rebalanceLowerByeAssignment(plan.pool, rounds, matches, nextStage.stageNumber);
    for (let pairingOrder = 1; pairingOrder <= plan.matchCount; pairingOrder += 1) {
      const sourceA = balancedPool[(pairingOrder * 2) - 2] ?? null;
      const sourceB = balancedPool[(pairingOrder * 2) - 1] ?? null;
      pushPairing(pairingOrder, sourceA, sourceB);
    }
    const actualByeCount = pairings.filter((pairing) => pairing.teamBId === null).length;
    if (actualByeCount !== plan.byeCount) {
      console.warn("[tournament][de] LB-even bye mismatch", {
        stageNumber: nextStage.stageNumber,
        expectedByeCount: plan.byeCount,
        actualByeCount
      });
    }
    return withRoundMeta(pairings, nextStage.stage, nextStage.stageNumber, nextStage.label);
  }

  const prevLBRound = rounds.find((r) => r.stage === "lower" && r.stageNumber === nextStage.stageNumber - 1);
  const prevLBMatches = prevLBRound ? matches.filter((m) => m.roundId === prevLBRound.id) : [];
  if (!prevLBRound || prevLBMatches.some((m) => m.result === "pending")) {
    return [] as TournamentRoundPairing[];
  }

  const prevStageMatches = getRoundMatchesByStage(rounds, matches, "lower", nextStage.stageNumber - 1);
  const previousWinners = prevStageMatches
    .map((match) => resolveTeamSourceByMatchOutcome(teams, match, "lower", nextStage.stageNumber - 1, "winner"))
    .filter((entry): entry is DETeamSource => Boolean(entry));
  const entrants = rebalanceLowerByeAssignment(previousWinners, rounds, matches, nextStage.stageNumber);
  const slotCount = Math.ceil(entrants.length / 2);
  for (let pairingOrder = 1; pairingOrder <= slotCount; pairingOrder += 1) {
    pushPairing(
      pairingOrder,
      entrants[(pairingOrder * 2) - 2] ?? null,
      entrants[(pairingOrder * 2) - 1] ?? null
    );
  }

  return withRoundMeta(pairings, nextStage.stage, nextStage.stageNumber, nextStage.label);
}

function buildDoubleEliminationPairings(
  event: TournamentEventRecord,
  teams: TournamentTeamRecord[],
  rounds: TournamentRoundRecord[],
  matches: TournamentMatchRecord[],
  strategy: TournamentPairingStrategy
) {
  const nextStage = buildDoubleEliminationNextStage(event.totalTeams, rounds, matches);
  if (!nextStage) return [] as TournamentRoundPairing[];

  if (nextStage.stage === "upper") {
    const participants = nextStage.stageNumber === 1
      ? sortTeamsBySeed(teams)
      : (() => {
          const prevUpperRound = rounds.find((r) => r.stage === "upper" && r.stageNumber === nextStage.stageNumber - 1);
          const prevUpperMatches = prevUpperRound ? matches.filter((m) => m.roundId === prevUpperRound.id) : [];
          if (!prevUpperRound || prevUpperMatches.some((m) => m.result === "pending")) {
            console.info("[tournament][de] block upper stage generation: source upper round not ready", {
              nextUpperStage: nextStage.stageNumber,
              prevUpperStage: nextStage.stageNumber - 1
            });
            return [] as TournamentTeamRecord[];
          }
          return buildPlayoffParticipants(teams, prevUpperMatches);
        })();
    if (participants.length === 0) return [] as TournamentRoundPairing[];
    const pairings = nextStage.stageNumber === 1
      ? strategy === "shuffle"
        ? buildShuffledSeededKnockoutPairings(participants)
        : buildSeededKnockoutPairings(participants)
      : buildBracketOrderedKnockoutPairings(participants);
    return withRoundMeta(pairings, nextStage.stage, nextStage.stageNumber, nextStage.label);
  }

  if (nextStage.stage === "lower") {
    return buildDELowerStagePairingsFromSlots(teams, rounds, matches, nextStage);
  }

  const upperRounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, event.totalTeams))));
  const participants = (() => {
    if (nextStage.stageNumber === 2) {
      const firstGrandFinal = getRoundMatchesByStage(rounds, matches, "grand_final", 1)[0];
      if (!firstGrandFinal?.teamAId || !firstGrandFinal.teamBId || firstGrandFinal.result === "pending") {
        console.info("[tournament][de] block grand final reset generation: first final not resolved", {
          hasFirstFinal: Boolean(firstGrandFinal)
        });
        return [] as TournamentTeamRecord[];
      }
      const teamA = teams.find((t) => t.id === firstGrandFinal.teamAId) ?? null;
      const teamB = teams.find((t) => t.id === firstGrandFinal.teamBId) ?? null;
      if (!teamA || !teamB) return [] as TournamentTeamRecord[];
      return [teamA, teamB];
    }
    const upperWinner = buildPlayoffParticipants(teams, getRoundMatchesByStage(rounds, matches, "upper", upperRounds));
    const lowerWinner = buildPlayoffParticipants(
      teams,
      getRoundMatchesByStage(rounds, matches, "lower", getDEFinalLowerStage(event.totalTeams))
    );
    return [...upperWinner.slice(0, 1), ...lowerWinner.slice(0, 1)];
  })();
  if (participants.length < 2) {
    console.info("[tournament][de] block grand final generation: finalists not ready", {
      nextGrandFinalStage: nextStage.stageNumber,
      participantsCount: participants.length
    });
    return [] as TournamentRoundPairing[];
  }
  return withRoundMeta(
    buildBracketOrderedKnockoutPairings(participants),
    nextStage.stage,
    nextStage.stageNumber,
    nextStage.label
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
    const playoffFormat = getTournamentPlayoffFormat(event);
    if (playoffFormat === "double_elimination") {
      return buildDoubleEliminationPairings(event, teams, rounds, matches, strategy);
    }

    const currentRound = activeTournamentRound(rounds);
    const { participants, currentRoundMatches } = (() => {
      if (!currentRound) {
        if (nextRoundNumber !== 1) {
          return { participants: [] as TournamentTeamRecord[], currentRoundMatches: [] as TournamentMatchRecord[] };
        }
        return { participants: sortTeamsBySeed(teams), currentRoundMatches: [] as TournamentMatchRecord[] };
      }
      const currentRoundMatches = matches
        .filter((match) => match.roundId === currentRound.id)
        .sort((left, right) => left.pairingOrder - right.pairingOrder);
      return {
        participants: buildPlayoffParticipants(teams, currentRoundMatches),
        currentRoundMatches
      };
    })();
    if (participants.length === 0) return [];
    const allowShuffle = tournamentAllowsShuffleForNextRound(event, nextRoundNumber);
    const nextRoundPairings = strategy === "shuffle" && allowShuffle
      ? buildShuffledSeededKnockoutPairings(participants)
      : nextRoundNumber <= 1
        ? buildSeededKnockoutPairings(participants)
        : buildBracketOrderedKnockoutPairings(participants);

    const shouldIncludeThirdPlaceMatch =
      nextRoundNumber >= event.totalRounds
      && currentRound?.roundNumber === event.totalRounds - 1
      && Boolean(event.playoffThirdPlaceBestOf);

    const isAdvanceMode = event.playoffAdvanceCount !== undefined && event.playoffAdvanceCount !== null && event.playoffAdvanceCount >= 4;
    const baseRoundLabel =
      nextRoundNumber >= event.totalRounds
        ? (isAdvanceMode ? "Babak Kualifikasi" : "Grand Final")
        : event.totalRounds > 1 && nextRoundNumber === event.totalRounds - 1
          ? "Semifinal"
          : `Knockout Stage Round ${nextRoundNumber}`;

    if (!shouldIncludeThirdPlaceMatch) {
      return withRoundMeta(nextRoundPairings, "main", nextRoundNumber, baseRoundLabel);
    }

    const eliminatedParticipants = buildPlayoffEliminatedParticipants(teams, currentRoundMatches);
    if (eliminatedParticipants.length !== 2) {
      console.warn(`[3rd place] Expected 2 eliminated participants, got ${eliminatedParticipants.length}. Skipping 3rd place match.`);
      return withRoundMeta(nextRoundPairings, "main", nextRoundNumber, baseRoundLabel);
    }

    const thirdPlacePairings = buildSeededKnockoutPairings(eliminatedParticipants);
    if (thirdPlacePairings.length === 0) {
      return nextRoundPairings;
    }

    return withRoundMeta([
      ...nextRoundPairings.map((pairing, index) => ({
        ...pairing,
        pairingOrder: index + 1,
        matchBestOf: Math.max(3, event.playoffFinalBestOf || 5)
      })),
      ...thirdPlacePairings.map((pairing, index) => ({
        ...pairing,
        pairingOrder: nextRoundPairings.length + index + 1,
        matchBestOf: Math.max(1, event.playoffThirdPlaceBestOf || event.matchBestOf || 1)
      }))
    ], "main", nextRoundNumber, "Grand Final / 3rd Place");
  }

  const regularSeasonFormat = getTournamentRegularSeasonFormat(event);
  if (regularSeasonFormat === "round_robin" || regularSeasonFormat === "double_round_robin") {
    return buildRoundRobinRoundPairings(teams, nextRoundNumber, regularSeasonFormat) as TournamentRoundPairing[];
  }

  if (regularSeasonFormat === "swiss_stage") {
    return buildRegularSeasonSwissRoundPairings(event, teams, rounds, matches, nextRoundNumber, strategy);
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

  const byCode = await loadTournamentEventByCode(normalized);
  if (byCode) return byCode;

  return loadTournamentEventBySlug(normalized);
}

async function loadTournamentBundle(eventIdOrCode: number | string) {
  const event = await loadTournamentEventByIdentifier(eventIdOrCode);
  if (!event) return null;
  const eventId = event.id;

  const cacheKey = tournamentBundleCacheKey(eventId);
  const cached = await cacheGet<{ event: typeof event; teams: TournamentTeamRecord[]; rounds: TournamentRoundRecord[]; matches: TournamentMatchRecord[] }>(cacheKey);
  if (cached) return cached;

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

  const bundle = { event, teams, rounds, matches };
  await cacheSet(cacheKey, bundle, BUNDLE_CACHE_TTL);
  return bundle;
}

async function loadTournamentBundleFresh(eventIdOrCode: number | string) {
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

const BUNDLE_CACHE_TTL = 60;

function tournamentBundleCacheKey(eventId: number) {
  return `tournament:bundle:${eventId}`;
}

async function invalidateTournamentBundle(eventId: number) {
  await cacheDel(tournamentBundleCacheKey(eventId));
}

function prepareTournamentNextRoundContext(bundle: Awaited<ReturnType<typeof loadTournamentBundle>>) {
  if (!bundle) {
    return { error: "Event not found." } as const;
  }

  const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";
  const activeRound = activeTournamentRound(bundle.rounds);

  if (!isDE) {
    // For non-DE: block if active round still has pending matches
    const pendingMatches = activeRound
      ? bundle.matches.filter((match) => match.roundId === activeRound.id && match.result === "pending")
      : [];
    if (pendingMatches.length > 0) {
      return { error: "Current round still has pending matches." } as const;
    }
  }
  // For DE: skip the "active round pending" check — multiple rounds can be active simultaneously.
  // buildDoubleEliminationPairings will return empty if sources aren't ready, acting as the gate.

  const nextRoundNumber = isDE
    ? Math.max(0, ...bundle.rounds.map((r) => r.roundNumber)) + 1
    : (activeRound?.roundNumber ?? 0) + 1;

  const deNextStage = isDE ? buildDoubleEliminationNextStage(bundle.event.totalTeams, bundle.rounds, bundle.matches) : null;
  if ((!isDE && nextRoundNumber > bundle.event.totalRounds) || (isDE && !deNextStage)) {
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
        stage: pairings[0]?.stage ?? "main",
        stageNumber: pairings[0]?.stageNumber ?? 1,
        label: pairings[0]?.label ?? null,
        status: "active"
      })
      .returning();
    if (!round) {
      throw new Error("Failed to create tournament round.");
    }

    const matches = await tx
      .insert(tournamentMatches)
      .values(
        pairings.map((pairing) => ({
          eventId,
          roundId: round.id,
          teamAId: pairing.teamAId,
          teamBId: pairing.teamBId,
          matchBestOf: pairing.matchBestOf ?? null,
          result: pairing.result,
          pairingOrder: pairing.pairingOrder,
          winnerTeamId: pairing.winnerTeamId,
          playoffFlow: pairing.playoffFlow ?? null
        }))
      )
      .returning();

    const event = await tx
      .select()
      .from(tournamentEvents)
      .where(eq(tournamentEvents.id, eventId))
      .limit(1);

    const createdEvent = event[0] ?? null;
    if (createdEvent && getTournamentEventMode(createdEvent) === "playoffs") {
      const allRounds = await tx
        .select()
        .from(tournamentRounds)
        .where(eq(tournamentRounds.eventId, eventId))
        .orderBy(asc(tournamentRounds.roundNumber));
      const allMatches = await tx
        .select()
        .from(tournamentMatches)
        .where(eq(tournamentMatches.eventId, eventId))
        .orderBy(asc(tournamentMatches.roundId), asc(tournamentMatches.pairingOrder));
      for (const playoffMatch of allMatches) {
        const playoffRound = allRounds.find((item) => item.id === playoffMatch.roundId);
        if (!playoffRound) continue;
        await tx
          .update(tournamentMatches)
          .set({
            playoffFlow: inferPlayoffMatchFlow(createdEvent, allRounds, allMatches, playoffRound, playoffMatch)
          })
          .where(and(eq(tournamentMatches.eventId, eventId), eq(tournamentMatches.id, playoffMatch.id)));
      }
    }

    await tx
      .update(tournamentEvents)
      .set({
        status: "ongoing",
        updatedAt
      })
      .where(eq(tournamentEvents.id, eventId));

    return { round, matches };
  });

  await invalidateTournamentBundle(eventId);
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
  if (!("pairings" in preview)) {
    return { error: "Unable to generate pairings." } as const;
  }

  const isDE = getTournamentPlayoffFormat(preview.bundle.event) === "double_elimination";

  // For DE: never auto-finish the previous active round here; refreshDERoundStatuses manages it.
  const created = await persistTournamentNextRound(
    eventId,
    isDE ? null : (preview.activeRound?.id ?? null),
    preview.nextRoundNumber,
    preview.pairings
  );
  if ("error" in created) {
    return created;
  }

  if (isDE) {
    // Immediately update all DE round statuses based on match results.
    await refreshDERoundStatuses(eventId);
  }

  // Re-load the final bundle after all rounds are generated.
  const finalBundle = await loadTournamentBundle(eventId);
  return {
    completed: false,
    bundle: finalBundle ?? created.bundle,
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

// For Double Elimination: recompute status for ALL rounds based on their match states.
// A round is "finished" when all matches are resolved (no pending), "active" when all
// participants are known but some matches still pending, "upcoming" when some matches
// are still waiting for participants (teamBId null and not a bye).
async function refreshDERoundStatuses(eventId: number) {
  const allMatches = await db
    .select({
      roundId: tournamentMatches.roundId,
      result: tournamentMatches.result,
      teamAId: tournamentMatches.teamAId,
      teamBId: tournamentMatches.teamBId,
    })
    .from(tournamentMatches)
    .where(eq(tournamentMatches.eventId, eventId));

  const matchesByRound = new Map<number, { result: string; teamAId: number | null; teamBId: number | null }[]>();
  for (const m of allMatches) {
    if (!matchesByRound.has(m.roundId)) matchesByRound.set(m.roundId, []);
    matchesByRound.get(m.roundId)!.push(m);
  }

  await Promise.all(
    Array.from(matchesByRound.entries()).map(([roundId, matches]) => {
      const allDone = matches.every((m) => m.result !== "pending");
      // A match is "unresolved" when teamBId is null and result is still pending (no participant yet)
      const allResolved = matches.every((m) => (m.teamAId !== null && m.teamBId !== null) || m.result !== "pending");
      const newStatus = allDone ? "finished" : allResolved ? "active" : "upcoming";
      return db
        .update(tournamentRounds)
        .set({ status: newStatus })
        .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, roundId)));
    })
  );
}

async function sanitizeDEBracket(eventId: number): Promise<boolean> {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) return false;
  if (getTournamentPlayoffFormat(bundle.event) !== "double_elimination") return false;

  const { teams, rounds, matches } = bundle;
  const upperRoundCount = Math.max(1, Math.ceil(Math.log2(Math.max(2, bundle.event.totalTeams))));
  const finalLowerStage = Math.max(1, (upperRoundCount * 2) - 2);
  const hasFixedFullTopology =
    rounds.some((round) => round.stage === "upper" && round.stageNumber === upperRoundCount)
    && rounds.some((round) => round.stage === "lower" && round.stageNumber === finalLowerStage)
    && rounds.some((round) => round.stage === "grand_final" && round.stageNumber === 1);
  if (hasFixedFullTopology) return false;

  const ubRounds = rounds.filter((r) => r.stage === "upper").sort((a, b) => a.stageNumber - b.stageNumber);
  const lbRounds = rounds.filter((r) => r.stage === "lower").sort((a, b) => a.stageNumber - b.stageNumber);
  const teamIdSet = new Set(teams.map((team) => team.id));
  const roundByStage = new Map(rounds.map((round) => [`${round.stage}:${round.stageNumber}`, round] as const));
  const matchesByRoundId = new Map<number, TournamentMatchRecord[]>();
  for (const match of matches) {
    const bucket = matchesByRoundId.get(match.roundId) ?? [];
    bucket.push(match);
    matchesByRoundId.set(match.roundId, bucket);
  }

  const hasValidFlowRef = (ref: string | null | undefined) => {
    if (!ref) return false;
    const [stage, stageNumberRaw, pairingOrderRaw] = ref.split(":");
    const stageNumber = Number(stageNumberRaw);
    const pairingOrder = Number(pairingOrderRaw);
    if (!stage || !Number.isInteger(stageNumber) || !Number.isInteger(pairingOrder)) return false;
    const sourceRound = roundByStage.get(`${stage}:${stageNumber}`);
    if (!sourceRound) return false;
    return (matchesByRoundId.get(sourceRound.id) ?? []).some((match) => match.pairingOrder === pairingOrder);
  };

  const isLegacyGhostLowerMatch = (round: TournamentRoundRecord, match: TournamentMatchRecord) => {
    if (round.stage !== "lower") return false;
    const flow = (match.playoffFlow ?? {}) as {
      sourceA?: { type?: string; ref?: string };
      sourceB?: { type?: string; ref?: string };
    };
    const hasTeamA = match.teamAId !== null && teamIdSet.has(match.teamAId);
    const hasTeamB = match.teamBId !== null && teamIdSet.has(match.teamBId);
    const sourceAValid = hasValidFlowRef(flow.sourceA?.ref);
    const sourceBIsBye = flow.sourceB?.type === "bye";
    const sourceBValid = sourceBIsBye || hasValidFlowRef(flow.sourceB?.ref);
    const unresolved =
      match.result === "pending"
      && match.winnerTeamId === null
      && match.scoreA === null
      && match.scoreB === null;
    return !hasTeamA && !hasTeamB && !sourceAValid && !sourceBValid && unresolved;
  };

  let firstInvalidRoundNumber: number | null = null;

  for (const lbRound of lbRounds) {
    const lbRoundMatches = (matchesByRoundId.get(lbRound.id) ?? [])
      .slice()
      .sort((a, b) => a.pairingOrder - b.pairingOrder);

    if (lbRoundMatches.some((match) => isLegacyGhostLowerMatch(lbRound, match))) {
      firstInvalidRoundNumber = lbRound.roundNumber;
      break;
    }

    if (lbRound.stageNumber === 1) {
      const expectedCount = buildDELowerStagePairingsFromSlots(
        teams,
        rounds.filter((round) => round.roundNumber < lbRound.roundNumber),
        matches.filter((match) => {
          const sourceRound = rounds.find((round) => round.id === match.roundId);
          return Boolean(sourceRound && sourceRound.roundNumber < lbRound.roundNumber);
        }),
        { stage: "lower", stageNumber: 1, label: "Lower Bracket Round 1" }
      ).length;
      const actualCount = lbRoundMatches.length;
      if (expectedCount > 0 && actualCount !== expectedCount) {
        firstInvalidRoundNumber = lbRound.roundNumber;
        break;
      }
    }

    if (lbRound.stageNumber % 2 === 0) {
      const ubSourceStage = Math.floor(lbRound.stageNumber / 2) + 1;
      const ubSourceRound = ubRounds.find((r) => r.stageNumber === ubSourceStage);
      const ubSourceMatches = ubSourceRound ? matches.filter((m) => m.roundId === ubSourceRound.id) : [];

      if (!ubSourceRound || ubSourceMatches.some((m) => m.result === "pending")) {
        firstInvalidRoundNumber = lbRound.roundNumber;
        break;
      }

      const expectedCount = buildDELowerEvenPlan(teams, rounds, matches, lbRound.stageNumber).matchCount;
      const actualCount = matches.filter((m) => m.roundId === lbRound.id).length;

      if (expectedCount > 0 && actualCount !== expectedCount) {
        firstInvalidRoundNumber = lbRound.roundNumber;
        break;
      }
    } else if (lbRound.stageNumber >= 3) {
      const prevLBRound = lbRounds.find((r) => r.stageNumber === lbRound.stageNumber - 1);
      const prevLBMatches = prevLBRound ? matches.filter((m) => m.roundId === prevLBRound.id) : [];
      if (!prevLBRound || prevLBMatches.some((m) => m.result === "pending")) {
        firstInvalidRoundNumber = lbRound.roundNumber;
        break;
      }
    }
  }

  if (firstInvalidRoundNumber === null) return false;

  const roundsToDelete = rounds
    .filter((r) => r.roundNumber >= firstInvalidRoundNumber!)
    .map((r) => r.id);
  if (roundsToDelete.length === 0) return false;

  await db.transaction(async (tx) => {
    for (const roundId of roundsToDelete) {
      await tx
        .delete(tournamentMatches)
        .where(and(eq(tournamentMatches.eventId, eventId), eq(tournamentMatches.roundId, roundId)));
      await tx
        .delete(tournamentRounds)
        .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, roundId)));
    }
  });

  await invalidateTournamentBundle(eventId);
  await refreshDERoundStatuses(eventId);
  return true;
}

async function rollbackPlayoffRoundsAfter(eventId: number, fromRoundId: number) {
  const allRounds = await db
    .select({ id: tournamentRounds.id, roundNumber: tournamentRounds.roundNumber })
    .from(tournamentRounds)
    .where(eq(tournamentRounds.eventId, eventId));

  const fromRound = allRounds.find((r) => r.id === fromRoundId);
  if (!fromRound) return;

  const roundsToDelete = allRounds.filter((r) => r.roundNumber > fromRound.roundNumber);
  if (roundsToDelete.length === 0) return;

  await db.transaction(async (tx) => {
    for (const r of roundsToDelete) {
      await tx
        .delete(tournamentMatches)
        .where(and(eq(tournamentMatches.eventId, eventId), eq(tournamentMatches.roundId, r.id)));
      await tx
        .delete(tournamentRounds)
        .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, r.id)));
    }
  });

  await invalidateTournamentBundle(eventId);
}

async function saveTournamentMatchScore(
  event: TournamentEventRecord,
  round: TournamentRoundRecord,
  match: TournamentMatchRecord,
  scoreA: number,
  scoreB: number
) {
  if (event.status === "completed") {
    return { error: "Event is completed. Match results can no longer be edited." } as const;
  }

  const eventMode = getTournamentEventMode(event);
  if (!match.teamAId || !match.teamBId) {
    return { error: "Match is not ready." } as const;
  }
  const matchBestOf = getTournamentRoundBestOf(
    event,
    round.roundNumber,
    match.pairingOrder,
    round.stage,
    match.matchBestOf
  );
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

  if (getTournamentPlayoffFormat(event) === "double_elimination") {
    await refreshDERoundStatuses(event.id);
  } else {
    await refreshTournamentRoundStatus(event.id, match.roundId);
  }

  return { result: resolved.result } as const;
}

async function saveMatchGameScore(
  event: TournamentEventRecord,
  round: TournamentRoundRecord,
  match: TournamentMatchRecord,
  side: "a" | "b"
) {
  if (event.status === "completed") {
    return { error: "Event sudah selesai." } as const;
  }
  if (!match.teamAId || !match.teamBId) {
    return { error: "Match is not ready." } as const;
  }
  const eventMode = getTournamentEventMode(event);
  const matchBestOf = getTournamentRoundBestOf(event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf);
  const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
  const curA = match.scoreA ?? 0;
  const curB = match.scoreB ?? 0;
  if (!match.teamAId || !match.teamBId) {
    return { error: "Match is not ready." } as const;
  }
  if (curA >= requiredWins || curB >= requiredWins) {
    return { error: "Pertandingan sudah selesai. Reset dulu jika ingin mengubah." } as const;
  }
  const newA = side === "a" ? curA + 1 : curA;
  const newB = side === "b" ? curB + 1 : curB;
  const isComplete = newA >= requiredWins || newB >= requiredWins;
  const result = !isComplete ? "pending" as const : newA > newB ? "team_a_win" as const : "team_b_win" as const;
  const winnerTeamId = result === "team_a_win" ? match.teamAId : result === "team_b_win" ? (match.teamBId ?? null) : null;
  await db
    .update(tournamentMatches)
    .set({ scoreA: newA, scoreB: newB, result, winnerTeamId, updatedAt: new Date() })
    .where(and(eq(tournamentMatches.eventId, event.id), eq(tournamentMatches.id, match.id)));
  if (getTournamentPlayoffFormat(event) === "double_elimination") {
    await refreshDERoundStatuses(event.id);
  } else {
    await refreshTournamentRoundStatus(event.id, match.roundId);
  }
  return { result, scoreA: newA, scoreB: newB, isComplete } as const;
}

async function undoMatchGameScore(
  event: TournamentEventRecord,
  round: TournamentRoundRecord,
  match: TournamentMatchRecord,
  side: "a" | "b"
) {
  if (event.status === "completed") {
    return { error: "Event sudah selesai." } as const;
  }
  const curA = match.scoreA ?? 0;
  const curB = match.scoreB ?? 0;
  const newA = side === "a" ? Math.max(0, curA - 1) : curA;
  const newB = side === "b" ? Math.max(0, curB - 1) : curB;
  if (newA === curA && newB === curB) {
    return { error: "Tidak ada game yang bisa di-undo." } as const;
  }
  const eventMode = getTournamentEventMode(event);
  const matchBestOf = getTournamentRoundBestOf(event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf);
  const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
  const result = newA >= requiredWins ? "team_a_win" as const : newB >= requiredWins ? "team_b_win" as const : "pending" as const;
  const winnerTeamId = result === "team_a_win" ? match.teamAId : result === "team_b_win" ? (match.teamBId ?? null) : null;
  await db
    .update(tournamentMatches)
    .set({ scoreA: newA, scoreB: newB, result, winnerTeamId, updatedAt: new Date() })
    .where(and(eq(tournamentMatches.eventId, event.id), eq(tournamentMatches.id, match.id)));
  if (getTournamentPlayoffFormat(event) === "double_elimination") {
    await refreshDERoundStatuses(event.id);
  } else {
    await refreshTournamentRoundStatus(event.id, match.roundId);
  }
  return { scoreA: newA, scoreB: newB } as const;
}

async function notifySwissStageThreshold(
  chatId: number | string,
  eventId: number,
  winnerTeamId: number | null,
  loserTeamId: number | null
) {
  if (!winnerTeamId && !loserTeamId) return;
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle || getTournamentRegularSeasonFormat(bundle.event) !== "swiss_stage") return;
  const standings = buildTournamentStandingRows(bundle.teams, bundle.matches);
  const winThreshold = getSwissWinThreshold(bundle.event.totalTeams);
  const notifications: string[] = [];
  if (winnerTeamId) {
    const row = standings.find((r) => r.teamId === winnerTeamId);
    if (row && row.win === winThreshold) {
      notifications.push(`🏆 ${row.teamName} qualified for knockout! (${row.win}W-${row.lose}L)`);
    }
  }
  if (loserTeamId) {
    const row = standings.find((r) => r.teamId === loserTeamId);
    if (row && row.lose === winThreshold) {
      notifications.push(`❌ ${row.teamName} eliminated from Swiss Stage. (${row.win}W-${row.lose}L)`);
    }
  }
  if (notifications.length === 0) return;
  const qualified = standings.filter((r) => r.win >= winThreshold).length;
  const eliminated = standings.filter((r) => r.lose >= winThreshold).length;
  const active = standings.length - qualified - eliminated;
  notifications.push(`\nStandings: ${qualified} qualified · ${active} active · ${eliminated} eliminated`);
  await sendTelegramMessage(chatId, notifications.join("\n"));
}

async function createTournamentEventRecord(input: {
  name: string;
  eventMode: TournamentEventMode;
  regularSeasonFormat?: TournamentRegularSeasonFormat;
  playoffFormat?: TournamentPlayoffFormat;
  matchBestOf: number;
  playoffSemifinalBestOf?: number;
  playoffFinalBestOf?: number;
  playoffThirdPlaceBestOf?: number;
  swissDeciderBestOf?: number;
  playoffSeedPolicy?: TournamentPlayoffSeedPolicy;
  playoffSeedMetadata?: Record<string, unknown>;
  playoffAdvanceCount?: number;
  advanceToPlayoffs?: number;
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
    : normalizeTournamentPlayoffFormat(input.playoffFormat);
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
        playoffThirdPlaceBestOf: input.playoffThirdPlaceBestOf ?? null,
        swissDeciderBestOf: input.swissDeciderBestOf ?? null,
        playoffSeedPolicy: input.playoffSeedPolicy ?? null,
        playoffSeedMetadata: input.playoffSeedMetadata ?? null,
        playoffAdvanceCount: input.playoffAdvanceCount ?? null,
        advanceToPlayoffs: resolveTournamentAdvanceToPlayoffs(input.totalTeams, input.advanceToPlayoffs),
        totalTeams: input.totalTeams,
        totalRounds: input.totalRounds,
        eventDate,
        status: "ongoing",
        createdByTelegramUserId: input.createdByTelegramUserId,
        telegramChatId: input.telegramChatId ?? null
      })
      .returning();
    if (!event) {
      throw new Error("Failed to create tournament event.");
    }

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

    if (input.eventMode === "playoffs" && normalizedFormat === "double_elimination") {
      const topology = buildFixedDoubleEliminationTopology(teams);
      const insertedRounds: TournamentRoundRecord[] = [];
      const insertedMatches: TournamentMatchRecord[] = [];

      for (const topologyRound of topology) {
        const [round] = await tx
          .insert(tournamentRounds)
          .values({
            eventId: event.id,
            roundNumber: topologyRound.roundNumber,
            stage: topologyRound.stage,
            stageNumber: topologyRound.stageNumber,
            label: topologyRound.label,
            status: topologyRound.status
          })
          .returning();
        if (!round) throw new Error("Failed to create double elimination round.");
        insertedRounds.push(round);

        const matches = await tx
          .insert(tournamentMatches)
          .values(topologyRound.matches.map((match) => ({
            eventId: event.id,
            roundId: round.id,
            teamAId: match.teamAId,
            teamBId: match.teamBId,
            result: match.result,
            pairingOrder: match.pairingOrder,
            winnerTeamId: match.winnerTeamId,
            playoffFlow: {
              sourceA: match.sourceA,
              sourceB: match.sourceB
            }
          })))
          .returning();
        insertedMatches.push(...matches);
      }

      const matchByRef = new Map<string, TournamentMatchRecord>();
      for (const match of insertedMatches) {
        const round = insertedRounds.find((item) => item.id === match.roundId);
        if (!round) continue;
        matchByRef.set(buildDEMatchRef(round.stage, round.stageNumber, match.pairingOrder), match);
      }

      const flowByMatchId = new Map<number, Record<string, unknown>>();
      for (const match of insertedMatches) {
        flowByMatchId.set(match.id, { ...(match.playoffFlow ?? {}) });
      }
      for (const target of insertedMatches) {
        const targetFlow = (target.playoffFlow ?? {}) as { sourceA?: DEFlowSource; sourceB?: DEFlowSource };
        for (const [slot, source] of [["A", targetFlow.sourceA], ["B", targetFlow.sourceB]] as const) {
          if (!source || (source.type !== "winner" && source.type !== "loser")) continue;
          const sourceMatch = matchByRef.get(source.ref);
          if (!sourceMatch) continue;
          const sourceFlow = flowByMatchId.get(sourceMatch.id) ?? {};
          if (source.type === "winner") {
            sourceFlow.nextWinnerMatchId = String(target.id);
            sourceFlow.nextWinnerSlot = slot;
          } else {
            sourceFlow.nextLoserMatchId = String(target.id);
            sourceFlow.nextLoserSlot = slot;
          }
          flowByMatchId.set(sourceMatch.id, sourceFlow);
        }
      }

      for (const [matchId, flow] of flowByMatchId.entries()) {
        await tx
          .update(tournamentMatches)
          .set({ playoffFlow: flow })
          .where(and(eq(tournamentMatches.eventId, event.id), eq(tournamentMatches.id, matchId)));
      }

      return {
        event,
        teams,
        round: insertedRounds[0] ?? null,
        matches: insertedMatches
      };
    }

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
    if (!round) {
      throw new Error("Failed to create tournament round.");
    }

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

async function createUpcomingTournamentEventRecord(input: {
  name: string;
  eventDate: string | Date;
  adminWhatsapp: string;
  eventBannerImageUrl?: string | null;
  createdByTelegramUserId: string;
  telegramChatId?: string;
}) {
  const eventDate = input.eventDate instanceof Date ? input.eventDate : new Date(input.eventDate);
  const eventCode = await createUniqueTournamentEventCode();
  const [event] = await db
    .insert(tournamentEvents)
    .values({
      code: eventCode,
      name: input.name,
      format: "single_elimination",
      eventMode: "playoffs",
      matchBestOf: 3,
      playoffSemifinalBestOf: 3,
      playoffFinalBestOf: 5,
      playoffThirdPlaceBestOf: null,
      swissDeciderBestOf: null,
      playoffSeedPolicy: null,
      playoffSeedMetadata: null,
      advanceToPlayoffs: 0,
      totalTeams: 0,
      totalRounds: 0,
      eventDate,
      status: "upcoming",
      createdByTelegramUserId: input.createdByTelegramUserId,
      telegramChatId: input.telegramChatId ?? null,
      adminWhatsapp: input.adminWhatsapp,
      eventBannerImageUrl: input.eventBannerImageUrl ?? null
    })
    .returning();
  return { event };
}

const TELEGRAM_SESSION_TTL_MS = 15 * 60_000;
type TelegramSessionStep =
  | "AWAITING_SWISS_TEAM_COUNT"
  | "AWAITING_UPCOMING_EVENT_NAME"
  | "AWAITING_UPCOMING_EVENT_DATE"
  | "AWAITING_UPCOMING_EVENT_ADMIN_CONTACT"
  | "AWAITING_UPCOMING_EVENT_BANNER"
  | "AWAITING_EVENT_NAME"
  | "AWAITING_EVENT_DATE"
  | "AWAITING_EVENT_MODE"
  | "AWAITING_REGULAR_SEASON_FORMAT"
  | "AWAITING_PLAYOFF_FORMAT"
  | "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS"
  | "AWAITING_MATCH_BEST_OF"
  | "AWAITING_MATCH_BEST_OF_CUSTOM"
  | "AWAITING_SWISS_DECIDER_BEST_OF"
  | "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF"
  | "AWAITING_PLAYOFF_FINAL_BEST_OF"
  | "AWAITING_PLAYOFF_THIRD_PLACE_DECISION"
  | "AWAITING_PLAYOFF_THIRD_PLACE_BEST_OF"
  | "AWAITING_TOTAL_TEAMS"
  | "AWAITING_ADVANCE_TO_PLAYOFFS"
  | "AWAITING_TEAM_NAMES"
  | "AWAITING_TEAM_NAMES_REVIEW"
  | "AWAITING_CONFIRMATION"
  | "AWAITING_CONTACT_PERSON_DECISION"
  | "AWAITING_CONTACT_TEAM_SELECTION"
  | "AWAITING_CONTACT_PHONE"
  | "AWAITING_VIEW_EVENT_SELECTION"
  | "AWAITING_TOTAL_PARTICIPANTS"
  | "AWAITING_TOTAL_PARTICIPANTS_CUSTOM"
  | "AWAITING_EVENT_TYPE"
  | "AWAITING_REGULAR_ROUNDS"
  | "AWAITING_REGULAR_ROUNDS_CUSTOM"
  | "AWAITING_PLAYOFF_STANDINGS"
  | "AWAITING_PLAYOFF_ADVANCE_COUNT"
  | "AWAITING_REGULAR_SEASON_SOURCE"
  | "AWAITING_REGULAR_SEASON_EVENT_SELECTION"
  | "AWAITING_RS_TOP_N"
  | "AWAITING_RS_TOP_N_CUSTOM"
  | "AWAITING_REGULAR_SEASON_SEED_PREVIEW"
  | "AWAITING_WHATSAPP_NUMBERS"
  | "AWAITING_RENAME_TEAM_SELECTION"
  | "AWAITING_RENAME_TEAM_NEW_NAME"
  | "AWAITING_GF_TEAM_A_LOGO"
  | "AWAITING_GF_TEAM_B_LOGO"
  | "AWAITING_GF_YOUTUBE_URL";

type TelegramSessionPayload = {
  upcomingEventName?: string;
  upcomingEventDate?: string;
  upcomingAdminWhatsapp?: string;
  upcomingBannerImageUrl?: string | null;
  eventName?: string;
  eventMode?: TournamentEventMode;
  regularSeasonFormat?: TournamentRegularSeasonFormat;
  playoffFormat?: TournamentPlayoffFormat;
  regularSeasonCustomRounds?: number;
  matchBestOf?: number;
  swissDeciderBestOf?: number;
  playoffSemifinalBestOf?: number;
  playoffFinalBestOf?: number;
  playoffThirdPlaceBestOf?: number;
  advanceToPlayoffs?: number;
  totalTeams?: number;
  totalRounds?: number;
  eventDate?: string;
  teamNames?: string[];
  createdEventId?: number;
  selectedContactTeamId?: number;
  selectedRenameTeamId?: number;
  eventOptions?: Array<{ id: number; code: string; name: string }>;
  teamWhatsappNumbers?: string[];
  suggestedRounds?: number;
  playoffStandings?: number;
  playoffAdvanceCount?: number;
  playoffSeedPolicy?: TournamentPlayoffSeedPolicy;
  playoffSeedMetadata?: Record<string, unknown>;
  regularSeasonEventOptions?: Array<{ id: number; code: string; name: string; totalTeams: number; advanceToPlayoffs: number }>;
  regularSeasonSourceEventIds?: number[];
  rsTopN?: number;
  rsTopNMax?: number;
  rsTopNDefault?: number;
  grandFinalEventId?: number;
  grandFinalTeamALogoUrl?: string | null;
  grandFinalTeamBLogoUrl?: string | null;
  grandFinalYoutubeUrl?: string | null;
};

type TournamentRoundPairing = {
  stage?: string;
  stageNumber?: number;
  label?: string | null;
  teamAId: number | null;
  teamBId: number | null;
  matchBestOf?: number | null;
  result: "pending" | "bye";
  pairingOrder: number;
  winnerTeamId: number | null;
  playoffFlow?: Record<string, unknown> | null;
};

type RegularSeasonGroupStanding = {
  sourceEventId: number;
  sourceEventName: string;
  sourceFormat: TournamentRegularSeasonFormat;
  sourceTotalRounds: number;
  sourceMatchBestOf: number;
  teams: string[];
};

type RegularSeasonPlayoffSeedEntry = {
  teamName: string;
  sourceEventId: number;
  sourceEventName: string;
  rank: number;
};

type RegularSeasonSeedBuildResult = {
  entries: RegularSeasonPlayoffSeedEntry[];
  initialConflictCount: number;
  finalConflictCount: number;
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
    caption?: string;
    photo?: Array<{
      file_id?: string;
      file_unique_id?: string;
      width?: number;
      height?: number;
      file_size?: number;
    }>;
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

function getBotUsername() {
  return (process.env.TELEGRAM_BOT_USERNAME ?? "").trim();
}

async function registerBotCommands() {
  const token = getTelegramBotToken();
  if (!token) return;
  await telegramApi("setMyCommands", {
    commands: [
      { command: "create_new_event", description: "Buat event tournament baru" },
      { command: "create_upcoming_event", description: "Buat event upcoming singkat" },
      { command: "view_event", description: "Lihat dan kelola event" },
      { command: "cancel", description: "Batalkan sesi aktif" },
      { command: "help", description: "Bantuan dan daftar perintah" }
    ]
  });
}

function getTelegramWebhookSecret() {
  return (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
}

function getTournamentWebBaseUrl() {
  return (process.env.WEB_APP_BASE_URL ?? process.env.PUBLIC_WEB_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function getDigiflazzTransactionPayload() {
  const username = (process.env.DIGIFLAZZ_USERNAME ?? "").trim();
  const buyerSkuCode = (process.env.DIGIFLAZZ_TEST_BUYER_SKU_CODE ?? "").trim();
  const customerNo = (process.env.DIGIFLAZZ_TEST_CUSTOMER_NO ?? "").trim();
  const refId = (process.env.DIGIFLAZZ_TEST_REF_ID ?? "").trim();
  const sign = (process.env.DIGIFLAZZ_TEST_SIGN ?? "").trim();

  const missing: string[] = [];
  if (!username) missing.push("DIGIFLAZZ_USERNAME");
  if (!buyerSkuCode) missing.push("DIGIFLAZZ_TEST_BUYER_SKU_CODE");
  if (!customerNo) missing.push("DIGIFLAZZ_TEST_CUSTOMER_NO");
  if (!refId) missing.push("DIGIFLAZZ_TEST_REF_ID");
  if (!sign) missing.push("DIGIFLAZZ_TEST_SIGN");

  return {
    missing,
    body: {
      username,
      buyer_sku_code: buyerSkuCode,
      customer_no: customerNo,
      ref_id: refId,
      sign
    }
  };
}

const TELEGRAM_EVENT_BANNER_FILE_PREFIX = "telegram-file:";

function getPublicTournamentEventBannerUrl(eventId: number) {
  const webBaseUrl = getTournamentWebBaseUrl();
  if (!webBaseUrl) return null;
  return `${webBaseUrl}/api/events/${eventId}/banner`;
}

function toTelegramBannerFileRef(filePath: string) {
  const normalized = filePath.trim().replace(/^\/+/, "");
  if (!normalized) return null;
  return `${TELEGRAM_EVENT_BANNER_FILE_PREFIX}${normalized}`;
}

function parseTelegramBannerFileRef(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw.startsWith(TELEGRAM_EVENT_BANNER_FILE_PREFIX)) return null;
  const filePath = raw.slice(TELEGRAM_EVENT_BANNER_FILE_PREFIX.length).trim();
  return filePath ? filePath : null;
}

function resolveTournamentEventBannerImageUrl(event: TournamentEventRecord) {
  const raw = (event.eventBannerImageUrl ?? "").trim();
  if (!raw) return null;
  const telegramFilePath = parseTelegramBannerFileRef(raw);
  if (!telegramFilePath) return raw;
  return getPublicTournamentEventBannerUrl(event.id);
}

function toTournamentEventSlug(name: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return base || "event";
}

function buildTournamentEventWebUrl(event: Pick<TournamentEventRecord, "name">) {
  const webBaseUrl = getTournamentWebBaseUrl();
  if (!webBaseUrl) return null;

  return `${webBaseUrl}/tournaments/${toTournamentEventSlug(event.name)}`;
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

function normalizeImageUrlInput(text: string) {
  const value = text.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function pickLargestTelegramPhoto(
  photos: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }> | undefined
) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return photos
    .filter((photo) => Boolean(photo.file_id))
    .sort((left, right) => {
      const leftSize = left.file_size ?? ((left.width ?? 0) * (left.height ?? 0));
      const rightSize = right.file_size ?? ((right.width ?? 0) * (right.height ?? 0));
      return rightSize - leftSize;
    })[0] ?? null;
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
  if (normalized === "swiss_stage" || normalized === "swiss") return "swiss_stage" as const;
  return null;
}

function normalizePlayoffFormatInput(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "single_elimination"
    || normalized === "single"
    || normalized === "knockout_single_elimination"
  ) {
    return "single_elimination" as const;
  }
  if (
    normalized === "double_elimination"
    || normalized === "double"
    || normalized === "knockout_double_elimination"
  ) {
    return "double_elimination" as const;
  }
  if (normalized === "swiss_stage" || normalized === "swiss") {
    return "swiss_stage" as const;
  }
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

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

function hasEmoji(text: string): boolean {
  return EMOJI_REGEX.test(text);
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

function wizardPhaseHeader(phase: 1 | 2 | 3 | 4, stepLabel: string): string {
  const dots = (["●", "●", "●", "●"] as const).map((_, i) => i < phase ? "●" : "○").join(" ");
  const phaseNames = ["Setup", "Format", "Tim", "Final"] as const;
  return `🎮 Buat Event  ${dots}\nTahap ${phase}/4 — ${phaseNames[phase - 1]}: ${stepLabel}`;
}

function upcomingWizardPhaseHeader(phase: 1 | 2 | 3 | 4, stepLabel: string) {
  const dots = (["●", "●", "●", "●"] as const).map((_, i) => i < phase ? "●" : "○").join(" ");
  const phaseNames = ["Info", "Jadwal", "Kontak", "Banner"] as const;
  return `🎮 Buat Upcoming Event  ${dots}\nTahap ${phase}/4 — ${phaseNames[phase - 1]}: ${stepLabel}`;
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

function buildPlayoffFormatKeyboard() {
  return [
    [{ text: "Knockout Single Elimination", callback_data: "create_playoff_format:single_elimination" }],
    [{ text: "Knockout Double Elimination", callback_data: "create_playoff_format:double_elimination" }]
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
    ],
    [{ text: "Swiss Stage", callback_data: "create_regular_format:swiss_stage" }]
  ];
}

function buildRegularSeasonMatchBestOfKeyboard() {
  return [
    [
      { text: "BO1", callback_data: "create_match_best_of:1" },
      { text: "BO2", callback_data: "create_match_best_of:2" },
      { text: "BO3", callback_data: "create_match_best_of:3" }
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

function buildSwissFinalBestOfKeyboard() {
  return [
    [
      { text: "BO3", callback_data: "create_swiss_final_best_of:3" },
      { text: "BO5", callback_data: "create_swiss_final_best_of:5" }
    ]
  ];
}

function buildSwissDeciderBestOfKeyboard() {
  return [
    [
      { text: "BO1 (Default)", callback_data: "create_swiss_decider_best_of:1" },
      { text: "BO3", callback_data: "create_swiss_decider_best_of:3" }
    ]
  ];
}

async function sendCreateEventSwissDeciderBestOfPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Swiss Decider BO")}\nPilih Best Of untuk decider match Swiss Stage (BO1 atau BO3).`,
    { inlineKeyboard: buildSwissDeciderBestOfKeyboard() }
  );
}

function buildPlayoffThirdPlaceDecisionKeyboard() {
  return [
    [
      { text: "Pakai 3rd Place Match", callback_data: "create_playoff_third_place:yes" }
    ],
    [
      { text: "Tanpa 3rd Place Match", callback_data: "create_playoff_third_place:no" }
    ]
  ];
}

function buildPlayoffThirdPlaceBestOfKeyboard() {
  return [
    [
      { text: "BO1", callback_data: "create_playoff_third_place_best_of:1" },
      { text: "BO3", callback_data: "create_playoff_third_place_best_of:3" }
    ],
    [
      { text: "BO5", callback_data: "create_playoff_third_place_best_of:5" }
    ]
  ];
}

function buildPlayoffStandingsKeyboard() {
  return [
    [{ text: "Juara 1 aja", callback_data: "create_playoff_standings:1" }],
    [{ text: "Juara sampai 2", callback_data: "create_playoff_standings:2" }],
    [{ text: "Juara sampai 3", callback_data: "create_playoff_standings:3" }],
    [{ text: "Top Tim ke Babak Berikutnya", callback_data: "create_playoff_standings:custom" }]
  ];
}

function buildPlayoffAdvanceCountKeyboard(totalTeams: number) {
  const fixedOptions = [2, 4, 8, 16, 32];
  const options = totalTeams > 0
    ? fixedOptions.filter(n => n < totalTeams)
    : fixedOptions;
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  const rowSize = 3;
  for (let i = 0; i < options.length; i += rowSize) {
    rows.push(
      options.slice(i, i + rowSize).map((n) => ({
        text: `Top ${n}`,
        callback_data: `create_playoff_advance_count:${n}`
      }))
    );
  }
  return rows;
}

function buildRegularSeasonSourceKeyboard() {
  return [
    [{ text: "✅ Iya, ambil dari Regular Season", callback_data: "create_rs_source:yes" }],
    [{ text: "➕ Buat Bracket Baru", callback_data: "create_rs_source:new" }]
  ];
}

function formatPlayoffSeedPolicyLabel(policy: TournamentPlayoffSeedPolicy) {
  if (policy === "strict_rank") return "Strict Rank";
  if (policy === "avoid_same_group") return "Avoid Same Group";
  return "Balanced";
}

function buildRegularSeasonEventSelectionKeyboard(
  events: Array<{ id: number; code: string; name: string; totalTeams: number }>,
  selectedIds: number[]
) {
  const rows = events.map((ev) => [
    {
      text: `${selectedIds.includes(ev.id) ? "✅ " : ""}${ev.name} (${ev.totalTeams} tim)`,
      callback_data: `create_rs_event_toggle:${ev.id}`
    }
  ]);
  if (selectedIds.length > 0) {
    rows.push([{ text: "✅ Konfirmasi Pilihan", callback_data: "create_rs_event_confirm" }]);
  }
  return rows;
}

function buildRegularSeasonSeedPreviewKeyboard(policy: TournamentPlayoffSeedPolicy) {
  const policies: TournamentPlayoffSeedPolicy[] = ["balanced", "strict_rank", "avoid_same_group"];
  const policyButtons = policies.map((entry) => ({
    text: `${entry === policy ? "✅ " : ""}${formatPlayoffSeedPolicyLabel(entry)}`,
    callback_data: `create_rs_seed_policy:${entry}`
  }));

  return [
    policyButtons,
    [{ text: "✅ Gunakan Seed Ini", callback_data: "create_rs_seed_apply" }],
    [{ text: "↩️ Pilih Event RS Ulang", callback_data: "create_rs_seed_back" }]
  ];
}

function buildTotalTeamsKeyboard(payload: TelegramSessionPayload) {
  const mode = payload.eventMode ?? "regular_season";
  if (payload.eventMode === "regular_season" && payload.regularSeasonFormat === "swiss_stage") {
    return [
      [
        { text: "8 Teams", callback_data: `create_total_teams:${mode}:8` },
        { text: "16 Teams", callback_data: `create_total_teams:${mode}:16` },
        { text: "32 Teams", callback_data: `create_total_teams:${mode}:32` }
      ]
    ];
  }
  if (payload.eventMode === "playoffs" && payload.playoffFormat === "single_elimination") {
    return [
      [
        { text: "4 Teams", callback_data: `create_total_teams:${mode}:4` },
        { text: "8 Teams", callback_data: `create_total_teams:${mode}:8` },
        { text: "12 Teams", callback_data: `create_total_teams:${mode}:12` }
      ],
      [
        { text: "16 Teams", callback_data: `create_total_teams:${mode}:16` },
        { text: "24 Teams", callback_data: `create_total_teams:${mode}:24` }
      ]
    ];
  }
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

function buildAdvanceToPlayoffsKeyboard(totalTeams: number) {
  const safeTotalTeams = Math.max(2, totalTeams);
  const preset = [4, 6, 8]
    .filter((value) => value <= safeTotalTeams)
    .filter((value, index, all) => all.indexOf(value) === index);
  const firstRow = [2, ...preset]
    .filter((value) => value <= safeTotalTeams)
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((value) => ({ text: `Top ${value}`, callback_data: `create_advance_to_playoffs:${value}` }));

  return [
    firstRow,
    [{ text: `Top ${safeTotalTeams}`, callback_data: `create_advance_to_playoffs:${safeTotalTeams}` }]
  ];
}

function buildParticipantsKeyboard() {
  return [
    [
      { text: "Kurang dari 16", callback_data: "create_participants:custom" },
      { text: "16 Tim", callback_data: "create_participants:16" }
    ],
    [
      { text: "32 Tim", callback_data: "create_participants:32" },
      { text: "Lebih dari 32", callback_data: "create_participants:custom" }
    ]
  ];
}

function buildEventTypeKeyboard() {
  return [
    [{ text: "Regular Season", callback_data: "create_event_type:regular_season" }],
    [{ text: "Langsung Playoffs", callback_data: "create_event_type:playoffs" }]
  ];
}

function buildRegularRoundsKeyboard() {
  return [
    [
      { text: "1 Ronde", callback_data: "create_regular_rounds:1" },
      { text: "2 Ronde", callback_data: "create_regular_rounds:2" }
    ],
    [
      { text: "3 Ronde", callback_data: "create_regular_rounds:3" },
      { text: "5 Ronde", callback_data: "create_regular_rounds:5" }
    ],
    [{ text: "Custom", callback_data: "create_regular_rounds:custom" }]
  ];
}

function buildSuggestedRegularSeasonFormatKeyboard(totalTeams: number, rounds: number) {
  type FormatButton = { text: string; callback_data: string };
  const formatLabel = (fmt: string): string => {
    const labels: Record<string, string> = {
      round_robin: "Round Robin",
      double_round_robin: "Double Round Robin",
      five_round: "Round 5",
      swiss_stage: "Swiss Stage",
      custom_round: "Custom Round"
    };
    return labels[fmt] ?? fmt;
  };
  const btn = (fmt: string): FormatButton => ({
    text: formatLabel(fmt),
    callback_data: `create_regular_format:${fmt}`
  });

  let suggested: string[];
  if (totalTeams <= 16) {
    if (rounds === 1) {
      suggested = ["round_robin", "double_round_robin", "five_round", "swiss_stage", "custom_round"];
    } else if (rounds === 2) {
      suggested = ["double_round_robin", "round_robin", "five_round", "swiss_stage", "custom_round"];
    } else if (rounds === 5) {
      suggested = ["swiss_stage", "five_round", "round_robin", "double_round_robin", "custom_round"];
    } else {
      suggested = ["custom_round", "five_round", "round_robin", "double_round_robin", "swiss_stage"];
    }
  } else if (totalTeams <= 32) {
    if (rounds === 5) {
      suggested = ["swiss_stage", "five_round", "custom_round"];
    } else {
      suggested = ["five_round", "custom_round", "swiss_stage"];
    }
  } else {
    suggested = ["five_round", "custom_round"];
  }

  const topSuggested = suggested.slice(0, 4);
  const allFormats = ["round_robin", "double_round_robin", "five_round", "swiss_stage", "custom_round"];
  const showAllBtn: FormatButton = { text: "Lihat Semua Format", callback_data: "create_regular_format_show_all" };

  const rows: FormatButton[][] = topSuggested.map((fmt) => [btn(fmt)]);

  if (suggested.length > 4 || allFormats.some((f) => !topSuggested.includes(f))) {
    rows.push([showAllBtn]);
  }

  return rows;
}

async function sendCreateEventNamePrompt(chatId: number | string) {
  await sendTelegramMessage(chatId, `${wizardPhaseHeader(4, "Nama Event")}\nApa nama event kamu?`);
}

async function sendCreateEventDatePrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(4, "Tanggal")}\nKapan event ini akan diselenggarakan? Kirim tanggal dengan format DD-MM-YYYY.`
  );
}

async function sendCreateEventModePrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(1, "Mode")}\nPilih mode tournament.`,
    {
      inlineKeyboard: buildEventModeKeyboard()
    }
  );
}

async function sendCreateEventRegularSeasonFormatPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Format Regular Season")}\nPilih format untuk regular season kamu.`,
    {
      inlineKeyboard: buildRegularSeasonFormatKeyboard()
    }
  );
}

async function sendCreateEventPlayoffFormatPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Format Playoff")}\nPilih format playoffs.`,
    {
      inlineKeyboard: buildPlayoffFormatKeyboard()
    }
  );
}

async function sendCreateEventRegularSeasonCustomRoundsPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Custom Round")}\nKirim jumlah ronde custom (1 sampai 10).`
  );
}

async function sendCreateEventMatchBestOfPrompt(chatId: number | string, payload: TelegramSessionPayload) {
  const eventMode = payload.eventMode;
  const hint =
    eventMode === "playoffs"
      ? "Pilih Best Of untuk early rounds di Playoffs."
      : "Pilih Best Of untuk setiap match di Regular Season.";
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Match BO")}\n${hint}`,
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
    `${wizardPhaseHeader(2, "Semifinal BO")}\nPilih Best Of untuk semifinal.`,
    {
      inlineKeyboard: buildPlayoffSemifinalBestOfKeyboard()
    }
  );
}

async function sendCreateEventPlayoffFinalBestOfPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Final BO")}\nPilih Best Of untuk grand final.`,
    {
      inlineKeyboard: buildPlayoffFinalBestOfKeyboard()
    }
  );
}

async function sendCreateEventSwissFinalBestOfPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Grand Final BO")}\nPilih Best Of untuk Grand Final Swiss Stage (BO3 atau BO5).`,
    {
      inlineKeyboard: buildSwissFinalBestOfKeyboard()
    }
  );
}

async function sendCreateEventPlayoffThirdPlaceDecisionPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "3rd Place Match")}\nApakah playoffs ini pakai 3rd Place Match?`,
    {
      inlineKeyboard: buildPlayoffThirdPlaceDecisionKeyboard()
    }
  );
}

async function sendCreateEventPlayoffThirdPlaceBestOfPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "3rd Place BO")}\nPilih Best Of untuk match peringkat 3.`,
    {
      inlineKeyboard: buildPlayoffThirdPlaceBestOfKeyboard()
    }
  );
}

async function sendCreateEventPlayoffStandingsPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Penentuan Juara")}\n\nKamu mau menentukan posisi sampai juara ke berapa?`,
    { inlineKeyboard: buildPlayoffStandingsKeyboard() }
  );
}

async function sendCreateEventPlayoffAdvanceCountPrompt(chatId: number | string, totalTeams: number) {
  const teamsInfo = totalTeams > 0 ? ` dari ${totalTeams} peserta` : "";
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Top Tim Lolos")}\nBerapa tim yang lolos ke babak berikutnya${teamsInfo}?\n\nPilih jumlah tim yang akan advance ke event berikutnya.`,
    { inlineKeyboard: buildPlayoffAdvanceCountKeyboard(totalTeams) }
  );
}

async function sendCreateEventRegularSeasonSourcePrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(3, "Sumber Data")}\n\nKamu punya data dari Regular Season yang mau dijadikan peserta Playoffs?\n\nKalau iya, bot akan ambil standing tim dari event Regular Season kamu dan langsung atur bracket sesuai peringkat.`,
    { inlineKeyboard: buildRegularSeasonSourceKeyboard() }
  );
}

async function sendCreateEventRegularSeasonEventSelectionPrompt(
  chatId: number | string,
  events: Array<{ id: number; code: string; name: string; totalTeams: number }>,
  selectedIds: number[]
) {
  const selectedText = selectedIds.length > 0
    ? `\n\nSudah dipilih: ${selectedIds.length} event`
    : "";
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(3, "Pilih Event RS")}\n\nPilih event Regular Season (status selesai) yang mau diambil standing-nya. Kamu bisa pilih lebih dari satu event (multi-group bracket).${selectedText}`,
    { inlineKeyboard: buildRegularSeasonEventSelectionKeyboard(events, selectedIds) }
  );
}

function buildRsTopNKeyboard(maxN: number, defaultN: number): Array<Array<{ text: string; callback_data: string }>> {
  const options: number[] = [];
  for (let n = 2; n <= maxN; n += 2) {
    options.push(n);
  }
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < options.length; i += 3) {
    rows.push(
      options.slice(i, i + 3).map(n => ({
        text: n === defaultN ? `✅ Top ${n} (Default)` : `Top ${n}`,
        callback_data: `create_rs_top_n:${n}`
      }))
    );
  }
  rows.push([{ text: "✏️ Masukkan Jumlah Manual", callback_data: "create_rs_top_n:custom" }]);
  return rows;
}

async function sendCreateEventRsTopNPrompt(chatId: number | string, maxN: number, defaultN: number) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(3, "Ambil Top Tim RS")}\n\nAmbil berapa tim teratas dari Regular Season untuk masuk ke Playoffs?\n\nDefault: <b>Top ${defaultN}</b> (dari setting advance RS)\nMaksimal: ${maxN} tim`,
    { inlineKeyboard: buildRsTopNKeyboard(maxN, defaultN), parseMode: "HTML" }
  );
}

type RegularSeasonSeedPlan = {
  seeded: RegularSeasonSeedBuildResult;
  teamNames: string[];
  totalTeams: number;
  numGroups: number;
  duplicateTeams: string[];
  failedEvents: string[];
  warnings: string[];
  sourceGroups: RegularSeasonGroupStanding[];
};

function buildRegularSeasonCompatibilityWarnings(sourceGroups: RegularSeasonGroupStanding[]) {
  const warnings: string[] = [];
  if (sourceGroups.length <= 1) return warnings;

  const formatSet = new Set(sourceGroups.map(group => group.sourceFormat));
  if (formatSet.size > 1) {
    warnings.push("Format RS antar grup berbeda. Fairness lintas grup bisa tidak 100% setara.");
  }

  const totalRoundsSet = new Set(sourceGroups.map(group => group.sourceTotalRounds));
  if (totalRoundsSet.size > 1) {
    warnings.push("Jumlah round antar grup berbeda. Kekuatan rank bisa bias.");
  }

  const matchBestOfSet = new Set(sourceGroups.map(group => group.sourceMatchBestOf));
  if (matchBestOfSet.size > 1) {
    warnings.push("Match BO antar grup berbeda. Hasil rank mungkin tidak apple-to-apple.");
  }

  const groupSizes = sourceGroups.map(group => group.teams.length);
  if (Math.max(...groupSizes) !== Math.min(...groupSizes)) {
    warnings.push("Jumlah tim per grup berbeda. Sebagian seed rank bawah bisa tidak merata.");
  }

  return warnings;
}

async function buildRegularSeasonSeedPlan(
  selectedEventIds: number[],
  policy: TournamentPlayoffSeedPolicy,
  topN?: number
): Promise<RegularSeasonSeedPlan> {
  const sourceGroups: RegularSeasonGroupStanding[] = [];
  const failedEvents: string[] = [];

  for (const eventId of selectedEventIds) {
    try {
      const bundle = await loadTournamentBundle(eventId);
      if (!bundle) {
        failedEvents.push(`Event #${eventId} (tidak ditemukan)`);
        continue;
      }
      if (bundle.event.status !== "completed") {
        failedEvents.push(`${bundle.event.name} (belum selesai)`);
        continue;
      }
      if (getTournamentEventMode(bundle.event) !== "regular_season") {
        failedEvents.push(`${bundle.event.name} (bukan regular season)`);
        continue;
      }

      const standingsMatches = getTournamentStandingsMatches(bundle.event, bundle.rounds, bundle.matches);
      const standings = buildTournamentStandings(bundle.teams, standingsMatches);
      const teamNames = standings.map(row => row.teamName).filter(Boolean);

      if (teamNames.length === 0) {
        failedEvents.push(`${bundle.event.name} (standing kosong)`);
        continue;
      }

      sourceGroups.push({
        sourceEventId: bundle.event.id,
        sourceEventName: bundle.event.name,
        sourceFormat: getTournamentRegularSeasonFormat(bundle.event),
        sourceTotalRounds: bundle.event.totalRounds,
        sourceMatchBestOf: getTournamentMatchBestOf(bundle.event),
        teams: teamNames
      });
    } catch {
      failedEvents.push(`Event #${eventId}`);
    }
  }

  const seeded = buildPlayoffSeedEntriesFromRegularSeasonGroups(sourceGroups, policy);
  const allEntries = topN && topN > 0 && topN < seeded.entries.length
    ? { ...seeded, entries: seeded.entries.slice(0, topN) }
    : seeded;
  const teamNames = allEntries.entries.map(entry => entry.teamName);
  const normalizedNameMap = new Map<string, string[]>();
  for (const teamName of teamNames) {
    const key = teamName.trim().toLowerCase();
    const list = normalizedNameMap.get(key) ?? [];
    list.push(teamName);
    normalizedNameMap.set(key, list);
  }
  const duplicateTeams = Array.from(normalizedNameMap.values())
    .filter(names => names.length > 1)
    .map(names => names[0] ?? "-");

  return {
    seeded: allEntries,
    teamNames,
    totalTeams: teamNames.length,
    numGroups: sourceGroups.length,
    duplicateTeams,
    failedEvents,
    warnings: buildRegularSeasonCompatibilityWarnings(sourceGroups),
    sourceGroups
  };
}

async function sendCreateEventRegularSeasonSeedPreviewPrompt(
  chatId: number | string,
  policy: TournamentPlayoffSeedPolicy,
  plan: RegularSeasonSeedPlan
) {
  const firstRoundPairs = buildFirstRoundSeedIndexPairs(plan.seeded.entries.length);
  const previewMatches = firstRoundPairs
    .slice(0, 6)
    .map(([leftIndex, rightIndex], index) => {
      const left = plan.seeded.entries[leftIndex];
      const right = plan.seeded.entries[rightIndex];
      if (!left || !right) return `M${index + 1}: TBD`;
      return `M${index + 1}: #${leftIndex + 1} ${left.teamName} vs #${rightIndex + 1} ${right.teamName}`;
    });

  const warningLines = plan.warnings.length > 0
    ? [`⚠️ Warning kompatibilitas:`, ...plan.warnings.map(item => `- ${item}`), ""]
    : [];

  const conflictLine = `Potensi bentrok sumber yang sama di Round 1: ${plan.seeded.initialConflictCount} → ${plan.seeded.finalConflictCount}`;
  await sendTelegramMessage(
    chatId,
    [
      `${wizardPhaseHeader(3, "Preview Seeding Playoffs")}`,
      `Policy: ${formatPlayoffSeedPolicyLabel(policy)}`,
      `Sumber RS: ${plan.numGroups} grup`,
      `Total tim playoffs: ${plan.totalTeams}`,
      conflictLine,
      "",
      ...warningLines,
      "Top Seed Preview:",
      ...plan.seeded.entries.slice(0, 12).map((entry, index) => `${index + 1}. ${entry.teamName} (${entry.sourceEventName} #${entry.rank})`),
      plan.totalTeams > 12 ? `... dan ${plan.totalTeams - 12} tim lainnya` : "",
      "",
      "Simulasi Default Match Round 1:",
      ...previewMatches,
      firstRoundPairs.length > previewMatches.length ? `... dan ${firstRoundPairs.length - previewMatches.length} match lainnya` : ""
    ].filter(Boolean).join("\n"),
    {
      inlineKeyboard: buildRegularSeasonSeedPreviewKeyboard(policy)
    }
  );
}

async function proceedRsTopNConfirm(
  session: Awaited<ReturnType<typeof loadTelegramSession>>,
  payload: TelegramSessionPayload,
  topN: number,
  chatId: number | string,
  telegramUserId: string
) {
  if (!session) return;
  const selectedEventIds = payload.regularSeasonSourceEventIds ?? [];
  const policy = payload.playoffSeedPolicy ?? "balanced";

  const plan = await buildRegularSeasonSeedPlan(selectedEventIds, policy, topN);
  if (plan.failedEvents.length > 0 || plan.numGroups === 0 || plan.totalTeams === 0) {
    await sendTelegramMessage(chatId, "Gagal memuat data dari event yang dipilih. Coba lagi ya.");
    return;
  }
  if (plan.duplicateTeams.length > 0) {
    await sendTelegramMessage(
      chatId,
      `❌ Ada nama tim duplikat antar grup RS: ${plan.duplicateTeams.slice(0, 6).join(", ")}${plan.duplicateTeams.length > 6 ? "..." : ""}\n\nUbah nama tim agar unik dulu sebelum dijadikan peserta Playoffs.`
    );
    return;
  }

  const totalRounds = calculateTournamentTotalRounds("playoffs", plan.totalTeams, undefined, undefined, payload.playoffFormat, payload.playoffAdvanceCount);
  const nextPayload: TelegramSessionPayload = {
    ...payload,
    rsTopN: topN,
    playoffSeedPolicy: policy,
    teamNames: plan.teamNames,
    totalTeams: plan.totalTeams,
    totalRounds,
    playoffSeedMetadata: {
      source: "regular_season",
      seedingPolicy: policy,
      rsTopN: topN,
      sources: plan.sourceGroups.map(group => ({
        eventId: group.sourceEventId,
        eventName: group.sourceEventName,
        format: group.sourceFormat,
        totalRounds: group.sourceTotalRounds,
        matchBestOf: group.sourceMatchBestOf,
        totalTeams: group.teams.length
      })),
      entries: plan.seeded.entries.map((entry, index) => ({
        seed: index + 1,
        teamName: entry.teamName,
        sourceEventId: entry.sourceEventId,
        sourceEventName: entry.sourceEventName,
        sourceRank: entry.rank
      })),
      diagnostics: {
        firstRoundSameSourceConflictsBefore: plan.seeded.initialConflictCount,
        firstRoundSameSourceConflictsAfter: plan.seeded.finalConflictCount,
        warnings: plan.warnings
      }
    }
  };
  await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SEED_PREVIEW", nextPayload);
  await sendCreateEventRegularSeasonSeedPreviewPrompt(chatId, policy, plan);
}

function buildCreateEventConfigLines(payload: TelegramSessionPayload) {
  const lines = [`Mode: ${formatTelegramEventModeLabel(payload.eventMode)}`];
  if (payload.eventMode === "regular_season") {
    const advanceToPlayoffs = resolveTournamentAdvanceToPlayoffs(
      payload.totalTeams ?? TOURNAMENT_DEFAULT_ADVANCE_TO_PLAYOFFS,
      payload.advanceToPlayoffs
    );
    lines.push(`Format: ${formatTelegramRegularSeasonFormatLabel(payload.regularSeasonFormat)}`);
    lines.push(`Match Best Of: BO${payload.matchBestOf ?? 2}`);
    if (payload.regularSeasonFormat === "swiss_stage") {
      lines.push(`Decider Match: BO${payload.swissDeciderBestOf ?? 1}`);
    }
    if (payload.regularSeasonFormat === "custom_round") {
      lines.push(`Custom Rounds: ${payload.regularSeasonCustomRounds ?? "-"}`);
    }
    lines.push(`Playoffs: Top ${advanceToPlayoffs} tim lolos ke playoffs`);
    return lines;
  }

  lines.push(`Format: ${formatTournamentPlayoffFormatLabel(payload.playoffFormat)}`);
  if (payload.playoffAdvanceCount !== undefined && payload.playoffAdvanceCount >= 4) {
    lines.push(`Early Rounds BO: BO${payload.matchBestOf ?? 1}`);
    lines.push(`Top Tim Lolos: Top ${payload.playoffAdvanceCount} tim ke babak berikutnya`);
  } else {
    lines.push(`Early Rounds BO: BO${payload.matchBestOf ?? 1}`);
    lines.push(`Semifinal BO: BO${payload.playoffSemifinalBestOf ?? "-"}`);
    lines.push(`Final BO: BO${payload.playoffFinalBestOf ?? "-"}`);
    lines.push(`3rd Place BO: ${payload.playoffThirdPlaceBestOf ? `BO${payload.playoffThirdPlaceBestOf}` : "Off"}`);
    lines.push(`Penentuan Juara: Juara sampai ${payload.playoffStandings ?? 1}`);
  }
  if (payload.playoffSeedMetadata?.source === "regular_season") {
    lines.push(`Seeding Source: Regular Season`);
    if (payload.rsTopN) lines.push(`Ambil Tim RS: Top ${payload.rsTopN} tim teratas`);
    lines.push(`Seeding Policy: ${formatPlayoffSeedPolicyLabel(payload.playoffSeedPolicy ?? "balanced")}`);
  }
  return lines;
}

async function sendCreateEventAdvanceToPlayoffsPrompt(
  chatId: number | string,
  payload: TelegramSessionPayload
) {
  const totalTeams = payload.totalTeams ?? 0;
  const defaultAdvance = Math.min(TOURNAMENT_DEFAULT_ADVANCE_TO_PLAYOFFS, Math.max(2, totalTeams));
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(3, "Lolos ke Playoffs")}\nPilih berapa tim yang lolos ke playoffs dari ${totalTeams} peserta. Default Top ${defaultAdvance}.`,
    {
      inlineKeyboard: buildAdvanceToPlayoffsKeyboard(totalTeams)
    }
  );
}

async function sendParticipantsPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(1, "Jumlah Partisipan")}\nBerapa jumlah partisipan di event kamu?`,
    { inlineKeyboard: buildParticipantsKeyboard() }
  );
}

async function sendEventTypePrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(1, "Tipe Event")}\nMau seleksi team di regular season dulu, atau langsung playoffs?`,
    { inlineKeyboard: buildEventTypeKeyboard() }
  );
}

async function sendRegularRoundsPrompt(chatId: number | string) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Referensi Ronde")}\nBerapa kira-kira jumlah ronde yang diinginkan? Ini digunakan untuk merekomendasikan format yang tepat.`,
    { inlineKeyboard: buildRegularRoundsKeyboard() }
  );
}

async function sendSuggestedRegularSeasonFormatPrompt(chatId: number | string, totalTeams: number, rounds: number) {
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(2, "Format Regular Season")}\nBerikut format yang disarankan untuk ${totalTeams} tim dengan ${rounds} ronde:`,
    { inlineKeyboard: buildSuggestedRegularSeasonFormatKeyboard(totalTeams, rounds) }
  );
}

async function sendWhatsappNumbersPrompt(chatId: number | string, teamNames: string[]) {
  const teamList = teamNames.map((name, i) => `${i + 1}. ${name}`).join("\n");
  await sendTelegramMessage(
    chatId,
    [
      wizardPhaseHeader(4, "Nomor WhatsApp (Opsional)"),
      "Masukkan nomor WhatsApp untuk setiap tim.",
      "Ketik satu per baris dengan format:",
      "NamaTim: 0812xxxxxxxx",
      "",
      "Atau ketik nomor saja satu per baris (urutan sesuai daftar tim).",
      "",
      "Daftar tim:",
      teamList,
      "",
      'Ketik "skip" untuk lewati langkah ini.'
    ].join("\n"),
    {
      inlineKeyboard: [
        [{ text: "Lewati", callback_data: "create_whatsapp_skip" }]
      ]
    }
  );
}

async function sendCreateEventTeamsPrompt(
  chatId: number | string,
  payload: TelegramSessionPayload
) {
  const teamHint =
    payload.eventMode === "playoffs"
      ? "Pilih jumlah tim dari tombol atau kirim angka manual."
      : payload.regularSeasonFormat === "swiss_stage"
        ? `Swiss Stage mendukung ${TOURNAMENT_SWISS_VALID_TEAM_COUNTS.join(", ")} tim.`
        : "Pilih jumlah tim dari tombol atau kirim angka genap secara manual.";
  await sendTelegramMessage(
    chatId,
    `${wizardPhaseHeader(3, "Jumlah Tim")}\n${teamHint}`,
    {
      inlineKeyboard: buildTotalTeamsKeyboard(payload)
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
      wizardPhaseHeader(3, "Nama Tim"),
      ...buildCreateEventConfigLines(payload),
      `Kirim ${totalTeams} nama tim. Satu nama per baris atau pisahkan dengan koma.`,
      "",
      "Contoh:",
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
      wizardPhaseHeader(3, "Review Tim"),
      ...buildCreateEventConfigLines(payload),
      `Kamu memasukkan ${payload.teamNames?.length ?? 0} tim:`,
      ...(payload.teamNames ?? []).map((name, index) => `${index + 1}. ${name}`),
      "",
      "Klik Oke Lanjut untuk melanjutkan atau Masukkan Ulang untuk kirim ulang daftar tim."
    ].join("\n"),
    {
      inlineKeyboard: [
        [{ text: "Oke Lanjut", callback_data: "create_team_names_confirm" }],
        [{ text: "Masukkan Ulang", callback_data: "create_team_names_retry" }]
      ]
    }
  );
}

function buildCreateEventEditMenuKeyboard(payload: TelegramSessionPayload): Array<Array<{ text: string; callback_data: string }>> {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: "Edit Nama", callback_data: "create_edit:event_name" },
      { text: "Edit Tanggal", callback_data: "create_edit:event_date" }
    ],
    [{ text: "Edit Mode", callback_data: "create_edit:event_mode" }],
    [{ text: "Edit Match BO", callback_data: "create_edit:match_best_of" }],
    [{ text: "Edit Jumlah Tim", callback_data: "create_edit:total_teams" }],
    [{ text: "Edit Nama Tim", callback_data: "create_edit:team_names" }]
  ];

  if (payload.eventMode === "regular_season") {
    keyboard.splice(2, 0, [{ text: "Edit Format", callback_data: "create_edit:regular_format" }]);
    keyboard.splice(4, 0, [{ text: "Edit Advance Playoffs", callback_data: "create_edit:advance_to_playoffs" }]);
  } else {
    keyboard.splice(2, 0, [{ text: "Edit Format", callback_data: "create_edit:playoff_format" }]);
    if (payload.playoffFormat !== "double_elimination" && payload.playoffFormat !== "swiss_stage") {
      keyboard.splice(4, 0, [{ text: "Edit 3rd Place Match", callback_data: "create_edit:third_place" }]);
    }
  }

  keyboard.push([{ text: "« Kembali ke Konfirmasi", callback_data: "create_back_to_confirm" }]);
  return keyboard;
}

async function sendCreateEventEditMenu(chatId: number | string, payload: TelegramSessionPayload) {
  await sendTelegramMessage(
    chatId,
    "✏️ Pilih bagian yang ingin diedit:",
    { inlineKeyboard: buildCreateEventEditMenuKeyboard(payload) }
  );
}

async function sendCreateEventConfirmation(chatId: number | string, payload: TelegramSessionPayload) {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "✅ Konfirmasi", callback_data: "create_confirm" }],
    [{ text: "✏️ Edit", callback_data: "create_edit_menu" }],
    [{ text: "Batal", callback_data: "create_cancel" }]
  ];

  await sendTelegramMessage(
    chatId,
    [
      `${wizardPhaseHeader(4, "Konfirmasi")} ✅`,
      `Nama: ${payload.eventName ?? "-"}`,
      ...buildCreateEventConfigLines(payload),
      `Tim: ${payload.totalTeams ?? "-"}`,
      `Ronde: ${payload.totalRounds ?? "-"}`,
      `Tanggal: ${payload.eventDate ? formatTournamentDate(payload.eventDate) : "-"}`,
      "Daftar tim:",
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
      `Event ${event.name} sudah siap! 🎉`,
      "Mau tambahkan kontak WhatsApp kapten sekarang?",
      "Langkah ini opsional dan bisa dilewati."
    ].join("\n"),
    {
      inlineKeyboard: [
        [{ text: "Tambah Kontak Kapten", callback_data: `create_contact_start:${event.id}` }],
        [{ text: "Lewati", callback_data: `create_contact_skip:${event.id}` }]
      ]
    }
  );
}

async function sendCreateEventContactMenu(chatId: number | string, eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event tidak ditemukan.");
    return;
  }

  const completedContacts = countTeamsWithCaptainWhatsapp(bundle.teams);
  const keyboard = bundle.teams.map((team) => ([
    { text: buildCreateContactTeamLabel(team), callback_data: `create_contact_team:${bundle.event.id}:${team.id}` }
  ]));
  keyboard.push([{ text: "Selesai", callback_data: `create_contact_done:${bundle.event.id}` }]);

  await sendTelegramMessage(
    chatId,
    [
      `${bundle.event.name} - Kontak Kapten`,
      `Tersimpan: ${completedContacts}/${bundle.teams.length}`,
      "Pilih tim untuk tambah atau update kontak WhatsApp kapten.",
      "Atau paste data bulk dengan format: Nama Tim - 628xxxx atau Nama Tim - 08xxxx.",
      "Ketik selesai kapan saja untuk selesai."
    ].join("\n"),
    {
      inlineKeyboard: keyboard
    }
  );
}

async function sendTeamRenameMenu(chatId: number | string, eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event tidak ditemukan.");
    return;
  }
  const keyboard = bundle.teams.map((team) => ([
    { text: team.name, callback_data: `team_rename:${bundle.event.id}:${team.id}` }
  ]));
  keyboard.push([{ text: "Selesai", callback_data: `event_manage:${bundle.event.id}` }]);
  await sendTelegramMessage(
    chatId,
    [
      `✏️ *Ganti Nama Tim — ${bundle.event.name}*`,
      "Pilih tim yang ingin kamu ganti namanya."
    ].join("\n"),
    { inlineKeyboard: keyboard }
  );
}

async function sendCreateEventContactPhonePrompt(chatId: number | string, eventId: number, teamId: number) {
  const team = await loadTournamentTeamById(teamId);
  if (!team || team.eventId !== eventId) {
    await sendTelegramMessage(chatId, "Tim tidak ditemukan.");
    return;
  }

  await sendTelegramMessage(
    chatId,
    [
      `Kirim nomor WhatsApp kapten untuk ${team.name}.`,
      "Gunakan format nomor dengan kode negara, hanya angka.",
      "Contoh format: 6281234567890"
    ].join("\n"),
    {
      inlineKeyboard: [[{ text: "Kembali ke Menu Kontak", callback_data: `create_contact_back:${eventId}` }]]
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

  if (!payload.playoffFormat) return false;
  const isAdvanceCountMode = payload.playoffAdvanceCount !== undefined && payload.playoffAdvanceCount >= 4;
  if (!isAdvanceCountMode && (!payload.playoffSemifinalBestOf || !payload.playoffFinalBestOf)) return false;
  if (payload.playoffStandings === 3 && !payload.playoffThirdPlaceBestOf) return false;
  return true;
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
    playoffFormat: payload.playoffFormat,
    regularSeasonCustomRounds: payload.regularSeasonCustomRounds,
    matchBestOf: payload.matchBestOf ?? 2,
    playoffSemifinalBestOf: payload.playoffSemifinalBestOf,
    playoffFinalBestOf: payload.playoffFinalBestOf,
    playoffThirdPlaceBestOf: payload.playoffThirdPlaceBestOf,
    swissDeciderBestOf: payload.swissDeciderBestOf,
    playoffSeedPolicy: payload.playoffSeedPolicy,
    playoffSeedMetadata: payload.playoffSeedMetadata,
    playoffAdvanceCount: payload.playoffAdvanceCount,
    advanceToPlayoffs: payload.advanceToPlayoffs,
    totalTeams: payload.totalTeams ?? 0,
    totalRounds: payload.totalRounds ?? calculateTournamentTotalRounds(
      payload.eventMode ?? "regular_season",
      payload.totalTeams ?? 0,
      payload.regularSeasonFormat,
      payload.regularSeasonCustomRounds,
      payload.playoffFormat,
      payload.playoffAdvanceCount
    ),
    teamNames: payload.teamNames ?? [],
    eventDate: payload.eventDate ?? "",
    createdByTelegramUserId: telegramUserId,
    telegramChatId: telegramChatId ?? undefined
  });

  const result = await createTournamentEventRecord(parsed);

  if (payload.teamWhatsappNumbers && payload.teamWhatsappNumbers.length > 0 && result.teams) {
    for (let i = 0; i < Math.min(payload.teamWhatsappNumbers.length, result.teams.length); i++) {
      const phone = payload.teamWhatsappNumbers[i];
      const team = result.teams[i];
      if (phone && team) {
        await db
          .update(tournamentTeams)
          .set({ captainWhatsapp: phone })
          .where(eq(tournamentTeams.id, team.id));
      }
    }
  }

  return result;
}

async function finalizeTelegramCreatedEvent(chatId: number | string, telegramUserId: string, eventId: number) {
  const event = await loadTournamentEventById(eventId);
  await clearTelegramSession(telegramUserId);

  if (!event) {
    await sendTelegramMessage(chatId, "Event tidak ditemukan.");
    return;
  }

  await sendTelegramMessage(chatId, `Event berhasil dibuat! 🎉\nKode: ${event.code}`);
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

async function telegramApiResult<T>(method: string, payload: Record<string, unknown>) {
  const token = getTelegramBotToken();
  if (!token) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN is not configured");
    return null;
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
      return null;
    }
    const payloadJson = await response.json().catch(() => null) as
      | { ok?: boolean; result?: T; description?: string }
      | null;
    if (!payloadJson?.ok || payloadJson.result === undefined) {
      console.warn(`[telegram] ${method} returned error`, payloadJson?.description ?? "unknown");
      return null;
    }
    return payloadJson.result;
  } catch (error) {
    console.warn("[telegram] request failed", error);
    return null;
  }
}

async function resolveTelegramImageFilePath(fileId: string) {
  const result = await telegramApiResult<{ file_path?: string }>("getFile", { file_id: fileId });
  const filePath = (result?.file_path ?? "").trim().replace(/^\/+/, "");
  return filePath || null;
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

async function loadTournamentEventBySlug(slug: string) {
  const normalizedSlug = toTournamentEventSlug(slug);
  if (!normalizedSlug) return null;

  const events = await db
    .select()
    .from(tournamentEvents)
    .orderBy(desc(tournamentEvents.createdAt))
    .limit(500);

  return events.find((event) => toTournamentEventSlug(event.name) === normalizedSlug) ?? null;
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

function buildTournamentEventKeyboard(event: Pick<TournamentEventRecord, "name">) {
  const url = buildTournamentEventWebUrl(event);
  if (!url) return undefined;

  return [[{ text: "Open Web", url }]];
}

function getTournamentBracketMenuLabel(event: Pick<TournamentEventRecord, "eventMode" | "format">) {
  if (getTournamentEventMode(event) === "regular_season") return "View Schedule";
  return "View Bracket";
}

function tournamentAllowsShuffleForNextRound(
  event: Pick<TournamentEventRecord, "eventMode" | "format">,
  nextRoundNumber: number
) {
  if (getTournamentEventMode(event) !== "playoffs") return true;
  return nextRoundNumber <= 1;
}

async function sendTelegramStartMenu(chatId: number | string) {
  await sendTelegramMessage(
      chatId,
      [
      "Bot ini dipakai untuk mengelola event tournament di website Draft Arena.",
      "",
      "Fungsi utama:",
      "- Buat event tournament lengkap langsung dari Telegram",
      "- Buat event upcoming singkat untuk pengumuman/pamflet",
      "- Lihat daftar event yang kamu buat atau yang sudah dishare ke group ini",
      "- Input hasil pertandingan per ronde sesuai mode event",
      "- Lihat schedule, bracket, dan standings",
      "",
      "Cara pakai singkat:",
      "1. Pilih Buat Event Tournament untuk setup lengkap (tim, mode, format, BO, ronde).",
      "2. Pilih Buat Event Upcoming untuk input ringkas: nama event, tanggal, kontak admin, banner.",
      "3. Pilih Lihat Event untuk manage ronde, input hasil, dan generate ronde berikutnya.",
      "4. Kalau event dibuka dari group Telegram, akses otomatis dishare ke semua member group tersebut.",
      "",
      "Menu:"
    ].join("\n"),
    {
      inlineKeyboard: [
        [{ text: "Buat Event Tournament", callback_data: "start_create_event" }],
        [{ text: "Buat Event Upcoming", callback_data: "create_upcoming_event" }],
        [{ text: "Lihat Event", callback_data: "start_view_event" }]
      ]
    }
  );
}

function formatTournamentEventSummary(event: TournamentEventRecord) {
  const eventMode = getTournamentEventMode(event);
  const regularSeasonFormat = getTournamentRegularSeasonFormat(event);
  return [
    `Event: ${event.name}`,
    `Kode: ${event.code}`,
    `Mode: ${formatTelegramEventModeLabel(eventMode)}`,
    eventMode === "regular_season"
      ? `Format: ${formatTournamentRegularSeasonFormatLabel(regularSeasonFormat)}`
      : `Format: ${formatTournamentPlayoffFormatLabel(getTournamentPlayoffFormat(event))}`,
    eventMode === "regular_season"
      ? `Match Best Of: BO${getTournamentMatchBestOf(event)}`
      : `Early Rounds BO: BO${getTournamentMatchBestOf(event)}`,
    eventMode === "playoffs"
      && getTournamentPlayoffFormat(event) !== "swiss_stage"
      ? `Semifinal BO: BO${event.playoffSemifinalBestOf ?? "-"}`
      : null,
    eventMode === "playoffs"
      ? `Final BO: BO${event.playoffFinalBestOf ?? "-"}`
      : null,
    eventMode === "playoffs"
      ? `3rd Place BO: ${event.playoffThirdPlaceBestOf ? `BO${event.playoffThirdPlaceBestOf}` : "Off"}`
      : null,
    eventMode === "playoffs" && event.playoffSeedMetadata
      ? `Seeding: ${formatPlayoffSeedPolicyLabel((event.playoffSeedPolicy as TournamentPlayoffSeedPolicy) ?? "balanced")}`
      : null,
    `Tim: ${event.totalTeams}`,
    `Ronde: ${event.totalRounds}`,
    eventMode === "regular_season" ? `Playoffs: Top ${getTournamentAdvanceToPlayoffs(event)} tim lolos` : null,
    `Tanggal: ${formatTournamentDate(event.eventDate)}`,
    `Status: ${event.status}`
  ].filter(Boolean).join("\n");
}

async function sendTournamentEventDetails(chatId: number | string, event: TournamentEventRecord) {
  await sendTelegramMessage(chatId, formatTournamentEventSummary(event), {
    inlineKeyboard: buildTournamentEventKeyboard(event)
  });
}

async function sendTournamentNextRoundPairingMenu(chatId: number | string, eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  const context = prepareTournamentNextRoundContext(bundle);
  if ("error" in context) {
    await sendTelegramMessage(chatId, context.error, {
      inlineKeyboard: [[{ text: "Back to Event", callback_data: `event_manage:${eventId}` }]]
    });
    return;
  }
  if (context.completed) {
    await sendTelegramMessage(chatId, "Final round already reached. Use Finish Event.", {
      inlineKeyboard: [[{ text: "Back to Event", callback_data: `event_manage:${eventId}` }]]
    });
    return;
  }

  const allowShuffle = tournamentAllowsShuffleForNextRound(context.bundle.event, context.nextRoundNumber);
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{
      text: allowShuffle ? "Default Match" : "Continue (Bracket Order)",
      callback_data: `next_round_pick:${eventId}:default`
    }]
  ];
  if (allowShuffle) {
    keyboard.push([{ text: "Shuffle Match", callback_data: `next_round_pick:${eventId}:shuffle` }]);
  }
  keyboard.push([{ text: "Back to Event", callback_data: `event_manage:${eventId}` }]);

  await sendTelegramMessage(
    chatId,
    allowShuffle
      ? "Choose the pairing method for the next round."
      : "Next round follows fixed playoff bracket order. Tap Continue to preview pairings.",
    {
      inlineKeyboard: keyboard
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
  const allowShuffle = tournamentAllowsShuffleForNextRound(bundle.event, roundNumber);
  const lines = pairings
    .slice()
    .sort((left, right) => left.pairingOrder - right.pairingOrder)
    .map((pairing) => {
      const teamA = pairing.teamAId ? (teamById.get(pairing.teamAId) ?? "Team A") : "Team A";
      if (!pairing.teamBId) {
        return `Match ${pairing.pairingOrder}: ${teamA} gets BYE`;
      }

      const teamB = teamById.get(pairing.teamBId) ?? "Team B";
      return `Match ${pairing.pairingOrder}: ${teamA} vs ${teamB}`;
    });

  const sourceLines = (() => {
    if (getTournamentPlayoffFormat(bundle.event) !== "double_elimination") return [] as string[];
    const meta = (pairings as unknown as { _meta?: { stage: string; stageNumber: number } })._meta;
    if (!meta) return [] as string[];
    return pairings
      .slice()
      .sort((left, right) => left.pairingOrder - right.pairingOrder)
      .map((pairing) => {
        const flow = (pairing.playoffFlow ?? {}) as { sourceA?: unknown; sourceB?: unknown };
        const flowSourceA = formatDEFlowSourceLabel(flow.sourceA, bundle.event.totalTeams);
        const flowSourceB = formatDEFlowSourceLabel(flow.sourceB, bundle.event.totalTeams);
        if (flowSourceA && flowSourceB) {
          return `  ↳ Source M${pairing.pairingOrder}: ${flowSourceA} vs ${flowSourceB}`;
        }

        const source = buildDEPairingSourceLabels(
          bundle.event.totalTeams,
          meta.stage,
          meta.stageNumber,
          pairing.pairingOrder
        );
        const resolved = buildDEPreviewSourceLabels(
          bundle.event.totalTeams,
          meta.stage,
          meta.stageNumber,
          pairing.pairingOrder,
          bundle.rounds,
          bundle.matches
        );
        const activeSource = resolved ?? source;
        if (!activeSource) return null;
        return `  ↳ Source M${pairing.pairingOrder}: ${activeSource.left} vs ${activeSource.right}`;
      })
      .filter((line): line is string => Boolean(line));
  })();

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "Confirm Pairings", callback_data: `next_round_confirm:${bundle.event.id}` }]
  ];

  const isGrandFinalRound = (() => {
    if (getTournamentPlayoffFormat(bundle.event) === "single_elimination" && bundle.event.eventMode === "playoffs") {
      return roundNumber === bundle.event.totalRounds;
    }
    const meta = (pairings as unknown as { _meta?: { stage: string } })._meta;
    return meta?.stage === "grand_final";
  })();

  if (isGrandFinalRound) {
    const hasGfMeta = Boolean(
      bundle.event.grandFinalTeamALogoUrl
      || bundle.event.grandFinalTeamBLogoUrl
      || bundle.event.grandFinalYoutubeUrl
    );
    keyboard.push([{
      text: hasGfMeta ? "✏️ Edit Grand Final Info" : "🎬 Set Grand Final Info (Optional)",
      callback_data: `gf_meta_start:${bundle.event.id}`
    }]);
  }

  if (allowShuffle && strategy === "shuffle") {
    keyboard.push([{ text: "Shuffle Match Again", callback_data: `next_round_pick:${bundle.event.id}:shuffle` }]);
    keyboard.push([{ text: "Use Default Match", callback_data: `next_round_pick:${bundle.event.id}:default` }]);
  } else if (allowShuffle) {
    keyboard.push([{ text: "Shuffle Match", callback_data: `next_round_pick:${bundle.event.id}:shuffle` }]);
  }

  keyboard.push([{ text: "Back to Pairing Menu", callback_data: `next_round:${bundle.event.id}` }]);
  keyboard.push([{ text: "Back to Event", callback_data: `event_manage:${bundle.event.id}` }]);

  const hasBye = pairings.some((p) => !p.teamBId);
  const isThirdPlaceRound =
    bundle.event.playoffFormat === "single_elimination"
    && roundNumber === bundle.event.totalRounds
    && Boolean(bundle.event.playoffThirdPlaceBestOf);
  const missingThirdPlace = isThirdPlaceRound && pairings.length < 2;

  const deContextLine = (() => {
    if (getTournamentPlayoffFormat(bundle.event) !== "double_elimination") return null;
    const meta = (pairings as unknown as { _meta?: { stage: string; stageNumber: number; label: string } })._meta;
    if (!meta) return null;
    if (meta.stage === "upper") {
      return `🔵 Upper Bracket — winner stays in UB, loser drops to Lower Bracket.`;
    }
    if (meta.stage === "lower") {
      const isLBFinal = meta.label.toLowerCase().includes("final");
      return isLBFinal
        ? `🔴 Lower Bracket Final — winner advances to Grand Final, loser is eliminated.`
        : `🔴 Lower Bracket — winner stays in LB, loser is eliminated.`;
    }
    if (meta.stage === "grand_final") {
      if (meta.stageNumber >= 2) {
        return `🏆 Grand Final Reset — winner becomes champion.`;
      }
      return `🏆 Grand Final — Upper Bracket winner vs Lower Bracket winner.`;
    }
    return null;
  })();

  await sendTelegramMessage(
    chatId,
    [
      `${bundle.event.name} · Round ${roundNumber} Preview`,
      `Pairing mode: ${strategy === "shuffle" ? "Shuffle Match" : "Default Match"}`,
      "",
      ...lines,
      sourceLines.length > 0 ? "" : null,
      ...sourceLines,
      "",
      deContextLine,
      hasBye ? "⚠️ Note: 1 team will receive a BYE this round (auto-win)." : null,
      isThirdPlaceRound && !missingThirdPlace ? `ℹ️ This round includes a 3rd Place Match (BO${bundle.event.playoffThirdPlaceBestOf}).` : null,
      missingThirdPlace ? "⚠️ 3rd place match could not be generated (unexpected semifinal results). It will be skipped." : null,
      allowShuffle && strategy === "shuffle"
        ? "Pilih Confirm Pairings atau Shuffle Match Again sampai pairing sesuai."
        : "Pilih Confirm Pairings untuk membuat round ini."
    ].filter(Boolean).join("\n"),
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
      const teamA = match.teamAId ? (teamById.get(match.teamAId) ?? "Team A") : "Team A";
      if (!match.teamBId) {
        return `Match ${match.pairingOrder}: ${teamA} gets BYE`;
      }

      const teamB = teamById.get(match.teamBId) ?? "Team B";
      return `Match ${match.pairingOrder}: ${teamA} vs ${teamB}`;
    });

  const webUrl = buildTournamentEventWebUrl(bundle.event);
  const roundMatchBestOf = roundMatches[0]
    ? getTournamentRoundBestOf(bundle.event, round.roundNumber, roundMatches[0].pairingOrder, round.stage, roundMatches[0].matchBestOf)
    : getTournamentMatchBestOf(bundle.event);

  return [
    `${bundle.event.name} · ${round.label ?? `Round ${round.roundNumber}`} · BO${roundMatchBestOf}`,
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
  const standings = buildTournamentStandingsForEvent(bundle.event, bundle.rounds, bundle.teams, bundle.matches);
  const mode = getTournamentEventMode(bundle.event);

  if (mode === "regular_season") {
    const advanceToPlayoffs = getTournamentAdvanceToPlayoffs(bundle.event);
    const topTeams = standings.slice(0, advanceToPlayoffs);
    if (topTeams.length === 0) return null;

    return [
      `🎉 ${bundle.event.name} · Regular Season Completed`,
      "",
      `🔥 Congratulations to the Top ${advanceToPlayoffs} teams advancing to Playoffs:`,
      ...topTeams.map((team) => `${team.rank}. ${team.teamName}`),
      "",
      "🙏 Thank you to all other teams for participating in this event.",
      "👋 See you next event."
    ].join("\n");
  }

  if (
    getTournamentRegularSeasonFormat(bundle.event) === "swiss_stage"
  ) {
    const winThreshold = getSwissWinThreshold(bundle.event.totalTeams);
    const qualifiedTeams = standings.filter((team) => team.win >= winThreshold);
    return [
      `🏁 ${bundle.event.name} · Swiss Stage Completed`,
      "",
      ...(qualifiedTeams.length > 0
        ? [
            "✅ Qualified teams:",
            ...qualifiedTeams.map((team) => `${team.rank}. ${team.teamName} (${team.win}-${team.lose})`)
          ]
        : [`No teams reached ${winThreshold} wins.`]),
      "",
      "🙏 Thank you to all participating teams.",
      "👋 See you next event."
    ].join("\n");
  }

  const teamById = new Map(bundle.teams.map((team) => [team.id, team.name]));
  const finalRound = bundle.rounds
    .slice()
    .sort((left, right) => right.roundNumber - left.roundNumber)[0];
  const finalRoundMatches = finalRound
    ? bundle.matches
        .filter((match) => match.roundId === finalRound.id)
        .sort((left, right) => left.pairingOrder - right.pairingOrder)
    : [];
  const grandFinal = finalRoundMatches[0] ?? null;
  const thirdPlaceMatch = finalRoundMatches[1] ?? null;
  const championName = grandFinal?.winnerTeamId ? (teamById.get(grandFinal.winnerTeamId) ?? null) : null;
  if (!championName) return null;
  const runnerUpName = (() => {
    if (!grandFinal?.winnerTeamId || !grandFinal.teamAId || !grandFinal.teamBId) return null;
    const loserTeamId = grandFinal.winnerTeamId === grandFinal.teamAId ? grandFinal.teamBId : grandFinal.teamAId;
    return teamById.get(loserTeamId) ?? null;
  })();
  const thirdPlaceName = (() => {
    if (!bundle.event.playoffThirdPlaceBestOf || !thirdPlaceMatch?.winnerTeamId) return null;
    return teamById.get(thirdPlaceMatch.winnerTeamId) ?? null;
  })();

  const lines = [
    `🏆 ${bundle.event.name} · Playoffs Completed`,
    "",
    `🥇 ${championName}`,
    runnerUpName ? `🥈 ${runnerUpName}` : null,
    thirdPlaceName ? `🥉 ${thirdPlaceName}` : null,
    "🙏 Thank you to all other teams for participating in this event.",
    "👋 See you next event."
  ].filter(Boolean);

  return lines.join("\n");
}

async function finishTournamentEvent(eventId: number) {
  const bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    return { error: "Event not found." } as const;
  }

  const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";
  const currentRound = activeTournamentRound(bundle.rounds);
  if (!currentRound) {
    return { error: "No rounds available." } as const;
  }

  const pendingMatches = bundle.matches.filter((match) => match.roundId === currentRound.id && match.result === "pending");
  if (pendingMatches.length > 0) {
    return { error: "Current round still has pending matches." } as const;
  }

  if (isDE) {
    const nextStage = buildDoubleEliminationNextStage(bundle.event.totalTeams, bundle.rounds, bundle.matches);
    if (nextStage) {
      return { error: "Event still has remaining rounds." } as const;
    }
  } else if (currentRound.roundNumber < bundle.event.totalRounds) {
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

  await invalidateTournamentBundle(eventId);
  const refreshed = await loadTournamentBundle(eventId);
  return { bundle: refreshed ?? bundle } as const;
}

function activeTournamentRound(rounds: TournamentRoundRecord[]) {
  return rounds.find((round) => round.status === "active")
    ?? rounds.slice().sort((left, right) => right.roundNumber - left.roundNumber)[0]
    ?? null;
}

function getDEActivePlayableRounds(bundle: NonNullable<Awaited<ReturnType<typeof loadTournamentBundle>>>) {
  return bundle.rounds
    .filter((round) =>
      bundle.matches.some((match) =>
        match.roundId === round.id
        && match.result === "pending"
        && match.teamBId !== null
      )
    )
    .sort((a, b) => a.roundNumber - b.roundNumber);
}

function getDENextRoundReadiness(bundle: NonNullable<Awaited<ReturnType<typeof loadTournamentBundle>>>) {
  const activePlayableRounds = getDEActivePlayableRounds(bundle);
  const blocked = activePlayableRounds.length > 0;
  const hasNextStage = Boolean(buildDoubleEliminationNextStage(bundle.event.totalTeams, bundle.rounds, bundle.matches));
  return {
    canGenerate: !blocked && hasNextStage,
    blocked,
    activePlayableRounds
  };
}

async function sendTournamentManageMenu(chatId: number | string, eventId: number) {
  let bundle = await loadTournamentBundle(eventId);
  if (!bundle) {
    await sendTelegramMessage(chatId, "Event not found.");
    return;
  }

  const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";
  if (isDE) {
    const cleaned = await sanitizeDEBracket(bundle.event.id);
    if (cleaned) {
      const freshBundle = await loadTournamentBundle(bundle.event.id);
      if (freshBundle) bundle = freshBundle;
    }
  }

  const currentRound = activeTournamentRound(bundle.rounds);
  const currentRoundPending = currentRound
    ? bundle.matches.filter((match) => match.roundId === currentRound.id && match.result === "pending").length
    : 0;
  const usesFlexiblePairings = tournamentUsesFlexiblePairings(bundle.event);
  const isSwiss = getTournamentRegularSeasonFormat(bundle.event) === "swiss_stage";
  const swissComplete = isSwiss && isSwissStageComplete(bundle.teams, bundle.matches, bundle.event.totalTeams);

  const deReadiness = isDE ? getDENextRoundReadiness(bundle) : null;
  const deActiveRounds = deReadiness?.activePlayableRounds ?? null;

  const canGenerateNextRound = isDE
    ? deReadiness!.canGenerate &&
      !swissComplete
    : currentRound
      ? currentRoundPending === 0 && !swissComplete && currentRound.roundNumber < bundle.event.totalRounds
      : usesFlexiblePairings && bundle.event.totalRounds > 0;

  const canFinishEvent =
    isDE
      ? bundle.event.status !== "completed"
        && deReadiness !== null
        && !deReadiness.canGenerate
        && deActiveRounds!.length === 0
      : Boolean(
          currentRound &&
          currentRoundPending === 0 &&
          (swissComplete || currentRound.roundNumber >= bundle.event.totalRounds) &&
          bundle.event.status !== "completed"
        );

  const keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
  const webKeyboard = buildTournamentEventKeyboard(bundle.event);
  if (webKeyboard && webKeyboard[0]?.[0]) {
    keyboard.push([{ text: webKeyboard[0][0].text, url: webKeyboard[0][0].url }]);
  }
  if (isDE && deActiveRounds!.length > 0) {
    for (const deRound of deActiveRounds!) {
      keyboard.push([
        {
          text: `Manage ${deRound.label ?? `Round ${deRound.roundNumber}`}`,
          callback_data: `round_manage:${bundle.event.id}:${deRound.id}`
        }
      ]);
    }
  } else if (!isDE && currentRound) {
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
      text: "Edit Events",
      callback_data: `edit_events:${bundle.event.id}`
    }
  ]);
  keyboard.push([
    {
      text: "Back to Events",
      callback_data: "events_list"
    }
  ]);

  const swissProgressLine = (() => {
    if (getTournamentRegularSeasonFormat(bundle.event) !== "swiss_stage") return null;
    const swissRows = buildTournamentStandingRows(bundle.teams, bundle.matches);
    const winThreshold = getSwissWinThreshold(bundle.event.totalTeams);
    const qualified = swissRows.filter((row) => row.win >= winThreshold).length;
    const eliminated = swissRows.filter((row) => row.lose >= winThreshold).length;
    const active = swissRows.length - qualified - eliminated;
    return `Swiss: ${qualified} qualified · ${active} active · ${eliminated} eliminated`;
  })();

  const deProgressLine = (() => {
    if (getTournamentPlayoffFormat(bundle.event) !== "double_elimination") return null;
    const allRounds = bundle.rounds.filter((r) => ["upper", "lower", "grand_final"].includes(r.stage));
    const teamsInUB = new Set<number>();
    const teamsInLB = new Set<number>();
    const eliminated = new Set<number>();

    for (const round of allRounds.filter((r) => r.stage === "upper").sort((a, b) => a.stageNumber - b.stageNumber)) {
      const roundMatches = bundle.matches.filter((m) => m.roundId === round.id && m.result !== "pending");
      for (const match of roundMatches) {
        if (!match.teamBId || match.result === "bye") {
          if (match.teamAId) teamsInUB.add(match.teamAId);
          continue;
        }
        const winnerId = match.result === "team_a_win" ? match.teamAId : match.teamBId;
        const loserId = match.result === "team_a_win" ? match.teamBId : match.teamAId;
        if (!winnerId || !loserId) continue;
        teamsInUB.add(winnerId);
        teamsInLB.add(loserId);
      }
    }
    for (const round of allRounds.filter((r) => r.stage === "lower").sort((a, b) => a.stageNumber - b.stageNumber)) {
      const roundMatches = bundle.matches.filter((m) => m.roundId === round.id && m.result !== "pending");
      for (const match of roundMatches) {
        if (!match.teamBId || match.result === "bye") {
          if (match.teamAId) teamsInLB.add(match.teamAId);
          continue;
        }
        const winnerId = match.result === "team_a_win" ? match.teamAId : match.teamBId;
        const loserId = match.result === "team_a_win" ? match.teamBId : match.teamAId;
        if (!winnerId || !loserId) continue;
        teamsInLB.add(winnerId);
        eliminated.add(loserId);
      }
    }
    for (const id of teamsInLB) teamsInUB.delete(id);
    for (const id of eliminated) teamsInLB.delete(id);
    const inUB = teamsInUB.size || (allRounds.length === 0 ? bundle.teams.length : 0);
    const inLB = teamsInLB.size;
    const elim = eliminated.size;
    return `DE: ${inUB} in UB · ${inLB} in LB · ${elim} eliminated`;
  })();

  const statusLine = (() => {
    if (isDE) {
      if (deActiveRounds!.length > 0) {
        return deActiveRounds!
          .map((r) => {
            const pending = bundle.matches.filter((m) => m.roundId === r.id && m.result === "pending").length;
            return `${r.label ?? `Round ${r.roundNumber}`}: ${pending} pending match${pending !== 1 ? "es" : ""}`;
          })
          .join("\n");
      }
      if (bundle.rounds.length === 0) {
        return "No rounds generated yet. Use Generate Next Round to start Round 1.";
      }
      return "All current rounds complete. Generate next round to continue.";
    }
    return currentRound
      ? `Current round: ${currentRound.label ?? `Round ${currentRound.roundNumber}`} (${currentRoundPending} pending matches)`
      : usesFlexiblePairings
        ? "No rounds generated yet. Use Generate Next Round to start Round 1."
        : "No rounds available.";
  })();

  await sendTelegramMessage(
    chatId,
    [
      formatTournamentEventSummary(bundle.event),
      statusLine,
      swissProgressLine,
      deProgressLine
    ].filter(Boolean).join("\n"),
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

  const standings = buildTournamentStandingsForEvent(bundle.event, bundle.rounds, bundle.teams, bundle.matches);
  const lines = standings.map((row) =>
    `${row.rank}. ${row.teamName} | P:${row.played} W:${row.win} L:${row.lose} D:${row.draw} Bye:${row.bye} | Pts:${row.score} | H2H:${row.headToHead} | BH:${row.buchholz} | Diff:${formatTournamentPointDiff(row.pointDiff)}`
  );

  await sendTelegramMessage(
    chatId,
    [
      `${bundle.event.name} standings`,
      ...lines,
      getTournamentEventMode(bundle.event) === "regular_season" ? "" : null,
      getTournamentEventMode(bundle.event) === "regular_season"
        ? `Top ${getTournamentAdvanceToPlayoffs(bundle.event)} teams advance to playoffs.`
        : null
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
  const isSwiss = getTournamentRegularSeasonFormat(bundle.event) === "swiss_stage";
  const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";

  const sections = bundle.rounds
    .slice()
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => {
      const roundMatches = bundle.matches
        .filter((match) => match.roundId === round.id)
        .sort((left, right) => left.pairingOrder - right.pairingOrder);

      if (isSwiss && round.stage === "swiss") {
        const groups = new Map<string, string[]>();
        const standings = buildTournamentStandingRows(bundle.teams, bundle.matches.filter((m) => m.roundId !== round.id));
        for (const match of roundMatches) {
          const teamARow = standings.find((r) => r.teamId === match.teamAId);
          const groupKey = teamARow ? `${teamARow.win}-${teamARow.lose}` : "?-?";
          const teamA = match.teamAId ? (teamById.get(match.teamAId) ?? "Team A") : "Team A";
          const teamB = match.teamBId ? (teamById.get(match.teamBId) ?? "Team B") : "BYE";
          const score = match.result === "pending" ? "pending" : `${match.scoreA ?? "-"}-${match.scoreB ?? "-"}`;
          const line = `  ${teamA} vs ${teamB} (${score})`;
          const bucket = groups.get(groupKey) ?? [];
          bucket.push(line);
          groups.set(groupKey, bucket);
        }
        const groupLines = Array.from(groups.entries())
          .sort(([a], [b]) => {
            const [aw = 0, al = 0] = a.split("-").map(Number);
            const [bw = 0, bl = 0] = b.split("-").map(Number);
            return (bw - bl) - (aw - al);
          })
          .flatMap(([key, lines]) => [`[${key}]`, ...lines]);
        return [`${round.label ?? `Swiss Round ${round.roundNumber}`} - ${round.status}`, ...groupLines].join("\n");
      }

      if (isDE) {
        const stageBadge =
          round.stage === "upper" ? "🔵 UB" :
          round.stage === "lower" ? "🔴 LB" :
          round.stage === "grand_final" ? "🏆 Grand Final" : "";
        const matchLines = roundMatches.map((match) => {
          const teamA = match.teamAId ? (teamById.get(match.teamAId) ?? "Team A") : "Team A";
          const teamB = match.teamBId ? (teamById.get(match.teamBId) ?? "Team B") : "BYE";
          const score = match.result === "pending" ? "pending" : `${match.scoreA ?? "-"}-${match.scoreB ?? "-"}`;
          return `  Match ${match.pairingOrder}: ${teamA} vs ${teamB} (${score})`;
        });
        return [`${stageBadge} ${round.label ?? `Round ${round.roundNumber}`} - ${round.status}`, ...matchLines].join("\n");
      }

      const matchLines = roundMatches.map((match) => {
          const teamA = match.teamAId ? (teamById.get(match.teamAId) ?? "Team A") : "Team A";
          const teamB = match.teamBId ? (teamById.get(match.teamBId) ?? "Team B") : "BYE";
          const score =
            match.result === "pending"
              ? "pending"
              : `${match.scoreA ?? "-"}-${match.scoreB ?? "-"}`;
          return `Match ${match.pairingOrder}: ${teamA} vs ${teamB} (${score})`;
        });
      return [`${round.label ?? `Round ${round.roundNumber}`} - ${round.status}`, ...matchLines].join("\n");
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
    const teamA = match.teamAId ? (teamById.get(match.teamAId)?.name ?? "Team A") : "Team A";
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
  const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";
  const deReadiness = isDE ? getDENextRoundReadiness(bundle) : null;
  if (pendingMatches === 0) {
    if (!isDE && round.roundNumber < bundle.event.totalRounds) {
      keyboard.push([
        {
          text: "Generate Next Round",
          callback_data: `next_round:${bundle.event.id}`
        }
      ]);
    } else if (isDE && deReadiness?.canGenerate) {
      keyboard.push([
        {
          text: "Generate Next Round",
          callback_data: `next_round:${bundle.event.id}`
        }
      ]);
    }
  }
  if (
    pendingMatches === 0
    && bundle.event.status !== "completed"
    && (
      (!isDE && round.roundNumber >= bundle.event.totalRounds)
      || (isDE && !deReadiness?.canGenerate)
    )
  ) {
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

  const roundTitle = round.label ?? `Round ${round.roundNumber}`;
  const headerText = pendingMatches > 0
    ? `${roundTitle} tasks (${pendingMatches} pending matches). Select a match to set the result.`
    : `${roundTitle} tasks complete (0 pending matches).`;
  await sendTelegramMessage(chatId, headerText, { inlineKeyboard: keyboard });
}

function buildTournamentScoreOptions(
  event: TournamentEventRecord,
  round: Pick<TournamentRoundRecord, "roundNumber" | "stage">,
  match: Pick<TournamentMatchRecord, "pairingOrder" | "matchBestOf">
) {
  const eventMode = getTournamentEventMode(event);
  const matchBestOf = getTournamentRoundBestOf(
    event,
    round.roundNumber,
    match.pairingOrder,
    round.stage,
    match.matchBestOf
  );

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
  const bundle = await loadTournamentBundleFresh(eventId);
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
  const teamA = match.teamAId ? (teamById.get(match.teamAId)?.name ?? "Team A") : "Team A";
  const teamB = match.teamBId ? (teamById.get(match.teamBId)?.name ?? "Team B") : "BYE";
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const eventMode = getTournamentEventMode(bundle.event);
  const matchBestOf = getTournamentRoundBestOf(bundle.event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf);
  const requiredWins = getTournamentRequiredWins(eventMode, matchBestOf);
  const curA = match.scoreA ?? 0;
  const curB = match.scoreB ?? 0;
  const isSeriesComplete = curA >= requiredWins || curB >= requiredWins;
  const usePerGameFlow = matchBestOf > 1 && Boolean(match.teamBId);

  if (!match.teamBId) {
    const byeScore = getTournamentByeScore(eventMode, matchBestOf);
    keyboard.push([
      {
        text: `${teamA} gets BYE (${byeScore.scoreA}-${byeScore.scoreB})`,
        callback_data: `match_score:${bundle.event.id}:${round.id}:${match.id}:${byeScore.scoreA}-${byeScore.scoreB}`
      }
    ]);
  } else if (usePerGameFlow) {
    if (isSeriesComplete) {
      const winner = curA > curB ? teamA : teamB;
      keyboard.push([
        {
          text: `🔄 Reset Hasil (${curA}-${curB})`,
          callback_data: `match_reset:${bundle.event.id}:${round.id}:${match.id}`
        }
      ]);
      if (round.stage === "grand_final") {
        const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";
        const needsGrandFinalReset = isDE
          && (round.stageNumber ?? 1) === 1
          && match.teamBId !== null
          && match.winnerTeamId === match.teamBId;
        if (needsGrandFinalReset) {
          keyboard.push([
            {
              text: "Generate Next Round",
              callback_data: `next_round:${bundle.event.id}`
            }
          ]);
        } else {
          keyboard.push([
            {
              text: "🏁 Finish Event",
              callback_data: `finish_event:${bundle.event.id}`
            }
          ]);
        }
      }
      keyboard.push([
        {
          text: "Kembali ke Round",
          callback_data: `round_manage:${bundle.event.id}:${round.id}`
        }
      ]);
      const gameNum = curA + curB;
      await sendTelegramMessage(
        chatId,
        [
          `🏆 *${round.label ?? `Round ${round.roundNumber}`} · Match ${match.pairingOrder}*`,
          `${teamA} vs ${teamB}`,
          `Skor: *${curA} - ${curB}* (BO${matchBestOf})`,
          `*${winner}* menang setelah ${gameNum} game!`,
          `Tekan Reset jika ada yang perlu diubah.`
        ].join("\n"),
        { inlineKeyboard: keyboard }
      );
      return;
    }

    const gameNum = curA + curB + 1;
    const isDecider = curA === requiredWins - 1 && curB === requiredWins - 1;
    const gameLabel = isDecider ? `Game ${gameNum} (DECIDER 🔥)` : `Game ${gameNum}`;
    keyboard.push([
      {
        text: `✅ ${teamA} menang ${gameLabel}`,
        callback_data: `match_game:${bundle.event.id}:${round.id}:${match.id}:a`
      }
    ]);
    keyboard.push([
      {
        text: `✅ ${teamB} menang ${gameLabel}`,
        callback_data: `match_game:${bundle.event.id}:${round.id}:${match.id}:b`
      }
    ]);
    if (curA > 0 || curB > 0) {
      const undoRow: Array<{ text: string; callback_data: string }> = [];
      if (curA > 0) {
        undoRow.push({
          text: `↩️ Undo ${teamA} (${curA})`,
          callback_data: `match_game_undo:${bundle.event.id}:${round.id}:${match.id}:a`
        });
      }
      if (curB > 0) {
        undoRow.push({
          text: `↩️ Undo ${teamB} (${curB})`,
          callback_data: `match_game_undo:${bundle.event.id}:${round.id}:${match.id}:b`
        });
      }
      keyboard.push(undoRow);
    }
  } else {
    for (const option of buildTournamentScoreOptions(bundle.event, round, match)) {
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
      text: "Kembali ke Round",
      callback_data: `round_manage:${bundle.event.id}:${round.id}`
    }
  ]);

  const statusLine = usePerGameFlow
    ? `Skor: *${curA} - ${curB}* (BO${matchBestOf}, menang ${requiredWins} game)`
    : `Status: ${match.result === "pending" ? "pending" : `${curA}-${curB}`}`;

  await sendTelegramMessage(
    chatId,
    [
      `⚔️ *${round.label ?? `Round ${round.roundNumber}`} · Match ${match.pairingOrder}*`,
      `${teamA} vs ${teamB}`,
      statusLine,
      usePerGameFlow
        ? `Input hasil per game. Bracket otomatis update setelah seri selesai.`
        : eventMode === "regular_season" && matchBestOf === 1
          ? "Standing points: win = 1, draw = 0.5, loss = 0, bye = 1. Pilih Draw (20m+) jika match > 20 menit."
          : "Pilih hasil pertandingan dari POV " + teamA + "."
    ].join("\n"),
    {
      inlineKeyboard: keyboard
    }
  );
}

async function sendTournamentEventListMenu(chatId: number | string, telegramUserId: string) {
  const events = await listTournamentEventsForTelegramUser(telegramUserId, normalizeTelegramChatId(chatId), 8);
  if (events.length === 0) {
    await sendTelegramMessage(chatId, "No recent events found in your account or this chat. Use /create_new_event first.");
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
  session: typeof telegramSessions.$inferSelect,
  incomingMessage?: TelegramUpdate["message"]
) {
  const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
  const normalizedInput = text.trim();

  if (session.currentCommand === "/create-upcoming-event") {
    if (session.step === "AWAITING_UPCOMING_EVENT_NAME") {
      const upcomingEventName = normalizedInput;
      if (upcomingEventName.length < 3 || upcomingEventName.length > 160) {
        await sendTelegramMessage(chatId, "Nama event harus antara 3 dan 160 karakter.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_UPCOMING_EVENT_DATE", {
        ...payload,
        upcomingEventName
      });
      await sendTelegramMessage(
        chatId,
        `${upcomingWizardPhaseHeader(2, "Tanggal Event")}\nMasukkan tanggal event (format: DD-MM-YYYY).`
      );
      return;
    }

    if (session.step === "AWAITING_UPCOMING_EVENT_DATE") {
      const upcomingEventDate = normalizeEventDateInput(normalizedInput);
      if (!upcomingEventDate) {
        await sendTelegramMessage(chatId, "Tanggal tidak valid. Gunakan format DD-MM-YYYY.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_UPCOMING_EVENT_ADMIN_CONTACT", {
        ...payload,
        upcomingEventDate
      });
      await sendTelegramMessage(
        chatId,
        `${upcomingWizardPhaseHeader(3, "Contact Admin")}\nMasukkan contact admin (WhatsApp), contoh: 08123456789 atau +628123456789.`
      );
      return;
    }

    if (session.step === "AWAITING_UPCOMING_EVENT_ADMIN_CONTACT") {
      const upcomingAdminWhatsapp = normalizeWhatsappContactInput(normalizedInput);
      if (!upcomingAdminWhatsapp) {
        await sendTelegramMessage(chatId, "Nomor contact admin tidak valid. Gunakan format 08xxx atau +62xxx.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_UPCOMING_EVENT_BANNER", {
        ...payload,
        upcomingAdminWhatsapp
      });
      await sendTelegramMessage(
        chatId,
        `${upcomingWizardPhaseHeader(4, "Banner Event")}\nKirim image banner event (pamflet), atau kirim URL gambar (http/https), atau ketik "skip" untuk lewati.`
      );
      return;
    }

    if (session.step === "AWAITING_UPCOMING_EVENT_BANNER") {
      let upcomingBannerImageUrl: string | null = null;
      const lower = normalizedInput.toLowerCase();
      const skipBanner = lower === "skip" || lower === "lewati" || lower === "lewat";

      if (!skipBanner) {
        const telegramPhoto = pickLargestTelegramPhoto(incomingMessage?.photo);
        if (telegramPhoto?.file_id) {
          const filePath = await resolveTelegramImageFilePath(telegramPhoto.file_id);
          const fileRef = filePath ? toTelegramBannerFileRef(filePath) : null;
          if (!fileRef) {
            await sendTelegramMessage(chatId, "Gagal memproses image dari Telegram. Coba upload ulang atau kirim URL gambar.");
            return;
          }
          upcomingBannerImageUrl = fileRef;
        } else if (normalizedInput) {
          const imageUrl = normalizeImageUrlInput(normalizedInput);
          if (!imageUrl) {
            await sendTelegramMessage(chatId, "URL gambar tidak valid. Gunakan URL http/https, kirim foto, atau ketik \"skip\".");
            return;
          }
          upcomingBannerImageUrl = imageUrl;
        } else {
          await sendTelegramMessage(chatId, "Kirim foto banner, URL gambar, atau ketik \"skip\".");
          return;
        }
      }

      if (!payload.upcomingEventName || !payload.upcomingEventDate || !payload.upcomingAdminWhatsapp) {
        await clearTelegramSession(telegramUserId);
        await sendTelegramMessage(chatId, "Sesi tidak lengkap. Silakan mulai ulang dari menu utama.");
        return;
      }

      try {
        const created = await createUpcomingTournamentEventRecord({
          name: payload.upcomingEventName,
          eventDate: payload.upcomingEventDate,
          adminWhatsapp: payload.upcomingAdminWhatsapp,
          eventBannerImageUrl: upcomingBannerImageUrl,
          createdByTelegramUserId: telegramUserId,
          telegramChatId: telegramChatId ?? undefined
        });
        await clearTelegramSession(telegramUserId);
        const webUrl = buildTournamentEventWebUrl(created.event);
        await sendTelegramMessage(
          chatId,
          [
            "Event upcoming berhasil dibuat! 🎉",
            `Kode: ${created.event.code}`,
            webUrl ? `Link: ${webUrl}` : null
          ].filter(Boolean).join("\n"),
          {
            inlineKeyboard: buildTournamentEventKeyboard(created.event)
          }
        );
        return;
      } catch (error) {
        console.warn("[telegram] create upcoming event failed", error);
        await sendTelegramMessage(chatId, "Gagal membuat event upcoming. Silakan coba lagi dari menu utama.");
        return;
      }
    }
  }

  if (session.step === "AWAITING_TOTAL_PARTICIPANTS") {
    const n = parsePositiveIntegerInput(text);
    if (!n || n < 4 || n > 256) {
      await sendTelegramMessage(chatId, "Masukkan angka antara 4 dan 256.");
      return;
    }
    const nextPayload = { ...payload, totalTeams: n };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_TYPE", nextPayload);
    await sendEventTypePrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_TOTAL_PARTICIPANTS_CUSTOM") {
    const n = parsePositiveIntegerInput(text);
    if (!n || n < 4 || n > 256) {
      await sendTelegramMessage(chatId, "Masukkan angka antara 4 dan 256.");
      return;
    }
    const nextPayload = { ...payload, totalTeams: n };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_TYPE", nextPayload);
    await sendEventTypePrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_EVENT_TYPE") {
    const normalized = text.trim().toLowerCase();
    if (normalized === "playoffs" || normalized === "playoff") {
      const nextPayload = { ...payload, eventMode: "playoffs" as const };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_FORMAT", nextPayload);
      await sendCreateEventPlayoffFormatPrompt(chatId);
      return;
    }
    if (normalized === "regular" || normalized === "regular season" || normalized === "regular_season") {
      const nextPayload = { ...payload, eventMode: "regular_season" as const };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_ROUNDS", nextPayload);
      await sendRegularRoundsPrompt(chatId);
      return;
    }
    await sendTelegramMessage(chatId, 'Pilih "Regular Season" atau "Langsung Playoffs".');
    return;
  }

  if (session.step === "AWAITING_REGULAR_ROUNDS") {
    const n = parsePositiveIntegerInput(text);
    if (!n || n < 1 || n > 10) {
      await sendTelegramMessage(chatId, "Masukkan jumlah ronde antara 1 dan 10.");
      return;
    }
    const totalTeams = payload.totalTeams ?? 16;
    const nextPayload = { ...payload, suggestedRounds: n };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_FORMAT", nextPayload);
    await sendSuggestedRegularSeasonFormatPrompt(chatId, totalTeams, n);
    return;
  }

  if (session.step === "AWAITING_REGULAR_ROUNDS_CUSTOM") {
    const n = parsePositiveIntegerInput(text);
    if (!n || n < 1 || n > 10) {
      await sendTelegramMessage(chatId, "Custom ronde harus angka 1 sampai 10.");
      return;
    }
    const totalTeams = payload.totalTeams ?? 16;
    const nextPayload = { ...payload, suggestedRounds: n };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_FORMAT", nextPayload);
    await sendSuggestedRegularSeasonFormatPrompt(chatId, totalTeams, n);
    return;
  }

  if (session.step === "AWAITING_WHATSAPP_NUMBERS") {
    const normalizedInput = text.trim().toLowerCase();
    if (normalizedInput === "skip" || normalizedInput === "lewati" || normalizedInput === "lewat") {
      const nextPayload = { ...payload, teamWhatsappNumbers: undefined };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_NAME", nextPayload);
      await sendCreateEventNamePrompt(chatId);
      return;
    }

    const teamNames = payload.teamNames ?? [];
    const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);

    const phoneNumbers: string[] = [];
    const parseErrors: string[] = [];

    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      let phone = "";
      if (colonIdx !== -1) {
        phone = line.slice(colonIdx + 1).trim().replace(/\s+/g, "");
      } else {
        phone = line.trim().replace(/\s+/g, "");
      }

      if (phone.startsWith("08") || phone.startsWith("+62") || phone.startsWith("628")) {
        phoneNumbers.push(phone);
      } else {
        parseErrors.push(`Nomor tidak valid: "${line}"`);
      }
    }

    if (parseErrors.length > 0) {
      await sendTelegramMessage(chatId, [
        "Ada beberapa nomor yang tidak valid:",
        ...parseErrors,
        "",
        "Gunakan format 08xxxxxxxx atau +62xxxxxxxx.",
        'Atau ketik "skip" untuk lewati.'
      ].join("\n"));
      return;
    }

    if (phoneNumbers.length !== teamNames.length) {
      await sendTelegramMessage(chatId, [
        `Kamu memasukkan ${phoneNumbers.length} nomor, tapi ada ${teamNames.length} tim.`,
        "Pastikan jumlah nomor sesuai jumlah tim.",
        "",
        'Atau ketik "skip" untuk lewati.'
      ].join("\n"));
      return;
    }

    const nextPayload = { ...payload, teamWhatsappNumbers: phoneNumbers };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_NAME", nextPayload);
    await sendCreateEventNamePrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_EVENT_NAME") {
    const eventName = text.trim();
    if (eventName.length < 3 || eventName.length > 160) {
      await sendTelegramMessage(chatId, "Nama tournament harus antara 3 dan 160 karakter.");
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
      await sendTelegramMessage(chatId, "Tanggal tidak valid. Gunakan format DD-MM-YYYY.");
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

    await sendTelegramMessage(chatId, "Terjadi kesalahan pada data event. Silakan mulai ulang dengan /create-new-event.");
    await saveTelegramSession(telegramUserId, session.currentCommand, undefined, undefined);
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
      await sendTelegramMessage(chatId, 'Pilih "Regular Season" atau "Playoffs".');
      return;
    }

    const nextPayload = {
      ...payload,
      eventMode,
      regularSeasonFormat: undefined,
      regularSeasonCustomRounds: undefined,
      playoffSemifinalBestOf: undefined,
      playoffFinalBestOf: undefined,
      playoffThirdPlaceBestOf: undefined,
      playoffFormat: undefined,
      matchBestOf: undefined,
      totalTeams: payload.totalTeams,
      totalRounds: undefined,
      advanceToPlayoffs: undefined,
      teamNames: undefined,
      playoffSeedPolicy: eventMode === "playoffs" ? (payload.playoffSeedPolicy ?? "balanced") : undefined,
      playoffSeedMetadata: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "regular_season" ? "AWAITING_REGULAR_SEASON_FORMAT" : "AWAITING_PLAYOFF_FORMAT",
      nextPayload
    );
    if (eventMode === "regular_season") {
      await sendCreateEventRegularSeasonFormatPrompt(chatId);
    } else {
      await sendCreateEventPlayoffFormatPrompt(chatId);
    }
    return;
  }

  if (session.step === "AWAITING_REGULAR_SEASON_FORMAT") {
    const regularSeasonFormat = normalizeRegularSeasonFormatInput(text);
    if (!regularSeasonFormat) {
      await sendTelegramMessage(chatId, 'Pilih "Round Robin", "Double Round Robin", "5 Round", "Custom Round", atau "Swiss Stage".');
      return;
    }

    if (payload.totalTeams !== undefined && payload.totalTeams % 2 !== 0) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_PARTICIPANTS_CUSTOM", {
        ...payload,
        totalTeams: undefined,
        regularSeasonFormat: undefined,
        regularSeasonCustomRounds: undefined,
        totalRounds: undefined,
        teamNames: undefined,
        playoffSeedMetadata: undefined
      });
      await sendTelegramMessage(
        chatId,
        `⚠️ *Jumlah tim harus genap.*\n\nRegular Season tidak bisa dimainkan dengan *${payload.totalTeams} tim* (ganjil).\n\nMasukkan jumlah tim baru (angka genap, 4–256):`
      );
      return;
    }

    const autoCustomRounds = regularSeasonFormat === "custom_round" && payload.suggestedRounds !== undefined
      ? payload.suggestedRounds : undefined;
    const nextPayload = {
      ...payload,
      regularSeasonFormat,
      regularSeasonCustomRounds: autoCustomRounds,
      totalTeams: payload.totalTeams,
      totalRounds: autoCustomRounds,
      advanceToPlayoffs: undefined,
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    const needsCustomRoundsInput = regularSeasonFormat === "custom_round" && autoCustomRounds === undefined;
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      needsCustomRoundsInput ? "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS" : "AWAITING_MATCH_BEST_OF",
      nextPayload
    );
    if (needsCustomRoundsInput) {
      await sendCreateEventRegularSeasonCustomRoundsPrompt(chatId);
    } else {
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    }
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_FORMAT") {
    const playoffFormat = normalizePlayoffFormatInput(text);
    if (!playoffFormat || playoffFormat === "swiss_stage") {
      await sendCreateEventPlayoffFormatPrompt(chatId);
      return;
    }

    const nextPayload = {
      ...payload,
      playoffFormat,
      playoffFinalBestOf: undefined,
      playoffThirdPlaceBestOf: undefined,
      totalTeams: payload.totalTeams,
      totalRounds: undefined,
      teamNames: undefined,
      playoffSeedMetadata: undefined,
      playoffSeedPolicy: payload.playoffSeedPolicy ?? "balanced"
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
    await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    return;
  }

  if (session.step === "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS") {
    const regularSeasonCustomRounds = parsePositiveIntegerInput(text);
    if (!regularSeasonCustomRounds || regularSeasonCustomRounds > 10) {
      await sendTelegramMessage(chatId, "Custom round harus angka 1 sampai 10.");
      return;
    }

    const isNewFlowCustom = payload.suggestedRounds !== undefined && payload.totalTeams !== undefined;
    const nextPayload = {
      ...payload,
      regularSeasonCustomRounds,
      totalRounds: regularSeasonCustomRounds,
      totalTeams: isNewFlowCustom ? payload.totalTeams : undefined,
      advanceToPlayoffs: undefined,
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
    await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    return;
  }

  if (session.step === "AWAITING_MATCH_BEST_OF") {
    const matchBestOf = parsePositiveIntegerInput(text);
    const eventMode = payload.eventMode ?? "regular_season";
    if (!matchBestOf || matchBestOf > 9) {
      await sendTelegramMessage(chatId, "Match Best Of harus angka antara 1 dan 9.");
      return;
    }
    if (eventMode === "playoffs" && matchBestOf % 2 === 0) {
      await sendTelegramMessage(chatId, "Playoffs hanya mendukung BO ganjil seperti BO1, BO3, atau BO5.");
      return;
    }
    if (eventMode === "playoffs" && ![1, 3, 5].includes(matchBestOf)) {
      await sendTelegramMessage(chatId, "Early rounds playoffs hanya mendukung BO1, BO3, atau BO5.");
      return;
    }

    const hasPresetTotalTeams = payload.totalTeams !== undefined;
    const newFlowRS = eventMode === "regular_season" && hasPresetTotalTeams;
    const newFlowTotalRounds = newFlowRS
      ? calculateTournamentTotalRounds(eventMode, payload.totalTeams ?? 0, payload.regularSeasonFormat, payload.regularSeasonCustomRounds, payload.playoffFormat)
      : undefined;

    const nextPayload = {
      ...payload,
      eventMode,
      matchBestOf,
      totalTeams: hasPresetTotalTeams ? payload.totalTeams : undefined,
      totalRounds: newFlowTotalRounds,
      advanceToPlayoffs: eventMode === "regular_season" ? undefined : payload.advanceToPlayoffs,
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    if (eventMode === "playoffs" && payload.playoffFormat === "swiss_stage") {
      nextPayload.playoffSemifinalBestOf = 3;
      nextPayload.playoffFinalBestOf = 3;
    }
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "playoffs"
        ? payload.playoffFormat === "swiss_stage"
          ? "AWAITING_TOTAL_TEAMS"
          : "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF"
        : payload.regularSeasonFormat === "swiss_stage"
          ? "AWAITING_SWISS_DECIDER_BEST_OF"
          : newFlowRS
            ? "AWAITING_ADVANCE_TO_PLAYOFFS"
            : "AWAITING_TOTAL_TEAMS",
      nextPayload
    );
    if (eventMode === "playoffs") {
      if (payload.playoffFormat === "swiss_stage") {
        await sendCreateEventTeamsPrompt(chatId, nextPayload);
      } else {
        await sendCreateEventPlayoffSemifinalBestOfPrompt(chatId);
      }
    } else if (payload.regularSeasonFormat === "swiss_stage") {
      await sendCreateEventSwissDeciderBestOfPrompt(chatId);
    } else if (newFlowRS) {
      await sendCreateEventAdvanceToPlayoffsPrompt(chatId, nextPayload);
    } else {
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
    }
    return;
  }

  if (session.step === "AWAITING_MATCH_BEST_OF_CUSTOM") {
    const matchBestOf = parsePositiveIntegerInput(text);
    if (!matchBestOf || matchBestOf > 9) {
      await sendTelegramMessage(chatId, "Custom BO harus angka antara 1 dan 9.");
      return;
    }

    const eventMode = payload.eventMode ?? "regular_season";
    const newFlowRS = eventMode === "regular_season" && payload.totalTeams !== undefined && (payload.suggestedRounds !== undefined || payload.regularSeasonFormat === "swiss_stage");
    const newFlowTotalRounds = newFlowRS
      ? calculateTournamentTotalRounds(eventMode, payload.totalTeams ?? 0, payload.regularSeasonFormat, payload.regularSeasonCustomRounds, payload.playoffFormat)
      : undefined;
    const nextPayload = {
      ...payload,
      matchBestOf,
      totalTeams: payload.totalTeams,
      totalRounds: newFlowTotalRounds,
      advanceToPlayoffs: eventMode === "regular_season" ? undefined : payload.advanceToPlayoffs,
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    const nextStep = eventMode === "playoffs"
      ? "AWAITING_PLAYOFF_STANDINGS" as const
      : payload.regularSeasonFormat === "swiss_stage"
        ? "AWAITING_SWISS_DECIDER_BEST_OF" as const
        : newFlowRS
          ? "AWAITING_ADVANCE_TO_PLAYOFFS" as const
          : "AWAITING_TOTAL_TEAMS" as const;
    await saveTelegramSession(telegramUserId, session.currentCommand, nextStep, nextPayload);
    if (eventMode === "playoffs") {
      await sendCreateEventPlayoffStandingsPrompt(chatId);
    } else if (payload.regularSeasonFormat === "swiss_stage") {
      await sendCreateEventSwissDeciderBestOfPrompt(chatId);
    } else if (newFlowRS) {
      await sendCreateEventAdvanceToPlayoffsPrompt(chatId, nextPayload);
    } else {
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
    }
    return;
  }

  if (session.step === "AWAITING_SWISS_DECIDER_BEST_OF") {
    const swissDeciderBestOf = parsePositiveIntegerInput(text);
    if (!swissDeciderBestOf || ![1, 3].includes(swissDeciderBestOf)) {
      await sendTelegramMessage(chatId, "Swiss Decider BO hanya mendukung BO1 atau BO3.");
      return;
    }
    const newFlowSwiss = payload.totalTeams !== undefined && (payload.suggestedRounds !== undefined || payload.regularSeasonFormat === "swiss_stage");
    const nextPayload = { ...payload, swissDeciderBestOf };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      newFlowSwiss ? "AWAITING_TEAM_NAMES" : "AWAITING_TOTAL_TEAMS",
      nextPayload
    );
    if (newFlowSwiss) {
      await sendCreateEventTeamNamesPrompt(chatId, payload.totalTeams ?? 0, nextPayload);
    } else {
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
    }
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF") {
    const playoffSemifinalBestOf = parsePositiveIntegerInput(text);
    if (!playoffSemifinalBestOf || ![1, 3, 5].includes(playoffSemifinalBestOf)) {
      await sendTelegramMessage(chatId, "Semifinal BO hanya mendukung BO1, BO3, atau BO5.");
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
      await sendTelegramMessage(chatId, "Grand Final hanya mendukung BO3, BO5, atau BO7.");
      return;
    }

    const nextPayload = { ...payload, playoffFinalBestOf };
    if (payload.playoffStandings === 3) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_THIRD_PLACE_BEST_OF", nextPayload);
      await sendCreateEventPlayoffThirdPlaceBestOfPrompt(chatId);
    } else {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SOURCE", nextPayload);
      await sendCreateEventRegularSeasonSourcePrompt(chatId);
    }
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_THIRD_PLACE_DECISION") {
    const normalized = text.trim().toLowerCase();
    const includeThirdPlace =
      normalized === "yes"
      || normalized === "y"
      || normalized === "with"
      || normalized === "with 3rd place"
      || normalized === "with third place"
      || isTelegramAffirmative(text);
    const skipThirdPlace =
      normalized === "no"
      || normalized === "n"
      || normalized === "without"
      || normalized === "off"
      || isTelegramNegative(text);

    if (!includeThirdPlace && !skipThirdPlace) {
      await sendTelegramMessage(chatId, "Reply yes to include 3rd place match, or no to skip.");
      return;
    }

    if (skipThirdPlace) {
      const nextPayload = {
        ...payload,
        playoffThirdPlaceBestOf: undefined
      };
      if (nextPayload.totalTeams && nextPayload.totalTeams >= 2) {
        await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SOURCE", nextPayload);
        await sendCreateEventRegularSeasonSourcePrompt(chatId);
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", nextPayload);
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
      return;
    }

    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      "AWAITING_PLAYOFF_THIRD_PLACE_BEST_OF",
      {
        ...payload,
        playoffThirdPlaceBestOf: undefined
      }
    );
    await sendCreateEventPlayoffThirdPlaceBestOfPrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_THIRD_PLACE_BEST_OF") {
    const playoffThirdPlaceBestOf = parsePositiveIntegerInput(text);
    if (!playoffThirdPlaceBestOf || ![1, 3, 5].includes(playoffThirdPlaceBestOf)) {
      await sendTelegramMessage(chatId, "3rd place BO only allows BO1, BO3, or BO5.");
      return;
    }

    const nextPayload = {
      ...payload,
      playoffThirdPlaceBestOf
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SOURCE", nextPayload);
    await sendCreateEventRegularSeasonSourcePrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_STANDINGS") {
    await sendCreateEventPlayoffStandingsPrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_PLAYOFF_ADVANCE_COUNT") {
    await sendCreateEventPlayoffAdvanceCountPrompt(chatId, payload.totalTeams ?? 0);
    return;
  }

  if (session.step === "AWAITING_REGULAR_SEASON_SOURCE") {
    await sendCreateEventRegularSeasonSourcePrompt(chatId);
    return;
  }

  if (session.step === "AWAITING_REGULAR_SEASON_EVENT_SELECTION") {
    const events = payload.regularSeasonEventOptions ?? [];
    const selectedIds = payload.regularSeasonSourceEventIds ?? [];
    await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, events, selectedIds);
    return;
  }

  if (session.step === "AWAITING_RS_TOP_N") {
    const rsTopNMax = payload.rsTopNMax ?? 0;
    const rsTopNDefault = payload.rsTopNDefault ?? Math.min(4, rsTopNMax);
    await sendCreateEventRsTopNPrompt(chatId, rsTopNMax, rsTopNDefault);
    return;
  }

  if (session.step === "AWAITING_RS_TOP_N_CUSTOM") {
    const rsTopNMax = payload.rsTopNMax ?? 0;
    const topN = parsePositiveIntegerInput(text);
    if (!topN || topN < 2 || topN > rsTopNMax) {
      await sendTelegramMessage(chatId, `❌ Jumlah tim tidak valid. Masukkan angka antara 2 dan ${rsTopNMax}.`);
      return;
    }
    await proceedRsTopNConfirm(session, payload, topN, chatId, telegramUserId);
    return;
  }

  if (session.step === "AWAITING_REGULAR_SEASON_SEED_PREVIEW") {
    const selectedEventIds = payload.regularSeasonSourceEventIds ?? [];
    if (selectedEventIds.length === 0) {
      const events = payload.regularSeasonEventOptions ?? [];
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_EVENT_SELECTION", payload);
      await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, events, []);
      return;
    }
    const policy = payload.playoffSeedPolicy ?? "balanced";
    const plan = await buildRegularSeasonSeedPlan(selectedEventIds, policy, payload.rsTopN);
    if (plan.failedEvents.length > 0 || plan.numGroups === 0 || plan.totalTeams === 0) {
      await sendTelegramMessage(chatId, "Preview seeding gagal dimuat. Pilih event RS ulang ya.");
      const events = payload.regularSeasonEventOptions ?? [];
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_EVENT_SELECTION", payload);
      await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, events, selectedEventIds);
      return;
    }
    await sendCreateEventRegularSeasonSeedPreviewPrompt(chatId, policy, plan);
    return;
  }

  if (session.step === "AWAITING_TOTAL_TEAMS") {
    const totalTeams = parsePositiveIntegerInput(text);
    const eventMode = payload.eventMode ?? "regular_season";
    if (!totalTeams || totalTeams < 2 || totalTeams > 128) {
      await sendTelegramMessage(chatId, "Total tim harus angka antara 2 dan 128.");
      return;
    }
    if (eventMode === "regular_season" && totalTeams % 2 !== 0) {
      await sendTelegramMessage(chatId, "Regular Season membutuhkan jumlah tim genap.");
      return;
    }
    if (eventMode === "regular_season" && payload.regularSeasonFormat === "swiss_stage" && !TOURNAMENT_SWISS_VALID_TEAM_COUNTS.includes(totalTeams)) {
      await sendTelegramMessage(chatId, `Swiss Stage mendukung ${TOURNAMENT_SWISS_VALID_TEAM_COUNTS.join(", ")} tim.`);
      return;
    }
    if (eventMode === "playoffs" && payload.playoffFormat === "double_elimination" && totalTeams < TOURNAMENT_DE_MIN_TEAMS) {
      await sendTelegramMessage(chatId, `Playoffs Double Elimination membutuhkan minimal ${TOURNAMENT_DE_MIN_TEAMS} tim.`);
      return;
    }
    if (eventMode === "playoffs" && payload.playoffFormat === "single_elimination" && totalTeams < TOURNAMENT_SE_MIN_TEAMS) {
      await sendTelegramMessage(chatId, `Playoffs Single Elimination membutuhkan minimal ${TOURNAMENT_SE_MIN_TEAMS} tim.`);
      return;
    }

    const totalRounds = calculateTournamentTotalRounds(
      eventMode,
      totalTeams,
      payload.regularSeasonFormat,
      payload.regularSeasonCustomRounds,
      payload.playoffFormat
    );
    const nextPayload = {
      ...payload,
      totalTeams,
      totalRounds,
      advanceToPlayoffs: payload.eventMode === "regular_season"
        ? payload.advanceToPlayoffs
        : undefined,
      regularSeasonEventOptions: eventMode === "playoffs" ? undefined : payload.regularSeasonEventOptions,
      regularSeasonSourceEventIds: eventMode === "playoffs" ? undefined : payload.regularSeasonSourceEventIds,
      playoffSeedMetadata: eventMode === "playoffs" ? undefined : payload.playoffSeedMetadata
    };
    if (eventMode === "regular_season") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_ADVANCE_TO_PLAYOFFS", nextPayload);
      await sendCreateEventAdvanceToPlayoffsPrompt(chatId, nextPayload);
      return;
    }

    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
    await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    return;
  }

  if (session.step === "AWAITING_SWISS_FINAL_BEST_OF") {
    const playoffFinalBestOf = parsePositiveIntegerInput(text);
    if (!playoffFinalBestOf || ![3, 5].includes(playoffFinalBestOf)) {
      await sendTelegramMessage(chatId, "Swiss Grand Final BO hanya mendukung BO3 atau BO5.");
      return;
    }

    const nextPayload = { ...payload, playoffFinalBestOf };
    const totalTeams = nextPayload.totalTeams ?? 0;
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
    await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    return;
  }

  if (session.step === "AWAITING_ADVANCE_TO_PLAYOFFS") {
    const totalTeams = payload.totalTeams ?? 0;
    const advanceToPlayoffs = parsePositiveIntegerInput(text);
    if (!advanceToPlayoffs || advanceToPlayoffs < 2 || advanceToPlayoffs > totalTeams) {
      await sendTelegramMessage(chatId, `Jumlah tim lolos playoffs harus antara 2 dan ${totalTeams}.`);
      return;
    }

    const nextPayload = {
      ...payload,
      advanceToPlayoffs
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
    await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    return;
  }

  if (session.step === "AWAITING_TEAM_NAMES") {
    const teamNames = parseTeamNamesInput(text);
    const totalTeams = payload.totalTeams ?? 0;

    if (teamNames.length !== totalTeams) {
      await sendTelegramMessage(chatId, `Expected ${totalTeams} nama tim, tetapi menerima ${teamNames.length}.`);
      return;
    }

    const normalizedNames = teamNames.map((name) => name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      await sendTelegramMessage(chatId, "Nama tim harus unik.");
      return;
    }

    const emojiTeam = teamNames.find((name) => hasEmoji(name));
    if (emojiTeam) {
      await sendTelegramMessage(chatId, `Nama tim tidak boleh mengandung emoji: "${emojiTeam}"\n\nGunakan teks saja. Karakter spesial seperti tanda kurung tetap diperbolehkan.`);
      return;
    }

    const nextPayload = {
      ...payload,
      teamNames,
      playoffSeedMetadata: undefined
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES_REVIEW", nextPayload);
    await sendCreateEventTeamNamesReview(chatId, nextPayload);
    return;
  }

  if (session.step === "AWAITING_TEAM_NAMES_REVIEW") {
    await sendTelegramMessage(chatId, "Gunakan tombol di bawah pesan review untuk melanjutkan atau memasukkan ulang daftar tim.");
    return;
  }

  if (session.step === "AWAITING_CONTACT_PERSON_DECISION") {
    const eventId = payload.createdEventId;
    if (!eventId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Sesi setup kontak kedaluwarsa.");
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

    await sendTelegramMessage(chatId, "Gunakan Tambah Kontak Kapten atau Lewati.");
    return;
  }

  if (session.step === "AWAITING_CONTACT_TEAM_SELECTION") {
    const eventId = payload.createdEventId;
    const isManageContactSession = session.currentCommand === "/event-contact-manage";
    if (!eventId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Sesi setup kontak kedaluwarsa.");
      return;
    }

    const normalized = text.trim().toLowerCase();
    if (normalized === "done" || normalized === "skip" || isTelegramNegative(text)) {
      if (isManageContactSession) {
        await clearTelegramSession(telegramUserId);
        await sendTournamentManageMenu(chatId, eventId);
      } else {
        await finalizeTelegramCreatedEvent(chatId, telegramUserId, eventId);
      }
      return;
    }

    const bundle = await loadTournamentBundle(eventId);
    if (!bundle) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Event tidak ditemukan.");
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
        "Import kontak kapten selesai.",
        `Saved: ${bulkParsed.saved.length}`
      ];

      if (bulkParsed.unknownTeams.length > 0) {
        lines.push("", "Tim tidak ditemukan:");
        lines.push(...bulkParsed.unknownTeams.map((name) => `- ${name}`));
      }

      if (bulkParsed.invalidNumbers.length > 0) {
        lines.push("", "Nomor tidak valid:");
        lines.push(...bulkParsed.invalidNumbers.map((name) => `- ${name}`));
      }

      if (bulkParsed.saved.length === 0 && bulkParsed.unknownTeams.length === 0 && bulkParsed.invalidNumbers.length === 0) {
        lines.push("Tidak ada data yang diimpor.");
      }

      await sendTelegramMessage(chatId, lines.join("\n"));
      await sendCreateEventContactMenu(chatId, eventId);
      return;
    }

    await sendTelegramMessage(
      chatId,
      "Pilih tim dari menu kontak, paste data bulk kontak, atau kirim selesai untuk mengakhiri."
    );
    return;
  }

  if (session.step === "AWAITING_CONTACT_PHONE") {
    const eventId = payload.createdEventId;
    const teamId = payload.selectedContactTeamId;
    if (!eventId || !teamId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Sesi setup kontak kedaluwarsa.");
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
        "Nomor WhatsApp tidak valid. Gunakan kode negara dan angka saja, contoh 6281234567890."
      );
      return;
    }

    const team = await loadTournamentTeamById(teamId);
    if (!team || team.eventId !== eventId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Tim tidak ditemukan.");
      return;
    }

    await db
      .update(tournamentTeams)
      .set({ captainWhatsapp })
      .where(eq(tournamentTeams.id, team.id));
    await invalidateTournamentBundle(eventId);

    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONTACT_TEAM_SELECTION", {
      ...payload,
      selectedContactTeamId: undefined
    });
    await sendTelegramMessage(chatId, `Saved captain contact for ${team.name}.`);
    await sendCreateEventContactMenu(chatId, eventId);
    return;
  }

  if (session.step === "AWAITING_RENAME_TEAM_NEW_NAME") {
    const eventId = payload.createdEventId;
    const teamId = payload.selectedRenameTeamId;
    if (!eventId || !teamId) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Sesi tidak valid. Silakan coba lagi.");
      return;
    }

    if (isTelegramNegative(text) || text.toLowerCase() === "batal") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_RENAME_TEAM_SELECTION", {
        createdEventId: eventId
      });
      await sendTeamRenameMenu(chatId, eventId);
      return;
    }

    const newName = text.trim();
    if (newName.length < 1 || newName.length > 40) {
      await sendTelegramMessage(chatId, "Nama tim harus antara 1–40 karakter. Coba lagi.");
      return;
    }

    if (hasEmoji(newName)) {
      await sendTelegramMessage(chatId, `Nama tim tidak boleh mengandung emoji.\n\nGunakan teks saja. Karakter spesial seperti tanda kurung tetap diperbolehkan.`);
      return;
    }

    const bundle = await loadTournamentBundle(eventId);
    const team = bundle?.teams.find((t) => t.id === teamId);
    if (!bundle || !team) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Tim tidak ditemukan.");
      return;
    }

    const oldName = team.name;
    await db.update(tournamentTeams).set({ name: newName }).where(eq(tournamentTeams.id, teamId));
    await invalidateTournamentBundle(eventId);

    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_RENAME_TEAM_SELECTION", {
      createdEventId: eventId
    });
    await sendTelegramMessage(chatId, `✅ Nama tim berhasil diubah: *${oldName}* → *${newName}*`);
    await sendTeamRenameMenu(chatId, eventId);
    return;
  }

  if (session.step === "AWAITING_CONFIRMATION") {
    if (isTelegramNegative(text)) {
      await clearTelegramSession(telegramUserId);
      await sendTelegramMessage(chatId, "Pembuatan event dibatalkan.");
      return;
    }

    if (!isTelegramAffirmative(text)) {
      await sendTelegramMessage(chatId, 'Ketik "yes" untuk konfirmasi atau "cancel" untuk batal.');
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
      await sendTelegramMessage(chatId, "Gagal membuat event. Mulai ulang dengan /create_new_event.");
      return;
    }
  }

  // Fallback: unrecognized or stale step — reset to fresh start
  if (session.currentCommand === "/create-upcoming-event") {
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_UPCOMING_EVENT_NAME", {});
    await sendTelegramMessage(
      chatId,
      `Sesi sebelumnya sudah kedaluwarsa, yuk isi lagi dari awal.\n\n${upcomingWizardPhaseHeader(1, "Nama Event")}\nMasukkan nama event upcoming.`
    );
    return;
  }
  await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_PARTICIPANTS", {});
  await sendTelegramMessage(chatId, "Sesi sebelumnya sudah kedaluwarsa, yuk mulai dari awal! 😊");
  await sendParticipantsPrompt(chatId);
}

async function handleTelegramGfMetaStep(
  chatId: number | string,
  telegramUserId: string,
  text: string,
  session: typeof telegramSessions.$inferSelect
) {
  const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
  const eventId = payload.grandFinalEventId;
  if (!eventId) {
    await clearTelegramSession(telegramUserId);
    await sendTelegramMessage(chatId, "Sesi tidak valid. Silakan coba lagi.");
    return;
  }

  const isSkip = text.trim().toLowerCase() === "skip";

  if (session.step === "AWAITING_GF_TEAM_A_LOGO") {
    const url = isSkip ? null : text.trim();
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_GF_TEAM_B_LOGO", {
      ...payload,
      grandFinalTeamALogoUrl: url
    });
    await sendTelegramMessage(
      chatId,
      "Kirim URL logo Team B (JPG/PNG), atau kirim \"skip\" untuk lewati."
    );
    return;
  }

  if (session.step === "AWAITING_GF_TEAM_B_LOGO") {
    const url = isSkip ? null : text.trim();
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_GF_YOUTUBE_URL", {
      ...payload,
      grandFinalTeamBLogoUrl: url
    });
    await sendTelegramMessage(
      chatId,
      "Kirim URL YouTube live stream Grand Final, atau kirim \"skip\" untuk lewati."
    );
    return;
  }

  if (session.step === "AWAITING_GF_YOUTUBE_URL") {
    const url = isSkip ? null : text.trim();
    await db
      .update(tournamentEvents)
      .set({
        grandFinalTeamALogoUrl: payload.grandFinalTeamALogoUrl ?? null,
        grandFinalTeamBLogoUrl: payload.grandFinalTeamBLogoUrl ?? null,
        grandFinalYoutubeUrl: url
      })
      .where(eq(tournamentEvents.id, eventId));
    await invalidateTournamentBundle(eventId);
    await clearTelegramSession(telegramUserId);
    await sendTelegramMessage(chatId, "✅ Grand Final info berhasil disimpan!");
    const preview = await loadTournamentNextRoundPreview(telegramUserId, eventId);
    if (preview && preview.eventId === eventId && Array.isArray(preview.pairings) && preview.pairings.length > 0) {
      const bundle = await loadTournamentBundle(eventId);
      if (bundle) {
        await sendTournamentNextRoundPreviewMenu(chatId, bundle, preview.roundNumber, preview.strategy, preview.pairings);
        return;
      }
    }
    await sendTournamentManageMenu(chatId, eventId);
    return;
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

  if (rawData === "create_upcoming_event") {
    await saveTelegramSession(telegramUserId, "/create-upcoming-event", "AWAITING_UPCOMING_EVENT_NAME", {});
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTelegramMessage(
      chatId,
      `${upcomingWizardPhaseHeader(1, "Nama Event")}\nMasukkan nama event upcoming.`
    );
    return;
  }

  if (rawData === "start_create_event") {
    await saveTelegramSession(telegramUserId, "/create-new-event", "AWAITING_TOTAL_PARTICIPANTS", {});
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendParticipantsPrompt(chatId);
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

  if (rawData.startsWith("create_participants:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const participantsRaw = rawData.split(":")[1] ?? "";
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    if (participantsRaw === "custom") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_PARTICIPANTS_CUSTOM", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendTelegramMessage(chatId, "🎮 Buat Event · Jumlah Partisipan\nMasukkan jumlah partisipan (4 sampai 256):");
      return;
    }
    const totalTeams = parsePositiveIntegerInput(participantsRaw);
    if (!totalTeams) {
      await answerTelegramCallbackQuery(callbackQueryId, "Jumlah partisipan tidak valid.");
      return;
    }
    const nextPayload = { ...payload, totalTeams };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_TYPE", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendEventTypePrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_event_type:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const eventTypeRaw = rawData.split(":")[1] ?? "";
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    if (eventTypeRaw === "playoffs") {
      const nextPayload = {
        ...payload,
        eventMode: "playoffs" as const,
        regularSeasonFormat: undefined,
        regularSeasonCustomRounds: undefined,
        matchBestOf: undefined,
        playoffFormat: undefined,
        playoffSemifinalBestOf: undefined,
        playoffFinalBestOf: undefined,
        playoffThirdPlaceBestOf: undefined,
        totalRounds: undefined,
        advanceToPlayoffs: undefined,
        teamNames: undefined,
        playoffSeedPolicy: payload.playoffSeedPolicy ?? "balanced",
        playoffSeedMetadata: undefined
      };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_FORMAT", nextPayload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventPlayoffFormatPrompt(chatId);
      return;
    }
    const nextPayload = {
      ...payload,
      eventMode: "regular_season" as const,
      regularSeasonFormat: undefined,
      regularSeasonCustomRounds: undefined,
      matchBestOf: undefined,
      advanceToPlayoffs: undefined,
      teamNames: undefined,
      playoffSeedPolicy: undefined,
      playoffSeedMetadata: undefined
    };
    await answerTelegramCallbackQuery(callbackQueryId);
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_ROUNDS", nextPayload);
    await sendRegularRoundsPrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_regular_rounds:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const roundsRaw = rawData.split(":")[1] ?? "";
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    if (roundsRaw === "custom") {
      await answerTelegramCallbackQuery(callbackQueryId);
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_ROUNDS_CUSTOM", payload);
      await sendTelegramMessage(chatId, "🎮 Buat Event · Custom Ronde\nMasukkan jumlah ronde (1 sampai 10):");
      return;
    }
    const rounds = parsePositiveIntegerInput(roundsRaw);
    if (!rounds) {
      await answerTelegramCallbackQuery(callbackQueryId, "Jumlah ronde tidak valid.");
      return;
    }
    const totalTeams = payload.totalTeams ?? 16;
    const nextPayload = { ...payload, suggestedRounds: rounds };
    await answerTelegramCallbackQuery(callbackQueryId);
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_FORMAT", nextPayload);
    await sendSuggestedRegularSeasonFormatPrompt(chatId, totalTeams, rounds);
    return;
  }

  if (rawData === "create_regular_format_show_all") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTelegramMessage(
      chatId,
      "🎮 Buat Event · Format Regular Season\nPilih format untuk regular season kamu:",
      { inlineKeyboard: buildRegularSeasonFormatKeyboard() }
    );
    return;
  }

  if (rawData === "create_whatsapp_skip") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = { ...payload, teamWhatsappNumbers: undefined };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_NAME", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventNamePrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_event_mode:")) {
    const session = await loadTelegramSession(telegramUserId);
    const eventMode = normalizeTournamentEventMode(rawData.split(":")[1]);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
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
      playoffThirdPlaceBestOf: undefined,
      playoffFormat: undefined,
      matchBestOf: undefined,
      totalTeams: payload.totalTeams,
      totalRounds: undefined,
      advanceToPlayoffs: undefined,
      teamNames: undefined,
      playoffSeedPolicy: eventMode === "playoffs" ? (payload.playoffSeedPolicy ?? "balanced") : undefined,
      playoffSeedMetadata: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "regular_season" ? "AWAITING_REGULAR_SEASON_FORMAT" : "AWAITING_PLAYOFF_FORMAT",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (eventMode === "regular_season") {
      await sendCreateEventRegularSeasonFormatPrompt(chatId);
    } else {
      await sendCreateEventPlayoffFormatPrompt(chatId);
    }
    return;
  }

  if (rawData.startsWith("create_playoff_format:")) {
    const session = await loadTelegramSession(telegramUserId);
    const playoffFormat = normalizePlayoffFormatInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !playoffFormat) {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = {
      ...payload,
      playoffFormat,
      playoffFinalBestOf: undefined,
      playoffThirdPlaceBestOf: undefined,
      totalTeams: payload.totalTeams,
      totalRounds: undefined,
      teamNames: undefined,
      playoffSeedMetadata: undefined,
      playoffSeedPolicy: payload.playoffSeedPolicy ?? "balanced"
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    return;
  }

  if (rawData.startsWith("create_regular_format:")) {
    const session = await loadTelegramSession(telegramUserId);
    const regularSeasonFormat = normalizeRegularSeasonFormatInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !regularSeasonFormat) {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;

    // Hard error: odd team count blocks all regular season formats
    if (payload.totalTeams !== undefined && payload.totalTeams % 2 !== 0) {
      await answerTelegramCallbackQuery(callbackQueryId);
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_PARTICIPANTS_CUSTOM", {
        ...payload,
        totalTeams: undefined,
        regularSeasonFormat: undefined,
        regularSeasonCustomRounds: undefined,
        totalRounds: undefined,
        teamNames: undefined,
        playoffSeedMetadata: undefined
      });
      await sendTelegramMessage(
        chatId,
        `⚠️ *Jumlah tim harus genap.*\n\nRegular Season tidak bisa dimainkan dengan *${payload.totalTeams} tim* (ganjil).\n\nMasukkan jumlah tim baru (angka genap, 4–256):`
      );
      return;
    }

    // Warning: Round Robin or Double Round Robin with too many teams
    if (
      (regularSeasonFormat === "round_robin" || regularSeasonFormat === "double_round_robin") &&
      payload.totalTeams !== undefined && payload.totalTeams > 16
    ) {
      const rounds = regularSeasonFormat === "round_robin"
        ? payload.totalTeams - 1
        : (payload.totalTeams - 1) * 2;
      const formatLabel = regularSeasonFormat === "round_robin" ? "Round Robin" : "Double Round Robin";
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendTelegramMessage(
        chatId,
        `⚠️ *${formatLabel} dengan ${payload.totalTeams} tim akan menghasilkan ${rounds} ronde.*\n\nIni cukup panjang untuk sebuah regular season. Yakin ingin lanjut, atau pilih format lain?`,
        {
          inlineKeyboard: [
            [{ text: `✅ Lanjut (${rounds} Ronde)`, callback_data: `create_format_force:${regularSeasonFormat}` }],
            [{ text: "← Pilih Format Lain", callback_data: "create_format_force:back" }]
          ]
        }
      );
      return;
    }

    if (regularSeasonFormat === "swiss_stage") {
      const rawTeams = payload.totalTeams ?? 0;
      await answerTelegramCallbackQuery(callbackQueryId);

      if (!TOURNAMENT_SWISS_VALID_TEAM_COUNTS.includes(rawTeams)) {
        const nextPayload = {
          ...payload,
          regularSeasonFormat,
          regularSeasonCustomRounds: undefined,
          suggestedRounds: payload.suggestedRounds,
          totalRounds: undefined,
          advanceToPlayoffs: undefined,
          teamNames: undefined,
          playoffSeedMetadata: undefined
        };
        await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_SWISS_TEAM_COUNT", nextPayload);
        await sendTelegramMessage(
          chatId,
          `⚠️ *Swiss Stage tidak kompatibel dengan ${rawTeams} tim.*\n\nSwiss Stage hanya mendukung *8, 16, atau 32 tim*.\nMau ganti jumlah tim atau pilih format lain?`,
          {
            inlineKeyboard: [
              [
                { text: "8 Tim", callback_data: "create_swiss_teams:8" },
                { text: "16 Tim", callback_data: "create_swiss_teams:16" },
                { text: "32 Tim", callback_data: "create_swiss_teams:32" }
              ],
              [{ text: "← Pilih Format Lain", callback_data: "create_swiss_teams:back" }]
            ]
          }
        );
        return;
      }

      const totalTeams = rawTeams;
      const swissThresholds: Record<number, number> = { 8: 2, 16: 3, 32: 3 };
      const threshold = swissThresholds[totalTeams] ?? 3;
      await sendTelegramMessage(
        chatId,
        `ℹ️ *Swiss Stage · ${totalTeams} Tim*\n\nSwiss Stage bekerja berdasarkan *target kemenangan*, bukan jumlah ronde tetap.\n\n` +
        `🏆 Lolos → setelah *${threshold} kemenangan*\n` +
        `❌ Gugur → setelah *${threshold} kekalahan*\n\n` +
        `Tim tidak perlu bermain sampai batas ronde maksimal — cukup capai target kemenangan lebih dulu.`
      );
      const nextPayload = {
        ...payload,
        regularSeasonFormat,
        totalTeams,
        regularSeasonCustomRounds: undefined,
        suggestedRounds: undefined,
        totalRounds: undefined,
        advanceToPlayoffs: getSwissAdvanceToPlayoffs(totalTeams),
        teamNames: undefined,
        playoffSeedMetadata: undefined
      };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
      return;
    }

    const autoCustomRounds = regularSeasonFormat === "custom_round" && payload.suggestedRounds !== undefined
      ? payload.suggestedRounds : undefined;
    const nextPayload = {
      ...payload,
      regularSeasonFormat,
      regularSeasonCustomRounds: autoCustomRounds,
      totalTeams: payload.totalTeams,
      totalRounds: autoCustomRounds,
      advanceToPlayoffs: undefined,
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    const needsCustomRoundsInput = regularSeasonFormat === "custom_round" && autoCustomRounds === undefined;
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      needsCustomRoundsInput ? "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS" : "AWAITING_MATCH_BEST_OF",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (needsCustomRoundsInput) {
      await sendCreateEventRegularSeasonCustomRoundsPrompt(chatId);
    } else {
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    }
    return;
  }

  if (rawData.startsWith("create_swiss_teams:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const swissTeamsRaw = rawData.split(":")[1] ?? "";
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;

    if (swissTeamsRaw === "back") {
      await answerTelegramCallbackQuery(callbackQueryId);
      const hasSuggestedRounds = payload.suggestedRounds !== undefined && payload.totalTeams !== undefined;
      const backPayload = {
        ...payload,
        regularSeasonFormat: undefined,
        regularSeasonCustomRounds: undefined,
        totalRounds: undefined,
        advanceToPlayoffs: undefined,
        teamNames: undefined,
        playoffSeedMetadata: undefined
      };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_FORMAT", backPayload);
      if (hasSuggestedRounds) {
        await sendSuggestedRegularSeasonFormatPrompt(chatId, payload.totalTeams!, payload.suggestedRounds!);
      } else {
        await sendCreateEventRegularSeasonFormatPrompt(chatId);
      }
      return;
    }

    const totalTeams = parsePositiveIntegerInput(swissTeamsRaw);
    if (!totalTeams || !TOURNAMENT_SWISS_VALID_TEAM_COUNTS.includes(totalTeams)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilih 8, 16, atau 32 tim.");
      return;
    }

    await answerTelegramCallbackQuery(callbackQueryId);
    const swissThresholds: Record<number, number> = { 8: 2, 16: 3, 32: 3 };
    const threshold = swissThresholds[totalTeams] ?? 3;
    await sendTelegramMessage(
      chatId,
      `ℹ️ *Swiss Stage · ${totalTeams} Tim*\n\nSwiss Stage bekerja berdasarkan *target kemenangan*, bukan jumlah ronde tetap.\n\n` +
      `🏆 Lolos → setelah *${threshold} kemenangan*\n` +
      `❌ Gugur → setelah *${threshold} kekalahan*\n\n` +
      `Tim tidak perlu bermain sampai batas ronde maksimal — cukup capai target kemenangan lebih dulu.`
    );
    const nextPayload = {
      ...payload,
      regularSeasonFormat: "swiss_stage" as const,
      totalTeams,
      regularSeasonCustomRounds: undefined,
      suggestedRounds: undefined,
      totalRounds: undefined,
      advanceToPlayoffs: getSwissAdvanceToPlayoffs(totalTeams),
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
    await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    return;
  }

  if (rawData.startsWith("create_format_force:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const forceTarget = rawData.split(":")[1] ?? "";
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;

    if (forceTarget === "back") {
      await answerTelegramCallbackQuery(callbackQueryId);
      const hasSuggestedRounds = payload.suggestedRounds !== undefined && payload.totalTeams !== undefined;
      const backPayload = {
        ...payload,
        regularSeasonFormat: undefined,
        regularSeasonCustomRounds: undefined,
        totalRounds: undefined,
        advanceToPlayoffs: undefined,
        teamNames: undefined,
        playoffSeedMetadata: undefined
      };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_FORMAT", backPayload);
      if (hasSuggestedRounds) {
        await sendSuggestedRegularSeasonFormatPrompt(chatId, payload.totalTeams!, payload.suggestedRounds!);
      } else {
        await sendCreateEventRegularSeasonFormatPrompt(chatId);
      }
      return;
    }

    const regularSeasonFormat = normalizeRegularSeasonFormatInput(forceTarget);
    if (!regularSeasonFormat) {
      await answerTelegramCallbackQuery(callbackQueryId, "Format tidak valid.");
      return;
    }

    const autoCustomRounds = regularSeasonFormat === "custom_round" && payload.suggestedRounds !== undefined
      ? payload.suggestedRounds : undefined;
    const nextPayload = {
      ...payload,
      regularSeasonFormat,
      regularSeasonCustomRounds: autoCustomRounds,
      totalTeams: payload.suggestedRounds !== undefined ? payload.totalTeams : undefined,
      totalRounds: autoCustomRounds,
      advanceToPlayoffs: undefined,
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    const needsCustomRoundsInput = regularSeasonFormat === "custom_round" && autoCustomRounds === undefined;
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      needsCustomRoundsInput ? "AWAITING_REGULAR_SEASON_CUSTOM_ROUNDS" : "AWAITING_MATCH_BEST_OF",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (needsCustomRoundsInput) {
      await sendCreateEventRegularSeasonCustomRoundsPrompt(chatId);
    } else {
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
    }
    return;
  }

  if (rawData.startsWith("create_match_best_of:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const matchBestOfRaw = rawData.split(":")[1] ?? "";
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const eventMode = payload.eventMode ?? "regular_season";
    const matchBestOf = parsePositiveIntegerInput(matchBestOfRaw);
    if (!matchBestOf || matchBestOf > 9) {
      await answerTelegramCallbackQuery(callbackQueryId, "Nilai BO tidak valid.");
      return;
    }
    if (eventMode === "playoffs" && matchBestOf % 2 === 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Playoffs hanya mendukung BO ganjil.");
      return;
    }
    if (eventMode === "playoffs" && ![1, 3, 5].includes(matchBestOf)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Early rounds playoffs hanya mendukung BO1, BO3, atau BO5.");
      return;
    }

    const newFlowRegularSeason = eventMode === "regular_season" && payload.totalTeams !== undefined && (payload.suggestedRounds !== undefined || payload.regularSeasonFormat === "swiss_stage");
    const newFlowTotalRounds = newFlowRegularSeason
      ? calculateTournamentTotalRounds(
          eventMode,
          payload.totalTeams ?? 0,
          payload.regularSeasonFormat,
          payload.regularSeasonCustomRounds,
          payload.playoffFormat
        )
      : undefined;
    const nextPayload = {
      ...payload,
      matchBestOf,
      totalTeams: payload.totalTeams,
      totalRounds: newFlowTotalRounds,
      advanceToPlayoffs: eventMode === "regular_season" ? undefined : payload.advanceToPlayoffs,
      teamNames: undefined,
      playoffSeedMetadata: undefined
    };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      eventMode === "playoffs"
        ? "AWAITING_PLAYOFF_STANDINGS"
        : payload.regularSeasonFormat === "swiss_stage"
          ? "AWAITING_SWISS_DECIDER_BEST_OF"
          : newFlowRegularSeason
            ? "AWAITING_ADVANCE_TO_PLAYOFFS"
            : "AWAITING_TOTAL_TEAMS",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (eventMode === "playoffs") {
      await sendCreateEventPlayoffStandingsPrompt(chatId);
    } else if (payload.regularSeasonFormat === "swiss_stage") {
      await sendCreateEventSwissDeciderBestOfPrompt(chatId);
    } else if (newFlowRegularSeason) {
      await sendCreateEventAdvanceToPlayoffsPrompt(chatId, nextPayload);
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
      await answerTelegramCallbackQuery(callbackQueryId, "Nilai Grand Final BO tidak valid.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = { ...payload, playoffFinalBestOf };

    if (payload.playoffStandings === 3) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_THIRD_PLACE_BEST_OF", nextPayload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventPlayoffThirdPlaceBestOfPrompt(chatId);
    } else {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SOURCE", nextPayload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventRegularSeasonSourcePrompt(chatId);
    }
    return;
  }

  if (rawData.startsWith("create_playoff_third_place:")) {
    const session = await loadTelegramSession(telegramUserId);
    const decision = (rawData.split(":")[1] ?? "").trim().toLowerCase();
    if (!session || session.currentCommand !== "/create-new-event" || (decision !== "yes" && decision !== "no")) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid 3rd place option.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    if (decision === "no") {
      const nextPayload = {
        ...payload,
        playoffThirdPlaceBestOf: undefined
      };
      await saveTelegramSession(
        telegramUserId,
        session.currentCommand,
        nextPayload.totalTeams && nextPayload.totalTeams >= 2 ? "AWAITING_REGULAR_SEASON_SOURCE" : "AWAITING_TOTAL_TEAMS",
        nextPayload
      );
      await answerTelegramCallbackQuery(callbackQueryId);
      if (nextPayload.totalTeams && nextPayload.totalTeams >= 2) {
        await sendCreateEventRegularSeasonSourcePrompt(chatId);
      } else {
        await sendCreateEventTeamsPrompt(chatId, nextPayload);
      }
      return;
    }

    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      "AWAITING_PLAYOFF_THIRD_PLACE_BEST_OF",
      {
        ...payload,
        playoffThirdPlaceBestOf: undefined
      }
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventPlayoffThirdPlaceBestOfPrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_playoff_third_place_best_of:")) {
    const session = await loadTelegramSession(telegramUserId);
    const playoffThirdPlaceBestOf = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (
      !session
      || session.currentCommand !== "/create-new-event"
      || !playoffThirdPlaceBestOf
      || ![1, 3, 5].includes(playoffThirdPlaceBestOf)
    ) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid 3rd place BO value.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = {
      ...payload,
      playoffThirdPlaceBestOf
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SOURCE", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventRegularSeasonSourcePrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_playoff_standings:")) {
    const session = await loadTelegramSession(telegramUserId);
    const standingsRaw = rawData.split(":")[1] ?? "";
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilihan tidak valid.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;

    if (standingsRaw === "custom") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_ADVANCE_COUNT", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventPlayoffAdvanceCountPrompt(chatId, payload.totalTeams ?? 0);
      return;
    }

    const playoffStandings = parsePositiveIntegerInput(standingsRaw);
    if (!playoffStandings || ![1, 2, 3].includes(playoffStandings)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilihan tidak valid.");
      return;
    }

    const nextPayload = { ...payload, playoffStandings };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventPlayoffSemifinalBestOfPrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_playoff_advance_count:")) {
    const session = await loadTelegramSession(telegramUserId);
    const advanceCount = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !advanceCount || advanceCount < 2) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilihan tidak valid.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    await answerTelegramCallbackQuery(callbackQueryId);

    if (advanceCount === 2) {
      const nextPayload = { ...payload, playoffAdvanceCount: 2, playoffStandings: 2 as const };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_SEMIFINAL_BEST_OF", nextPayload);
      await sendCreateEventPlayoffSemifinalBestOfPrompt(chatId);
      return;
    }

    const totalTeams = payload.totalTeams ?? 0;
    const totalRounds = totalTeams > 0 && advanceCount > 0
      ? Math.round(Math.log2(totalTeams / advanceCount))
      : undefined;
    const nextPayload = { ...payload, playoffAdvanceCount: advanceCount, ...(totalRounds !== undefined ? { totalRounds } : {}) };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SOURCE", nextPayload);
    await sendCreateEventRegularSeasonSourcePrompt(chatId);
    return;
  }

  if (rawData.startsWith("create_rs_source:")) {
    const session = await loadTelegramSession(telegramUserId);
    const choice = rawData.split(":")[1] ?? "";
    if (!session || session.currentCommand !== "/create-new-event" || (choice !== "yes" && choice !== "new")) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilihan tidak valid.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    await answerTelegramCallbackQuery(callbackQueryId);

    if (choice === "new") {
      const nextPayload = {
        ...payload,
        regularSeasonEventOptions: undefined,
        regularSeasonSourceEventIds: undefined,
        playoffSeedPolicy: undefined,
        playoffSeedMetadata: undefined
      };
      if (nextPayload.totalTeams && nextPayload.totalTeams >= 2) {
        await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
        await sendCreateEventTeamNamesPrompt(chatId, nextPayload.totalTeams, nextPayload);
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", nextPayload);
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
      return;
    }

    const rsEvents = await db
      .select({
        id: tournamentEvents.id,
        code: tournamentEvents.code,
        name: tournamentEvents.name,
        totalTeams: tournamentEvents.totalTeams,
        advanceToPlayoffs: tournamentEvents.advanceToPlayoffs
      })
      .from(tournamentEvents)
      .where(
        and(
          eq(tournamentEvents.createdByTelegramUserId, telegramUserId),
          eq(tournamentEvents.eventMode, "regular_season"),
          eq(tournamentEvents.status, "completed")
        )
      )
      .orderBy(desc(tournamentEvents.createdAt))
      .limit(20);

    if (rsEvents.length === 0) {
      await sendTelegramMessage(chatId, "Hmm, kamu belum punya event Regular Season yang statusnya selesai (completed). Yuk buat bracket baru aja! 😊");
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", payload);
      await sendCreateEventTeamsPrompt(chatId, payload);
      return;
    }

    const nextPayload = {
      ...payload,
      regularSeasonEventOptions: rsEvents.map(ev => ({
        id: ev.id,
        code: ev.code,
        name: ev.name,
        totalTeams: ev.totalTeams ?? 0,
        advanceToPlayoffs: resolveTournamentAdvanceToPlayoffs(ev.totalTeams ?? 0, ev.advanceToPlayoffs)
      })),
      regularSeasonSourceEventIds: [] as number[],
      playoffSeedPolicy: payload.playoffSeedPolicy ?? "balanced"
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_EVENT_SELECTION", nextPayload);
    await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, nextPayload.regularSeasonEventOptions, []);
    return;
  }

  if (rawData.startsWith("create_rs_event_toggle:")) {
    const session = await loadTelegramSession(telegramUserId);
    const toggleId = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !toggleId) {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const currentSelected = payload.regularSeasonSourceEventIds ?? [];
    const newSelected = currentSelected.includes(toggleId)
      ? currentSelected.filter(id => id !== toggleId)
      : [...currentSelected, toggleId];

    const nextPayload = {
      ...payload,
      regularSeasonSourceEventIds: newSelected,
      teamNames: undefined,
      totalTeams: undefined,
      totalRounds: undefined,
      playoffSeedMetadata: undefined
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_EVENT_SELECTION", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    const events = payload.regularSeasonEventOptions ?? [];
    await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, events, newSelected);
    return;
  }

  if (rawData === "create_rs_event_confirm") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const selectedEventIds = payload.regularSeasonSourceEventIds ?? [];
    const allowedEventIds = new Set((payload.regularSeasonEventOptions ?? []).map(event => event.id));

    if (selectedEventIds.length === 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilih minimal 1 event dulu ya.");
      return;
    }
    if (!selectedEventIds.every(eventId => allowedEventIds.has(eventId))) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilihan event tidak valid. Silakan pilih ulang.");
      const events = payload.regularSeasonEventOptions ?? [];
      await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, events, []);
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_EVENT_SELECTION", {
        ...payload,
        regularSeasonSourceEventIds: []
      });
      return;
    }

    const policy = payload.playoffSeedPolicy ?? "balanced";
    await answerTelegramCallbackQuery(callbackQueryId, "Menyusun preview seeding...");

    const plan = await buildRegularSeasonSeedPlan(selectedEventIds, policy);
    if (plan.failedEvents.length > 0) {
      await sendTelegramMessage(
        chatId,
        `❌ Gagal memuat data dari beberapa event:\n${plan.failedEvents.map(item => `- ${item}`).join("\n")}\n\nPastikan semua event yang dipilih sudah selesai, lalu pilih ulang.`
      );
      const events = payload.regularSeasonEventOptions ?? [];
      await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, events, selectedEventIds);
      return;
    }
    if (plan.numGroups === 0 || plan.totalTeams === 0) {
      await sendTelegramMessage(chatId, "Gagal memuat data dari event yang dipilih. Coba lagi ya.");
      return;
    }
    if (plan.duplicateTeams.length > 0) {
      await sendTelegramMessage(
        chatId,
        `❌ Ada nama tim duplikat antar grup RS: ${plan.duplicateTeams.slice(0, 6).join(", ")}${plan.duplicateTeams.length > 6 ? "..." : ""}\n\nUbah nama tim agar unik dulu sebelum dijadikan peserta Playoffs.`
      );
      return;
    }

    const rsTopNMax = plan.totalTeams;
    const rsTopNDefault = Math.min(
      (payload.regularSeasonEventOptions ?? [])
        .filter(ev => selectedEventIds.includes(ev.id))
        .reduce((sum, ev) => sum + ev.advanceToPlayoffs, 0),
      rsTopNMax
    );

    const topNPayload: TelegramSessionPayload = {
      ...payload,
      playoffSeedPolicy: policy,
      rsTopNMax,
      rsTopNDefault,
      rsTopN: undefined,
      teamNames: plan.teamNames,
      totalTeams: plan.totalTeams
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_RS_TOP_N", topNPayload);
    await sendCreateEventRsTopNPrompt(chatId, rsTopNMax, rsTopNDefault > 0 ? rsTopNDefault : Math.min(4, rsTopNMax));
    return;
  }

  if (rawData.startsWith("create_rs_top_n:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const rsTopNMax = payload.rsTopNMax ?? 0;
    const rsTopNDefault = payload.rsTopNDefault ?? Math.min(4, rsTopNMax);

    if (rawData === "create_rs_top_n:custom") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_RS_TOP_N_CUSTOM", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendTelegramMessage(
        chatId,
        `${wizardPhaseHeader(3, "Ambil Top Tim RS")}\n\nKetik jumlah tim yang ingin diambil (angka genap, minimal 2, maksimal ${rsTopNMax}):`
      );
      return;
    }

    const topN = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!topN || topN < 2 || topN > rsTopNMax) {
      await answerTelegramCallbackQuery(callbackQueryId, `Pilihan tidak valid. Maksimal ${rsTopNMax} tim.`);
      return;
    }

    await answerTelegramCallbackQuery(callbackQueryId);
    await proceedRsTopNConfirm(session, payload, topN, chatId, telegramUserId);
    return;
  }

  if (rawData.startsWith("create_rs_seed_policy:")) {
    const session = await loadTelegramSession(telegramUserId);
    const policyRaw = rawData.split(":")[1] ?? "";
    const policy = playoffSeedPolicySchema.safeParse(policyRaw);
    if (!session || session.currentCommand !== "/create-new-event" || !policy.success) {
      await answerTelegramCallbackQuery(callbackQueryId, "Policy seeding tidak valid.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const selectedEventIds = payload.regularSeasonSourceEventIds ?? [];
    if (selectedEventIds.length === 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Pilih event RS dulu.");
      return;
    }

    const plan = await buildRegularSeasonSeedPlan(selectedEventIds, policy.data, payload.rsTopN);
    if (plan.failedEvents.length > 0 || plan.numGroups === 0 || plan.totalTeams === 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Gagal memuat seed preview.");
      return;
    }
    if (plan.duplicateTeams.length > 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Ada nama tim duplikat antar source RS.");
      return;
    }

    const totalRounds = calculateTournamentTotalRounds("playoffs", plan.totalTeams, undefined, undefined, payload.playoffFormat, payload.playoffAdvanceCount);
    const nextPayload: TelegramSessionPayload = {
      ...payload,
      playoffSeedPolicy: policy.data,
      teamNames: plan.teamNames,
      totalTeams: plan.totalTeams,
      totalRounds,
      playoffSeedMetadata: {
        source: "regular_season",
        seedingPolicy: policy.data,
        rsTopN: payload.rsTopN,
        sources: plan.sourceGroups.map(group => ({
          eventId: group.sourceEventId,
          eventName: group.sourceEventName,
          format: group.sourceFormat,
          totalRounds: group.sourceTotalRounds,
          matchBestOf: group.sourceMatchBestOf,
          totalTeams: group.teams.length
        })),
        entries: plan.seeded.entries.map((entry, index) => ({
          seed: index + 1,
          teamName: entry.teamName,
          sourceEventId: entry.sourceEventId,
          sourceEventName: entry.sourceEventName,
          sourceRank: entry.rank
        })),
        diagnostics: {
          firstRoundSameSourceConflictsBefore: plan.seeded.initialConflictCount,
          firstRoundSameSourceConflictsAfter: plan.seeded.finalConflictCount,
          warnings: plan.warnings
        }
      }
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_SEED_PREVIEW", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId, `Policy diubah ke ${formatPlayoffSeedPolicyLabel(policy.data)}.`);
    await sendCreateEventRegularSeasonSeedPreviewPrompt(chatId, policy.data, plan);
    return;
  }

  if (rawData === "create_rs_seed_back") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi tidak ditemukan.");
      return;
    }
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const events = payload.regularSeasonEventOptions ?? [];
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_REGULAR_SEASON_EVENT_SELECTION", {
      ...payload,
      teamNames: undefined,
      totalTeams: undefined,
      totalRounds: undefined,
      playoffSeedMetadata: undefined
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventRegularSeasonEventSelectionPrompt(chatId, events, payload.regularSeasonSourceEventIds ?? []);
    return;
  }

  if (rawData === "create_rs_seed_apply") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi tidak ditemukan.");
      return;
    }
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    if (!payload.teamNames || payload.teamNames.length === 0 || !payload.totalTeams || !payload.totalRounds) {
      await answerTelegramCallbackQuery(callbackQueryId, "Seed preview belum siap.");
      return;
    }
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_WHATSAPP_NUMBERS", payload);
    await answerTelegramCallbackQuery(callbackQueryId, "Seed dipakai. Lanjut ke kontak tim.");
    await sendWhatsappNumbersPrompt(chatId, payload.teamNames);
    return;
  }

  if (rawData.startsWith("create_total_teams:")) {
    const session = await loadTelegramSession(telegramUserId);
    const [, modeRaw, totalTeamsRaw] = rawData.split(":");
    const totalTeams = parsePositiveIntegerInput(totalTeamsRaw ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !totalTeams || totalTeams < 2) {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const eventMode = normalizeTournamentEventMode(modeRaw);
    if (eventMode === "regular_season" && totalTeams % 2 !== 0) {
      await answerTelegramCallbackQuery(callbackQueryId, "Regular Season membutuhkan jumlah tim genap.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    if (eventMode === "regular_season" && payload.regularSeasonFormat === "swiss_stage" && !TOURNAMENT_SWISS_VALID_TEAM_COUNTS.includes(totalTeams)) {
      await answerTelegramCallbackQuery(
        callbackQueryId,
        `Swiss Stage mendukung ${TOURNAMENT_SWISS_VALID_TEAM_COUNTS.join(", ")} tim.`
      );
      return;
    }
    if (eventMode === "playoffs" && payload.playoffFormat === "double_elimination" && totalTeams < TOURNAMENT_DE_MIN_TEAMS) {
      await answerTelegramCallbackQuery(
        callbackQueryId,
        `Playoffs Double Elimination membutuhkan minimal ${TOURNAMENT_DE_MIN_TEAMS} tim.`
      );
      return;
    }
    if (eventMode === "playoffs" && payload.playoffFormat === "single_elimination" && totalTeams < TOURNAMENT_SE_MIN_TEAMS) {
      await answerTelegramCallbackQuery(
        callbackQueryId,
        `Playoffs Single Elimination membutuhkan minimal ${TOURNAMENT_SE_MIN_TEAMS} tim.`
      );
      return;
    }
    const totalRounds = calculateTournamentTotalRounds(
      eventMode,
      totalTeams,
      payload.regularSeasonFormat,
      payload.regularSeasonCustomRounds,
      payload.playoffFormat
    );
    const nextPayload = {
      ...payload,
      eventMode,
      totalTeams,
      totalRounds,
      advanceToPlayoffs: eventMode === "regular_season" ? payload.advanceToPlayoffs : undefined,
      regularSeasonEventOptions: eventMode === "playoffs" ? undefined : payload.regularSeasonEventOptions,
      regularSeasonSourceEventIds: eventMode === "playoffs" ? undefined : payload.regularSeasonSourceEventIds,
      playoffSeedMetadata: eventMode === "playoffs" ? undefined : payload.playoffSeedMetadata
    };
    await answerTelegramCallbackQuery(callbackQueryId);
    if (eventMode === "regular_season") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_ADVANCE_TO_PLAYOFFS", nextPayload);
      await sendCreateEventAdvanceToPlayoffsPrompt(chatId, nextPayload);
    } else {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
      await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    }
    return;
  }

  if (rawData.startsWith("create_swiss_decider_best_of:")) {
    const session = await loadTelegramSession(telegramUserId);
    const swissDeciderBestOf = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !swissDeciderBestOf || ![1, 3].includes(swissDeciderBestOf)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Nilai BO Swiss Decider tidak valid.");
      return;
    }
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const newFlowRegularSeason = payload.eventMode === "regular_season" && payload.totalTeams !== undefined && (payload.suggestedRounds !== undefined || payload.regularSeasonFormat === "swiss_stage");
    const nextPayload = { ...payload, swissDeciderBestOf };
    await saveTelegramSession(
      telegramUserId,
      session.currentCommand,
      newFlowRegularSeason ? "AWAITING_TEAM_NAMES" : "AWAITING_TOTAL_TEAMS",
      nextPayload
    );
    await answerTelegramCallbackQuery(callbackQueryId);
    if (newFlowRegularSeason) {
      await sendCreateEventTeamNamesPrompt(chatId, payload.totalTeams ?? 0, nextPayload);
    } else {
      await sendCreateEventTeamsPrompt(chatId, nextPayload);
    }
    return;
  }

  if (rawData.startsWith("create_swiss_final_best_of:")) {
    const session = await loadTelegramSession(telegramUserId);
    const playoffFinalBestOf = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !playoffFinalBestOf || ![3, 5].includes(playoffFinalBestOf)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid Grand Final BO value.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const nextPayload = { ...payload, playoffFinalBestOf };
    const totalTeams = nextPayload.totalTeams ?? 0;
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    return;
  }

  if (rawData.startsWith("create_advance_to_playoffs:")) {
    const session = await loadTelegramSession(telegramUserId);
    const advanceToPlayoffs = parsePositiveIntegerInput(rawData.split(":")[1] ?? "");
    if (!session || session.currentCommand !== "/create-new-event" || !advanceToPlayoffs) {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const totalTeams = payload.totalTeams ?? 0;
    if (totalTeams < 2 || advanceToPlayoffs < 2 || advanceToPlayoffs > totalTeams) {
      await answerTelegramCallbackQuery(
        callbackQueryId,
        totalTeams >= 2
          ? `Playoff advance must be between 2 and ${totalTeams}.`
          : "Atur total tim dulu."
      );
      return;
    }

    const nextPayload = {
      ...payload,
      advanceToPlayoffs
    };
    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", nextPayload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventTeamNamesPrompt(chatId, totalTeams, nextPayload);
    return;
  }

  if (rawData === "create_team_names_confirm") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    const isNewRegularFlow = payload.eventMode === "regular_season" && (payload.suggestedRounds !== undefined || payload.regularSeasonFormat === "swiss_stage");
    if (isNewRegularFlow) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_WHATSAPP_NUMBERS", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendWhatsappNumbersPrompt(chatId, payload.teamNames ?? []);
      return;
    }

    if (!payload.eventName) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_NAME", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventNamePrompt(chatId);
      return;
    }

    if (!payload.eventDate) {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_DATE", payload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventDatePrompt(chatId);
      return;
    }

    await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_CONFIRMATION", payload);
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventConfirmation(chatId, payload);
    return;
  }

  if (rawData === "create_team_names_retry") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
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
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    if (session.step !== "AWAITING_CONFIRMATION" || !hasCompleteCreateEventDraft(payload)) {
      if (!payload.eventName) {
        await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_NAME", payload);
        await answerTelegramCallbackQuery(callbackQueryId, "Lengkapi nama event dulu.");
        await sendCreateEventNamePrompt(chatId);
        return;
      }
      if (!payload.eventDate) {
        await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_EVENT_DATE", payload);
        await answerTelegramCallbackQuery(callbackQueryId, "Lengkapi tanggal event dulu.");
        await sendCreateEventDatePrompt(chatId);
        return;
      }
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi belum lengkap. Lanjutkan pengisian event.");
      return;
    }

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
      await answerTelegramCallbackQuery(callbackQueryId, "Gagal membuat event.");
      await sendTelegramMessage(chatId, "Gagal membuat event. Mulai ulang dengan /create_new_event.");
      return;
    }
  }

  if (rawData.startsWith("create_contact_")) {
    const session = await loadTelegramSession(telegramUserId);
    const supportsContactFlow =
      session
      && (
        session.currentCommand === "/create-new-event"
        || session.currentCommand === "/event-contact-manage"
      );
    if (!supportsContactFlow) {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }

    const payload = (session!.payloadJson ?? {}) as TelegramSessionPayload;
    const [contactAction, eventIdRaw, teamIdRaw] = rawData.split(":");
    const eventId = Number.parseInt(eventIdRaw ?? "", 10);
    const teamId = Number.parseInt(teamIdRaw ?? "", 10);
    const isManageContactSession = session!.currentCommand === "/event-contact-manage";

    if (!Number.isInteger(eventId) || !payload.createdEventId || payload.createdEventId !== eventId) {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi setup kontak kedaluwarsa.");
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
      await saveTelegramSession(telegramUserId, session!.currentCommand, "AWAITING_CONTACT_TEAM_SELECTION", {
        ...payload,
        selectedContactTeamId: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventContactMenu(chatId, eventId);
      return;
    }

    if (contactAction === "create_contact_skip" || contactAction === "create_contact_done") {
      await answerTelegramCallbackQuery(callbackQueryId, "Contact setup finished.");
      if (isManageContactSession) {
        await clearTelegramSession(telegramUserId);
        await sendTournamentManageMenu(chatId, eventId);
      } else {
        await finalizeTelegramCreatedEvent(chatId, telegramUserId, eventId);
      }
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

      await saveTelegramSession(telegramUserId, session!.currentCommand, "AWAITING_CONTACT_PHONE", {
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
    await answerTelegramCallbackQuery(callbackQueryId, "Dibatalkan.");
    await sendTelegramMessage(chatId, "Pembuatan event dibatalkan.");
    return;
  }

  if (rawData === "create_edit_menu") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventEditMenu(chatId, payload);
    return;
  }

  if (rawData === "create_back_to_confirm") {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
      return;
    }
    const payload = (session.payloadJson ?? {}) as TelegramSessionPayload;
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventConfirmation(chatId, payload);
    return;
  }

  if (rawData.startsWith("create_edit:")) {
    const session = await loadTelegramSession(telegramUserId);
    if (!session || session.currentCommand !== "/create-new-event") {
      await answerTelegramCallbackQuery(callbackQueryId, "Sesi buat event tidak ditemukan.");
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
        playoffFormat: undefined,
        regularSeasonCustomRounds: undefined,
        playoffSemifinalBestOf: undefined,
        playoffFinalBestOf: undefined,
        playoffThirdPlaceBestOf: undefined,
        matchBestOf: undefined,
        totalTeams: undefined,
        totalRounds: undefined,
        advanceToPlayoffs: undefined,
        teamNames: undefined,
        playoffSeedPolicy: undefined,
        playoffSeedMetadata: undefined
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
        advanceToPlayoffs: undefined,
        teamNames: undefined,
        playoffSeedMetadata: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventRegularSeasonFormatPrompt(chatId);
      return;
    }

    if (target === "playoff_format") {
      if (payload.eventMode !== "playoffs") {
        await answerTelegramCallbackQuery(callbackQueryId, "Playoff format only applies to Playoffs.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_FORMAT", {
        ...payload,
        playoffFormat: undefined,
        playoffSemifinalBestOf: undefined,
        playoffFinalBestOf: undefined,
        playoffThirdPlaceBestOf: undefined,
        matchBestOf: undefined,
        totalTeams: undefined,
        totalRounds: undefined,
        teamNames: undefined,
        playoffSeedPolicy: payload.playoffSeedPolicy ?? "balanced",
        playoffSeedMetadata: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventPlayoffFormatPrompt(chatId);
      return;
    }

    if (target === "match_best_of") {
      const nextPayload = {
        ...payload,
        matchBestOf: undefined,
        playoffSemifinalBestOf: payload.eventMode === "playoffs" ? undefined : payload.playoffSemifinalBestOf,
        playoffFinalBestOf: payload.eventMode === "playoffs" ? undefined : payload.playoffFinalBestOf,
        playoffThirdPlaceBestOf: payload.eventMode === "playoffs" ? undefined : payload.playoffThirdPlaceBestOf,
        totalTeams: undefined,
        totalRounds: undefined,
        advanceToPlayoffs: payload.eventMode === "regular_season" ? undefined : payload.advanceToPlayoffs,
        teamNames: undefined,
        playoffSeedMetadata: undefined
      };
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_MATCH_BEST_OF", nextPayload);
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventMatchBestOfPrompt(chatId, nextPayload);
      return;
    }

    if (target === "third_place") {
      if (payload.eventMode !== "playoffs") {
        await answerTelegramCallbackQuery(callbackQueryId, "3rd place setup only applies to Playoffs.");
        return;
      }
      if (payload.playoffFormat === "double_elimination") {
        await answerTelegramCallbackQuery(callbackQueryId, "3rd place setup is only available for single elimination.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_PLAYOFF_THIRD_PLACE_DECISION", {
        ...payload,
        playoffThirdPlaceBestOf: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventPlayoffThirdPlaceDecisionPrompt(chatId);
      return;
    }

    if (target === "total_teams") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TOTAL_TEAMS", {
        ...payload,
        totalTeams: undefined,
        totalRounds: undefined,
        advanceToPlayoffs: payload.eventMode === "regular_season" ? undefined : payload.advanceToPlayoffs,
        teamNames: undefined,
        playoffSeedPolicy: payload.eventMode === "playoffs" ? payload.playoffSeedPolicy : undefined,
        playoffSeedMetadata: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventTeamsPrompt(chatId, payload);
      return;
    }

    if (target === "advance_to_playoffs") {
      if (payload.eventMode !== "regular_season") {
        await answerTelegramCallbackQuery(callbackQueryId, "Playoff advance only applies to Regular Season.");
        return;
      }
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_ADVANCE_TO_PLAYOFFS", {
        ...payload,
        advanceToPlayoffs: undefined,
        teamNames: undefined,
        playoffSeedMetadata: undefined
      });
      await answerTelegramCallbackQuery(callbackQueryId);
      await sendCreateEventAdvanceToPlayoffsPrompt(chatId, payload);
      return;
    }

    if (target === "team_names") {
      await saveTelegramSession(telegramUserId, session.currentCommand, "AWAITING_TEAM_NAMES", {
        ...payload,
        playoffSeedMetadata: undefined
      });
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

  if (
    event.status === "completed"
    && (action === "match_score" || action === "match_result" || action === "match_reset" || action === "match_game" || action === "match_game_undo")
  ) {
    await answerTelegramCallbackQuery(callbackQueryId, "Event is completed. Match results can no longer be edited.");
    return;
  }

  if (action === "event_manage") {
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTournamentManageMenu(chatId, eventId);
    return;
  }

  if (action === "edit_events") {
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTelegramMessage(
      chatId,
      "Edit Events",
      {
        inlineKeyboard: [
          [{ text: getTournamentBracketMenuLabel(event), callback_data: `bracket_view:${eventId}` }],
          [{ text: "Delete Event", callback_data: `delete_event_prompt:${eventId}` }],
          [{ text: "Ganti Nama Tim", callback_data: `team_rename_menu:${eventId}` }],
          [{ text: "Manage Captain Contact", callback_data: `contact_manage:${eventId}` }],
          [{ text: "Back to Event", callback_data: `event_manage:${eventId}` }]
        ]
      }
    );
    return;
  }

  if (action === "contact_manage") {
    await saveTelegramSession(telegramUserId, "/event-contact-manage", "AWAITING_CONTACT_TEAM_SELECTION", {
      createdEventId: eventId
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendCreateEventContactMenu(chatId, eventId);
    return;
  }

  if (rawData.startsWith("gf_meta_start:")) {
    const gfEventId = parseInt(rawData.split(":")[1]);
    if (!gfEventId || Number.isNaN(gfEventId)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid event.");
      return;
    }
    await saveTelegramSession(telegramUserId, "/gf-meta", "AWAITING_GF_TEAM_A_LOGO", {
      grandFinalEventId: gfEventId
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTelegramMessage(
      chatId,
      "🎬 *Grand Final Info*\n\nKirim URL logo Team A (gambar JPG/PNG), atau kirim \"skip\" untuk lewati."
    );
    return;
  }

  if (rawData.startsWith("team_rename_menu:")) {
    const menuEventId = parseInt(rawData.split(":")[1]);
    await saveTelegramSession(telegramUserId, "/event-rename-team", "AWAITING_RENAME_TEAM_SELECTION", {
      createdEventId: menuEventId
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTeamRenameMenu(chatId, menuEventId);
    return;
  }

  if (rawData.startsWith("team_rename:")) {
    const parts = rawData.split(":");
    const renameEventId = parseInt(parts[1]);
    const renameTeamId = parseInt(parts[2]);
    const bundle = await loadTournamentBundle(renameEventId);
    const team = bundle?.teams.find((t) => t.id === renameTeamId);
    if (!bundle || !team) {
      await answerTelegramCallbackQuery(callbackQueryId, "Tim tidak ditemukan.");
      return;
    }
    await saveTelegramSession(telegramUserId, "/event-rename-team", "AWAITING_RENAME_TEAM_NEW_NAME", {
      createdEventId: renameEventId,
      selectedRenameTeamId: renameTeamId
    });
    await answerTelegramCallbackQuery(callbackQueryId);
    await sendTelegramMessage(
      chatId,
      `✏️ Ketik nama baru untuk tim *${team.name}*.\n\nKirim "batal" untuk membatalkan.`
    );
    return;
  }


  if (action === "standings_view") {
    if (getTournamentEventMode(event) === "playoffs" && getTournamentPlayoffFormat(event) !== "swiss_stage") {
      await answerTelegramCallbackQuery(callbackQueryId, "Standings menu is disabled for playoff mode.");
      await sendTournamentManageMenu(chatId, eventId);
      return;
    }
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

    const isPlayoff = getTournamentEventMode(bundle.event) === "playoffs" && bundle.event.format !== "swiss_stage";
    const saved = isPlayoff
      ? await submitPlayoffMatchResult({
          eventId,
          matchId: match.id,
          scoreA,
          scoreB,
          source: "telegram",
          actorId: telegramUserId
        })
      : await saveTournamentMatchScore(bundle.event, round, match, scoreA, scoreB);
    if ("error" in saved) {
      await answerTelegramCallbackQuery(callbackQueryId, saved.error);
      return;
    }

    if (isPlayoff) {
      if (getTournamentPlayoffFormat(bundle.event) === "double_elimination") {
        await sanitizeDEBracket(eventId);
      } else if (round.roundNumber < bundle.event.totalRounds) {
        await generateTournamentNextRound(eventId, "default");
      }
    }

    await invalidateTournamentBundle(eventId);
    await answerTelegramCallbackQuery(callbackQueryId, "Result saved.");
    await sendTournamentRoundManageMenu(chatId, eventId, match.roundId);
    if (round.stage === "swiss" && (saved.result === "team_a_win" || saved.result === "team_b_win")) {
      const winnerTeamId = saved.result === "team_a_win" ? match.teamAId : (match.teamBId ?? null);
      const loserTeamId = saved.result === "team_a_win" ? (match.teamBId ?? null) : match.teamAId;
      await notifySwissStageThreshold(chatId, eventId, winnerTeamId, loserTeamId);
    }
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
      getTournamentRoundBestOf(bundle.event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf)
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
      getTournamentRoundBestOf(bundle.event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf)
    );
    if (validationError) {
      await answerTelegramCallbackQuery(callbackQueryId, validationError);
      return;
    }

    const isPlayoff = getTournamentEventMode(bundle.event) === "playoffs" && bundle.event.format !== "swiss_stage";
    const saved = isPlayoff
      ? await submitPlayoffMatchResult({
          eventId,
          matchId: match.id,
          scoreA: presetScore.scoreA,
          scoreB: presetScore.scoreB,
          source: "telegram",
          actorId: telegramUserId
        })
      : await saveTournamentMatchScore(bundle.event, round, match, presetScore.scoreA, presetScore.scoreB);
    if ("error" in saved) {
      await answerTelegramCallbackQuery(callbackQueryId, saved.error);
      return;
    }

    if (isPlayoff) {
      const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";
      if (isDE) {
        await sanitizeDEBracket(eventId);
      } else if (round.roundNumber < bundle.event.totalRounds) {
        // Keep auto-advance behavior for non-DE playoffs only.
        await generateTournamentNextRound(eventId, "default");
      }
    }

    await invalidateTournamentBundle(eventId);
    await answerTelegramCallbackQuery(callbackQueryId, "Result saved.");

    if (isPlayoff) {
      // Smart redirect: if round still has pending real matches, stay; otherwise go to manage menu
      const freshBundle = await loadTournamentBundle(eventId);
      const roundStillPending = freshBundle?.matches.some(
        (m) => m.roundId === match.roundId && m.result === "pending"
      );
      if (roundStillPending) {
        await sendTournamentRoundManageMenu(chatId, eventId, match.roundId);
      } else {
        await sendTournamentManageMenu(chatId, eventId);
      }
    } else {
      await sendTournamentRoundManageMenu(chatId, eventId, match.roundId);
      if (round.stage === "swiss" && (saved.result === "team_a_win" || saved.result === "team_b_win")) {
        const winnerTeamId = saved.result === "team_a_win" ? match.teamAId : (match.teamBId ?? null);
        const loserTeamId = saved.result === "team_a_win" ? (match.teamBId ?? null) : match.teamAId;
        await notifySwissStageThreshold(chatId, eventId, winnerTeamId, loserTeamId);
      }
    }
    return;
  }

  if (action === "match_game" || action === "match_game_undo") {
    if (!roundId || Number.isNaN(roundId) || !matchId || Number.isNaN(matchId)) {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid action.");
      return;
    }
    const side = resultRaw as "a" | "b";
    if (side !== "a" && side !== "b") {
      await answerTelegramCallbackQuery(callbackQueryId, "Invalid side.");
      return;
    }

    await answerTelegramCallbackQuery(callbackQueryId);

    try {
      const bundle = await loadTournamentBundle(eventId);
      if (!bundle) {
        await sendTelegramMessage(chatId, "Event not found.");
        return;
      }
      const round = bundle.rounds.find((r) => r.id === roundId);
      const match = bundle.matches.find((m) => m.id === matchId && m.roundId === roundId);
      if (!round || !match) {
        await sendTelegramMessage(chatId, "Match not found.");
        return;
      }

      const wasComplete = match.winnerTeamId !== null;
      const isPlayoff = getTournamentEventMode(bundle.event) === "playoffs" && bundle.event.format !== "swiss_stage";
      const gameResult = await (async () => {
        if (action !== "match_game" || !isPlayoff) {
          return action === "match_game"
            ? saveMatchGameScore(bundle.event, round, match, side)
            : undoMatchGameScore(bundle.event, round, match, side);
        }

        const matchBestOf = getTournamentRoundBestOf(bundle.event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf);
        const requiredWins = getTournamentRequiredWins(getTournamentEventMode(bundle.event), matchBestOf);
        const curA = match.scoreA ?? 0;
        const curB = match.scoreB ?? 0;
        if (curA >= requiredWins || curB >= requiredWins) {
          return { error: "Pertandingan sudah selesai. Reset dulu jika ingin mengubah." } as const;
        }
        const newA = side === "a" ? curA + 1 : curA;
        const newB = side === "b" ? curB + 1 : curB;
        const isComplete = newA >= requiredWins || newB >= requiredWins;
        if (!isComplete) {
          return saveMatchGameScore(bundle.event, round, match, side);
        }
        const saved = await submitPlayoffMatchResult({
          eventId,
          matchId: match.id,
          scoreA: newA,
          scoreB: newB,
          source: "telegram",
          actorId: telegramUserId
        });
        return "error" in saved ? saved : { ...saved, scoreA: newA, scoreB: newB, isComplete };
      })();

      if ("error" in gameResult && gameResult.error) {
        await sendTelegramMessage(chatId, gameResult.error);
        return;
      }

      if (isPlayoff) {
        const isDE = getTournamentPlayoffFormat(bundle.event) === "double_elimination";
        if (!isDE && action === "match_game" && "isComplete" in gameResult && gameResult.isComplete) {
          // Match just completed — auto-cascade next rounds
          await generateTournamentNextRound(eventId, "default");
        } else if (action === "match_game_undo" && wasComplete) {
          // Match reverted from complete to pending — rollback downstream rounds
          await rollbackPlayoffRoundsAfter(eventId, round.id);
        }
      }

      await invalidateTournamentBundle(eventId);
      await sendTournamentMatchManageMenu(chatId, eventId, roundId, matchId);
    } catch (error) {
      console.warn("[tournament] match_game callback failed", {
        eventId,
        roundId,
        matchId,
        side,
        action,
        error
      });
      await sendTelegramMessage(chatId, "Gagal mencatat hasil game. Coba lagi.");
    }
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

    const isPlayoff = getTournamentEventMode(event) === "playoffs";
    if (isPlayoff) {
      // Rollback any downstream rounds generated from this round's results
      await rollbackPlayoffRoundsAfter(eventId, roundId);
    }

    await invalidateTournamentBundle(eventId);
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

    // For playoffs rounds > 1 where shuffle is not available, skip the pairing
    // selection menu and go straight to the default preview.
    const pairingBundle = await loadTournamentBundle(eventId);
    if (pairingBundle && getTournamentPlayoffFormat(pairingBundle.event) === "double_elimination") {
      const deReadiness = getDENextRoundReadiness(pairingBundle);
      console.info("[tournament][de][next_round]", {
        eventId,
        canGenerate: deReadiness.canGenerate,
        activePlayableRounds: deReadiness.activePlayableRounds.map((r) => ({
          id: r.id,
          roundNumber: r.roundNumber,
          label: r.label
        }))
      });
      if (!deReadiness.canGenerate) {
        await sendTournamentManageMenu(chatId, eventId);
        return;
      }
    }
    const pairingContext = prepareTournamentNextRoundContext(pairingBundle);
    const isPlayoffNoShuffle =
      !("error" in pairingContext) &&
      !pairingContext.completed &&
      getTournamentEventMode(pairingContext.bundle.event) === "playoffs" &&
      !tournamentAllowsShuffleForNextRound(pairingContext.bundle.event, pairingContext.nextRoundNumber);

    if (isPlayoffNoShuffle) {
      const preview = await previewTournamentNextRound(eventId, "default");
      if ("error" in preview) {
        await sendTelegramMessage(chatId, preview.error, {
          inlineKeyboard: [[{ text: "Back to Event", callback_data: `event_manage:${eventId}` }]]
        });
        return;
      }
      if (preview.completed) {
        await sendTournamentManageMenu(chatId, eventId);
        return;
      }
      await saveTournamentNextRoundPreview(telegramUserId, {
        eventId,
        activeRoundId: preview.activeRound?.id ?? null,
        roundNumber: preview.nextRoundNumber,
        strategy: "default",
        pairings: preview.pairings
      });
      await sendTournamentNextRoundPreviewMenu(chatId, preview.bundle, preview.nextRoundNumber, "default", preview.pairings);
      return;
    }

    await sendTournamentNextRoundPairingMenu(chatId, eventId);
    return;
  }

  if (action === "next_round_pick") {
    const strategy = (resultRaw ?? roundIdRaw) === "shuffle" ? "shuffle" : "default";
    const bundle = await loadTournamentBundle(eventId);
    if (bundle && getTournamentPlayoffFormat(bundle.event) === "double_elimination") {
      const deReadiness = getDENextRoundReadiness(bundle);
      if (!deReadiness.canGenerate) {
        await clearTournamentNextRoundPreview(telegramUserId, eventId);
        await answerTelegramCallbackQuery(callbackQueryId, "Finish active DE round matches first.");
        await sendTournamentManageMenu(chatId, eventId);
        return;
      }
    }
    if (strategy === "shuffle") {
      const context = prepareTournamentNextRoundContext(bundle);
      if (!("error" in context) && !context.completed) {
        const allowShuffle = tournamentAllowsShuffleForNextRound(context.bundle.event, context.nextRoundNumber);
        if (!allowShuffle) {
          await answerTelegramCallbackQuery(callbackQueryId, "Shuffle Match only available for Playoff Round 1.");
          await sendTournamentNextRoundPairingMenu(chatId, eventId);
          return;
        }
      }
    }

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
    if (bundle && getTournamentPlayoffFormat(bundle.event) === "double_elimination") {
      const deReadiness = getDENextRoundReadiness(bundle);
      if (!deReadiness.canGenerate) {
        await clearTournamentNextRoundPreview(telegramUserId, eventId);
        await answerTelegramCallbackQuery(callbackQueryId, "Finish active DE round matches first.");
        await sendTournamentManageMenu(chatId, eventId);
        return;
      }
    }
    const context = prepareTournamentNextRoundContext(bundle);
    if ("error" in context) {
      await answerTelegramCallbackQuery(callbackQueryId, context.error);
      if (context.error === "Current round still has pending matches." && bundle) {
        const currentRound = activeTournamentRound(bundle.rounds);
        const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
        if (currentRound) {
          keyboard.push([{ text: "Manage Round", callback_data: `round_manage:${eventId}:${currentRound.id}` }]);
        }
        keyboard.push([{ text: "Back to Event", callback_data: `event_manage:${eventId}` }]);
        await sendTelegramMessage(
          chatId,
          context.error,
          { inlineKeyboard: keyboard }
        );
      }
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

    const isDE = bundle ? getTournamentPlayoffFormat(bundle.event) === "double_elimination" : false;
    const created = await persistTournamentNextRound(
      eventId,
      isDE ? null : preview.activeRoundId,
      preview.roundNumber,
      preview.pairings
    );
    if ("error" in created) {
      await answerTelegramCallbackQuery(callbackQueryId, created.error);
      return;
    }

    if (isDE) {
      await refreshDERoundStatuses(eventId);
    }

    await clearTournamentNextRoundPreview(telegramUserId, eventId);
    await answerTelegramCallbackQuery(
      callbackQueryId,
      `Round ${preview.roundNumber} generated.`
    );
    const roundShareSummary = formatTournamentRoundShareSummary(created.bundle, created.round.roundNumber);
    if (roundShareSummary) {
      await sendTelegramMessage(chatId, roundShareSummary, {
        inlineKeyboard: [[{ text: "Copy Message", copy_text: { text: roundShareSummary } }]]
      });
    }
    // For DE: show manage menu (multiple active rounds may exist).
    // For SE: go directly to the newly created round's manage menu.
    if (isDE) {
      await sendTournamentManageMenu(chatId, eventId);
    } else {
      await sendTournamentRoundManageMenu(chatId, eventId, created.round.id);
    }
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
  const text = normalizeTelegramText(message?.text ?? message?.caption);
  const hasPhoto = Array.isArray(message?.photo) && message.photo.length > 0;

  if (!chatId || !fromId || (!text && !hasPhoto)) return;

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
    const command = rawCommand.split("@")[0].replace(/_/g, "-");
    const arg = args.join(" ").trim();

    if (command === "/start") {
      await clearTelegramSession(telegramUserId);
      await sendTelegramStartMenu(chatId);
      return;
    }

    if (command === "/create-new-event") {
      await saveTelegramSession(telegramUserId, command, "AWAITING_TOTAL_PARTICIPANTS", {});
      await sendParticipantsPrompt(chatId);
      return;
    }

    if (command === "/create-upcoming-event") {
      await saveTelegramSession(telegramUserId, command, "AWAITING_UPCOMING_EVENT_NAME", {});
      await sendTelegramMessage(
        chatId,
        `${upcomingWizardPhaseHeader(1, "Nama Event")}\nMasukkan nama event upcoming.`
      );
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

    if (command === "/help" || command === "/help@" + getBotUsername()) {
      await sendTelegramMessage(
        chatId,
        "📖 *Daftar Perintah*\n\n" +
        "/create\\_new\\_event — Buat event tournament baru\n" +
        "/create\\_upcoming\\_event — Buat event upcoming singkat\n" +
        "/view\\_event — Lihat dan kelola event\n" +
        "/cancel — Batalkan sesi aktif\n" +
        "/help — Tampilkan pesan ini\n\n" +
        "💡 Gunakan /create\\_new\\_event untuk event tournament lengkap, /create\\_upcoming\\_event untuk event upcoming, atau /view\\_event untuk mengelola event."
      );
      return;
    }

    await sendTelegramMessage(chatId, "Perintah tidak dikenal. Gunakan /create_new_event, /create_upcoming_event, atau /view_event.");
    return;
  }

  if (!session) {
    await sendTelegramMessage(chatId, "Gunakan /create_new_event, /create_upcoming_event, atau /view_event.");
    return;
  }

  if (session.currentCommand === "/create-new-event") {
    await handleTelegramCreateEventStep(chatId, telegramUserId, telegramChatId, text, session, message);
    return;
  }

  if (session.currentCommand === "/create-upcoming-event") {
    await handleTelegramCreateEventStep(chatId, telegramUserId, telegramChatId, text, session, message);
    return;
  }

  if (session.currentCommand === "/event-contact-manage") {
    await handleTelegramCreateEventStep(chatId, telegramUserId, telegramChatId, text, session, message);
    return;
  }

  if (session.currentCommand === "/view-event") {
    await handleTelegramViewEventStep(chatId, telegramUserId, telegramChatId, groupChat, text, session);
  }

  if (session.currentCommand === "/gf-meta") {
    await handleTelegramGfMetaStep(chatId, telegramUserId, text, session);
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

app.post("/telegram/webhook-probe", async (c) => {
  const secret = getTelegramWebhookSecret();
  const incomingSecret = (c.req.header("x-telegram-bot-api-secret-token") ?? "").trim();
  if (secret && incomingSecret !== secret) {
    return c.json({ ok: false, stage: "secret" }, 401);
  }
  const token = getTelegramBotToken();
  if (!token) {
    return c.json({ ok: false, stage: "token" }, 503);
  }
  return c.json({ ok: true, stage: "pre-parse" });
});

app.post("/telegram/body-probe", async (c) => {
  const mode = (c.req.query("mode") ?? "reader").toLowerCase();
  const body = c.req.raw.body;
  if (!body) return c.json({ ok: true, mode, length: 0 });

  if (mode === "json") {
    const parsed = await c.req.raw.json().catch(() => null);
    return c.json({ ok: true, mode, hasParsed: Boolean(parsed) });
  }

  if (mode === "text") {
    const text = await c.req.raw.text().catch(() => "");
    return c.json({ ok: true, mode, length: text.length });
  }

  const reader = body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
  }
  return c.json({ ok: true, mode, length: total });
});

app.post("/digiflazz/transaction-test", async (c) => {
  const payload = getDigiflazzTransactionPayload();
  if (payload.missing.length > 0) {
    return c.json({ error: `Missing required env: ${payload.missing.join(", ")}` }, 500);
  }

  try {
    const upstream = await fetch("https://api.digiflazz.com/v1/transaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.body)
    });
    const text = await upstream.text();
    let data: unknown = { raw: text };
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw fallback when upstream response is not JSON
    }
    return c.json({ data }, upstream.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Digiflazz request error.";
    return c.json({ error: message }, 502);
  }
});

export async function processTelegramWebhook(
  rawBody: string,
  incomingSecretHeader: string | null | undefined
) {
  const secret = getTelegramWebhookSecret();
  const incomingSecret = (incomingSecretHeader ?? "").trim();

  if (secret && incomingSecret !== secret) {
    return { status: 401, body: { error: "Invalid telegram webhook secret." } } as const;
  }

  const token = getTelegramBotToken();
  if (!token) {
    return { status: 503, body: { error: "Telegram bot is not configured." } } as const;
  }

  const update = rawBody
    ? (() => {
        try {
          return JSON.parse(rawBody) as TelegramUpdate;
        } catch {
          return null;
        }
      })()
    : null;

  if (!update) {
    return { status: 400, body: { error: "Invalid telegram payload." } } as const;
  }

  await handleTelegramIncomingMessage(update);
  return { status: 200, body: { ok: true } } as const;
}

app.post("/telegram/webhook", async (c) => {
  console.info("[telegram-webhook] stage=entered-hono");
  const rawBody = await c.req.raw.text().catch(() => "");
  const result = await processTelegramWebhook(rawBody, c.req.header("x-telegram-bot-api-secret-token"));
  console.info("[telegram-webhook] stage=done-hono", { status: result.status });
  return c.json(result.body, result.status);
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
      createdAt: toIsoTimestamp(team.createdAt)
    })),
    bracket: buildTournamentBracket(created.round ? [created.round] : [], created.matches, created.teams),
    standings: buildTournamentStandingsForEvent(created.event, created.round ? [created.round] : [], created.teams, created.matches)
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
      createdAt: toIsoTimestamp(team.createdAt)
    })),
    rounds: bundle.rounds.map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      createdAt: toIsoTimestamp(round.createdAt)
    }))
  });
});

app.get("/events/:id/banner", zValidator("param", tournamentEventIdentifierParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const event = await loadTournamentEventById(id);
  if (!event) {
    return c.json({ error: "Event not found" }, 404);
  }

  const rawBanner = (event.eventBannerImageUrl ?? "").trim();
  if (!rawBanner) {
    return c.json({ error: "Banner not found" }, 404);
  }

  const telegramFilePath = parseTelegramBannerFileRef(rawBanner);
  if (!telegramFilePath) {
    return c.redirect(rawBanner, 302);
  }

  const token = getTelegramBotToken();
  if (!token) {
    return c.json({ error: "Telegram bot is not configured." }, 503);
  }

  try {
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${telegramFilePath}`);
    if (!response.ok || !response.body) {
      return c.json({ error: "Failed to load banner image." }, 502);
    }

    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    headers.set("Content-Type", contentType && contentType.length > 0 ? contentType : "image/jpeg");
    headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
    return new Response(response.body, { status: 200, headers });
  } catch {
    return c.json({ error: "Failed to load banner image." }, 502);
  }
});

app.get("/events/:id/bracket", zValidator("param", tournamentEventIdentifierParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  let bundle = await loadTournamentBundle(id);

  if (!bundle) {
    return c.json({ error: "Event not found" }, 404);
  }

  if (getTournamentPlayoffFormat(bundle.event) === "double_elimination") {
    await sanitizeDEBracket(id);
    bundle = await loadTournamentBundle(id);
    if (!bundle) return c.json({ error: "Event not found" }, 404);
  }

  return c.json({
    event: serializeTournamentEvent(bundle.event),
    rounds: buildTournamentBracket(bundle.rounds, bundle.matches, bundle.teams),
    playoffBracket: getTournamentEventMode(bundle.event) === "playoffs" && bundle.event.format !== "swiss_stage"
      ? buildPlayoffBracketView(bundle)
      : null
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
    standings: buildTournamentStandingsForEvent(bundle.event, bundle.rounds, bundle.teams, bundle.matches)
  });
});

app.post("/events/:id/playoff-flow/repair", zValidator("param", tournamentEventIdParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const report = await repairPlayoffBracketFlow(id);
  if ("error" in report) {
    return c.json({ error: report.error }, report.error === "Event not found." ? 404 : 400);
  }
  return c.json(report);
});

app.get("/events/:id/playoff-flow/debug", zValidator("param", tournamentEventIdParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const report = await debugPlayoffBracketFlow(id);
  if ("error" in report) {
    return c.json({ error: report.error }, report.error === "Event not found." ? 404 : 400);
  }
  return c.json(report);
});

app.get("/events/:id/overview", zValidator("param", tournamentEventIdentifierParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const bundle = await loadTournamentBundle(id);

  if (!bundle) {
    return c.json({ error: "Event not found" }, 404);
  }

  return c.json({
    event: serializeTournamentEvent(bundle.event),
    bracket: buildTournamentBracket(bundle.rounds, bundle.matches, bundle.teams),
    playoffBracket: getTournamentEventMode(bundle.event) === "playoffs" && bundle.event.format !== "swiss_stage"
      ? buildPlayoffBracketView(bundle)
      : null,
    standings: buildTournamentStandingsForEvent(bundle.event, bundle.rounds, bundle.teams, bundle.matches)
  });
});

app.get("/events/:id/postmatch-intelligence", zValidator("param", tournamentEventIdentifierParamsSchema), async (c) => {
  const { id } = c.req.valid("param");
  const payload = await buildTournamentPostmatchIntelligence(id);

  if (!payload) {
    return c.json({ error: "Event not found" }, 404);
  }

  return c.json(payload);
});

app.post(
  "/events/:id/matches/:matchId/draft-log",
  zValidator("param", tournamentMatchParamsSchema),
  zValidator("json", updateTournamentMatchDraftLogBodySchema),
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

    const cleanTeamAPicks = normalizeDraftMlids(body.teamAPicks).slice(0, 10);
    const cleanTeamBPicks = normalizeDraftMlids(body.teamBPicks).slice(0, 10);
    const cleanTeamABans = normalizeDraftMlids(body.teamABans).slice(0, 10);
    const cleanTeamBBans = normalizeDraftMlids(body.teamBBans).slice(0, 10);

    const [existing] = await db
      .select({ id: tournamentMatchDraftLogs.id })
      .from(tournamentMatchDraftLogs)
      .where(eq(tournamentMatchDraftLogs.matchId, match.id))
      .limit(1);

    if (existing) {
      await db
        .update(tournamentMatchDraftLogs)
        .set({
          eventId: bundle.event.id,
          teamAPicks: cleanTeamAPicks,
          teamBPicks: cleanTeamBPicks,
          teamABans: cleanTeamABans,
          teamBBans: cleanTeamBBans,
          source: body.source,
          notes: body.notes ?? null,
          updatedAt: new Date()
        })
        .where(eq(tournamentMatchDraftLogs.id, existing.id));
    } else {
      await db
        .insert(tournamentMatchDraftLogs)
        .values({
          eventId: bundle.event.id,
          matchId: match.id,
          teamAPicks: cleanTeamAPicks,
          teamBPicks: cleanTeamBPicks,
          teamABans: cleanTeamABans,
          teamBBans: cleanTeamBBans,
          source: body.source,
          notes: body.notes ?? null
        });
    }

    await invalidateTournamentBundle(bundle.event.id);
    return c.json({
      ok: true,
      draftLog: {
        eventId: bundle.event.id,
        matchId: match.id,
        teamAPicks: cleanTeamAPicks,
        teamBPicks: cleanTeamBPicks,
        teamABans: cleanTeamABans,
        teamBBans: cleanTeamBBans,
        source: body.source,
        notes: body.notes ?? null
      }
    });
  }
);

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
    if (bundle.event.status === "completed") {
      return c.json({ error: "Event is completed. Match results can no longer be edited." }, 400);
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
      getTournamentRoundBestOf(bundle.event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf)
    );
    const scoreA = body.scoreA ?? presetScore.scoreA;
    const scoreB = body.scoreB ?? presetScore.scoreB;
    const validationError = validateTournamentResultScore(
      body.result,
      scoreA,
      scoreB,
      Boolean(match.teamBId),
      getTournamentEventMode(bundle.event),
      getTournamentRoundBestOf(bundle.event, round.roundNumber, match.pairingOrder, round.stage, match.matchBestOf)
    );
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const isPlayoffMatch = getTournamentEventMode(bundle.event) === "playoffs" && bundle.event.format !== "swiss_stage";
    const saved = isPlayoffMatch
      ? await submitPlayoffMatchResult({
          eventId: bundle.event.id,
          matchId: match.id,
          scoreA,
          scoreB,
          source: "api",
          actorId: null
        })
      : await saveTournamentMatchScore(bundle.event, round, match, scoreA, scoreB);
    if ("error" in saved) {
      return c.json({ error: saved.error }, 400);
    }

    if (isPlayoffMatch) {
      if (getTournamentPlayoffFormat(bundle.event) === "double_elimination") {
        await sanitizeDEBracket(bundle.event.id);
      } else if (round.roundNumber < bundle.event.totalRounds) {
        await generateTournamentNextRound(bundle.event.id, "default");
      }
    }

    await invalidateTournamentBundle(bundle.event.id);
    const refreshed = await loadTournamentBundle(id);
    if (!refreshed) {
      return c.json({ error: "Event not found" }, 404);
    }
    const roundStatus = refreshed.rounds.find((round) => round.id === match.roundId)?.status ?? "finished";

    return c.json({
      event: serializeTournamentEvent(refreshed.event),
      roundStatus,
      standings: buildTournamentStandingsForEvent(refreshed.event, refreshed.rounds, refreshed.teams, refreshed.matches)
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
      standings: buildTournamentStandingsForEvent(refreshed.event, refreshed.rounds, refreshed.teams, refreshed.matches),
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
          createdAt: toIsoTimestamp(generated.round.createdAt)
        }
      : null,
    bracket: buildTournamentBracket(refreshed.rounds, refreshed.matches, refreshed.teams),
    standings: buildTournamentStandingsForEvent(refreshed.event, refreshed.rounds, refreshed.teams, refreshed.matches)
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

const subscribeBodySchema = z.object({
  email: z.string().email(),
  leagues: z.array(z.string()).optional().default([])
});

app.post("/subscribe", zValidator("json", subscribeBodySchema), async (c) => {
  const { email, leagues } = c.req.valid("json");
  try {
    await db
      .insert(eventSubscribers)
      .values({ email: email.toLowerCase().trim(), leagues })
      .onConflictDoNothing();
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: "Failed to save subscription." }, 500);
  }
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
  matchupDraft: matchupM7Draft,
  getPostmatchIntelligence: getM7PostmatchIntelligence
});

registerTournamentRoutes({
  slug: "mpl-ph",
  label: "MPL PH",
  getStatus: getMplPhStatus,
  getHeroList: getMplPhHeroList,
  getHeroCounters: getMplPhHeroCounters,
  getHeroProfile: getMplPhHeroProfile,
  analyzeDraft: analyzeMplPhDraft,
  matchupDraft: matchupMplPhDraft,
  getPostmatchIntelligence: getMplPhPostmatchIntelligence
});

registerTournamentRoutes({
  slug: "mpl-id",
  label: "MPL ID",
  getStatus: getMplIdStatus,
  getHeroList: getMplIdHeroList,
  getHeroCounters: getMplIdHeroCounters,
  getHeroProfile: getMplIdHeroProfile,
  analyzeDraft: analyzeMplIdDraft,
  matchupDraft: matchupMplIdDraft,
  getPostmatchIntelligence: getMplIdPostmatchIntelligence
});

export default app;
export const vercelHandler = handle(app);

if (process.env.API_EMBEDDED_SERVER !== "0") {
  void (async () => {
    const { serve } = await import("@hono/node-server");
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

    void registerBotCommands().catch((err) => {
      console.warn("[telegram] setMyCommands failed", err);
    });
  })();
}

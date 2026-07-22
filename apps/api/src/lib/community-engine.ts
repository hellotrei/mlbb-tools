import { asc, desc, and, eq, sql } from "drizzle-orm";
import { db, heroes, heroStatsLatest, tierResults, counterMatrix, synergyMatrix, heroRolePool } from "@mlbb/db";
import type { Tier, TierResultRow, DraftLane } from "@mlbb/shared";
import { evaluateDraftFeasibility, buildRolePoolMap, phaseWeights, computeTierResults } from "@mlbb/shared";
import { fetchCommunityCounterScores } from "./supabase-counters.js";

// ── Types ──────────────────────────────────────────────────────────────────────

type EngineReadiness = "empty" | "limited" | "ready";

type EngineCapabilities = {
  meta: boolean;
  counter: boolean;
  matchup: boolean;
  patterns: boolean;
};

type RolePoolEntry = {
  lane: DraftLane;
  confidence: number;
  source: string;
};

type HeroRow = {
  mlid: number;
  name: string;
  slug: string;
  rolePrimary: string;
  roleSecondary: string | null;
  lanes: string[];
  specialities: string[];
  imageKey: string;
};

export type HeroAggregate = {
  hero: HeroRow;
  picks: number;
  bans: number;
  wins: number;
  weightedWins: number;
  totalWeight: number;
  bluePicks: number;
  redPicks: number;
  blueWins: number;
  redWins: number;
  protectedBans: number;
  pickRate: number;
  banRate: number;
  winRate: number;
  flexValue: number;
  rolePool: RolePoolEntry[];
  score: number;
  tier: Tier;
};

type RecommendationRow = {
  mlid: number;
  score: number;
  tier?: Tier;
  pickPhase?: "meta" | "flex" | "counter";
  reasons: string[];
  breakdown: {
    counterImpact: number;
    tierPower: number;
    laneCoverage: number;
    flexValue: number;
    feasibilityGain: number;
    denyValue: number;
    synergyValue?: number;
    denialValue?: number;
    protectionValue?: number;
  };
  preview: null;
};

type AnalyzeResponse = {
  recommendedPicks: RecommendationRow[];
  recommendedBans: RecommendationRow[];
  recommendedMetaPicks: RecommendationRow[];
  recommendedCounterPicks: RecommendationRow[];
  notes: string[];
  archetype: null;
  draftProbability: { allyWinProb: number; enemyWinProb: number; confidence: number } | null;
  dataset: {
    engine: string;
    totalMaps: number;
    generatedAt: string;
    unmatchedHeroes: string[];
    readiness: EngineReadiness;
    capabilities: EngineCapabilities;
    degradedReason: string | null;
  };
};

type MatchupResponse = {
  verdict: string;
  allyScore: number;
  enemyScore: number;
  allyWinProb: number;
  enemyWinProb: number;
  confidence: number;
  components: {
    allyTierPower: number;
    enemyTierPower: number;
    allyCounterEdge: number;
    enemyCounterEdge: number;
    allySynergy: number;
    enemySynergy: number;
  };
  details: {
    ally: {
      coveredLanes: DraftLane[];
      missingLanes: DraftLane[];
      topCounterPairs: Array<{ counterMlid: number; enemyMlid: number; score: number }>;
      tierCounts: Record<string, number>;
    };
    enemy: {
      coveredLanes: DraftLane[];
      missingLanes: DraftLane[];
      topCounterPairs: Array<{ counterMlid: number; enemyMlid: number; score: number }>;
      tierCounts: Record<string, number>;
    };
    keyFactors: string[];
  };
  dataset: {
    engine: string;
    totalMaps: number;
    readiness: EngineReadiness;
    capabilities: EngineCapabilities;
    degradedReason: string | null;
  };
};

type HeroProfile = {
  hero: HeroRow;
  statistic: {
    timeframe: string;
    rankScope: string;
    winRate: number;
    pickRate: number;
    banRate: number;
    appearance: number;
    picks: number;
    bans: number;
    wins: number;
    totalMaps: number;
  };
  tier: { timeframe: string; rankScope: string; tier: Tier; score: number };
  rolePool: Array<{ lane: string; confidence: number; source: string }>;
  counterSignals: Array<{
    enemyMlid: number;
    enemyName: string;
    score: number;
    matches: number;
    winRate: number;
    sameLaneMatches: number;
    protectionBans: number;
  }>;
  synergySignals: Array<{
    heroMlid: number;
    heroName: string;
    score: number;
    matches: number;
    winRate: number;
    source: string;
  }>;
};

type TournamentPostmatchRecommendation = {
  lane: string;
  mlid: number;
  heroName: string;
  confidence: string;
  reason: string;
  swapOutHeroName?: string | null;
};

type TournamentPostmatchItem = {
  matchId: number;
  weekNumber: number;
  roundNumber: number | null;
  roundLabel: string | null;
  scoreline: string;
  winnerTeam: { id: number; name: string } | null;
  loserTeam: { id: number; name: string } | null;
  winnerAnalysis: string[];
  loserAnalysis: string[];
  loserRecommendations: TournamentPostmatchRecommendation[];
  confidence: string;
  confidenceReason: string;
  dataMode: string;
  matchDate?: string | null;
  gameDetails?: Array<{
    gameNumber: number;
    mapName?: string | null;
    duration?: string | null;
    mvp?: string | null;
    winnerSide: "blue" | "red";
    winnerTeamName: string;
    blueTeamName: string;
    redTeamName: string;
    bluePicks: Array<{ mlid: number; heroName: string }>;
    redPicks: Array<{ mlid: number; heroName: string }>;
    blueBans: Array<{ mlid: number; heroName: string }>;
    redBans: Array<{ mlid: number; heroName: string }>;
  }>;
};

type CommunityEngineParams = {
  timeframe?: string;
  rankScope?: string;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const DRAFT_LANES: DraftLane[] = ["exp", "jungle", "mid", "gold", "roam"];
const ROLE_ORDER = ["tank", "fighter", "assassin", "mage", "marksman", "support"] as const;
const NEUTRAL_SIGNAL = 0.5;
const MIN_MAPS_FOR_ADVANCED_SIGNALS = 20;
const PICK_REC_COUNT = 8;
const BAN_REC_COUNT = 8;

const COUNTER_TIER_WEIGHTS: Record<string, number> = {
  SS: 1.0, S: 0.83, A: 0.5, B: 0.17, C: 0, D: 0,
};

const COUNTER_BLEND_DEFAULTS = {
  community: 0.55,
  counter: 0.25,
  tier: 0.20,
};

const ROLE_CAP = 3;
const LOGISTIC_DIVISOR = 22;
const MISSING_LANE_PENALTY = 7;
const UNRESOLVED_FLEX_PENALTY = 3;
const LANE_COMFORT_WEIGHT = 12;

// ── Helpers ────────────────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function rate100(value: number | undefined): number {
  return Number(((value ?? 0) * 100).toFixed(4));
}

function normalizeRate(value: unknown): number {
  const n = toNumber(value);
  return n > 1.5 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function tierNumeric(tier: Tier | undefined): number {
  if (tier === "SS") return 100;
  if (tier === "S") return 80;
  if (tier === "A") return 60;
  if (tier === "B") return 40;
  if (tier === "C") return 25;
  return 15;
}

function counterTierNorm(tier: string | undefined): number {
  return tier ? (COUNTER_TIER_WEIGHTS[tier] ?? 0) : 0;
}

function tierWeight(tier: Tier | undefined): number {
  if (tier === "SS") return 1.0;
  if (tier === "S") return 0.83;
  if (tier === "A") return 0.5;
  if (tier === "B") return 0.17;
  return 0;
}

function buildTierCounts(mlids: number[], tierMap: Map<number, Tier>): Record<string, number> {
  const counts: Record<string, number> = { SS: 0, S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const mlid of mlids) {
    const tier = tierMap.get(mlid) ?? "D";
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

function normalizeTierRows(rows: unknown): TierResultRow[] {
  return (rows as TierResultRow[]).map((row) => ({
    mlid: row.mlid,
    tier: row.tier as Tier,
    score: toNumber(row.score),
  }));
}

function buildEngineReadiness(totalMaps: number): EngineReadiness {
  if (totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS) return "ready";
  if (totalMaps > 0) return "limited";
  return "empty";
}

function buildEngineCapabilities(totalMaps: number): EngineCapabilities {
  return {
    meta: totalMaps > 0,
    counter: totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS,
    matchup: totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS,
    patterns: totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS,
  };
}

function buildDegradedReason(totalMaps: number): string | null {
  if (totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS) return null;
  if (totalMaps > 0) return `Limited community data: ${totalMaps} hero entries. Some features degraded.`;
  return "No community data available yet.";
}

function safeArrayLiteral(values: number[]): string {
  return `{${values.join(",")}}`;
}

function asTurnSide(value: string | undefined): "ally" | "enemy" {
  if (value === "enemy") return "enemy";
  return "ally";
}

function asTurnType(value: string | undefined): "pick" | "ban" {
  if (value === "ban") return "ban";
  return "pick";
}

function inferDraftTurn(body: { allyMlids: number[]; enemyMlids: number[] }, turnType: string, turnSide: string): number {
  const actingPicks = turnSide === "ally" ? body.allyMlids : body.enemyMlids;
  return actingPicks.length + 1;
}

function buildRolePoolMapEntries(entries: Array<{ mlid: number; lane: string }>): Array<{ mlid: number; lanes: string[] }> {
  const byHero = new Map<number, string[]>();
  for (const row of entries) {
    if (!DRAFT_LANES.includes(row.lane as DraftLane)) continue;
    const list = byHero.get(row.mlid) ?? [];
    if (!list.includes(row.lane)) list.push(row.lane);
    byHero.set(row.mlid, list);
  }
  return Array.from(byHero.entries()).map(([mlid, lanes]) => ({ mlid, lanes }));
}

function computeScoresFromVotePairs(
  votes: Array<{ heroMlid: number; counterMlid: number }>,
  enemyMlids: number[],
  candidateMlids: number[]
): { scoreByMlid: Map<number, number>; totalVotes: number } {
  const votesByEnemy = new Map<number, Map<number, number>>();
  const totalByEnemy = new Map<number, number>();

  for (const vote of votes) {
    if (!enemyMlids.includes(vote.heroMlid)) continue;
    const inner = votesByEnemy.get(vote.heroMlid) ?? new Map<number, number>();
    inner.set(vote.counterMlid, (inner.get(vote.counterMlid) ?? 0) + 1);
    votesByEnemy.set(vote.heroMlid, inner);
    totalByEnemy.set(vote.heroMlid, (totalByEnemy.get(vote.heroMlid) ?? 0) + 1);
  }

  const numCandidates = candidateMlids.length || 1;
  const rawScores = new Map<number, number>();

  for (const candidateMlid of candidateMlids) {
    let sum = 0;
    for (const enemyMlid of enemyMlids) {
      const inner = votesByEnemy.get(enemyMlid);
      const votesFor = inner?.get(candidateMlid) ?? 0;
      const totalVotesForEnemy = totalByEnemy.get(enemyMlid) ?? 0;
      const adaptivePrior = Math.max(2, Math.min(8, Math.sqrt(totalVotesForEnemy)));
      const score = (votesFor + adaptivePrior) / (totalVotesForEnemy + adaptivePrior * numCandidates);
      sum += score;
    }
    rawScores.set(candidateMlid, sum / Math.max(1, enemyMlids.length));
  }

  const sortedScores = Array.from(rawScores.values()).sort((a, b) => a - b);
  const totalCandidatesCount = sortedScores.length;

  const scoreByMlid = new Map<number, number>();
  for (const [mlid, raw] of rawScores) {
    let rank = 0;
    for (let i = 0; i < sortedScores.length; i++) {
      if (sortedScores[i]! <= raw) rank = i;
    }
    const percentile = totalCandidatesCount > 1 ? rank / (totalCandidatesCount - 1) : 0.5;
    const rawMin = sortedScores[0]!;
    const rawMax = sortedScores[totalCandidatesCount - 1]!;
    const rawNorm = rawMax > rawMin ? (raw - rawMin) / (rawMax - rawMin) : 0.5;
    scoreByMlid.set(mlid, Number((percentile * 0.6 + rawNorm * 0.4).toFixed(6)));
  }

  return { scoreByMlid, totalVotes: votes.length };
}

// ── Cache helpers ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { expiresAt: number; data: T };

function isCacheValid<T>(cache: CacheEntry<T> | null): cache is CacheEntry<T> {
  return cache !== null && cache.expiresAt > Date.now();
}

// ── Main Factory ───────────────────────────────────────────────────────────────

export function createCommunityEngine(params?: CommunityEngineParams) {
  const timeframe = params?.timeframe ?? "7d";
  const rankScope = params?.rankScope ?? "mythic_glory";
  const engineId = "community";

  // In-memory caches
  let heroCatalogCache: CacheEntry<Map<number, HeroRow>> | null = null;
  let rolePoolCache: CacheEntry<Map<number, RolePoolEntry[]>> | null = null;
  let tierMapCache: CacheEntry<Map<number, Tier>> | null = null;
  let rankStatsCache: CacheEntry<Map<number, { winRate: number; pickRate: number; banRate: number }>> | null = null;

  async function loadHeroCatalog(): Promise<Map<number, HeroRow>> {
    if (isCacheValid(heroCatalogCache)) return heroCatalogCache.data;
    const rows = await db.select({
      mlid: heroes.mlid, name: heroes.name, slug: heroes.slug,
      rolePrimary: heroes.rolePrimary, roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes, specialities: heroes.specialities, imageKey: heroes.imageKey,
    }).from(heroes).orderBy(asc(heroes.name));

    const map = new Map<number, HeroRow>();
    for (const row of rows) {
      map.set(row.mlid, {
        mlid: row.mlid, name: row.name, slug: row.slug,
        rolePrimary: row.rolePrimary, roleSecondary: row.roleSecondary,
        lanes: ((row.lanes ?? []) as string[]).filter(Boolean),
        specialities: ((row.specialities ?? []) as string[]).filter(Boolean),
        imageKey: row.imageKey ?? "",
      });
    }
    heroCatalogCache = { expiresAt: Date.now() + CACHE_TTL_MS, data: map };
    return map;
  }

  async function loadRolePoolMap(): Promise<Map<number, RolePoolEntry[]>> {
    if (isCacheValid(rolePoolCache)) return rolePoolCache.data;
    const rows = await db.select().from(heroRolePool).orderBy(desc(heroRolePool.confidence));
    const map = new Map<number, RolePoolEntry[]>();
    for (const row of rows) {
      const lane = row.lane as DraftLane;
      if (!DRAFT_LANES.includes(lane)) continue;
      const existing = map.get(row.mlid) ?? [];
      existing.push({ lane, confidence: toNumber(row.confidence), source: row.source ?? "db" });
      map.set(row.mlid, existing);
    }
    rolePoolCache = { expiresAt: Date.now() + CACHE_TTL_MS, data: map };
    return map;
  }

  async function loadTierMap(): Promise<Map<number, Tier>> {
    if (isCacheValid(tierMapCache)) return tierMapCache.data;
    const [snapshot] = await db.select({ rows: tierResults.rows })
      .from(tierResults)
      .where(and(eq(tierResults.timeframe, timeframe), eq(tierResults.segment, "all")))
      .orderBy(desc(tierResults.computedAt)).limit(1);
    const tierRows = normalizeTierRows(snapshot?.rows ?? []);
    const map = new Map(tierRows.map((row) => [row.mlid, row.tier]));
    tierMapCache = { expiresAt: Date.now() + CACHE_TTL_MS, data: map };
    return map;
  }

  async function loadRankStatsMap(): Promise<Map<number, { winRate: number; pickRate: number; banRate: number }>> {
    if (isCacheValid(rankStatsCache)) return rankStatsCache.data;
    const rows = await db.select().from(heroStatsLatest).where(eq(heroStatsLatest.timeframe, timeframe));
    const map = new Map<number, { winRate: number; pickRate: number; banRate: number }>();
    for (const row of rows) {
      map.set(row.mlid, {
        winRate: normalizeRate(row.winRate),
        pickRate: normalizeRate(row.pickRate),
        banRate: normalizeRate(row.banRate),
      });
    }
    rankStatsCache = { expiresAt: Date.now() + CACHE_TTL_MS, data: map };
    return map;
  }

  // ── 1. getStatus ─────────────────────────────────────────────────────────

  async function getStatus() {
    const [heroCount, statsCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(heroes),
      db.select({ count: sql<number>`count(*)::int` }).from(heroStatsLatest).where(eq(heroStatsLatest.timeframe, timeframe)),
    ]);
    const totalMaps = heroCount[0]?.count ?? 0;
    const readiness = buildEngineReadiness(totalMaps);
    const capabilities = buildEngineCapabilities(totalMaps);
    const degradedReason = buildDegradedReason(totalMaps);

    return {
      available: totalMaps > 0,
      ready: totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS,
      totalMaps,
      reason: degradedReason,
      readyReason: degradedReason,
      upstreamHealthy: totalMaps > 0,
      readiness,
      capabilities,
      degradedReason,
    };
  }

  // ── 2. getHeroList ───────────────────────────────────────────────────────

  async function getHeroList(): Promise<{ heroes: HeroAggregate[] }> {
    const heroCatalog = await loadHeroCatalog();
    const tierMap = await loadTierMap();
    const rankStatsMap = await loadRankStatsMap();
    const rolePoolMap = await loadRolePoolMap();

    const heroes: HeroAggregate[] = [];
    for (const [mlid, heroRow] of heroCatalog) {
      const stat = rankStatsMap.get(mlid);
      const tier = tierMap.get(mlid) ?? "D";
      const rp = rolePoolMap.get(mlid) ?? [];

      const winRate = stat?.winRate ?? 0;
      const pickRate = stat?.pickRate ?? 0;
      const banRate = stat?.banRate ?? 0;
      const appearance = pickRate + banRate; // rates represent share
      const picks = Math.round(pickRate * 100);
      const bans = Math.round(banRate * 100);
      const wins = Math.round(winRate * picks);

      const tierScore = tierNumeric(tier);
      const score = Number((0.40 * tierScore + 0.25 * (winRate * 100) + 0.20 * (pickRate * 100) + 0.15 * (banRate * 100)).toFixed(4));

      heroes.push({
        hero: heroRow,
        picks, bans, wins,
        weightedWins: wins,
        totalWeight: picks + bans,
        bluePicks: Math.round(picks * 0.5),
        redPicks: Math.round(picks * 0.5),
        blueWins: Math.round(wins * 0.5),
        redWins: Math.round(wins * 0.5),
        protectedBans: Math.round(bans * 0.3),
        pickRate, banRate, winRate,
        flexValue: Math.min(1, rp.length / 3),
        rolePool: rp,
        score, tier,
      });
    }

    heroes.sort((a, b) => b.score - a.score);
    return { heroes };
  }

  // ── 3. getHeroCounters ───────────────────────────────────────────────────

  async function getHeroCounters(mlid: number) {
    const rows = await db.execute<{
      counter_mlid: number;
      enemy_mlid: number;
      score: number;
    }>(sql`
      SELECT counter_mlid AS enemy_mlid, enemy_mlid AS counter_mlid, AVG(score)::float8 AS score
      FROM counter_matrix
      WHERE timeframe = ${timeframe} AND counter_mlid = ${mlid}
      GROUP BY counter_mlid, enemy_mlid
      ORDER BY score DESC LIMIT 50
    `);

    // Fix: counter_matrix has counter_mlid=hero that counters, enemy_mlid=hero being countered
    // We want: given hero X, who does X counter? → counter_mlid = X
    const counterRows = await db.execute<{
      counter_mlid: number;
      enemy_mlid: number;
      score: number;
      cnt: number;
    }>(sql`
      SELECT counter_mlid, enemy_mlid, AVG(score)::float8 AS score, COUNT(*)::int AS cnt
      FROM counter_matrix
      WHERE timeframe = ${timeframe} AND counter_mlid = ${mlid}
      GROUP BY counter_mlid, enemy_mlid
      ORDER BY score DESC LIMIT 50
    `);

    const items = counterRows.rows.map((row) => ({
      enemyMlid: row.enemy_mlid,
      score: Number(row.score.toFixed(4)),
      matches: row.cnt,
      wins: 0,
      sameLaneMatches: 0,
      protectionBans: 0,
    }));

    return { items };
  }

  // ── 4. getHeroProfile ────────────────────────────────────────────────────

  async function getHeroProfile(mlid: number): Promise<HeroProfile | null> {
    const heroCatalog = await loadHeroCatalog();
    const heroRow = heroCatalog.get(mlid);
    if (!heroRow) return null;

    const tierMap = await loadTierMap();
    const rankStatsMap = await loadRankStatsMap();
    const rolePoolMap = await loadRolePoolMap();

    const stat = rankStatsMap.get(mlid);
    const tier = tierMap.get(mlid) ?? "D";
    const rp = rolePoolMap.get(mlid) ?? [];
    const winRate = stat?.winRate ?? 0;
    const pickRate = stat?.pickRate ?? 0;
    const banRate = stat?.banRate ?? 0;
    const picks = Math.round(pickRate * 100);
    const bans = Math.round(banRate * 100);

    // Counter signals
    const counterResult = await db.execute<{
      enemy_mlid: number; score: number; cnt: number;
    }>(sql`
      SELECT enemy_mlid, AVG(score)::float8 AS score, COUNT(*)::int AS cnt
      FROM counter_matrix
      WHERE timeframe = ${timeframe} AND counter_mlid = ${mlid}
      GROUP BY enemy_mlid ORDER BY score DESC LIMIT 8
    `);

    const counterSignals = counterResult.rows.map((row) => ({
      enemyMlid: row.enemy_mlid,
      enemyName: heroCatalog.get(row.enemy_mlid)?.name ?? String(row.enemy_mlid),
      score: Number(row.score.toFixed(4)),
      matches: row.cnt,
      winRate: 0,
      sameLaneMatches: 0,
      protectionBans: 0,
    }));

    // Synergy signals
    const synergyResult = await db.execute<{
      synergy_mlid: number; score: number; cnt: number;
    }>(sql`
      SELECT hero_mlid AS synergy_mlid, AVG(score)::float8 AS score, COUNT(*)::int AS cnt
      FROM synergy_matrix
      WHERE timeframe = ${timeframe} AND hero_mlid = ${mlid}
      GROUP BY hero_mlid ORDER BY score DESC LIMIT 8
    `);

    const synergySignals = synergyResult.rows.map((row) => ({
      heroMlid: row.synergy_mlid,
      heroName: heroCatalog.get(row.synergy_mlid)?.name ?? String(row.synergy_mlid),
      score: Number(row.score.toFixed(4)),
      matches: row.cnt,
      winRate: 0,
      source: `${engineId}_pair`,
    }));

    return {
      hero: heroRow,
      statistic: {
        timeframe: engineId,
        rankScope: "community",
        winRate, pickRate, banRate,
        appearance: picks + bans,
        picks, bans,
        wins: Math.round(winRate * picks),
        totalMaps: 0,
      },
      tier: { timeframe: engineId, rankScope: "community", tier, score: tierNumeric(tier) },
      rolePool: rp.map((r) => ({ lane: r.lane, confidence: r.confidence, source: r.source })),
      counterSignals,
      synergySignals,
    };
  }

  // ── 5. analyzeDraft ──────────────────────────────────────────────────────

  async function analyzeDraft(body: {
    timeframe?: string;
    rankScope?: string;
    allyMlids: number[];
    enemyMlids: number[];
    allyBans?: number[];
    enemyBans?: number[];
    turnType?: string;
    turnSide?: string;
    draftSide?: string;
    mode?: string;
  }): Promise<AnalyzeResponse> {
    const turnType = asTurnType(body.turnType);
    const turnSide = asTurnSide(body.turnSide);
    const actingPicks = turnSide === "ally" ? body.allyMlids : body.enemyMlids;
    const opposingPicks = turnSide === "ally" ? body.enemyMlids : body.allyMlids;
    const bannedSet = new Set([
      ...body.allyMlids, ...body.enemyMlids,
      ...(body.allyBans ?? []), ...(body.enemyBans ?? []),
    ]);

    const heroCatalog = await loadHeroCatalog();
    const tierMap = await loadTierMap();
    const rankStatsMap = await loadRankStatsMap();
    const rolePoolMap = await loadRolePoolMap();

    const heroInfoMap = new Map<number, { rolePrimary: string; specialities: string[] }>();
    for (const [mlid, hero] of heroCatalog) {
      heroInfoMap.set(mlid, { rolePrimary: hero.rolePrimary, specialities: hero.specialities });
    }
    const draftHeroNameByMlid = new Map<number, string>();
    for (const [mlid, hero] of heroCatalog) {
      draftHeroNameByMlid.set(mlid, hero.name);
    }

    const tierByMlid = new Map(normalizeTierRows(
      (await db.select({ rows: tierResults.rows }).from(tierResults)
        .where(and(eq(tierResults.timeframe, timeframe), eq(tierResults.segment, "all")))
        .orderBy(desc(tierResults.computedAt)).limit(1))[0]?.rows ?? []
    ).map((row) => [row.mlid, row.tier]));

    const candidateMlids = Array.from(heroCatalog.keys()).filter((mlid) => !bannedSet.has(mlid));

    // Parallel DB queries
    const [counterRowsResult, synergyRowsResult, counterVsAlliesResult, synergyWithEnemyResult, draftCommunityResult] = await Promise.all([
      opposingPicks.length > 0
        ? db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
            SELECT counter_mlid, enemy_mlid, score::float8 AS score
            FROM counter_matrix WHERE timeframe = ${timeframe}
            AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(opposingPicks))}) LIMIT 3000
          `)
        : Promise.resolve({ rows: [] as Array<{ counter_mlid: number; enemy_mlid: number; score: number }> }),
      actingPicks.length > 0
        ? db.execute<{ synergy_mlid: number; hero_mlid: number; score: number }>(sql`
            SELECT synergy_mlid, hero_mlid, score::float8 AS score
            FROM synergy_matrix WHERE timeframe = ${timeframe}
            AND hero_mlid = ANY(${sql.raw(safeArrayLiteral(actingPicks))}) LIMIT 3000
          `)
        : Promise.resolve({ rows: [] as Array<{ synergy_mlid: number; hero_mlid: number; score: number }> }),
      actingPicks.length > 0
        ? db.execute<{ counter_mlid: number; score: number }>(sql`
            SELECT counter_mlid, score::float8 AS score
            FROM counter_matrix WHERE timeframe = ${timeframe}
            AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(actingPicks))}) LIMIT 3000
          `)
        : Promise.resolve({ rows: [] as Array<{ counter_mlid: number; score: number }> }),
      opposingPicks.length > 0
        ? db.execute<{ synergy_mlid: number; score: number }>(sql`
            SELECT synergy_mlid, score::float8 AS score
            FROM synergy_matrix WHERE timeframe = ${timeframe}
            AND hero_mlid = ANY(${sql.raw(safeArrayLiteral(opposingPicks))}) LIMIT 3000
          `)
        : Promise.resolve({ rows: [] as Array<{ synergy_mlid: number; score: number }> }),
      opposingPicks.length > 0
        ? fetchCommunityCounterScores(opposingPicks, candidateMlids, draftHeroNameByMlid)
        : Promise.resolve({ scoreByMlid: new Map<number, number>(), totalVotes: 0, matchupConfidence: 0 }),
    ]);

    // Build maps
    const counterScoreByMlid = new Map<number, number>();
    const counterToEnemyPairs = new Map<number, Set<number>>();
    for (const row of counterRowsResult.rows) {
      counterScoreByMlid.set(row.counter_mlid, (counterScoreByMlid.get(row.counter_mlid) ?? 0) + Number(row.score));
      const enemies = counterToEnemyPairs.get(row.counter_mlid) ?? new Set<number>();
      enemies.add(row.enemy_mlid);
      counterToEnemyPairs.set(row.counter_mlid, enemies);
    }

    const synergyScoreByMlid = new Map<number, number>();
    for (const row of synergyRowsResult.rows) {
      synergyScoreByMlid.set(row.synergy_mlid, (synergyScoreByMlid.get(row.synergy_mlid) ?? 0) + Number(row.score));
    }

    const protectionScoreByMlid = new Map<number, number>();
    for (const row of counterVsAlliesResult.rows) {
      protectionScoreByMlid.set(row.counter_mlid, (protectionScoreByMlid.get(row.counter_mlid) ?? 0) + Number(row.score));
    }

    const denialScoreByMlid = new Map<number, number>();
    for (const row of synergyWithEnemyResult.rows) {
      denialScoreByMlid.set(row.synergy_mlid, (denialScoreByMlid.get(row.synergy_mlid) ?? 0) + Number(row.score));
    }

    const draftCommunityScores = draftCommunityResult.scoreByMlid;
    const draftCommunityVotes = draftCommunityResult.totalVotes;

    const globalReliability = draftCommunityVotes > 0
      ? Math.max(0.25, Math.min(1, Math.log10(draftCommunityVotes + 1) / 2.6)) : 0;
    const communityReliability = draftCommunityVotes > 0
      ? Number((globalReliability * 0.4 + draftCommunityResult.matchupConfidence * 0.6).toFixed(4)) : 0;

    // Lane analysis
    const actingPickNumber = actingPicks.length + 1;
    const rolePoolEntries = Array.from(rolePoolMap.entries()).map(([mlid, entries]) => ({
      mlid,
      lanes: entries.map((e) => e.lane),
    }));
    const sharedRolePoolMap = buildRolePoolMap(rolePoolEntries);
    const actingFeasibility = evaluateDraftFeasibility(actingPicks, sharedRolePoolMap);
    const opposingFeasibility = evaluateDraftFeasibility(opposingPicks, sharedRolePoolMap);
    const actingMissingRoles = new Set<string>(actingFeasibility.missingRoles);
    const actingLaneCounts = new Map<string, number>();
    for (const lane of Object.values(actingFeasibility.heroToLane)) {
      actingLaneCounts.set(lane, (actingLaneCounts.get(lane) ?? 0) + 1);
    }
    for (const mlid of actingFeasibility.unassignedHeroes) {
      const lanes = rolePoolMap.get(mlid) ?? [];
      if (lanes[0]) actingLaneCounts.set(lanes[0].lane, (actingLaneCounts.get(lanes[0].lane) ?? 0) + 1);
    }
    const lockedSingleLanes = new Set<string>();
    for (const mlid of actingPicks) {
      const lanes = rolePoolMap.get(mlid) ?? [];
      if (lanes.length === 1 && lanes[0]) lockedSingleLanes.add(lanes[0].lane);
    }

    const pickNumber = actingPicks.length + 1;
    const pickPhase: "meta" | "flex" | "counter" = pickNumber <= 2 ? "meta" : pickNumber === 3 ? "flex" : "counter";
    const baseWeights = phaseWeights(pickNumber);

    // Score candidates
    const draftCounterRawByMlid = new Map<number, number>();
    for (const mlid of candidateMlids) {
      const raw = opposingPicks.length > 0 ? (counterScoreByMlid.get(mlid) ?? 0) / opposingPicks.length : 0;
      draftCounterRawByMlid.set(mlid, raw);
    }

    const scored = candidateMlids.map((mlid) => {
      const tierScore = tierNumeric(tierByMlid.get(mlid));
      const stat = rankStatsMap.get(mlid);
      const banRate = rate100(stat?.banRate);
      const pickRate = rate100(stat?.pickRate);
      const winRate = rate100(stat?.winRate);
      const lanes = rolePoolMap.get(mlid) ?? [];

      const fullyBlocked = lanes.length > 0 && lanes.every((lp) => lockedSingleLanes.has(lp.lane));
      if (fullyBlocked) return null;

      const coveredMissing = lanes.filter((lp) => actingMissingRoles.has(lp.lane));
      const coverageBoost = actingMissingRoles.size * Math.min(0.08, 0.15);
      const laneBonus = 0;
      const laneConflictPenalty = 0;
      const flexValue = lanes.length > 1 ? 60 : 0;

      const counterScore = rate100(stat?.banRate) * 0.01;
      const synergyScore = (synergyScoreByMlid.get(mlid) ?? 0) / Math.max(1, actingPicks.length) * 100;
      const stabilityBase = (tierScore + winRate + pickRate) / 3;

      // Blend counter + community
      const nCounter = draftCounterRawByMlid.get(mlid) ?? 0;
      const nCommunity = draftCommunityScores.get(mlid) ?? 0.5;
      const nTier = counterTierNorm(tierByMlid.get(mlid));

      const rawCounter = opposingPicks.length > 0 ? (counterScoreByMlid.get(mlid) ?? 0) / opposingPicks.length : 0;
      const enemiesCountered = opposingPicks.filter((e) => counterToEnemyPairs.get(mlid)?.has(e)).length;
      const coverageMult = opposingPicks.length > 0 ? 0.55 + 0.45 * (enemiesCountered / opposingPicks.length) : 1;

      const blended = (COUNTER_BLEND_DEFAULTS.counter * nCounter + COUNTER_BLEND_DEFAULTS.community * nCommunity + COUNTER_BLEND_DEFAULTS.tier * nTier) * coverageMult;
      const counterPickScore = Number(blended.toFixed(4));

      const metaRawScore = tierScore * 0.40 + winRate * 0.27 + pickRate * 0.14 + banRate * 0.07 + flexValue * 0.05;
      const metaScore = Number(metaRawScore.toFixed(4));

      const pickRawScore = baseWeights.counterWeight * counterPickScore * 100 + baseWeights.tierWeight * tierScore + baseWeights.flexWeight * flexValue + baseWeights.banRateWeight * banRate + baseWeights.pickRateWeight * pickRate + baseWeights.winRateWeight * winRate + baseWeights.laneBonusWeight * laneBonus;
      const pickScore = Number(pickRawScore.toFixed(4));

      const denialScore = denialScoreByMlid.get(mlid) ?? 0;
      const banRawScore = denialScore * 5 + tierScore * 0.30 + banRate * 0.15 + winRate * 0.10;
      const banScore = Number(banRawScore.toFixed(4));

      const archBoost = 0;

      return {
        mlid, tierScore, stat, banRate, pickRate, winRate, lanes, flexValue,
        coverageBoost, counterScore, synergyScore, stabilityBase, counterPickScore,
        metaScore, pickScore, banScore, archBoost,
        counterImpact: counterPickScore,
        tierPower: tierScore / 100,
        laneCoverage: coverageBoost,
        feasibilityGain: 0,
        denyValue: denialScore,
        synergyValue: synergyScore / 100,
        protectionValue: (protectionScoreByMlid.get(mlid) ?? 0) / Math.max(1, actingPicks.length),
      };
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    scored.sort((a, b) => b.pickScore - a.pickScore);

    const usedPicks = new Set<number>();
    const usedBans = new Set<number>();

    function makeRec(row: (typeof scored)[number], score: number, kind: "meta" | "flex" | "counter" | "ban"): RecommendationRow {
      const reasons: string[] = [];
      if (kind === "ban") {
        reasons.push("Targeted for denial against confirmed enemy threats.");
      } else {
        reasons.push(`Pick phase: ${pickPhase}. Tier: ${tierByMlid.get(row.mlid) ?? "D"}.`);
      }
      return {
        mlid: row.mlid,
        score: Number(score.toFixed(4)),
        tier: tierByMlid.get(row.mlid) as Tier | undefined,
        pickPhase: kind === "ban" ? undefined : pickPhase,
        reasons,
        breakdown: {
          counterImpact: row.counterImpact,
          tierPower: row.tierPower,
          laneCoverage: row.laneCoverage,
          flexValue: row.flexValue / 100,
          feasibilityGain: row.feasibilityGain,
          denyValue: row.denyValue,
          synergyValue: row.synergyValue,
          denialValue: row.denyValue,
          protectionValue: row.protectionValue,
        },
        preview: null,
      };
    }

    // Recommended picks
    const recommendedPicks: RecommendationRow[] = [];
    for (const row of scored) {
      if (recommendedPicks.length >= PICK_REC_COUNT) break;
      if (usedPicks.has(row.mlid)) continue;
      usedPicks.add(row.mlid);
      recommendedPicks.push(makeRec(row, row.pickScore, pickPhase));
    }

    // Recommended bans
    const banScored = [...scored].sort((a, b) => b.banScore - a.banScore);
    const recommendedBans: RecommendationRow[] = [];
    for (const row of banScored) {
      if (recommendedBans.length >= BAN_REC_COUNT) break;
      if (usedBans.has(row.mlid)) continue;
      usedBans.add(row.mlid);
      recommendedBans.push(makeRec(row, row.banScore, "ban"));
    }

    // Meta picks (sorted by meta score)
    const metaScored = [...scored].sort((a, b) => b.metaScore - a.metaScore);
    const recommendedMetaPicks: RecommendationRow[] = [];
    for (const row of metaScored) {
      if (recommendedMetaPicks.length >= PICK_REC_COUNT) break;
      recommendedMetaPicks.push(makeRec(row, row.metaScore, "meta"));
    }

    // Counter picks (sorted by counter score)
    const counterScored = [...scored].sort((a, b) => b.counterPickScore - a.counterPickScore);
    const recommendedCounterPicks: RecommendationRow[] = [];
    for (const row of counterScored) {
      if (recommendedCounterPicks.length >= PICK_REC_COUNT) break;
      recommendedCounterPicks.push(makeRec(row, row.counterPickScore, "counter"));
    }

    // Draft probability
    const allyTierPower = body.allyMlids.reduce((s, m) => s + tierNumeric(tierByMlid.get(m)), 0);
    const enemyTierPower = body.enemyMlids.reduce((s, m) => s + tierNumeric(tierByMlid.get(m)), 0);
    const diff = allyTierPower - enemyTierPower;
    const allyWinProb = Number((1 / (1 + Math.exp(-diff / LOGISTIC_DIVISOR)) * 100).toFixed(1));
    const enemyWinProb = Number((100 - allyWinProb).toFixed(1));

    const totalMaps = 0;
    const capabilities = buildEngineCapabilities(totalMaps);
    const readiness = buildEngineReadiness(totalMaps);
    const degradedReason = buildDegradedReason(totalMaps);

    const notes: string[] = [];
    if (actingMissingRoles.size > 0) {
      notes.push(`Missing lanes: ${Array.from(actingMissingRoles).join(", ")}.`);
    }

    return {
      recommendedPicks,
      recommendedBans,
      recommendedMetaPicks,
      recommendedCounterPicks,
      notes,
      archetype: null,
      draftProbability: { allyWinProb, enemyWinProb, confidence: communityReliability },
      dataset: {
        engine: engineId,
        totalMaps,
        generatedAt: new Date().toISOString(),
        unmatchedHeroes: [],
        readiness,
        capabilities,
        degradedReason,
      },
    };
  }

  // ── 6. matchupDraft ──────────────────────────────────────────────────────

  async function matchupDraft(body: {
    allyMlids: number[];
    enemyMlids: number[];
    allyLaneMlids?: number[];
    enemyLaneMlids?: number[];
  }): Promise<MatchupResponse> {
    const ally = body.allyMlids.slice().sort((a, b) => a - b);
    const enemy = body.enemyMlids.slice().sort((a, b) => a - b);

    const tierMap = await loadTierMap();
    const rolePoolMap = await loadRolePoolMap();

    const rolePoolEntries = Array.from(rolePoolMap.entries()).map(([mlid, entries]) => ({
      mlid,
      lanes: entries.map((e) => e.lane),
    }));
    const sharedRolePoolMap = buildRolePoolMap(rolePoolEntries);

    const allyTierPower = ally.reduce((sum, mlid) => sum + tierWeight(tierMap.get(mlid)), 0);
    const enemyTierPower = enemy.reduce((sum, mlid) => sum + tierWeight(tierMap.get(mlid)), 0);

    const [allyCounterRows, enemyCounterRows] = await Promise.all([
      db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
        SELECT counter_mlid, enemy_mlid, score::float8 AS score
        FROM counter_matrix WHERE timeframe = ${timeframe}
        AND counter_mlid = ANY(${sql.raw(safeArrayLiteral(ally))})
        AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(enemy))}) LIMIT 500
      `),
      db.execute<{ counter_mlid: number; enemy_mlid: number; score: number }>(sql`
        SELECT counter_mlid, enemy_mlid, score::float8 AS score
        FROM counter_matrix WHERE timeframe = ${timeframe}
        AND counter_mlid = ANY(${sql.raw(safeArrayLiteral(enemy))})
        AND enemy_mlid = ANY(${sql.raw(safeArrayLiteral(ally))}) LIMIT 500
      `),
    ]);

    const allyCounterEdge = allyCounterRows.rows.length > 0
      ? allyCounterRows.rows.reduce((s, r) => s + Number(r.score), 0) / allyCounterRows.rows.length
      : NEUTRAL_SIGNAL;
    const enemyCounterEdge = enemyCounterRows.rows.length > 0
      ? enemyCounterRows.rows.reduce((s, r) => s + Number(r.score), 0) / enemyCounterRows.rows.length
      : NEUTRAL_SIGNAL;

    const allyFeasibility = evaluateDraftFeasibility(ally, sharedRolePoolMap);
    const enemyFeasibility = evaluateDraftFeasibility(enemy, sharedRolePoolMap);

    const allyLaneComfort = body.allyLaneMlids && body.allyLaneMlids.length === 5 ? 3 : 0;
    const enemyLaneComfort = body.enemyLaneMlids && body.enemyLaneMlids.length === 5 ? 3 : 0;

    const TIER_WEIGHT = 14;
    const COUNTER_WEIGHT = 35;

    const allyBaseScore = allyTierPower * TIER_WEIGHT + allyCounterEdge * COUNTER_WEIGHT;
    const enemyBaseScore = enemyTierPower * TIER_WEIGHT + enemyCounterEdge * COUNTER_WEIGHT;

    const allyRiskPenalty = allyFeasibility.missingRoles.length * MISSING_LANE_PENALTY + (allyFeasibility.unassignedHeroes?.length ?? 0) * UNRESOLVED_FLEX_PENALTY;
    const enemyRiskPenalty = enemyFeasibility.missingRoles.length * MISSING_LANE_PENALTY + (enemyFeasibility.unassignedHeroes?.length ?? 0) * UNRESOLVED_FLEX_PENALTY;

    const allyScore = Math.max(0, allyBaseScore - allyRiskPenalty + allyLaneComfort * LANE_COMFORT_WEIGHT);
    const enemyScore = Math.max(0, enemyBaseScore - enemyRiskPenalty + enemyLaneComfort * LANE_COMFORT_WEIGHT);
    const diff = allyScore - enemyScore;
    const allyWinProb = Number(((1 / (1 + Math.exp(-(diff / LOGISTIC_DIVISOR)))) * 100).toFixed(1));
    const enemyWinProb = Number((100 - allyWinProb).toFixed(1));

    const verdict = Math.abs(diff) < 2 ? "Balanced draft" : diff > 0 ? "Ally draft advantage" : "Enemy draft advantage";

    const allyTopCounters = allyCounterRows.rows.slice(0, 4).map((r) => ({ counterMlid: r.counter_mlid, enemyMlid: r.enemy_mlid, score: Number(r.score.toFixed(4)) }));
    const enemyTopCounters = enemyCounterRows.rows.slice(0, 4).map((r) => ({ counterMlid: r.counter_mlid, enemyMlid: r.enemy_mlid, score: Number(r.score.toFixed(4)) }));

    const totalMaps = 0;
    const capabilities = buildEngineCapabilities(totalMaps);
    const readiness = buildEngineReadiness(totalMaps);

    const keyFactors: string[] = [];
    if (Math.abs(allyCounterEdge - enemyCounterEdge) >= 0.08) {
      keyFactors.push(allyCounterEdge > enemyCounterEdge ? "Ally has stronger counter interactions." : "Enemy has stronger counter interactions.");
    }
    if (Math.abs(allyTierPower - enemyTierPower) >= 2) {
      keyFactors.push(allyTierPower > enemyTierPower ? "Ally has higher tier-weighted core." : "Enemy has higher tier-weighted core.");
    }
    if (keyFactors.length === 0) {
      keyFactors.push("Both drafts are structurally close.");
    }

    return {
      verdict,
      allyScore: Number(allyScore.toFixed(2)),
      enemyScore: Number(enemyScore.toFixed(2)),
      allyWinProb,
      enemyWinProb,
      confidence: 0,
      components: {
        allyTierPower: Number(allyTierPower.toFixed(2)),
        enemyTierPower: Number(enemyTierPower.toFixed(2)),
        allyCounterEdge: Number(allyCounterEdge.toFixed(4)),
        enemyCounterEdge: Number(enemyCounterEdge.toFixed(4)),
        allySynergy: 0,
        enemySynergy: 0,
      },
      details: {
        ally: {
          coveredLanes: Object.keys(allyFeasibility.assignment) as DraftLane[],
          missingLanes: allyFeasibility.missingRoles,
          topCounterPairs: allyTopCounters,
          tierCounts: buildTierCounts(ally, tierMap),
        },
        enemy: {
          coveredLanes: Object.keys(enemyFeasibility.assignment) as DraftLane[],
          missingLanes: enemyFeasibility.missingRoles,
          topCounterPairs: enemyTopCounters,
          tierCounts: buildTierCounts(enemy, tierMap),
        },
        keyFactors,
      },
      dataset: {
        engine: engineId,
        totalMaps,
        readiness,
        capabilities,
        degradedReason: buildDegradedReason(totalMaps),
      },
    };
  }

  // ── 7. getPostmatchIntelligence ──────────────────────────────────────────

  async function getPostmatchIntelligence() {
    return {
      methodologyNote: "Community engine: data from ranked match statistics. No individual match-level intelligence available.",
      draftLogCoverage: 0,
      items: [] as TournamentPostmatchItem[],
    };
  }

  // ── Public Interface ─────────────────────────────────────────────────────

  return {
    getStatus,
    getHeroList,
    getHeroCounters,
    getHeroProfile,
    analyzeDraft,
    matchupDraft,
    getPostmatchIntelligence,
  };
}

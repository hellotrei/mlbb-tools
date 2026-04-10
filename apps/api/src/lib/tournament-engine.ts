import { asc, desc } from "drizzle-orm";
import { db, heroRolePool, heroes } from "@mlbb/db";
import type { DraftAnalyzeBody, DraftLane, Tier } from "@mlbb/shared";
import { Agent } from "undici";
import { cacheGet, cacheSet } from "./cache.js";

export type TournamentEngineConfig = {
  pages: readonly string[];
  engineId: string;
};

type EngineReadiness = "empty" | "limited" | "ready";

type EngineCapabilities = {
  meta: boolean;
  counter: boolean;
  matchup: boolean;
  patterns: boolean;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STATUS_TTL_MS = 5 * 60 * 1000;
const PERSISTED_DATASET_TTL_SECONDS = 7 * 24 * 60 * 60;
const PICK_REC_COUNT = 8;
const BAN_REC_COUNT = 8;
const MATCHUP_LOGISTIC_DIVISOR = 16;
const NEUTRAL_SIGNAL = 0.5;
const MIN_MAPS_FOR_ADVANCED_SIGNALS = 20;
const DRAFT_LANES: DraftLane[] = ["exp", "jungle", "mid", "gold", "roam"];
const ROLE_ORDER = ["tank", "fighter", "assassin", "mage", "marksman", "support"] as const;
const vercelApiIpv6Dispatcher = new Agent({
  connect: {
    family: 6
  }
});
const vercelApiIpv4Dispatcher = new Agent({
  connect: {
    family: 4
  }
});

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

type RolePoolEntry = {
  lane: DraftLane;
  confidence: number;
  source: string;
};

type DraftMapRecord = {
  page: string;
  bluePicks: number[];
  redPicks: number[];
  blueBans: number[];
  redBans: number[];
  winner: "blue" | "red";
};

export type HeroAggregate = {
  hero: HeroRow;
  picks: number;
  bans: number;
  wins: number;
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

type CounterPairAggregate = {
  candidateMlid: number;
  enemyMlid: number;
  matches: number;
  wins: number;
  sameLaneMatches: number;
  sameLaneWins: number;
  protectionBans: number;
  score: number;
};

type SynergyPairAggregate = {
  heroA: number;
  heroB: number;
  matches: number;
  wins: number;
  score: number;
};

type TournamentDataset = {
  generatedAt: string;
  maps: DraftMapRecord[];
  totalMaps: number;
  heroes: Map<number, HeroAggregate>;
  rolePool: Map<number, RolePoolEntry[]>;
  counterPairs: Map<string, CounterPairAggregate>;
  synergyPairs: Map<string, SynergyPairAggregate>;
  winningRolePatterns: Map<string, number>;
  winningTrioPatterns: Map<string, number>;
  unmatchedHeroTokens: string[];
};

type PersistedTournamentDataset = {
  generatedAt: string;
  maps: DraftMapRecord[];
  totalMaps: number;
  heroes: Array<[number, HeroAggregate]>;
  rolePool: Array<[number, RolePoolEntry[]]>;
  counterPairs: Array<[string, CounterPairAggregate]>;
  synergyPairs: Array<[string, SynergyPairAggregate]>;
  winningRolePatterns: Array<[string, number]>;
  winningTrioPatterns: Array<[string, number]>;
  unmatchedHeroTokens: string[];
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
  draftProbability: {
    allyWinProb: number;
    enemyWinProb: number;
    confidence: number;
  } | null;
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

type UpstreamState = {
  upstreamHealthy: boolean;
  reason: string | null;
  checkedAt: string;
};

type HeroProfile = {
  hero: {
    mlid: number;
    name: string;
    rolePrimary: string;
    lanes: string[];
    specialities: string[];
  };
  statistic: {
    timeframe: string;
    rankScope: "tournament";
    winRate: number;
    pickRate: number;
    banRate: number;
    appearance: number;
    picks: number;
    bans: number;
    wins: number;
    totalMaps: number;
  };
  tier: {
    timeframe: string;
    rankScope: "tournament";
    tier: Tier;
    score: number;
  };
  rolePool: Array<{ lane: DraftLane; confidence: number; source: string }>;
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

type EngineStatus = {
  available: boolean;
  totalMaps: number;
  generatedAt: string | null;
  reason: string | null;
  upstreamHealthy: boolean | null;
  readiness: EngineReadiness;
  capabilities: EngineCapabilities;
};

function normalizeHeroToken(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/x\.borg/g, "x-borg")
    .replace(/yi sun shin/g, "yi-sun-shin")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeMetric(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return NEUTRAL_SIGNAL;
  return clamp01((value - min) / (max - min));
}

function rolePatternKey(roleCounts: Record<string, number>) {
  return ROLE_ORDER.map((role) => `${role}:${roleCounts[role] ?? 0}`).join("|");
}

function trioPatternKey(mlids: number[]) {
  return mlids.slice().sort((a, b) => a - b).join(":");
}

function getVercelApiUrl() {
  const value = (process.env.VERCEL_API ?? "").trim();
  if (!value) {
    throw new Error("VERCEL_API is required");
  }
  return value;
}

function getVercelApiProxyToken() {
  const value = (process.env.VERCEL_API_PROXY_TOKEN ?? "").trim();
  return value && value.length > 0 ? value : null;
}

function tierByIndex(index: number, length: number): Tier {
  const ss = Math.ceil(length * 0.05);
  const s = Math.ceil(length * 0.15);
  const a = Math.ceil(length * 0.35);
  const b = Math.ceil(length * 0.6);
  const c = Math.ceil(length * 0.8);
  if (index < ss) return "SS";
  if (index < s) return "S";
  if (index < a) return "A";
  if (index < b) return "B";
  if (index < c) return "C";
  return "D";
}

function pairKey(a: number, b: number) {
  return `${a}:${b}`;
}

function synergyKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function overlapLanes(left: string[], right: string[]) {
  return left.some((lane) => right.includes(lane));
}

function serializeDataset(dataset: TournamentDataset): PersistedTournamentDataset {
  return {
    generatedAt: dataset.generatedAt,
    maps: dataset.maps,
    totalMaps: dataset.totalMaps,
    heroes: Array.from(dataset.heroes.entries()),
    rolePool: Array.from(dataset.rolePool.entries()),
    counterPairs: Array.from(dataset.counterPairs.entries()),
    synergyPairs: Array.from(dataset.synergyPairs.entries()),
    winningRolePatterns: Array.from(dataset.winningRolePatterns.entries()),
    winningTrioPatterns: Array.from(dataset.winningTrioPatterns.entries()),
    unmatchedHeroTokens: dataset.unmatchedHeroTokens
  };
}

function deserializeDataset(dataset: PersistedTournamentDataset): TournamentDataset {
  return {
    generatedAt: dataset.generatedAt,
    maps: dataset.maps,
    totalMaps: dataset.totalMaps,
    heroes: new Map(dataset.heroes),
    rolePool: new Map(dataset.rolePool),
    counterPairs: new Map(dataset.counterPairs),
    synergyPairs: new Map(dataset.synergyPairs),
    winningRolePatterns: new Map(dataset.winningRolePatterns),
    winningTrioPatterns: new Map(dataset.winningTrioPatterns),
    unmatchedHeroTokens: dataset.unmatchedHeroTokens
  };
}

function extractSimpleField(body: string, key: string) {
  const match = body.match(new RegExp(`\\|${key}=([^\\n\\r|}]*)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function extractHeroSequence(body: string, prefix: string) {
  const out: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const value = extractSimpleField(body, `${prefix}${index}`);
    if (value) out.push(value);
  }
  return out;
}

function parseMapBlocks(page: string, wikitext: string) {
  const maps: Array<{
    page: string;
    team1Side: "blue" | "red";
    team2Side: "blue" | "red";
    winner: "blue" | "red";
    team1Picks: string[];
    team2Picks: string[];
    team1Bans: string[];
    team2Bans: string[];
  }> = [];

  const mapRegex = /\|map\d+=\{\{Map\|([\s\S]*?)(?:\n\s*}}|}})/g;
  for (const match of wikitext.matchAll(mapRegex)) {
    const block = match[1] ?? "";
    if (!block || /finished=skip/i.test(block)) continue;

    const team1Side = extractSimpleField(block, "team1side") === "red" ? "red" : "blue";
    const team2Side = extractSimpleField(block, "team2side") === "blue" ? "blue" : "red";
    const winnerValue = extractSimpleField(block, "winner");
    const winner = winnerValue === "2" ? team2Side : team1Side;

    const team1Picks = extractHeroSequence(block, "t1h");
    const team2Picks = extractHeroSequence(block, "t2h");
    const team1Bans = extractHeroSequence(block, "t1b");
    const team2Bans = extractHeroSequence(block, "t2b");
    if (team1Picks.length !== 5 || team2Picks.length !== 5) continue;

    maps.push({
      page,
      team1Side,
      team2Side,
      winner,
      team1Picks,
      team2Picks,
      team1Bans,
      team2Bans
    });
  }

  return maps;
}

function buildRequestUrl(page: string) {
  const url = new URL(getVercelApiUrl());
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", page);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("format", "json");
  return url;
}

function vercelApiHeaders() {
  const headers: Record<string, string> = {
    accept: "application/json, text/javascript, */*; q=0.01",
    "accept-encoding": "gzip",
    "user-agent": "DraftArenaBot/1.0 (+https://mlbbdraftarena.vercel.app)"
  };
  const proxyToken = getVercelApiProxyToken();
  if (proxyToken) {
    headers["x-proxy-token"] = proxyToken;
  }
  return headers;
}

function shouldRetryVercelApiStatus(status: number) {
  return status === 403 || status === 429 || status >= 500;
}

async function discardResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {}
}

async function fetchVercelApiAttempt(url: URL, dispatcher?: Agent) {
  return dispatcher
    ? fetch(url, {
        headers: vercelApiHeaders(),
        dispatcher
      })
    : fetch(url, {
        headers: vercelApiHeaders()
      });
}

async function fetchVercelApi(url: URL) {
  const attempts = [
    () => fetchVercelApiAttempt(url, vercelApiIpv6Dispatcher),
    () => fetchVercelApiAttempt(url, vercelApiIpv4Dispatcher),
    () => fetchVercelApiAttempt(url)
  ];

  let lastError: unknown = null;
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const response = await attempts[index]!();
      if (!shouldRetryVercelApiStatus(response.status) || index === attempts.length - 1) {
        return response;
      }
      await discardResponse(response);
    } catch (error) {
      lastError = error;
      if (index === attempts.length - 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Upstream request failed.");
}

async function fetchWikitext(page: string) {
  const response = await fetchVercelApi(buildRequestUrl(page));
  if (!response.ok) {
    throw new Error(`Upstream request failed for ${page}: ${response.status}`);
  }

  const payload = await response.json() as { parse?: { wikitext?: { "*": string } } };
  return payload.parse?.wikitext?.["*"] ?? "";
}

async function loadHeroRows() {
  const heroRows = await db
    .select({
      mlid: heroes.mlid,
      name: heroes.name,
      slug: heroes.slug,
      rolePrimary: heroes.rolePrimary,
      roleSecondary: heroes.roleSecondary,
      lanes: heroes.lanes,
      specialities: heroes.specialities,
      imageKey: heroes.imageKey
    })
    .from(heroes)
    .orderBy(asc(heroes.name));

  const rolePoolRows = await db
    .select({
      mlid: heroRolePool.mlid,
      lane: heroRolePool.lane,
      confidence: heroRolePool.confidence,
      source: heroRolePool.source
    })
    .from(heroRolePool)
    .orderBy(desc(heroRolePool.confidence));

  const rolePoolByMlid = new Map<number, RolePoolEntry[]>();
  for (const row of rolePoolRows) {
    const lane = row.lane as DraftLane;
    if (!DRAFT_LANES.includes(lane)) continue;
    const bucket = rolePoolByMlid.get(row.mlid) ?? [];
    bucket.push({
      lane,
      confidence: Number(row.confidence),
      source: row.source
    });
    rolePoolByMlid.set(row.mlid, bucket);
  }

  const heroesBySlug = new Map<string, HeroRow>();
  const heroesByMlid = new Map<number, HeroRow>();
  for (const row of heroRows) {
    const hero: HeroRow = {
      mlid: row.mlid,
      name: row.name,
      slug: row.slug,
      rolePrimary: row.rolePrimary,
      roleSecondary: row.roleSecondary,
      lanes: (row.lanes as string[]) ?? [],
      specialities: (row.specialities as string[]) ?? [],
      imageKey: row.imageKey
    };
    heroesBySlug.set(normalizeHeroToken(row.slug || row.name), hero);
    heroesBySlug.set(normalizeHeroToken(row.name), hero);
    heroesByMlid.set(hero.mlid, hero);
  }

  return { heroesBySlug, heroesByMlid, rolePoolByMlid };
}

function resolveHeroMlids(
  tokens: string[],
  heroesBySlug: Map<string, HeroRow>,
  unmatched: Set<string>
) {
  const out: number[] = [];
  for (const token of tokens) {
    const normalized = normalizeHeroToken(token);
    const hero = heroesBySlug.get(normalized);
    if (!hero) {
      unmatched.add(token.trim());
      continue;
    }
    out.push(hero.mlid);
  }
  return out;
}

async function buildDataset(pages: readonly string[]): Promise<TournamentDataset> {
  const [{ heroesBySlug, heroesByMlid, rolePoolByMlid }, ...wikitexts] = await Promise.all([
    loadHeroRows(),
    ...pages.map((page) => fetchWikitext(page))
  ]);

  const unmatched = new Set<string>();
  const maps: DraftMapRecord[] = [];

  wikitexts.forEach((wikitext, index) => {
    const page = pages[index]!;
    for (const parsed of parseMapBlocks(page, wikitext)) {
      const team1Picks = resolveHeroMlids(parsed.team1Picks, heroesBySlug, unmatched);
      const team2Picks = resolveHeroMlids(parsed.team2Picks, heroesBySlug, unmatched);
      if (team1Picks.length !== 5 || team2Picks.length !== 5) continue;

      const team1Bans = resolveHeroMlids(parsed.team1Bans, heroesBySlug, unmatched);
      const team2Bans = resolveHeroMlids(parsed.team2Bans, heroesBySlug, unmatched);

      maps.push({
        page,
        bluePicks: parsed.team1Side === "blue" ? team1Picks : team2Picks,
        redPicks: parsed.team1Side === "red" ? team1Picks : team2Picks,
        blueBans: parsed.team1Side === "blue" ? team1Bans : team2Bans,
        redBans: parsed.team1Side === "red" ? team1Bans : team2Bans,
        winner: parsed.winner
      });
    }
  });

  const heroAgg = new Map<number, HeroAggregate>();
  const directedCounters = new Map<string, CounterPairAggregate>();
  const synergies = new Map<string, SynergyPairAggregate>();
  const winningRolePatterns = new Map<string, number>();
  const winningTrioPatterns = new Map<string, number>();

  const ensureHero = (mlid: number) => {
    const existing = heroAgg.get(mlid);
    if (existing) return existing;
    const hero = heroesByMlid.get(mlid);
    if (!hero) throw new Error(`Missing hero row for mlid=${mlid}`);
    const rolePool = rolePoolByMlid.get(mlid) ?? [];
    const next: HeroAggregate = {
      hero,
      picks: 0,
      bans: 0,
      wins: 0,
      bluePicks: 0,
      redPicks: 0,
      blueWins: 0,
      redWins: 0,
      protectedBans: 0,
      pickRate: 0,
      banRate: 0,
      winRate: 0,
      flexValue: clamp01(Math.min(3, Math.max(hero.lanes.length, rolePool.length)) / 3),
      rolePool,
      score: 0,
      tier: "D"
    };
    heroAgg.set(mlid, next);
    return next;
  };

  const recordTeam = (
    teamPicks: number[],
    enemyPicks: number[],
    teamBans: number[],
    didWin: boolean,
    side: "blue" | "red"
  ) => {
    for (const mlid of teamPicks) {
      const hero = ensureHero(mlid);
      hero.picks += 1;
      if (didWin) hero.wins += 1;
      if (side === "blue") {
        hero.bluePicks += 1;
        if (didWin) hero.blueWins += 1;
      } else {
        hero.redPicks += 1;
        if (didWin) hero.redWins += 1;
      }
    }

    for (const mlid of teamBans) {
      ensureHero(mlid).bans += 1;
    }

    for (const enemyMlid of enemyPicks) {
      const enemyHero = heroesByMlid.get(enemyMlid);
      if (!enemyHero) continue;

      for (const candidateMlid of teamPicks) {
        const candidateHero = heroesByMlid.get(candidateMlid);
        if (!candidateHero) continue;
        const key = pairKey(candidateMlid, enemyMlid);
        const current = directedCounters.get(key) ?? {
          candidateMlid,
          enemyMlid,
          matches: 0,
          wins: 0,
          sameLaneMatches: 0,
          sameLaneWins: 0,
          protectionBans: 0,
          score: NEUTRAL_SIGNAL
        };
        current.matches += 1;
        if (didWin) current.wins += 1;
        if (overlapLanes(candidateHero.lanes, enemyHero.lanes)) {
          current.sameLaneMatches += 1;
          if (didWin) current.sameLaneWins += 1;
        }
        directedCounters.set(key, current);
      }

      for (const bannedMlid of teamBans) {
        const bannedHero = heroesByMlid.get(bannedMlid);
        if (!bannedHero) continue;
        if (!overlapLanes(bannedHero.lanes, enemyHero.lanes)) continue;
        const key = pairKey(bannedMlid, enemyMlid);
        const current = directedCounters.get(key) ?? {
          candidateMlid: bannedMlid,
          enemyMlid,
          matches: 0,
          wins: 0,
          sameLaneMatches: 0,
          sameLaneWins: 0,
          protectionBans: 0,
          score: NEUTRAL_SIGNAL
        };
        current.protectionBans += 1;
        directedCounters.set(key, current);
        ensureHero(bannedMlid).protectedBans += 1;
      }
    }

    for (let index = 0; index < teamPicks.length; index += 1) {
      for (let inner = index + 1; inner < teamPicks.length; inner += 1) {
        const heroA = teamPicks[index]!;
        const heroB = teamPicks[inner]!;
        const key = synergyKey(heroA, heroB);
        const current = synergies.get(key) ?? {
          heroA: Math.min(heroA, heroB),
          heroB: Math.max(heroA, heroB),
          matches: 0,
          wins: 0,
          score: NEUTRAL_SIGNAL
        };
        current.matches += 1;
        if (didWin) current.wins += 1;
        synergies.set(key, current);
      }
    }
  };

  for (const map of maps) {
    recordTeam(map.bluePicks, map.redPicks, map.blueBans, map.winner === "blue", "blue");
    recordTeam(map.redPicks, map.bluePicks, map.redBans, map.winner === "red", "red");

    const winningTeam = map.winner === "blue" ? map.bluePicks : map.redPicks;
    const winningCounts: Record<string, number> = {};
    for (const mlid of winningTeam) {
      const hero = heroesByMlid.get(mlid);
      if (!hero) continue;
      winningCounts[hero.rolePrimary] = (winningCounts[hero.rolePrimary] ?? 0) + 1;
    }
    const key = rolePatternKey(winningCounts);
    winningRolePatterns.set(key, (winningRolePatterns.get(key) ?? 0) + 1);

    for (let i = 0; i < winningTeam.length; i += 1) {
      for (let j = i + 1; j < winningTeam.length; j += 1) {
        for (let k = j + 1; k < winningTeam.length; k += 1) {
          const trioKey = trioPatternKey([winningTeam[i]!, winningTeam[j]!, winningTeam[k]!]);
          winningTrioPatterns.set(trioKey, (winningTrioPatterns.get(trioKey) ?? 0) + 1);
        }
      }
    }
  }

  const totalDraftSides = Math.max(1, maps.length * 2);
  const heroRows = Array.from(heroAgg.values());

  for (const row of heroRows) {
    row.pickRate = Number(((row.picks / totalDraftSides) * 100).toFixed(3));
    row.banRate = Number(((row.bans / totalDraftSides) * 100).toFixed(3));
    row.winRate = row.picks > 0 ? Number(((row.wins / row.picks) * 100).toFixed(3)) : 0;
  }

  const pickRates = heroRows.map((row) => row.pickRate);
  const banRates = heroRows.map((row) => row.banRate);
  const winRates = heroRows.map((row) => row.winRate);
  const flexValues = heroRows.map((row) => row.flexValue);
  const pickMin = Math.min(...pickRates);
  const pickMax = Math.max(...pickRates);
  const banMin = Math.min(...banRates);
  const banMax = Math.max(...banRates);
  const winMin = Math.min(...winRates);
  const winMax = Math.max(...winRates);
  const flexMin = Math.min(...flexValues);
  const flexMax = Math.max(...flexValues);

  const sortedHeroRows = heroRows
    .map((row) => {
      const pickNorm = normalizeMetric(row.pickRate, pickMin, pickMax);
      const banNorm = normalizeMetric(row.banRate, banMin, banMax);
      const winNorm = normalizeMetric(row.winRate, winMin, winMax);
      const flexNorm = normalizeMetric(row.flexValue, flexMin, flexMax);
      row.score = Number((pickNorm * 0.34 + banNorm * 0.24 + winNorm * 0.30 + flexNorm * 0.12).toFixed(4));
      return row;
    })
    .sort((left, right) => right.score - left.score);

  sortedHeroRows.forEach((row, index) => {
    row.tier = tierByIndex(index, sortedHeroRows.length);
  });

  const protectionValues = Array.from(directedCounters.values()).map((entry) => entry.protectionBans);
  const protectionMin = protectionValues.length > 0 ? Math.min(...protectionValues) : 0;
  const protectionMax = protectionValues.length > 0 ? Math.max(...protectionValues) : 1;

  for (const entry of directedCounters.values()) {
    const winRate = entry.matches > 0 ? entry.wins / entry.matches : NEUTRAL_SIGNAL;
    const sameLaneWinRate = entry.sameLaneMatches > 0
      ? entry.sameLaneWins / entry.sameLaneMatches
      : winRate;
    const confidence = clamp01(Math.log2(entry.matches + 1) / 3.5);
    const protectionNorm = normalizeMetric(entry.protectionBans, protectionMin, protectionMax);
    const raw = winRate * 0.62 + sameLaneWinRate * 0.23 + protectionNorm * 0.15;
    entry.score = Number((NEUTRAL_SIGNAL * (1 - confidence) + raw * confidence).toFixed(4));
  }

  for (const entry of synergies.values()) {
    const rawWinRate = entry.matches > 0 ? entry.wins / entry.matches : NEUTRAL_SIGNAL;
    const confidence = clamp01(Math.log2(entry.matches + 1) / 3.5);
    entry.score = Number((NEUTRAL_SIGNAL * (1 - confidence) + rawWinRate * confidence).toFixed(4));
  }

  return {
    generatedAt: new Date().toISOString(),
    maps,
    totalMaps: maps.length,
    heroes: heroAgg,
    rolePool: rolePoolByMlid,
    counterPairs: directedCounters,
    synergyPairs: synergies,
    winningRolePatterns,
    winningTrioPatterns,
    unmatchedHeroTokens: Array.from(unmatched).sort((a, b) => a.localeCompare(b))
  };
}

function getRolePool(dataset: TournamentDataset, mlid: number) {
  return dataset.rolePool.get(mlid) ?? [];
}

function getHeroAggregate(dataset: TournamentDataset, mlid: number) {
  return dataset.heroes.get(mlid) ?? null;
}

function getCounterPair(dataset: TournamentDataset, candidateMlid: number, enemyMlid: number) {
  return dataset.counterPairs.get(pairKey(candidateMlid, enemyMlid)) ?? null;
}

function getSynergyPair(dataset: TournamentDataset, heroA: number, heroB: number) {
  return dataset.synergyPairs.get(synergyKey(heroA, heroB)) ?? null;
}

function roleCountsForTeam(dataset: TournamentDataset, mlids: number[]) {
  const counts: Record<string, number> = {};
  for (const mlid of mlids) {
    const aggregate = getHeroAggregate(dataset, mlid);
    const role = aggregate?.hero.rolePrimary;
    if (!role) continue;
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

function tierNumeric(tier: Tier | undefined) {
  if (tier === "SS") return 1;
  if (tier === "S") return 0.85;
  if (tier === "A") return 0.7;
  if (tier === "B") return 0.55;
  if (tier === "C") return 0.4;
  return 0.25;
}

function teamCoverage(dataset: TournamentDataset, mlids: number[]) {
  const lanes = new Set<DraftLane>();
  for (const mlid of mlids) {
    for (const row of getRolePool(dataset, mlid)) {
      lanes.add(row.lane);
    }
  }
  const covered = DRAFT_LANES.filter((lane) => lanes.has(lane));
  const missing = DRAFT_LANES.filter((lane) => !lanes.has(lane));
  return { covered, missing };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleConfidence(matches: number) {
  return clamp01(Math.log2(matches + 1) / 3.5);
}

function currentPickPhase(pickNumber: number): "meta" | "flex" | "counter" {
  if (pickNumber <= 2) return "meta";
  if (pickNumber === 3) return "flex";
  return "counter";
}

function buildEngineCapabilities(totalMaps: number): EngineCapabilities {
  return {
    meta: totalMaps > 0,
    counter: totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS,
    matchup: totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS,
    patterns: totalMaps >= MIN_MAPS_FOR_ADVANCED_SIGNALS
  };
}

function buildEngineReadiness(totalMaps: number): EngineReadiness {
  if (totalMaps <= 0) return "empty";
  if (totalMaps < MIN_MAPS_FOR_ADVANCED_SIGNALS) return "limited";
  return "ready";
}

function buildDegradedReason(totalMaps: number) {
  if (totalMaps <= 0) return "Tournament dataset is still empty.";
  if (totalMaps < MIN_MAPS_FOR_ADVANCED_SIGNALS) {
    return `Tournament dataset is still limited (${totalMaps} map${totalMaps === 1 ? "" : "s"}). Meta picks are available, but counter and matchup signals are still warming up.`;
  }
  return null;
}

function phaseWeightsForPick(pickNumber: number) {
  if (pickNumber <= 2) {
    return { meta: 0.5, counter: 0.12, synergy: 0.1, coverage: 0.16, flex: 0.12 };
  }
  if (pickNumber === 3) {
    return { meta: 0.4, counter: 0.2, synergy: 0.14, coverage: 0.16, flex: 0.1 };
  }
  return { meta: 0.27, counter: 0.35, synergy: 0.2, coverage: 0.1, flex: 0.08 };
}

function enemyCounterPriority(dataset: TournamentDataset, mlid: number) {
  const aggregate = getHeroAggregate(dataset, mlid);
  const primaryLane = getRolePool(dataset, mlid)[0]?.lane;

  if (primaryLane === "jungle") return 1;
  if (primaryLane === "gold") return 0.94;
  if (primaryLane === "mid") return 0.88;
  if (primaryLane === "exp") return 0.72;
  if (primaryLane === "roam") return 0.56;

  if (aggregate?.hero.rolePrimary === "assassin" || aggregate?.hero.rolePrimary === "marksman") return 0.92;
  if (aggregate?.hero.rolePrimary === "mage") return 0.84;
  if (aggregate?.hero.rolePrimary === "fighter") return 0.72;
  if (aggregate?.hero.rolePrimary === "support" || aggregate?.hero.rolePrimary === "tank") return 0.56;
  return 0.7;
}

function enemyThreatWeight(dataset: TournamentDataset, enemyMlid: number, enemyTeamMlids: number[]) {
  const aggregate = getHeroAggregate(dataset, enemyMlid);
  if (!aggregate) return 0.7;

  const heroPower = clamp01(
    tierNumeric(aggregate.tier) * 0.32 +
    clamp01(aggregate.winRate / 100) * 0.22 +
    clamp01(aggregate.pickRate / 100) * 0.18 +
    clamp01(aggregate.banRate / 100) * 0.12 +
    aggregate.flexValue * 0.16
  );

  const teamSynergy = enemyTeamMlids
    .filter((mlid) => mlid !== enemyMlid)
    .map((mlid) => getSynergyPair(dataset, enemyMlid, mlid))
    .filter(Boolean);
  const synergyThreat = teamSynergy.length > 0
    ? average(teamSynergy.map((entry) => entry?.score ?? NEUTRAL_SIGNAL))
    : NEUTRAL_SIGNAL;
  const synergyConfidence = teamSynergy.length > 0
    ? average(teamSynergy.map((entry) => sampleConfidence(entry.matches)))
    : 0;
  const synergyAdjusted = clamp01(
    NEUTRAL_SIGNAL * (1 - synergyConfidence) + synergyThreat * synergyConfidence
  );

  const rolePriority = enemyCounterPriority(dataset, enemyMlid);
  return clamp01(heroPower * 0.48 + synergyAdjusted * 0.24 + rolePriority * 0.28);
}

function blindPickSafety(aggregate: HeroAggregate) {
  return clamp01(
    tierNumeric(aggregate.tier) * 0.45 +
    clamp01(aggregate.banRate / 100) * 0.2 +
    clamp01(aggregate.pickRate / 100) * 0.2 +
    aggregate.flexValue * 0.15
  );
}

function draftAvailability(aggregate: HeroAggregate, pickPhase: "meta" | "flex" | "counter") {
  const banExposure = clamp01(aggregate.banRate / 100);
  if (pickPhase === "meta") return clamp01(1 - banExposure * 0.35);
  if (pickPhase === "flex") return clamp01(1 - banExposure * 0.5);
  return clamp01(1 - banExposure * 0.68);
}

function sideFit(aggregate: HeroAggregate, draftSide?: "blue" | "red") {
  if (!draftSide) return NEUTRAL_SIGNAL;
  const sidePicks = draftSide === "blue" ? aggregate.bluePicks : aggregate.redPicks;
  const sideWins = draftSide === "blue" ? aggregate.blueWins : aggregate.redWins;
  const sideConfidence = sampleConfidence(sidePicks);
  const sideWinRate = sidePicks > 0 ? sideWins / sidePicks : NEUTRAL_SIGNAL;
  const sidePresence = sidePicks / Math.max(1, aggregate.picks);
  return clamp01(
    NEUTRAL_SIGNAL * (1 - sideConfidence) +
    clamp01(sideWinRate * 0.68 + sidePresence * 0.32) * sideConfidence
  );
}

function oppositeDraftSide(side?: "blue" | "red") {
  if (side === "blue") return "red" as const;
  if (side === "red") return "blue" as const;
  return undefined;
}

function compositionPatternFit(dataset: TournamentDataset, teamMlids: number[]) {
  if (teamMlids.length === 0 || dataset.winningRolePatterns.size === 0) return NEUTRAL_SIGNAL;

  const counts = roleCountsForTeam(dataset, teamMlids);
  const currentKey = rolePatternKey(counts);
  const exact = dataset.winningRolePatterns.get(currentKey);
  const total = Array.from(dataset.winningRolePatterns.values()).reduce((sum, value) => sum + value, 0);
  if (exact) {
    return clamp01(0.55 + exact / Math.max(1, total) * 2.2);
  }

  let bestSimilarity = 0;
  let bestWeight = 0;
  for (const [patternKey, weight] of dataset.winningRolePatterns.entries()) {
    const targetCounts = Object.fromEntries(
      patternKey.split("|").map((entry) => {
        const [role, count] = entry.split(":");
        return [role, Number(count)];
      })
    ) as Record<string, number>;
    const overlap = ROLE_ORDER.reduce((sum, role) => {
      return sum + Math.min(counts[role] ?? 0, targetCounts[role] ?? 0);
    }, 0);
    const similarity = clamp01(overlap / Math.max(1, teamMlids.length));
    if (similarity > bestSimilarity || (similarity === bestSimilarity && weight > bestWeight)) {
      bestSimilarity = similarity;
      bestWeight = weight;
    }
  }

  return clamp01(NEUTRAL_SIGNAL * 0.6 + bestSimilarity * 0.4);
}

function trioPatternFit(dataset: TournamentDataset, teamMlids: number[]) {
  if (teamMlids.length < 2 || dataset.winningTrioPatterns.size === 0) return NEUTRAL_SIGNAL;

  const total = Array.from(dataset.winningTrioPatterns.values()).reduce((sum, value) => sum + value, 0);
  let bestWeight = 0;

  if (teamMlids.length >= 3) {
    for (let i = 0; i < teamMlids.length; i += 1) {
      for (let j = i + 1; j < teamMlids.length; j += 1) {
        for (let k = j + 1; k < teamMlids.length; k += 1) {
          const trioKey = trioPatternKey([teamMlids[i]!, teamMlids[j]!, teamMlids[k]!]);
          bestWeight = Math.max(bestWeight, dataset.winningTrioPatterns.get(trioKey) ?? 0);
        }
      }
    }
  } else {
    const duo = new Set(teamMlids);
    for (const [patternKey, weight] of dataset.winningTrioPatterns.entries()) {
      const trio = patternKey.split(":").map(Number);
      const overlap = trio.filter((mlid) => duo.has(mlid)).length;
      if (overlap >= 2) bestWeight = Math.max(bestWeight, weight);
    }
  }

  if (bestWeight <= 0) return NEUTRAL_SIGNAL;
  return clamp01(0.55 + bestWeight / Math.max(1, total) * 2.5);
}

function committedSingleLanes(dataset: TournamentDataset, mlids: number[]) {
  const locked = new Set<DraftLane>();
  for (const mlid of mlids) {
    const rolePool = getRolePool(dataset, mlid);
    const lanes = rolePool.length > 0
      ? Array.from(new Set(rolePool.map((row) => row.lane)))
      : ((getHeroAggregate(dataset, mlid)?.hero.lanes ?? []).filter((lane): lane is DraftLane => DRAFT_LANES.includes(lane as DraftLane)));
    if (lanes.length === 1) locked.add(lanes[0]!);
  }
  return locked;
}

function passesSupplementalLaneRule(
  dataset: TournamentDataset,
  candidateMlid: number,
  actingMlids: number[],
  missingLanes: DraftLane[]
) {
  const locked = committedSingleLanes(dataset, actingMlids);
  if (locked.size === 0) return true;

  const rolePool = getRolePool(dataset, candidateMlid);
  const candidateLanes = rolePool.length > 0
    ? Array.from(new Set(rolePool.map((row) => row.lane)))
    : ((getHeroAggregate(dataset, candidateMlid)?.hero.lanes ?? []).filter((lane): lane is DraftLane => DRAFT_LANES.includes(lane as DraftLane)));

  if (candidateLanes.length === 0) return true;
  if (missingLanes.some((lane) => candidateLanes.includes(lane))) return true;
  return !candidateLanes.every((lane) => locked.has(lane));
}

function prioritizeMissingLaneCoverage(
  dataset: TournamentDataset,
  rows: RecommendationRow[],
  missingLanes: DraftLane[]
) {
  if (missingLanes.length === 0) return rows;
  const missingSet = new Set(missingLanes);
  return rows
    .slice()
    .sort((left, right) => {
      const leftLanes = getRolePool(dataset, left.mlid).map((row) => row.lane);
      const rightLanes = getRolePool(dataset, right.mlid).map((row) => row.lane);
      const leftHits = leftLanes.filter((lane) => missingSet.has(lane)).length;
      const rightHits = rightLanes.filter((lane) => missingSet.has(lane)).length;
      return rightHits - leftHits;
    });
}

function prioritizeRoleBalance(
  dataset: TournamentDataset,
  rows: RecommendationRow[],
  actingMlids: number[]
) {
  const picked = actingMlids
    .map((mlid) => getHeroAggregate(dataset, mlid))
    .filter((row): row is HeroAggregate => Boolean(row));
  const damageCount = picked.filter((row) =>
    row.hero.rolePrimary === "assassin" ||
    row.hero.rolePrimary === "mage" ||
    row.hero.rolePrimary === "marksman"
  ).length;
  const frontlineCount = picked.filter((row) =>
    row.hero.rolePrimary === "tank" ||
    row.hero.rolePrimary === "support" ||
    row.hero.rolePrimary === "fighter"
  ).length;

  if (damageCount < 2 && frontlineCount > 0) return rows;

  return rows
    .slice()
    .sort((left, right) => {
      const leftHero = getHeroAggregate(dataset, left.mlid);
      const rightHero = getHeroAggregate(dataset, right.mlid);
      const leftRole = leftHero?.hero.rolePrimary ?? "";
      const rightRole = rightHero?.hero.rolePrimary ?? "";

      const leftBalance =
        leftRole === "tank" || leftRole === "support"
          ? 1
          : leftRole === "fighter"
            ? 0.78
            : damageCount >= 2 && frontlineCount === 0
              ? 0.18
              : 0.42;
      const rightBalance =
        rightRole === "tank" || rightRole === "support"
          ? 1
          : rightRole === "fighter"
            ? 0.78
            : damageCount >= 2 && frontlineCount === 0
              ? 0.18
              : 0.42;

      return rightBalance - leftBalance;
    });
}

function selectLaneDiverse(
  dataset: TournamentDataset,
  rows: RecommendationRow[],
  count: number,
  maxPerLane: number
) {
  const out: RecommendationRow[] = [];
  const laneCounts = new Map<string, number>();

  for (const row of rows) {
    const lane = getRolePool(dataset, row.mlid)[0]?.lane ?? "unknown";
    const used = laneCounts.get(lane) ?? 0;
    if (used >= maxPerLane) continue;
    laneCounts.set(lane, used + 1);
    out.push(row);
    if (out.length >= count) break;
  }

  if (out.length >= count) return out;

  for (const row of rows) {
    if (out.find((item) => item.mlid === row.mlid)) continue;
    out.push(row);
    if (out.length >= count) break;
  }

  return out;
}

function createRecommendation(
  dataset: TournamentDataset,
  aggregate: HeroAggregate,
  score: number,
  pickPhase: "meta" | "flex" | "counter",
  summary: {
    counterImpact: number;
    synergyValue: number;
    coverageGain: number;
    flexValue: number;
    denyValue: number;
    protectionValue: number;
    laneCoverage: number;
  },
  reasons: string[]
): RecommendationRow {
  return {
    mlid: aggregate.hero.mlid,
    score: Number(score.toFixed(4)),
    tier: aggregate.tier,
    pickPhase,
    reasons,
    breakdown: {
      counterImpact: Number(summary.counterImpact.toFixed(4)),
      tierPower: Number(tierNumeric(aggregate.tier).toFixed(4)),
      laneCoverage: Number(summary.laneCoverage.toFixed(4)),
      flexValue: Number(summary.flexValue.toFixed(4)),
      feasibilityGain: Number(summary.coverageGain.toFixed(4)),
      denyValue: Number(summary.denyValue.toFixed(4)),
      synergyValue: Number(summary.synergyValue.toFixed(4)),
      protectionValue: Number(summary.protectionValue.toFixed(4))
    },
    preview: null
  };
}

function buildTierCounts(dataset: TournamentDataset, mlids: number[]) {
  const counts: Record<string, number> = { SS: 0, S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const mlid of mlids) {
    const tier = getHeroAggregate(dataset, mlid)?.tier ?? "D";
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

function topCounterPairs(dataset: TournamentDataset, teamMlids: number[], enemyMlids: number[]) {
  return teamMlids
    .flatMap((counterMlid) =>
      enemyMlids.map((enemyMlid) => {
        const pair = getCounterPair(dataset, counterMlid, enemyMlid);
        return pair
          ? {
              counterMlid,
              enemyMlid,
              score: Number(pair.score.toFixed(4))
            }
          : null;
      })
    )
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

export function createTournamentEngine(config: TournamentEngineConfig) {
  const { pages, engineId } = config;
  const persistedDatasetCacheKey = `tournament:${engineId}:dataset:v1`;
  const persistedUpstreamStateCacheKey = `tournament:${engineId}:upstream:v1`;

  let datasetCache: { expiresAt: number; data: TournamentDataset } | null = null;
  let datasetPending: Promise<TournamentDataset> | null = null;
  let upstreamStateCache: { expiresAt: number; data: UpstreamState } | null = null;

  function getMemoryCachedDataset() {
    return datasetCache?.data ?? null;
  }

  async function getCachedDataset() {
    const memoryDataset = getMemoryCachedDataset();
    if (memoryDataset) {
      return memoryDataset;
    }

    try {
      const persistedDataset = await cacheGet<PersistedTournamentDataset>(persistedDatasetCacheKey);
      if (!persistedDataset) {
        return null;
      }

      const hydratedDataset = deserializeDataset(persistedDataset);
      datasetCache = { expiresAt: Date.now() + STATUS_TTL_MS, data: hydratedDataset };
      return hydratedDataset;
    } catch {
      return null;
    }
  }

  function cacheUpstreamState(data: UpstreamState) {
    upstreamStateCache = { expiresAt: Date.now() + STATUS_TTL_MS, data };
  }

  function isRecentUpstreamState(state: UpstreamState) {
    const checkedAt = Date.parse(state.checkedAt);
    if (!Number.isFinite(checkedAt)) return false;
    return Date.now() - checkedAt <= STATUS_TTL_MS;
  }

  async function getCachedUpstreamState() {
    if (upstreamStateCache && upstreamStateCache.expiresAt > Date.now()) {
      return upstreamStateCache.data;
    }

    try {
      const persistedState = await cacheGet<UpstreamState>(persistedUpstreamStateCacheKey);
      if (!persistedState) {
        return null;
      }

      cacheUpstreamState(persistedState);
      return persistedState;
    } catch {
      return null;
    }
  }

  async function persistUpstreamState(upstreamHealthy: boolean, reason: string | null) {
    const data: UpstreamState = {
      upstreamHealthy,
      reason,
      checkedAt: new Date().toISOString()
    };
    cacheUpstreamState(data);
    await cacheSet(persistedUpstreamStateCacheKey, data, PERSISTED_DATASET_TTL_SECONDS);
    return data;
  }

  function buildStatusFromDataset(
    dataset: TournamentDataset,
    upstreamHealthy: boolean | null,
    upstreamReason: string | null
  ): EngineStatus {
    const readiness = buildEngineReadiness(dataset.totalMaps);
    const capabilities = buildEngineCapabilities(dataset.totalMaps);
    const degradedReason = buildDegradedReason(dataset.totalMaps);
    const reason = upstreamHealthy === false
      ? dataset.totalMaps > 0
        ? [degradedReason, `Upstream temporarily unavailable: ${upstreamReason ?? `${engineId} dataset is unavailable.`}`]
            .filter((value): value is string => Boolean(value))
            .join(" ")
        : upstreamReason ?? `${engineId} dataset is unavailable.`
      : degradedReason;

    return {
      available: dataset.totalMaps > 0,
      totalMaps: dataset.totalMaps,
      generatedAt: dataset.generatedAt,
      reason,
      upstreamHealthy,
      readiness,
      capabilities
    };
  }

  async function getDataset() {
    if (datasetCache && datasetCache.expiresAt > Date.now()) {
      return datasetCache.data;
    }
    if (datasetPending) {
      return datasetPending;
    }
    datasetPending = buildDataset(pages)
      .then(async (data) => {
        datasetCache = { expiresAt: Date.now() + CACHE_TTL_MS, data };
        await Promise.all([
          cacheSet(persistedDatasetCacheKey, serializeDataset(data), PERSISTED_DATASET_TTL_SECONDS),
          persistUpstreamState(true, null)
        ]);
        return data;
      })
      .catch(async (error) => {
        await persistUpstreamState(false, error instanceof Error ? error.message : `${engineId} dataset is unavailable.`);
        const staleDataset = await getCachedDataset();
        if (staleDataset) {
          datasetCache = { expiresAt: Date.now() + STATUS_TTL_MS, data: staleDataset };
          return staleDataset;
        }
        throw error;
      })
      .finally(() => {
        datasetPending = null;
      });
    return datasetPending;
  }

  async function getStatus(): Promise<EngineStatus> {
    const staleDataset = await getCachedDataset();
    const upstreamState = await getCachedUpstreamState();

    if (staleDataset) {
      return buildStatusFromDataset(staleDataset, upstreamState?.upstreamHealthy ?? null, upstreamState?.reason ?? null);
    }

    if (upstreamState && !upstreamState.upstreamHealthy && isRecentUpstreamState(upstreamState)) {
      return {
        available: false,
        totalMaps: 0,
        generatedAt: null,
        reason: upstreamState.reason ?? `${engineId} dataset is unavailable.`,
        upstreamHealthy: false,
        readiness: "empty",
        capabilities: buildEngineCapabilities(0)
      };
    }

    try {
      const dataset = await getDataset();
      const latestUpstreamState = await getCachedUpstreamState();
      return buildStatusFromDataset(dataset, latestUpstreamState?.upstreamHealthy ?? true, latestUpstreamState?.reason ?? null);
    } catch (error) {
      await persistUpstreamState(false, error instanceof Error ? error.message : `${engineId} dataset is unavailable.`);

      return {
        available: false,
        totalMaps: 0,
        generatedAt: null,
        reason: error instanceof Error ? error.message : `${engineId} dataset is unavailable.`,
        upstreamHealthy: false,
        readiness: "empty",
        capabilities: buildEngineCapabilities(0)
      };
    }
  }

  async function getHeroList(): Promise<{ heroes: HeroAggregate[] }> {
    const dataset = await getDataset();
    return { heroes: Array.from(dataset.heroes.values()) };
  }

  async function getHeroCounters(mlid: number): Promise<{ items: Array<{ enemyMlid: number; score: number; matches: number; wins: number; sameLaneMatches: number; protectionBans: number }> }> {
    const dataset = await getDataset();
    const items = Array.from(dataset.counterPairs.values())
      .filter((entry) => entry.candidateMlid === mlid)
      .sort((left, right) => right.score - left.score)
      .map((entry) => ({
        enemyMlid: entry.enemyMlid,
        score: Number(entry.score.toFixed(4)),
        matches: entry.matches,
        wins: entry.wins,
        sameLaneMatches: entry.sameLaneMatches,
        protectionBans: entry.protectionBans
      }));
    return { items };
  }

  async function getHeroProfile(mlid: number): Promise<HeroProfile | null> {
    const dataset = await getDataset();
    const aggregate = getHeroAggregate(dataset, mlid);
    if (!aggregate) return null;

    const counters = Array.from(dataset.counterPairs.values())
      .filter((entry) => entry.candidateMlid === mlid)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map((entry) => {
        const enemy = getHeroAggregate(dataset, entry.enemyMlid);
        return {
          enemyMlid: entry.enemyMlid,
          enemyName: enemy?.hero.name ?? String(entry.enemyMlid),
          score: Number(entry.score.toFixed(4)),
          matches: entry.matches,
          winRate: Number((entry.matches > 0 ? entry.wins / entry.matches : 0).toFixed(4)),
          sameLaneMatches: entry.sameLaneMatches,
          protectionBans: entry.protectionBans
        };
      });

    const synergies = Array.from(dataset.synergyPairs.values())
      .filter((entry) => entry.heroA === mlid || entry.heroB === mlid)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map((entry) => {
        const teammateMlid = entry.heroA === mlid ? entry.heroB : entry.heroA;
        const teammate = getHeroAggregate(dataset, teammateMlid);
        return {
          heroMlid: teammateMlid,
          heroName: teammate?.hero.name ?? String(teammateMlid),
          score: Number(entry.score.toFixed(4)),
          matches: entry.matches,
          winRate: Number((entry.matches > 0 ? entry.wins / entry.matches : 0).toFixed(4)),
          source: `${engineId}_pair`
        };
      });

    return {
      hero: {
        mlid: aggregate.hero.mlid,
        name: aggregate.hero.name,
        rolePrimary: aggregate.hero.rolePrimary,
        lanes: aggregate.hero.lanes,
        specialities: aggregate.hero.specialities
      },
      statistic: {
        timeframe: engineId,
        rankScope: "tournament",
        winRate: aggregate.winRate,
        pickRate: aggregate.pickRate,
        banRate: aggregate.banRate,
        appearance: aggregate.picks + aggregate.bans,
        picks: aggregate.picks,
        bans: aggregate.bans,
        wins: aggregate.wins,
        totalMaps: dataset.totalMaps
      },
      tier: {
        timeframe: engineId,
        rankScope: "tournament",
        tier: aggregate.tier,
        score: aggregate.score
      },
      rolePool: aggregate.rolePool.map((row) => ({
        lane: row.lane,
        confidence: row.confidence,
        source: row.source
      })),
      counterSignals: counters,
      synergySignals: synergies
    };
  }

  async function analyzeDraft(body: DraftAnalyzeBody): Promise<AnalyzeResponse> {
    const dataset = await getDataset();
    const capabilities = buildEngineCapabilities(dataset.totalMaps);
    const readiness = buildEngineReadiness(dataset.totalMaps);
    const degradedReason = buildDegradedReason(dataset.totalMaps);
    const banned = new Set([
      ...body.allyMlids,
      ...body.enemyMlids,
      ...(body.allyBans ?? []),
      ...(body.enemyBans ?? [])
    ]);
    const actingMlids = body.turnSide === "ally" ? body.allyMlids : body.enemyMlids;
    const opposingMlids = body.turnSide === "ally" ? body.enemyMlids : body.allyMlids;
    const actingDraftSide = body.turnSide === "ally" ? body.draftSide : oppositeDraftSide(body.draftSide);
    const opposingDraftSide = oppositeDraftSide(actingDraftSide);
    const actingCoverage = teamCoverage(dataset, actingMlids);
    const pickNumber = actingMlids.length + 1;
    const pickPhase = currentPickPhase(pickNumber);
    const weights = phaseWeightsForPick(pickNumber);

    const scoredRows = Array.from(dataset.heroes.values())
      .filter((aggregate) => !banned.has(aggregate.hero.mlid))
      .map((aggregate) => {
        const rolePool = aggregate.rolePool;
        const lanes = rolePool.map((row) => row.lane);
        const enemyCounterWeights = capabilities.counter
          ? opposingMlids.map((enemyMlid) =>
              clamp01(enemyCounterPriority(dataset, enemyMlid) * 0.42 + enemyThreatWeight(dataset, enemyMlid, opposingMlids) * 0.58)
            )
          : opposingMlids.map(() => 0.7);
        const blindSafety = blindPickSafety(aggregate);
        const availability = draftAvailability(aggregate, pickPhase);
        const sideValue = sideFit(aggregate, actingDraftSide);
        const compositionFit = capabilities.patterns ? compositionPatternFit(dataset, [...actingMlids, aggregate.hero.mlid]) : NEUTRAL_SIGNAL;
        const trioFit = capabilities.patterns ? trioPatternFit(dataset, [...actingMlids, aggregate.hero.mlid]) : NEUTRAL_SIGNAL;
        const metaPower = clamp01(
          aggregate.score * 0.45 +
          clamp01(aggregate.pickRate / 100) * 0.25 +
          clamp01(aggregate.winRate / 100) * 0.2 +
          aggregate.flexValue * 0.1
        );

        const counterSignals = capabilities.counter
          ? opposingMlids.map((enemyMlid) => getCounterPair(dataset, aggregate.hero.mlid, enemyMlid)).filter(Boolean)
          : [];
        const synergySignals = capabilities.counter
          ? actingMlids.map((allyMlid) => getSynergyPair(dataset, aggregate.hero.mlid, allyMlid)).filter(Boolean)
          : [];
        const counterConfidence = counterSignals.length > 0
          ? average(counterSignals.map((entry) => sampleConfidence(entry.matches)))
          : 0;
        const sameLaneCounterBoost = counterSignals.length > 0
          ? average(counterSignals.map((entry) => {
              if (!entry || entry.sameLaneMatches <= 0) return 0;
              return clamp01(entry.sameLaneMatches / Math.max(1, entry.matches));
            }))
          : 0;
        const synergyConfidence = synergySignals.length > 0
          ? average(synergySignals.map((entry) => sampleConfidence(entry.matches)))
          : 0;
        const counterImpact = capabilities.counter && opposingMlids.length > 0
          ? clamp01(
              NEUTRAL_SIGNAL * (1 - counterConfidence) +
              clamp01(
                average(opposingMlids.map((enemyMlid, index) => {
                  const weight = enemyCounterWeights[index] ?? 0.7;
                  const entry = getCounterPair(dataset, aggregate.hero.mlid, enemyMlid);
                  return (entry?.score ?? NEUTRAL_SIGNAL) * weight;
                })) * 0.82 +
                sameLaneCounterBoost * 0.18
              ) * counterConfidence
            )
          : metaPower;
        const synergyValue = capabilities.counter && actingMlids.length > 0
          ? clamp01(
              NEUTRAL_SIGNAL * (1 - synergyConfidence) +
              average(synergySignals.map((entry) => entry?.score ?? NEUTRAL_SIGNAL)) * synergyConfidence
            )
          : NEUTRAL_SIGNAL;

        const coverageHits = actingCoverage.missing.filter((lane) => lanes.includes(lane)).length;
        const coverageGain = actingCoverage.missing.length > 0
          ? coverageHits / actingCoverage.missing.length
          : 0;
        const laneCoverage = coverageHits > 0 ? 1 : lanes.length > 0 ? 0.65 : 0;

        const protectionValue = capabilities.counter && opposingMlids.length > 0
          ? clamp01(average(counterSignals.map((entry) => {
              if (!entry) return 0;
              return entry.protectionBans > 0
                ? clamp01(entry.protectionBans / Math.max(1, dataset.totalMaps * 0.2))
                : 0;
            })) * counterConfidence)
          : 0;

        const denyValue = clamp01(
          aggregate.banRate / 100 * 0.55 +
          protectionValue * 0.45
        );

        const earlyBlindPenalty = pickPhase === "meta"
          ? clamp01((1 - blindSafety) * 0.18 + Math.max(0, counterImpact - metaPower) * 0.08)
          : 0;
        const lateReactiveBonus = pickPhase === "counter"
          ? clamp01(counterImpact * 0.08 + synergyValue * 0.04 + coverageGain * 0.04)
          : 0;

        const pickScore = clamp01(
          metaPower * weights.meta +
          counterImpact * weights.counter +
          synergyValue * weights.synergy +
          coverageGain * weights.coverage +
          aggregate.flexValue * weights.flex +
          compositionFit * 0.08 +
          trioFit * 0.08 +
          availability * 0.08 +
          sideValue * 0.06 +
          lateReactiveBonus -
          earlyBlindPenalty
        );

        const counterPickScore = clamp01(
          counterImpact * 0.46 +
          protectionValue * 0.18 +
          synergyValue * 0.16 +
          tierNumeric(aggregate.tier) * 0.14 +
          coverageGain * 0.06 +
          availability * 0.1 +
          sideValue * 0.08 +
          lateReactiveBonus * 0.6 -
          earlyBlindPenalty * 0.3
        );

        const banThreat = capabilities.counter && opposingMlids.length > 0
          ? average(
              opposingMlids.map((allyMlid) => getCounterPair(dataset, aggregate.hero.mlid, allyMlid)?.score ?? NEUTRAL_SIGNAL)
            )
          : metaPower;
        const enemySynergyThreat = capabilities.counter && opposingMlids.length > 0
          ? average(
              opposingMlids.map((enemyMlid) => getSynergyPair(dataset, aggregate.hero.mlid, enemyMlid)?.score ?? NEUTRAL_SIGNAL)
            )
          : NEUTRAL_SIGNAL;
        const enemyFutureCompFit = body.turnType === "ban" && capabilities.patterns
          ? compositionPatternFit(dataset, [...opposingMlids, aggregate.hero.mlid])
          : NEUTRAL_SIGNAL;
        const enemyFutureTrioFit = body.turnType === "ban" && capabilities.patterns
          ? trioPatternFit(dataset, [...opposingMlids, aggregate.hero.mlid])
          : NEUTRAL_SIGNAL;
        const enemySideValue = body.turnType === "ban"
          ? sideFit(aggregate, opposingDraftSide)
          : NEUTRAL_SIGNAL;
        const earlyBanBonus = body.turnType === "ban" && pickPhase === "meta"
          ? clamp01(metaPower * 0.08 + clamp01(aggregate.banRate / 100) * 0.06 + enemySideValue * 0.04)
          : 0;
        const lateBanBonus = body.turnType === "ban" && pickPhase !== "meta"
          ? clamp01(
              banThreat * 0.1 +
              enemySynergyThreat * 0.08 +
              enemyFutureCompFit * 0.06 +
              enemyFutureTrioFit * 0.06 +
              enemySideValue * 0.06
            )
          : 0;
        const banScore = clamp01(
          tierNumeric(aggregate.tier) * 0.36 +
          clamp01(aggregate.banRate / 100) * 0.24 +
          banThreat * 0.22 +
          enemySynergyThreat * 0.18 +
          earlyBanBonus +
          lateBanBonus
        );

        return {
          aggregate,
          pickScore,
          metaPower,
          counterImpact,
          counterConfidence,
          sameLaneCounterBoost,
          synergyValue,
          synergyConfidence,
          blindSafety,
          availability,
          sideValue,
          compositionFit,
          trioFit,
          coverageGain,
          flexValue: aggregate.flexValue,
          laneCoverage,
          protectionValue,
          denyValue,
          earlyBlindPenalty,
          lateReactiveBonus,
          enemyFutureCompFit,
          enemyFutureTrioFit,
          enemySideValue,
          earlyBanBonus,
          lateBanBonus,
          banScore,
          counterPickScore,
          topCounter: counterSignals
            .slice()
            .sort((left, right) => (right?.score ?? 0) - (left?.score ?? 0))[0] ?? null
        };
      });

    const sortedPicks = scoredRows
      .slice()
      .sort((left, right) => right.pickScore - left.pickScore)
      .map((row) => createRecommendation(
        dataset,
        row.aggregate,
        row.pickScore * 100,
        pickPhase,
        row,
        [
          `${engineId} ${pickPhase} phase: meta ${(row.metaPower * 100).toFixed(0)}%, counter ${(row.counterImpact * 100).toFixed(0)}% (${(row.counterConfidence * 100).toFixed(0)}% confidence, same-lane ${(row.sameLaneCounterBoost * 100).toFixed(0)}%, enemy-core weighted), synergy ${(row.synergyValue * 100).toFixed(0)}% (${(row.synergyConfidence * 100).toFixed(0)}% confidence).`,
          row.topCounter
            ? `Observed vs ${getHeroAggregate(dataset, row.topCounter.enemyMlid)?.hero.name ?? row.topCounter.enemyMlid}: ${(row.topCounter.score * 100).toFixed(0)}% signal from ${row.topCounter.matches} map(s), with enemy-threat weighting from current ${engineId} composition, comp-fit ${(row.compositionFit * 100).toFixed(0)}%, trio-fit ${(row.trioFit * 100).toFixed(0)}%, side-fit ${(row.sideValue * 100).toFixed(0)}%, blind safety ${(row.blindSafety * 100).toFixed(0)}%, availability ${(row.availability * 100).toFixed(0)}%.`
            : `Lane coverage gain ${(row.coverageGain * 100).toFixed(0)}% with flex ${(row.aggregate.flexValue * 100).toFixed(0)}%, comp-fit ${(row.compositionFit * 100).toFixed(0)}%, trio-fit ${(row.trioFit * 100).toFixed(0)}%, side-fit ${(row.sideValue * 100).toFixed(0)}%, blind safety ${(row.blindSafety * 100).toFixed(0)}%, availability ${(row.availability * 100).toFixed(0)}%.`
        ]
      ));

    const sortedMeta = scoredRows
      .slice()
      .sort((left, right) => right.metaPower - left.metaPower)
      .map((row) => createRecommendation(
        dataset,
        row.aggregate,
        row.metaPower * 100,
        pickPhase,
        row,
        [
          `${engineId} meta score from pick ${(row.aggregate.pickRate).toFixed(1)}%, ban ${(row.aggregate.banRate).toFixed(1)}%, win ${(row.aggregate.winRate).toFixed(1)}%.`,
          `Flex lane value ${(row.aggregate.flexValue * 100).toFixed(0)}% across ${Math.max(1, row.aggregate.rolePool.length)} mapped lane(s), with comp-fit ${(row.compositionFit * 100).toFixed(0)}%, trio-fit ${(row.trioFit * 100).toFixed(0)}%, side-fit ${(row.sideValue * 100).toFixed(0)}%, blind safety ${(row.blindSafety * 100).toFixed(0)}%, availability ${(row.availability * 100).toFixed(0)}%, and counter confidence ${(row.counterConfidence * 100).toFixed(0)}%.`
        ]
      ));

    const sortedCounter = scoredRows
      .slice()
      .sort((left, right) => right.counterPickScore - left.counterPickScore)
      .map((row) => createRecommendation(
        dataset,
        row.aggregate,
        row.counterPickScore * 100,
        pickPhase,
        row,
        [
          `${engineId} counter signal ${(row.counterImpact * 100).toFixed(0)}% with ${(row.counterConfidence * 100).toFixed(0)}% sample confidence, same-lane ${(row.sameLaneCounterBoost * 100).toFixed(0)}%, enemy-threat weighted by current ${engineId} composition, protection-ban ${(row.protectionValue * 100).toFixed(0)}%, reactive bonus ${(row.lateReactiveBonus * 100).toFixed(0)}%, availability ${(row.availability * 100).toFixed(0)}%.`,
          row.topCounter
            ? `Same-patch record vs ${getHeroAggregate(dataset, row.topCounter.enemyMlid)?.hero.name ?? row.topCounter.enemyMlid}: ${row.topCounter.wins}/${row.topCounter.matches} win(s), early blind penalty ${(row.earlyBlindPenalty * 100).toFixed(0)}%.`
            : `No direct enemy pair yet, leaning on tier ${(tierNumeric(row.aggregate.tier) * 100).toFixed(0)}%, synergy ${(row.synergyValue * 100).toFixed(0)}%, and blind safety ${(row.blindSafety * 100).toFixed(0)}%.`
        ]
      ));

    const sortedBans = scoredRows
      .slice()
      .sort((left, right) => right.banScore - left.banScore)
      .map((row) => createRecommendation(
        dataset,
        row.aggregate,
        row.banScore * 100,
        pickPhase,
        row,
        [
          `${engineId} ban pressure from tier ${(tierNumeric(row.aggregate.tier) * 100).toFixed(0)}%, ban ${(row.aggregate.banRate).toFixed(1)}%, threat ${(row.counterImpact * 100).toFixed(0)}%, enemy-side fit ${(row.enemySideValue * 100).toFixed(0)}%, early-ban ${(row.earlyBanBonus * 100).toFixed(0)}%, late-ban ${(row.lateBanBonus * 100).toFixed(0)}%.`,
          `Enemy-fit synergy ${(row.synergyValue * 100).toFixed(0)}%, future comp-fit ${(row.enemyFutureCompFit * 100).toFixed(0)}%, future trio-fit ${(row.enemyFutureTrioFit * 100).toFixed(0)}%, and protected-ban ${(row.protectionValue * 100).toFixed(0)}%.`
        ]
      ));

    const laneAwareMeta = prioritizeRoleBalance(
      dataset,
      prioritizeMissingLaneCoverage(dataset, sortedMeta.filter((row) =>
        passesSupplementalLaneRule(dataset, row.mlid, actingMlids, actingCoverage.missing)
      ), actingCoverage.missing),
      actingMlids
    );
    const laneAwareCounter = capabilities.counter
      ? prioritizeRoleBalance(
          dataset,
          prioritizeMissingLaneCoverage(dataset, sortedCounter.filter((row) =>
            passesSupplementalLaneRule(dataset, row.mlid, actingMlids, actingCoverage.missing)
          ), actingCoverage.missing),
          actingMlids
        )
      : [];
    const recommendedPicks = selectLaneDiverse(dataset, sortedPicks, PICK_REC_COUNT, 3);
    const recommendedMetaPicks = selectLaneDiverse(dataset, laneAwareMeta, PICK_REC_COUNT, 2);
    const recommendedMetaSet = new Set(recommendedMetaPicks.map((row) => row.mlid));
    const counterCandidates = laneAwareCounter.filter((row) => !recommendedMetaSet.has(row.mlid));
    const recommendedCounterPicks = capabilities.counter ? selectLaneDiverse(dataset, counterCandidates, PICK_REC_COUNT, 2) : [];
    if (capabilities.counter && recommendedCounterPicks.length < PICK_REC_COUNT) {
      const usedCounterSet = new Set(recommendedCounterPicks.map((row) => row.mlid));
      const counterBackfill = sortedPicks.filter((row) =>
        !recommendedMetaSet.has(row.mlid) &&
        !usedCounterSet.has(row.mlid) &&
        passesSupplementalLaneRule(dataset, row.mlid, actingMlids, actingCoverage.missing)
      );
      for (const row of counterBackfill) {
        recommendedCounterPicks.push(row);
        usedCounterSet.add(row.mlid);
        if (recommendedCounterPicks.length >= PICK_REC_COUNT) break;
      }
    }
    const recommendedBans = selectLaneDiverse(dataset, sortedBans, BAN_REC_COUNT, 2);

    const allyTierPower = body.allyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
    const enemyTierPower = body.enemyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
    const allyCounterEdge = capabilities.matchup && body.allyMlids.length > 0 && body.enemyMlids.length > 0
      ? average(body.allyMlids.flatMap((allyMlid) => body.enemyMlids.map((enemyMlid) => getCounterPair(dataset, allyMlid, enemyMlid)?.score ?? NEUTRAL_SIGNAL)))
      : NEUTRAL_SIGNAL;
    const enemyCounterEdge = capabilities.matchup && body.allyMlids.length > 0 && body.enemyMlids.length > 0
      ? average(body.enemyMlids.flatMap((enemyMlid) => body.allyMlids.map((allyMlid) => getCounterPair(dataset, enemyMlid, allyMlid)?.score ?? NEUTRAL_SIGNAL)))
      : NEUTRAL_SIGNAL;
    const allyScore = allyTierPower * 14 + allyCounterEdge * 35;
    const enemyScore = enemyTierPower * 14 + enemyCounterEdge * 35;
    const diff = allyScore - enemyScore;
    const allyWinProb = 100 / (1 + Math.exp(-(diff / MATCHUP_LOGISTIC_DIVISOR)));
    const limitedDraftProbability = {
      allyWinProb: 50,
      enemyWinProb: 50,
      confidence: Number(clamp01((body.allyMlids.length + body.enemyMlids.length) / 20).toFixed(4))
    };

    return {
      recommendedPicks,
      recommendedBans,
      recommendedMetaPicks,
      recommendedCounterPicks,
      notes: [
        ...(degradedReason ? [degradedReason] : []),
        `Engine: ${engineId} from upstream wiki (${dataset.totalMaps} maps).`,
        `Turn context: ${body.turnSide} ${body.turnType} — ${pickPhase.toUpperCase()} phase.`,
        body.draftSide ? `Side context: ally ${body.draftSide.toUpperCase()} / enemy ${oppositeDraftSide(body.draftSide)?.toUpperCase()}.` : `Side context: not locked.`,
        `Tier formula uses ${engineId} pick rate, ban rate, win rate, and flex lane value only.`,
        capabilities.counter
          ? `Counter signal uses observed head-to-head, same-lane overlap, and protected bans from ${engineId} drafts.`
          : `Counter and matchup signals will unlock automatically after at least ${MIN_MAPS_FOR_ADVANCED_SIGNALS} tournament maps are available.`
      ],
      archetype: null,
      draftProbability:
        body.allyMlids.length > 0 && body.enemyMlids.length > 0
          ? (capabilities.matchup
              ? {
                  allyWinProb: Number(allyWinProb.toFixed(1)),
                  enemyWinProb: Number((100 - allyWinProb).toFixed(1)),
                  confidence: Number(clamp01((body.allyMlids.length + body.enemyMlids.length) / 10).toFixed(4))
                }
              : limitedDraftProbability)
          : null,
      dataset: {
        engine: engineId,
        totalMaps: dataset.totalMaps,
        generatedAt: dataset.generatedAt,
        unmatchedHeroes: dataset.unmatchedHeroTokens,
        readiness,
        capabilities,
        degradedReason
      }
    };
  }

  async function matchupDraft(body: Pick<DraftAnalyzeBody, "allyMlids" | "enemyMlids">): Promise<MatchupResponse> {
    const dataset = await getDataset();
    const capabilities = buildEngineCapabilities(dataset.totalMaps);
    const readiness = buildEngineReadiness(dataset.totalMaps);
    const degradedReason = buildDegradedReason(dataset.totalMaps);
    const allyCoverage = teamCoverage(dataset, body.allyMlids);
    const enemyCoverage = teamCoverage(dataset, body.enemyMlids);

    const allyTierPower = body.allyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
    const enemyTierPower = body.enemyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
    const allyCounterEdge = capabilities.matchup && body.allyMlids.length > 0 && body.enemyMlids.length > 0
      ? average(body.allyMlids.flatMap((allyMlid) => body.enemyMlids.map((enemyMlid) => getCounterPair(dataset, allyMlid, enemyMlid)?.score ?? NEUTRAL_SIGNAL)))
      : NEUTRAL_SIGNAL;
    const enemyCounterEdge = capabilities.matchup && body.allyMlids.length > 0 && body.enemyMlids.length > 0
      ? average(body.enemyMlids.flatMap((enemyMlid) => body.allyMlids.map((allyMlid) => getCounterPair(dataset, enemyMlid, allyMlid)?.score ?? NEUTRAL_SIGNAL)))
      : NEUTRAL_SIGNAL;
    const allySynergy = capabilities.matchup && body.allyMlids.length > 1
      ? average(
          body.allyMlids.flatMap((hero, index) =>
            body.allyMlids.slice(index + 1).map((other) => getSynergyPair(dataset, hero, other)?.score ?? NEUTRAL_SIGNAL)
          )
        )
      : NEUTRAL_SIGNAL;
    const enemySynergy = capabilities.matchup && body.enemyMlids.length > 1
      ? average(
          body.enemyMlids.flatMap((hero, index) =>
            body.enemyMlids.slice(index + 1).map((other) => getSynergyPair(dataset, hero, other)?.score ?? NEUTRAL_SIGNAL)
          )
        )
      : NEUTRAL_SIGNAL;

    const allyScore = allyTierPower * 14 + allyCounterEdge * 32 + allySynergy * 20 + allyCoverage.covered.length * 2;
    const enemyScore = enemyTierPower * 14 + enemyCounterEdge * 32 + enemySynergy * 20 + enemyCoverage.covered.length * 2;
    const diff = allyScore - enemyScore;
    const allyWinProb = 100 / (1 + Math.exp(-(diff / MATCHUP_LOGISTIC_DIVISOR)));

    const verdict = !capabilities.matchup
      ? "Limited tournament sample"
      : Math.abs(diff) < 2
      ? "Balanced draft"
      : diff > 0
        ? "Ally draft advantage"
        : "Enemy draft advantage";

    const keyFactors: string[] = [];
    if (degradedReason) keyFactors.push(degradedReason);
    if (capabilities.matchup && allyCounterEdge > enemyCounterEdge + 0.05) keyFactors.push(`Ally has stronger observed ${engineId} counter edges.`);
    if (capabilities.matchup && enemyCounterEdge > allyCounterEdge + 0.05) keyFactors.push(`Enemy has stronger observed ${engineId} counter edges.`);
    if (allyTierPower > enemyTierPower + 0.4) keyFactors.push(`Ally has higher ${engineId} tier-weighted core.`);
    if (enemyTierPower > allyTierPower + 0.4) keyFactors.push(`Enemy has higher ${engineId} tier-weighted core.`);
    if (capabilities.matchup && allySynergy > enemySynergy + 0.05) keyFactors.push(`Ally pair synergy is stronger in the ${engineId} sample.`);
    if (capabilities.matchup && enemySynergy > allySynergy + 0.05) keyFactors.push(`Enemy pair synergy is stronger in the ${engineId} sample.`);
    if (keyFactors.length === 0) keyFactors.push(`Both drafts are close on ${engineId} sample data.`);

    return {
      verdict,
      allyScore: Number(allyScore.toFixed(2)),
      enemyScore: Number(enemyScore.toFixed(2)),
      allyWinProb: Number((capabilities.matchup ? allyWinProb : 50).toFixed(1)),
      enemyWinProb: Number((capabilities.matchup ? (100 - allyWinProb) : 50).toFixed(1)),
      confidence: Number((capabilities.matchup ? clamp01((body.allyMlids.length + body.enemyMlids.length) / 10) : clamp01((body.allyMlids.length + body.enemyMlids.length) / 20)).toFixed(4)),
      components: {
        allyTierPower: Number(allyTierPower.toFixed(4)),
        enemyTierPower: Number(enemyTierPower.toFixed(4)),
        allyCounterEdge: Number(allyCounterEdge.toFixed(4)),
        enemyCounterEdge: Number(enemyCounterEdge.toFixed(4)),
        allySynergy: Number(allySynergy.toFixed(4)),
        enemySynergy: Number(enemySynergy.toFixed(4))
      },
      details: {
        ally: {
          coveredLanes: allyCoverage.covered,
          missingLanes: allyCoverage.missing,
          topCounterPairs: topCounterPairs(dataset, body.allyMlids, body.enemyMlids),
          tierCounts: buildTierCounts(dataset, body.allyMlids)
        },
        enemy: {
          coveredLanes: enemyCoverage.covered,
          missingLanes: enemyCoverage.missing,
          topCounterPairs: topCounterPairs(dataset, body.enemyMlids, body.allyMlids),
          tierCounts: buildTierCounts(dataset, body.enemyMlids)
        },
        keyFactors
      },
      dataset: {
        engine: engineId,
        totalMaps: dataset.totalMaps,
        readiness,
        capabilities,
        degradedReason
      }
    };
  }

  return {
    getStatus,
    getHeroList,
    getHeroCounters,
    getHeroProfile,
    analyzeDraft,
    matchupDraft
  };
}

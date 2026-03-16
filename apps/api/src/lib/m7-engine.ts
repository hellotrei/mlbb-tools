import { asc, desc } from "drizzle-orm";
import { db, heroRolePool, heroes } from "@mlbb/db";
import type { DraftAnalyzeBody, DraftLane, Tier } from "@mlbb/shared";

const M7_PAGES = [
  "M7_World_Championship/Swiss_Stage",
  "M7_World_Championship/Knockout_Stage"
] as const;

const LIQUIPEDIA_API_URL = "https://liquipedia.net/mobilelegends/api.php";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PICK_REC_COUNT = 8;
const BAN_REC_COUNT = 8;
const MATCHUP_LOGISTIC_DIVISOR = 16;
const NEUTRAL_SIGNAL = 0.5;
const DRAFT_LANES: DraftLane[] = ["exp", "jungle", "mid", "gold", "roam"];

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

type HeroAggregate = {
  hero: HeroRow;
  picks: number;
  bans: number;
  wins: number;
  bluePicks: number;
  redPicks: number;
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

type M7Dataset = {
  generatedAt: string;
  maps: DraftMapRecord[];
  totalMaps: number;
  heroes: Map<number, HeroAggregate>;
  rolePool: Map<number, RolePoolEntry[]>;
  counterPairs: Map<string, CounterPairAggregate>;
  synergyPairs: Map<string, SynergyPairAggregate>;
  unmatchedHeroTokens: string[];
};

type M7RecommendationRow = {
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

type M7AnalyzeResponse = {
  recommendedPicks: M7RecommendationRow[];
  recommendedBans: M7RecommendationRow[];
  recommendedMetaPicks: M7RecommendationRow[];
  recommendedCounterPicks: M7RecommendationRow[];
  notes: string[];
  archetype: null;
  draftProbability: {
    allyWinProb: number;
    enemyWinProb: number;
    confidence: number;
  } | null;
  dataset: {
    engine: "m7";
    totalMaps: number;
    generatedAt: string;
    unmatchedHeroes: string[];
  };
};

type M7MatchupResponse = {
  verdict: string;
  allyScore: number;
  enemyScore: number;
  allyWinProb: number;
  enemyWinProb: number;
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
};

type M7HeroProfile = {
  hero: {
    mlid: number;
    name: string;
    rolePrimary: string;
    lanes: string[];
    specialities: string[];
  };
  statistic: {
    timeframe: "m7";
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
    timeframe: "m7";
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
    source: "m7_pair";
  }>;
};

let datasetCache: { expiresAt: number; data: M7Dataset } | null = null;
let datasetPending: Promise<M7Dataset> | null = null;

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

async function fetchM7Wikitext(page: string) {
  const url = new URL(LIQUIPEDIA_API_URL);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", page);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "user-agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Liquipedia request failed for ${page}: ${response.status}`);
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

async function buildDataset() {
  const [{ heroesBySlug, heroesByMlid, rolePoolByMlid }, ...wikitexts] = await Promise.all([
    loadHeroRows(),
    ...M7_PAGES.map((page) => fetchM7Wikitext(page))
  ]);

  const unmatched = new Set<string>();
  const maps: DraftMapRecord[] = [];

  wikitexts.forEach((wikitext, index) => {
    const page = M7_PAGES[index]!;
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
      if (side === "blue") hero.bluePicks += 1;
      else hero.redPicks += 1;
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
    unmatchedHeroTokens: Array.from(unmatched).sort((a, b) => a.localeCompare(b))
  } satisfies M7Dataset;
}

async function getDataset() {
  if (datasetCache && datasetCache.expiresAt > Date.now()) {
    return datasetCache.data;
  }
  if (datasetPending) {
    return datasetPending;
  }
  datasetPending = buildDataset()
    .then((data) => {
      datasetCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        data
      };
      return data;
    })
    .finally(() => {
      datasetPending = null;
    });
  return datasetPending;
}

function getRolePool(dataset: M7Dataset, mlid: number) {
  return dataset.rolePool.get(mlid) ?? [];
}

function getHeroAggregate(dataset: M7Dataset, mlid: number) {
  return dataset.heroes.get(mlid) ?? null;
}

function getCounterPair(dataset: M7Dataset, candidateMlid: number, enemyMlid: number) {
  return dataset.counterPairs.get(pairKey(candidateMlid, enemyMlid)) ?? null;
}

function getSynergyPair(dataset: M7Dataset, heroA: number, heroB: number) {
  return dataset.synergyPairs.get(synergyKey(heroA, heroB)) ?? null;
}

function tierNumeric(tier: Tier | undefined) {
  if (tier === "SS") return 1;
  if (tier === "S") return 0.85;
  if (tier === "A") return 0.7;
  if (tier === "B") return 0.55;
  if (tier === "C") return 0.4;
  return 0.25;
}

function teamCoverage(dataset: M7Dataset, mlids: number[]) {
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

function currentPickPhase(pickNumber: number): "meta" | "flex" | "counter" {
  if (pickNumber <= 2) return "meta";
  if (pickNumber === 3) return "flex";
  return "counter";
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

function selectLaneDiverse(
  dataset: M7Dataset,
  rows: M7RecommendationRow[],
  count: number,
  maxPerLane: number
) {
  const out: M7RecommendationRow[] = [];
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
  dataset: M7Dataset,
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
): M7RecommendationRow {
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

export async function getM7HeroProfile(mlid: number): Promise<M7HeroProfile | null> {
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
        source: "m7_pair" as const
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
      timeframe: "m7",
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
      timeframe: "m7",
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

export async function analyzeM7Draft(body: DraftAnalyzeBody): Promise<M7AnalyzeResponse> {
  const dataset = await getDataset();
  const banned = new Set([
    ...body.allyMlids,
    ...body.enemyMlids,
    ...(body.allyBans ?? []),
    ...(body.enemyBans ?? [])
  ]);
  const actingMlids = body.turnSide === "ally" ? body.allyMlids : body.enemyMlids;
  const opposingMlids = body.turnSide === "ally" ? body.enemyMlids : body.allyMlids;
  const actingCoverage = teamCoverage(dataset, actingMlids);
  const pickNumber = actingMlids.length + 1;
  const pickPhase = currentPickPhase(pickNumber);
  const weights = phaseWeightsForPick(pickNumber);

  const scoredRows = Array.from(dataset.heroes.values())
    .filter((aggregate) => !banned.has(aggregate.hero.mlid))
    .map((aggregate) => {
      const rolePool = aggregate.rolePool;
      const lanes = rolePool.map((row) => row.lane);
      const metaPower = clamp01(
        aggregate.score * 0.45 +
        clamp01(aggregate.pickRate / 100) * 0.25 +
        clamp01(aggregate.winRate / 100) * 0.2 +
        aggregate.flexValue * 0.1
      );

      const counterSignals = opposingMlids.map((enemyMlid) => getCounterPair(dataset, aggregate.hero.mlid, enemyMlid)).filter(Boolean);
      const synergySignals = actingMlids.map((allyMlid) => getSynergyPair(dataset, aggregate.hero.mlid, allyMlid)).filter(Boolean);
      const counterImpact = opposingMlids.length > 0
        ? average(counterSignals.map((entry) => entry?.score ?? NEUTRAL_SIGNAL))
        : metaPower;
      const synergyValue = actingMlids.length > 0
        ? average(synergySignals.map((entry) => entry?.score ?? NEUTRAL_SIGNAL))
        : NEUTRAL_SIGNAL;

      const coverageHits = actingCoverage.missing.filter((lane) => lanes.includes(lane)).length;
      const coverageGain = actingCoverage.missing.length > 0
        ? coverageHits / actingCoverage.missing.length
        : 0;
      const laneCoverage = coverageHits > 0 ? 1 : lanes.length > 0 ? 0.65 : 0;

      const protectionValue = opposingMlids.length > 0
        ? average(counterSignals.map((entry) => {
            if (!entry) return 0;
            return entry.protectionBans > 0
              ? clamp01(entry.protectionBans / Math.max(1, dataset.totalMaps * 0.2))
              : 0;
          }))
        : 0;

      const denyValue = clamp01(
        aggregate.banRate / 100 * 0.55 +
        protectionValue * 0.45
      );

      const pickScore = clamp01(
        metaPower * weights.meta +
        counterImpact * weights.counter +
        synergyValue * weights.synergy +
        coverageGain * weights.coverage +
        aggregate.flexValue * weights.flex
      );

      const counterPickScore = clamp01(
        counterImpact * 0.46 +
        protectionValue * 0.18 +
        synergyValue * 0.16 +
        tierNumeric(aggregate.tier) * 0.14 +
        coverageGain * 0.06
      );

      const banThreat = opposingMlids.length > 0
        ? average(
            opposingMlids.map((allyMlid) => getCounterPair(dataset, aggregate.hero.mlid, allyMlid)?.score ?? NEUTRAL_SIGNAL)
          )
        : metaPower;
      const enemySynergyThreat = opposingMlids.length > 0
        ? average(
            opposingMlids.map((enemyMlid) => getSynergyPair(dataset, aggregate.hero.mlid, enemyMlid)?.score ?? NEUTRAL_SIGNAL)
          )
        : NEUTRAL_SIGNAL;
      const banScore = clamp01(
        tierNumeric(aggregate.tier) * 0.36 +
        clamp01(aggregate.banRate / 100) * 0.24 +
        banThreat * 0.22 +
        enemySynergyThreat * 0.18
      );

      return {
        aggregate,
        pickScore,
        metaPower,
        counterImpact,
        synergyValue,
        coverageGain,
        flexValue: aggregate.flexValue,
        laneCoverage,
        protectionValue,
        denyValue,
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
        `M7 ${pickPhase} phase: meta ${(row.metaPower * 100).toFixed(0)}%, counter ${(row.counterImpact * 100).toFixed(0)}%, synergy ${(row.synergyValue * 100).toFixed(0)}%.`,
        row.topCounter
          ? `Observed vs ${getHeroAggregate(dataset, row.topCounter.enemyMlid)?.hero.name ?? row.topCounter.enemyMlid}: ${(row.topCounter.score * 100).toFixed(0)}% signal from ${row.topCounter.matches} map(s).`
          : `Lane coverage gain ${(row.coverageGain * 100).toFixed(0)}% with flex ${(row.aggregate.flexValue * 100).toFixed(0)}%.`
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
        `M7 meta score from pick ${(row.aggregate.pickRate).toFixed(1)}%, ban ${(row.aggregate.banRate).toFixed(1)}%, win ${(row.aggregate.winRate).toFixed(1)}%.`,
        `Flex lane value ${(row.aggregate.flexValue * 100).toFixed(0)}% across ${Math.max(1, row.aggregate.rolePool.length)} mapped lane(s).`
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
        `M7 counter signal ${(row.counterImpact * 100).toFixed(0)}% with protection-ban ${(row.protectionValue * 100).toFixed(0)}%.`,
        row.topCounter
          ? `Same-patch record vs ${getHeroAggregate(dataset, row.topCounter.enemyMlid)?.hero.name ?? row.topCounter.enemyMlid}: ${row.topCounter.wins}/${row.topCounter.matches} win(s).`
          : `No direct enemy pair yet, leaning on tier ${(tierNumeric(row.aggregate.tier) * 100).toFixed(0)}% and synergy ${(row.synergyValue * 100).toFixed(0)}%.`
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
        `M7 ban pressure from tier ${(tierNumeric(row.aggregate.tier) * 100).toFixed(0)}%, ban ${(row.aggregate.banRate).toFixed(1)}%, threat ${(row.counterImpact * 100).toFixed(0)}%.`,
        `Enemy-fit synergy ${(row.synergyValue * 100).toFixed(0)}% and protected-ban ${(row.protectionValue * 100).toFixed(0)}%.`
      ]
    ));

  const recommendedPicks = selectLaneDiverse(dataset, sortedPicks, PICK_REC_COUNT, 3);
  const recommendedMetaPicks = selectLaneDiverse(dataset, sortedMeta, PICK_REC_COUNT, 2);
  const recommendedCounterPicks = selectLaneDiverse(dataset, sortedCounter, PICK_REC_COUNT, 2);
  const recommendedBans = selectLaneDiverse(dataset, sortedBans, BAN_REC_COUNT, 2);

  const allyTierPower = body.allyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
  const enemyTierPower = body.enemyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
  const allyCounterEdge = body.allyMlids.length > 0 && body.enemyMlids.length > 0
    ? average(body.allyMlids.flatMap((allyMlid) => body.enemyMlids.map((enemyMlid) => getCounterPair(dataset, allyMlid, enemyMlid)?.score ?? NEUTRAL_SIGNAL)))
    : NEUTRAL_SIGNAL;
  const enemyCounterEdge = body.allyMlids.length > 0 && body.enemyMlids.length > 0
    ? average(body.enemyMlids.flatMap((enemyMlid) => body.allyMlids.map((allyMlid) => getCounterPair(dataset, enemyMlid, allyMlid)?.score ?? NEUTRAL_SIGNAL)))
    : NEUTRAL_SIGNAL;
  const allyScore = allyTierPower * 14 + allyCounterEdge * 35;
  const enemyScore = enemyTierPower * 14 + enemyCounterEdge * 35;
  const diff = allyScore - enemyScore;
  const allyWinProb = 100 / (1 + Math.exp(-(diff / MATCHUP_LOGISTIC_DIVISOR)));

  return {
    recommendedPicks,
    recommendedBans,
    recommendedMetaPicks,
    recommendedCounterPicks,
    notes: [
      `Engine: M7 dataset from Liquipedia (${dataset.totalMaps} maps).`,
      `Turn context: ${body.turnSide} ${body.turnType} — ${pickPhase.toUpperCase()} phase.`,
      `Tier formula uses M7 pick rate, ban rate, win rate, and flex lane value only.`,
      `Counter signal uses observed head-to-head, same-lane overlap, and protected bans from M7 drafts.`
    ],
    archetype: null,
    draftProbability:
      body.allyMlids.length > 0 && body.enemyMlids.length > 0
        ? {
            allyWinProb: Number(allyWinProb.toFixed(1)),
            enemyWinProb: Number((100 - allyWinProb).toFixed(1)),
            confidence: Number(clamp01((body.allyMlids.length + body.enemyMlids.length) / 10).toFixed(4))
          }
        : null,
    dataset: {
      engine: "m7",
      totalMaps: dataset.totalMaps,
      generatedAt: dataset.generatedAt,
      unmatchedHeroes: dataset.unmatchedHeroTokens
    }
  };
}

function buildTierCounts(dataset: M7Dataset, mlids: number[]) {
  const counts: Record<string, number> = { SS: 0, S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const mlid of mlids) {
    const tier = getHeroAggregate(dataset, mlid)?.tier ?? "D";
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

function topCounterPairs(dataset: M7Dataset, teamMlids: number[], enemyMlids: number[]) {
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

export async function matchupM7Draft(body: Pick<DraftAnalyzeBody, "allyMlids" | "enemyMlids">): Promise<M7MatchupResponse> {
  const dataset = await getDataset();
  const allyCoverage = teamCoverage(dataset, body.allyMlids);
  const enemyCoverage = teamCoverage(dataset, body.enemyMlids);

  const allyTierPower = body.allyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
  const enemyTierPower = body.enemyMlids.reduce((sum, mlid) => sum + tierNumeric(getHeroAggregate(dataset, mlid)?.tier), 0);
  const allyCounterEdge = body.allyMlids.length > 0 && body.enemyMlids.length > 0
    ? average(body.allyMlids.flatMap((allyMlid) => body.enemyMlids.map((enemyMlid) => getCounterPair(dataset, allyMlid, enemyMlid)?.score ?? NEUTRAL_SIGNAL)))
    : NEUTRAL_SIGNAL;
  const enemyCounterEdge = body.allyMlids.length > 0 && body.enemyMlids.length > 0
    ? average(body.enemyMlids.flatMap((enemyMlid) => body.allyMlids.map((allyMlid) => getCounterPair(dataset, enemyMlid, allyMlid)?.score ?? NEUTRAL_SIGNAL)))
    : NEUTRAL_SIGNAL;
  const allySynergy = body.allyMlids.length > 1
    ? average(
        body.allyMlids.flatMap((hero, index) =>
          body.allyMlids.slice(index + 1).map((other) => getSynergyPair(dataset, hero, other)?.score ?? NEUTRAL_SIGNAL)
        )
      )
    : NEUTRAL_SIGNAL;
  const enemySynergy = body.enemyMlids.length > 1
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

  const verdict = Math.abs(diff) < 2
    ? "Balanced draft"
    : diff > 0
      ? "Ally draft advantage"
      : "Enemy draft advantage";

  const keyFactors: string[] = [];
  if (allyCounterEdge > enemyCounterEdge + 0.05) keyFactors.push("Ally has stronger observed M7 counter edges.");
  if (enemyCounterEdge > allyCounterEdge + 0.05) keyFactors.push("Enemy has stronger observed M7 counter edges.");
  if (allyTierPower > enemyTierPower + 0.4) keyFactors.push("Ally has higher M7 tier-weighted core.");
  if (enemyTierPower > allyTierPower + 0.4) keyFactors.push("Enemy has higher M7 tier-weighted core.");
  if (allySynergy > enemySynergy + 0.05) keyFactors.push("Ally pair synergy is stronger in the M7 sample.");
  if (enemySynergy > allySynergy + 0.05) keyFactors.push("Enemy pair synergy is stronger in the M7 sample.");
  if (keyFactors.length === 0) keyFactors.push("Both drafts are close on M7 sample data.");

  return {
    verdict,
    allyScore: Number(allyScore.toFixed(2)),
    enemyScore: Number(enemyScore.toFixed(2)),
    allyWinProb: Number(allyWinProb.toFixed(1)),
    enemyWinProb: Number((100 - allyWinProb).toFixed(1)),
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
    }
  };
}

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), "../../.env") });

const VOTE_PRIOR_MIN = 2;
const VOTE_PRIOR_MAX = 8;

const HERO_MAP_TTL_MS = 60 * 60 * 1000;
type NameToUuid = Map<string, string>;

let cachedNameToUuid: NameToUuid | null = null;
let nameToUuidExpiry = 0;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return {
    url: url.replace(/\/+$/, ""),
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "accept-profile": "public"
    }
  };
}

async function getSupabaseNameToUuid(): Promise<NameToUuid> {
  const now = Date.now();
  if (cachedNameToUuid && now < nameToUuidExpiry) return cachedNameToUuid;

  const config = getSupabaseConfig();
  if (!config) return cachedNameToUuid ?? new Map();

  try {
    const resp = await fetch(`${config.url}/rest/v1/heroes?select=id,name`, {
      headers: config.headers,
      signal: AbortSignal.timeout(2_000)
    });
    if (!resp.ok) {
      console.warn("[supabase-counters] heroes fetch failed:", resp.status);
      return cachedNameToUuid ?? new Map();
    }
    const rows = (await resp.json()) as Array<{ id: string; name: string }>;
    const map: NameToUuid = new Map(rows.map((r) => [r.name.toLowerCase().trim(), r.id]));
    cachedNameToUuid = map;
    nameToUuidExpiry = now + HERO_MAP_TTL_MS;
    return map;
  } catch (err) {
    console.warn("[supabase-counters] heroes fetch error:", err);
    return cachedNameToUuid ?? new Map();
  }
}

export interface CommunityScoreResult {
  scoreByMlid: Map<number, number>;
  totalVotes: number;
  matchupConfidence: number;
}

export async function fetchCommunityCounterScores(
  enemyMlids: number[],
  candidateMlids: number[],
  heroNameByMlid: Map<number, string>
): Promise<CommunityScoreResult> {
  const empty: CommunityScoreResult = { scoreByMlid: new Map(), totalVotes: 0, matchupConfidence: 0 };
  const config = getSupabaseConfig();
  if (!config) return empty;

  const nameToUuid = await getSupabaseNameToUuid();
  if (nameToUuid.size === 0) return empty;

  const mlidToUuid = new Map<number, string>();
  const uuidToMlid = new Map<string, number>();
  for (const [mlid, name] of heroNameByMlid) {
    const uuid = nameToUuid.get(name.toLowerCase().trim());
    if (!uuid) continue;
    mlidToUuid.set(mlid, uuid);
    uuidToMlid.set(uuid, mlid);
  }

  const enemyUuids: string[] = [];
  const enemyUuidToMlid = new Map<string, number>();
  for (const mlid of enemyMlids) {
    const uuid = mlidToUuid.get(mlid);
    if (!uuid) continue;
    enemyUuids.push(uuid);
    enemyUuidToMlid.set(uuid, mlid);
  }

  if (enemyUuids.length === 0) return empty;

  const filterParam = enemyUuids.map((id) => `"${id}"`).join(",");

  let votes: Array<{ hero_id: string; counter_hero_id: string }>;
  try {
    const resp = await fetch(
      `${config.url}/rest/v1/counter_pick_votes?hero_id=in.(${filterParam})&select=hero_id,counter_hero_id`,
      { headers: config.headers, signal: AbortSignal.timeout(2_000) }
    );
    if (!resp.ok) return empty;
    votes = (await resp.json()) as Array<{ hero_id: string; counter_hero_id: string }>;
  } catch {
    return empty;
  }

  if (votes.length === 0) return empty;

  const votesByEnemy = new Map<number, Map<number, number>>();
  const totalByEnemy = new Map<number, number>();

  for (const vote of votes) {
    const enemyMlid = enemyUuidToMlid.get(vote.hero_id);
    const counterMlid = uuidToMlid.get(vote.counter_hero_id);
    if (enemyMlid === undefined || counterMlid === undefined) continue;

    const inner = votesByEnemy.get(enemyMlid) ?? new Map<number, number>();
    inner.set(counterMlid, (inner.get(counterMlid) ?? 0) + 1);
    votesByEnemy.set(enemyMlid, inner);

    totalByEnemy.set(enemyMlid, (totalByEnemy.get(enemyMlid) ?? 0) + 1);
  }

  const numCandidates = candidateMlids.length || 1;
  const rawScores = new Map<number, number>();

  let totalMatchupVotes = 0;
  let matchupsWithData = 0;

  for (const candidateMlid of candidateMlids) {
    let sum = 0;
    for (const enemyMlid of enemyMlids) {
      const inner = votesByEnemy.get(enemyMlid);
      const votesFor = inner?.get(candidateMlid) ?? 0;
      const totalVotesForEnemy = totalByEnemy.get(enemyMlid) ?? 0;

      const adaptivePrior = Math.max(
        VOTE_PRIOR_MIN,
        Math.min(VOTE_PRIOR_MAX, Math.sqrt(totalVotesForEnemy))
      );

      const score = (votesFor + adaptivePrior) / (totalVotesForEnemy + adaptivePrior * numCandidates);
      sum += score;

      if (votesFor > 0) {
        totalMatchupVotes += votesFor;
        matchupsWithData++;
      }
    }
    rawScores.set(candidateMlid, sum / enemyMlids.length);
  }

  const sortedScores = Array.from(rawScores.values()).sort((a, b) => a - b);
  const totalCandidatesCount = sortedScores.length;

  function percentileNormalize(value: number): number {
    if (totalCandidatesCount <= 1) return 0.5;
    let rank = 0;
    for (let i = 0; i < sortedScores.length; i++) {
      if (sortedScores[i]! <= value) rank = i;
    }
    const percentile = rank / (totalCandidatesCount - 1);
    const rawMin = sortedScores[0]!;
    const rawMax = sortedScores[totalCandidatesCount - 1]!;
    const rawNorm = rawMax > rawMin ? (value - rawMin) / (rawMax - rawMin) : 0.5;
    return percentile * 0.6 + rawNorm * 0.4;
  }

  const scoreByMlid = new Map<number, number>();
  for (const [mlid, raw] of rawScores) {
    scoreByMlid.set(mlid, Number(percentileNormalize(raw).toFixed(6)));
  }

  const matchupCoverage = enemyMlids.length > 0 ? matchupsWithData / enemyMlids.length : 0;
  const avgVotesPerMatchup = matchupsWithData > 0 ? totalMatchupVotes / matchupsWithData : 0;
  const voteDepthConfidence = Math.min(1, Math.log10(avgVotesPerMatchup + 1) / 1.8);
  const matchupConfidence = Number((matchupCoverage * 0.5 + voteDepthConfidence * 0.5).toFixed(4));

  return { scoreByMlid, totalVotes: votes.length, matchupConfidence };
}

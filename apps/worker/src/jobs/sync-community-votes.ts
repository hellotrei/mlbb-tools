import { db, heroes } from "@mlbb/db";
import { redis } from "../lib/redis.js";

export const COMMUNITY_VOTES_KEY = "community:votes";
const TTL = 3 * 60 * 60;

export interface VotePair {
  heroMlid: number;
  counterMlid: number;
}

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

export async function syncCommunityVotes(): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) {
    console.warn("[sync-community-votes] SUPABASE_URL or SUPABASE_ANON_KEY not set, skipping");
    return;
  }

  const heroesResp = await fetch(`${config.url}/rest/v1/heroes?select=id,name`, {
    headers: config.headers,
    signal: AbortSignal.timeout(10_000)
  });
  if (!heroesResp.ok) {
    console.warn("[sync-community-votes] heroes fetch failed:", heroesResp.status);
    return;
  }
  const supabaseHeroes = (await heroesResp.json()) as Array<{ id: string; name: string }>;
  const nameToUuid = new Map(supabaseHeroes.map((h) => [h.name.toLowerCase().trim(), h.id]));

  const dbHeroes = await db.select({ mlid: heroes.mlid, name: heroes.name }).from(heroes);
  const uuidToMlid = new Map<string, number>();
  for (const hero of dbHeroes) {
    const uuid = nameToUuid.get(hero.name.toLowerCase().trim());
    if (uuid) uuidToMlid.set(uuid, hero.mlid);
  }

  const votesResp = await fetch(
    `${config.url}/rest/v1/counter_pick_votes?select=hero_id,counter_hero_id`,
    { headers: config.headers, signal: AbortSignal.timeout(15_000) }
  );
  if (!votesResp.ok) {
    console.warn("[sync-community-votes] votes fetch failed:", votesResp.status);
    return;
  }
  const rawVotes = (await votesResp.json()) as Array<{ hero_id: string; counter_hero_id: string }>;

  const pairs: VotePair[] = [];
  for (const vote of rawVotes) {
    const heroMlid = uuidToMlid.get(vote.hero_id);
    const counterMlid = uuidToMlid.get(vote.counter_hero_id);
    if (heroMlid !== undefined && counterMlid !== undefined) {
      pairs.push({ heroMlid, counterMlid });
    }
  }

  if (redis.status !== "ready") await redis.connect();
  await redis.setex(COMMUNITY_VOTES_KEY, TTL, JSON.stringify(pairs));
  console.info(`[sync-community-votes] stored ${pairs.length} vote pairs in Redis (TTL ${TTL}s)`);
}

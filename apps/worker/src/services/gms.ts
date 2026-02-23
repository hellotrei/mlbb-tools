import type { HeroStatRow, Timeframe } from "@mlbb/shared";
import { db, heroes } from "@mlbb/db";

function seededRange(seed: number, min: number, max: number) {
  const x = Math.sin(seed) * 10000;
  const ratio = x - Math.floor(x);
  return min + ratio * (max - min);
}

function fallbackStats(mlids: number[], timeframe: Timeframe): HeroStatRow[] {
  const timeframeWeight: Record<Timeframe, number> = {
    "1d": 1,
    "3d": 3,
    "7d": 7,
    "15d": 15,
    "30d": 30
  };

  return mlids.map((mlid) => {
    const base = mlid * timeframeWeight[timeframe];
    const winRate = seededRange(base + 1, 43, 61);
    const pickRate = seededRange(base + 2, 0.5, 18);
    const banRate = seededRange(base + 3, 0.2, 12);
    const appearance = Math.floor(seededRange(base + 4, 120, 4500));
    return {
      mlid,
      timeframe,
      winRate: Number(winRate.toFixed(3)),
      pickRate: Number(pickRate.toFixed(3)),
      banRate: Number(banRate.toFixed(3)),
      appearance
    };
  });
}

export async function fetchGmsStats(timeframe: Timeframe): Promise<HeroStatRow[]> {
  const baseUrl = process.env.GMS_BASE_URL?.trim();
  const apiKey = process.env.GMS_API_KEY?.trim();
  const region = process.env.GMS_REGION?.trim() || "global";

  const heroRows = await db.select({ mlid: heroes.mlid }).from(heroes);
  const mlids = heroRows.map((row) => row.mlid);

  if (!baseUrl || !apiKey) {
    console.warn(`[worker] GMS not configured for timeframe=${timeframe}; using mock dataset`);
    return fallbackStats(mlids, timeframe);
  }

  try {
    const endpoint = new URL("/stats/heroes", baseUrl);
    endpoint.searchParams.set("timeframe", timeframe);
    endpoint.searchParams.set("region", region);

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`GMS response ${response.status}`);
    }

    const payload = (await response.json()) as {
      items?: Array<{
        mlid: number;
        winRate: number;
        pickRate: number;
        banRate: number;
        appearance?: number;
      }>;
    };

    if (!payload.items?.length) {
      return fallbackStats(mlids, timeframe);
    }

    return payload.items.map((item) => ({
      mlid: item.mlid,
      timeframe,
      winRate: Number(item.winRate),
      pickRate: Number(item.pickRate),
      banRate: Number(item.banRate),
      appearance: item.appearance
    }));
  } catch (error) {
    console.warn(`[worker] GMS fetch failed for timeframe=${timeframe}; using mock data`, error);
    return fallbackStats(mlids, timeframe);
  }
}

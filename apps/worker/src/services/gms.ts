import type { HeroStatRow, Timeframe } from "@mlbb/shared";
import { db, heroes } from "@mlbb/db";

const DEFAULT_GMS_SOURCE_BASE_URL = "https://api.gms.moontontech.com/api/gms/source";
const DEFAULT_GMS_SOURCE_ID = "2669606";
const DEFAULT_GMS_LANG = "en";
const DEFAULT_GMS_STATS_PAGE_SIZE = 500;
const DEFAULT_MATCH_TYPE = "0";
const DEFAULT_CAMP_TYPE = "0";

const TIMEFRAME_ENDPOINT_DEFAULTS: Record<Timeframe, string> = {
  "1d": "2756567",
  "3d": "2756568",
  "7d": "2756569",
  "15d": "2756565",
  "30d": "2756570"
};

const BIGRANK_SCOPE_MAP: Record<string, string> = {
  "1": "warrior",
  "2": "elite",
  "3": "master",
  "4": "grandmaster",
  "5": "epic",
  "6": "legend",
  "7": "mythic",
  "8": "mythic_honor",
  "9": "mythic_glory",
  "101": "all_rank"
};

const CANONICAL_SCOPE_PRIORITY = [
  "all_rank",
  "mythic_glory",
  "mythic_honor",
  "mythic",
  "legend",
  "epic",
  "grandmaster",
  "master",
  "elite",
  "warrior"
] as const;

interface GmsStatResponse {
  data?: {
    total?: number;
    records?: Array<{
      data?: {
        main_heroid?: number | string;
        main_hero_win_rate?: number;
        main_hero_appearance_rate?: number;
        main_hero_ban_rate?: number;
        bigrank?: string | number;
        camp_type?: string | number;
        match_type?: string | number;
      };
    }>;
  };
}

interface StatsBundle {
  allRows: HeroStatRow[];
  rowsByScope: Record<string, HeroStatRow[]>;
}

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

function fallbackBundle(mlids: number[], timeframe: Timeframe): StatsBundle {
  const rows = fallbackStats(mlids, timeframe);
  return {
    allRows: rows,
    rowsByScope: { all: rows }
  };
}

function timeframeEndpoint(timeframe: Timeframe) {
  const fromEnv: Record<Timeframe, string | undefined> = {
    "1d": process.env.GMS_STATS_ENDPOINT_1D,
    "3d": process.env.GMS_STATS_ENDPOINT_3D,
    "7d": process.env.GMS_STATS_ENDPOINT_7D,
    "15d": process.env.GMS_STATS_ENDPOINT_15D,
    "30d": process.env.GMS_STATS_ENDPOINT_30D
  };

  return fromEnv[timeframe]?.trim() || TIMEFRAME_ENDPOINT_DEFAULTS[timeframe];
}

function statsUrl(timeframe: Timeframe) {
  const base = (process.env.GMS_SOURCE_BASE_URL?.trim() || DEFAULT_GMS_SOURCE_BASE_URL).replace(/\/+$/, "");
  const sourceId = process.env.GMS_SOURCE_ID?.trim() || DEFAULT_GMS_SOURCE_ID;
  const endpoint = timeframeEndpoint(timeframe);
  return `${base}/${sourceId}/${endpoint}`;
}

function asNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asFilterValue(value: string) {
  const num = Number(value);
  return Number.isNaN(num) ? value : num;
}

function toPercent(value: unknown) {
  const num = asNumber(value);
  if (num >= 0 && num <= 1) return Number((num * 100).toFixed(3));
  return Number(num.toFixed(3));
}

function normalizeScope(bigrank: unknown) {
  const code = String(bigrank ?? "").trim();
  if (!code) return "rank_unknown";
  return BIGRANK_SCOPE_MAP[code] ?? `rank_${code}`;
}

function pickPreferred(a: HeroStatRow | undefined, b: HeroStatRow) {
  if (!a) return b;
  if (b.pickRate !== a.pickRate) return b.pickRate > a.pickRate ? b : a;
  if (b.banRate !== a.banRate) return b.banRate > a.banRate ? b : a;
  return b.winRate > a.winRate ? b : a;
}

function sortRows(rows: HeroStatRow[]) {
  return [...rows].sort((a, b) => a.mlid - b.mlid);
}

function filterKnownMlids(bundle: StatsBundle, knownMlids: Set<number>): StatsBundle {
  if (knownMlids.size === 0) return bundle;

  const allRows = bundle.allRows.filter((row) => knownMlids.has(row.mlid));
  const rowsByScope = Object.fromEntries(
    Object.entries(bundle.rowsByScope).map(([scope, rows]) => [
      scope,
      rows.filter((row) => knownMlids.has(row.mlid))
    ])
  );

  return { allRows, rowsByScope };
}

async function fetchAllRecords(timeframe: Timeframe) {
  const url = statsUrl(timeframe);
  const lang = process.env.GMS_LANG?.trim() || DEFAULT_GMS_LANG;
  const apiKey = process.env.GMS_API_KEY?.trim();
  const pageSize = Math.min(
    500,
    Math.max(1, Number(process.env.GMS_STATS_PAGE_SIZE ?? DEFAULT_GMS_STATS_PAGE_SIZE) || DEFAULT_GMS_STATS_PAGE_SIZE)
  );
  const matchType = process.env.GMS_STATS_FILTER_MATCH_TYPE?.trim() ?? DEFAULT_MATCH_TYPE;
  const campType = process.env.GMS_STATS_FILTER_CAMP_TYPE?.trim() ?? DEFAULT_CAMP_TYPE;

  const headers: Record<string, string> = {
    "Content-Type": "application/json;charset=UTF-8",
    "x-lang": lang,
    Accept: "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const records: NonNullable<NonNullable<GmsStatResponse["data"]>["records"]> = [];
  let pageIndex = 1;
  let total = Number.POSITIVE_INFINITY;

  while ((pageIndex - 1) * pageSize < total) {
    const filters: Array<{ field: string; operator: "eq"; value: string | number }> = [
      { field: "match_type", operator: "eq", value: asFilterValue(matchType) }
    ];

    if (campType !== "") {
      filters.push({ field: "camp_type", operator: "eq", value: asFilterValue(campType) });
    }

    const payload = {
      pageSize,
      pageIndex,
      filters,
      sorts: [{ data: { field: "main_heroid", order: "asc" }, type: "sequence" }],
      fields: [
        "main_heroid",
        "main_hero_win_rate",
        "main_hero_appearance_rate",
        "main_hero_ban_rate",
        "bigrank",
        "camp_type",
        "match_type"
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`GMS stats response ${response.status}`);
    }

    const json = (await response.json()) as GmsStatResponse;
    const pageRecords = json.data?.records ?? [];
    total = Number(json.data?.total ?? pageRecords.length);
    records.push(...pageRecords);

    if (pageRecords.length === 0) break;
    pageIndex += 1;
  }

  return records;
}

function reduceRecords(records: Awaited<ReturnType<typeof fetchAllRecords>>, timeframe: Timeframe): StatsBundle {
  const byScope = new Map<string, Map<number, HeroStatRow>>();
  const byHero = new Map<number, Map<string, HeroStatRow>>();

  for (const record of records) {
    const data = record.data;
    const mlid = asNumber(data?.main_heroid);
    if (!mlid) continue;

    const scope = normalizeScope(data?.bigrank).slice(0, 40);
    const row: HeroStatRow = {
      mlid,
      timeframe,
      winRate: toPercent(data?.main_hero_win_rate),
      pickRate: toPercent(data?.main_hero_appearance_rate),
      banRate: toPercent(data?.main_hero_ban_rate)
    };

    const scopeMap = byScope.get(scope) ?? new Map<number, HeroStatRow>();
    scopeMap.set(mlid, pickPreferred(scopeMap.get(mlid), row));
    byScope.set(scope, scopeMap);

    const heroMap = byHero.get(mlid) ?? new Map<string, HeroStatRow>();
    heroMap.set(scope, pickPreferred(heroMap.get(scope), row));
    byHero.set(mlid, heroMap);
  }

  const allRows: HeroStatRow[] = [];
  const heroIds = Array.from(byHero.keys()).sort((a, b) => a - b);

  for (const mlid of heroIds) {
    const scopeRows = byHero.get(mlid);
    if (!scopeRows) continue;

    let chosen: HeroStatRow | undefined;
    for (const scope of CANONICAL_SCOPE_PRIORITY) {
      const candidate = scopeRows.get(scope);
      if (candidate) {
        chosen = candidate;
        break;
      }
    }

    if (!chosen) {
      for (const candidate of scopeRows.values()) {
        chosen = pickPreferred(chosen, candidate);
      }
    }

    if (chosen) {
      allRows.push(chosen);
    }
  }

  const sortedAllRows = sortRows(allRows);
  const rowsByScope: Record<string, HeroStatRow[]> = { all: sortedAllRows };
  for (const [scope, scopeRows] of byScope.entries()) {
    rowsByScope[scope] = sortRows(Array.from(scopeRows.values()));
  }

  return {
    allRows: sortedAllRows,
    rowsByScope
  };
}

export async function fetchGmsStats(timeframe: Timeframe): Promise<StatsBundle> {
  const heroRows = await db.select({ mlid: heroes.mlid }).from(heroes);
  const knownMlids = new Set(heroRows.map((row) => row.mlid));

  try {
    const records = await fetchAllRecords(timeframe);
    if (records.length === 0) {
      console.warn(`[worker] GMS returned no records for timeframe=${timeframe}; using mock dataset`);
      return fallbackBundle(heroRows.map((row) => row.mlid), timeframe);
    }

    const reduced = reduceRecords(records, timeframe);
    const filtered = filterKnownMlids(reduced, knownMlids);

    if (filtered.allRows.length === 0) {
      console.warn(`[worker] GMS records for timeframe=${timeframe} did not match known heroes; using mock dataset`);
      return fallbackBundle(heroRows.map((row) => row.mlid), timeframe);
    }

    return filtered;
  } catch (error) {
    console.warn(`[worker] GMS fetch failed for timeframe=${timeframe}; using mock data`, error);
    return fallbackBundle(heroRows.map((row) => row.mlid), timeframe);
  }
}

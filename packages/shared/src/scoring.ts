import type { Tier, TierResultRow } from "./types";

export interface TierScoreInput {
  mlid: number;
  winRate: number;
  pickRate: number;
  banRate: number;
}

function normalize(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return 0;
  if (max <= min) return 0.5;
  return (value - min) / (max - min);
}

function calculateThresholds(length: number) {
  return {
    ss: Math.ceil(length * 0.05),
    s: Math.ceil(length * 0.15),
    a: Math.ceil(length * 0.35),
    b: Math.ceil(length * 0.6),
    c: Math.ceil(length * 0.8)
  };
}

function tierByIndex(index: number, thresholds: ReturnType<typeof calculateThresholds>): Tier {
  if (index < thresholds.ss) return "SS";
  if (index < thresholds.s) return "S";
  if (index < thresholds.a) return "A";
  if (index < thresholds.b) return "B";
  if (index < thresholds.c) return "C";
  return "D";
}

export function computeTierResults(rows: TierScoreInput[]): TierResultRow[] {
  if (rows.length === 0) return [];

  const wrMin = Math.min(...rows.map((row) => row.winRate));
  const wrMax = Math.max(...rows.map((row) => row.winRate));
  const prMin = Math.min(...rows.map((row) => row.pickRate));
  const prMax = Math.max(...rows.map((row) => row.pickRate));
  const brMin = Math.min(...rows.map((row) => row.banRate));
  const brMax = Math.max(...rows.map((row) => row.banRate));

  const scored = rows
    .map((row) => {
      const wr = normalize(row.winRate, wrMin, wrMax);
      const pr = normalize(row.pickRate, prMin, prMax);
      const br = normalize(row.banRate, brMin, brMax);
      const score = 0.55 * wr + 0.25 * pr + 0.2 * br;
      return { mlid: row.mlid, score };
    })
    .sort((a, b) => b.score - a.score);

  const thresholds = calculateThresholds(scored.length);
  return scored.map((row, index) => ({
    mlid: row.mlid,
    score: Number(row.score.toFixed(4)),
    tier: tierByIndex(index, thresholds)
  }));
}

export function computeCounterScore(tierScore: number, diversityBonus: number): number {
  return Number((0.7 * tierScore + 0.3 * diversityBonus).toFixed(4));
}

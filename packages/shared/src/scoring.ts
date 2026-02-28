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

/**
 * Enhanced counter scoring that uses position in the meta counter list
 * as a strength signal. Heroes listed earlier are stronger counters.
 */
export function computeEnhancedCounterScore(
  tierScore: number,
  diversityBonus: number,
  isMetaCounter: boolean,
  metaCounterRank: number,
  totalMetaCounters: number
): number {
  if (isMetaCounter) {
    const positionWeight = 1 - metaCounterRank / Math.max(1, totalMetaCounters);
    const metaBoost = 0.6 + 0.4 * positionWeight;
    return Number((0.4 * tierScore + 0.6 * metaBoost).toFixed(4));
  }
  return Number((0.7 * tierScore + 0.3 * diversityBonus).toFixed(4));
}

/**
 * Phase-aware weight configuration for draft pick scoring.
 * Weights shift from flex/meta-heavy in early picks to counter-heavy in late picks.
 */
export interface PhaseWeights {
  counterWeight: number;
  tierWeight: number;
  flexWeight: number;
  banRateWeight: number;
  pickRateWeight: number;
  winRateWeight: number;
  laneBonusWeight: number;
}

/**
 * Returns scoring weights based on acting side's pick number (1-5).
 * Early picks favor tier/flex; late picks favor counter/lane coverage.
 */
export function phaseWeights(pickNumber: number): PhaseWeights {
  const t = Math.max(0, Math.min(1, (pickNumber - 1) / 4));

  return {
    counterWeight: 0.05 + 0.25 * t,
    tierWeight: 0.35 - 0.1 * t,
    flexWeight: 0.15 - 0.1 * t,
    banRateWeight: 0.15 - 0.05 * t,
    pickRateWeight: 0.15,
    winRateWeight: 0.1,
    laneBonusWeight: 0.05 + 0.05 * t
  };
}

/**
 * Synergy scoring using meta synergy list position as strength signal.
 */
export function computeSynergyScore(
  tierScore: number,
  isMetaSynergy: boolean,
  synergyRank: number,
  totalSynergies: number
): number {
  if (isMetaSynergy) {
    const positionWeight = 1 - synergyRank / Math.max(1, totalSynergies);
    const metaBoost = 0.5 + 0.5 * positionWeight;
    return Number((0.4 * tierScore + 0.6 * metaBoost).toFixed(4));
  }
  return Number((0.8 * tierScore + 0.2 * 0.5).toFixed(4));
}

/**
 * Proficiency-weighted flex value using lane confidence scores.
 * Returns a 0-1 value where higher = more viable multi-lane flexibility.
 */
export function computeFlexValue(
  laneConfidences: Array<{ lane: string; confidence: number }>,
  threshold: number = 0.6
): number {
  const viable = laneConfidences.filter((lc) => lc.confidence >= threshold);
  if (viable.length === 0) return 0;
  const totalConfidence = viable.reduce((sum, lc) => sum + lc.confidence, 0);
  return Number((totalConfidence / 3).toFixed(4));
}

// Centralized insight logic for /hero-statistics.
// All thresholds are in THRESHOLDS — adjust here only.

export type StatLevel = "high" | "medium" | "low";

export type InsightKey = "hidden_op" | "safe_pick" | "meta_priority" | "risky_meta" | "niche_pick" | "avoid";
export type DraftUsageKey = "deny_priority" | "safe_pick" | "surprise_pick" | "risky_pick" | "situational";

export interface InsightLabel {
  readonly key: InsightKey;
  readonly emoji: string;
  readonly label: string;
  readonly cssClass: string;
}

export interface DraftUsageLabel {
  readonly key: DraftUsageKey;
  readonly label: string;
  readonly cssClass: string;
}

export interface HeroRef {
  readonly mlid: number;
  readonly name: string;
  readonly imageKey: string;
}

export interface InsightSummary {
  readonly hiddenOp: readonly HeroRef[];
  readonly safePicks: readonly HeroRef[];
  readonly riskyMeta: readonly HeroRef[];
  readonly metaPriority: readonly HeroRef[];
  readonly nichePicks: readonly HeroRef[];
}

// ── Thresholds ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  winRate:  { high: 52, stable: 49 },
  pickRate: { high: 3,  medium: 1  },
  banRate:  { high: 5,  medium: 2  },
} as const;

// ── Stat level ────────────────────────────────────────────────────────────────

export function getStatLevel(value: number, type: "win" | "pick" | "ban"): StatLevel {
  if (type === "win") {
    return value >= THRESHOLDS.winRate.high ? "high"
      : value >= THRESHOLDS.winRate.stable  ? "medium"
      : "low";
  }
  if (type === "pick") {
    return value >= THRESHOLDS.pickRate.high   ? "high"
      : value >= THRESHOLDS.pickRate.medium    ? "medium"
      : "low";
  }
  return value >= THRESHOLDS.banRate.high   ? "high"
    : value >= THRESHOLDS.banRate.medium    ? "medium"
    : "low";
}

// ── Input shape ───────────────────────────────────────────────────────────────

export interface StatInput {
  readonly winRate: number;
  readonly pickRate: number;
  readonly banRate: number;
}

// ── Insight label ─────────────────────────────────────────────────────────────

const INSIGHT_LABELS: Readonly<Record<InsightKey, InsightLabel>> = {
  hidden_op:     { key: "hidden_op",     emoji: "/insights/hidden-op.png",     label: "Hidden OP",     cssClass: "ins-hidden-op"     },
  safe_pick:     { key: "safe_pick",     emoji: "/insights/safe-pick.png",     label: "Safe Pick",     cssClass: "ins-safe-pick"     },
  meta_priority: { key: "meta_priority", emoji: "/insights/meta-priority.png", label: "Meta Priority", cssClass: "ins-meta-priority" },
  risky_meta:    { key: "risky_meta",    emoji: "/insights/risky-meta.png",    label: "Risky Meta",    cssClass: "ins-risky-meta"    },
  niche_pick:    { key: "niche_pick",    emoji: "/insights/niche-pick.png",    label: "Niche Pick",    cssClass: "ins-niche-pick"    },
  avoid:         { key: "avoid",         emoji: "/insights/avoid.png",         label: "Avoid",         cssClass: "ins-avoid"         },
};

// Priority order: hidden_op → meta_priority → safe_pick → risky_meta → avoid → niche_pick
export function getHeroInsight(hero: StatInput): InsightLabel {
  const win  = getStatLevel(hero.winRate,  "win");
  const pick = getStatLevel(hero.pickRate, "pick");
  const ban  = getStatLevel(hero.banRate,  "ban");

  if (win === "high" && pick === "low")                           return INSIGHT_LABELS.hidden_op;
  if (pick === "high" && ban === "high")                          return INSIGHT_LABELS.meta_priority;
  if (win === "high" && (pick === "medium" || pick === "high"))   return INSIGHT_LABELS.safe_pick;
  if (win === "low" && (pick === "high" || ban === "high"))       return INSIGHT_LABELS.risky_meta;
  if (win === "low" && pick === "low" && ban === "low")           return INSIGHT_LABELS.avoid;
  return INSIGHT_LABELS.niche_pick;
}

// ── Draft usage ───────────────────────────────────────────────────────────────

const DRAFT_USAGE_LABELS: Readonly<Record<DraftUsageKey, DraftUsageLabel>> = {
  deny_priority: { key: "deny_priority", label: "Deny / Priority", cssClass: "du-deny"       },
  safe_pick:     { key: "safe_pick",     label: "Safe Pick",       cssClass: "du-safe"       },
  surprise_pick: { key: "surprise_pick", label: "Surprise Pick",   cssClass: "du-surprise"   },
  risky_pick:    { key: "risky_pick",    label: "Risky Pick",      cssClass: "du-risky"      },
  situational:   { key: "situational",   label: "Situational",     cssClass: "du-situational"},
};

export function getDraftUsage(hero: StatInput): DraftUsageLabel {
  const win  = getStatLevel(hero.winRate,  "win");
  const pick = getStatLevel(hero.pickRate, "pick");
  const ban  = getStatLevel(hero.banRate,  "ban");

  if (ban === "high")                                           return DRAFT_USAGE_LABELS.deny_priority;
  if (win === "high" && (pick === "medium" || pick === "high")) return DRAFT_USAGE_LABELS.safe_pick;
  if (win === "high" && pick === "low")                         return DRAFT_USAGE_LABELS.surprise_pick;
  if (win === "low" && pick !== "low")                          return DRAFT_USAGE_LABELS.risky_pick;
  return DRAFT_USAGE_LABELS.situational;
}

// ── Insight reason ────────────────────────────────────────────────────────────

export function getInsightReason(hero: StatInput): string {
  const win  = getStatLevel(hero.winRate,  "win");
  const pick = getStatLevel(hero.pickRate, "pick");
  const ban  = getStatLevel(hero.banRate,  "ban");

  if (win === "high" && pick === "low")
    return "High win rate with low pick rate indicates a possible sleeper pick.";
  if (pick === "high" && ban === "high" && win === "high")
    return "Dominates in all metrics — expected to be drafted or denied early.";
  if (pick === "high" && ban === "high")
    return "High pick and ban pressure makes this a priority in draft phase.";
  if (win === "high")
    return "Consistent performer across matchups; reliable for ranked and coordinated play.";
  if (ban === "high")
    return "High ban pressure means this hero is often denied in draft, though win rate lags.";
  if (win === "low" && pick !== "low")
    return "Low win rate despite pick pressure suggests risky execution.";
  if (win === "low" && pick === "low")
    return "Consistently underperforming — consider other options or specialized play.";
  return "Low representation in current meta; niche but viable in the right setup.";
}

// ── Summary panel ─────────────────────────────────────────────────────────────

const MAX_SUMMARY = 3;

export function getTopInsights(
  heroes: ReadonlyArray<StatInput & { readonly mlid: number; readonly name: string; readonly imageKey: string }>
): InsightSummary {
  const hiddenOp:     HeroRef[] = [];
  const safePicks:    HeroRef[] = [];
  const riskyMeta:    HeroRef[] = [];
  const metaPriority: HeroRef[] = [];
  const nichePicks:   HeroRef[] = [];

  for (const hero of heroes) {
    const key = getHeroInsight(hero).key;
    const ref: HeroRef = { mlid: hero.mlid, name: hero.name, imageKey: hero.imageKey };
    if      (key === "hidden_op"     && hiddenOp.length     < MAX_SUMMARY) hiddenOp.push(ref);
    else if (key === "safe_pick"     && safePicks.length    < MAX_SUMMARY) safePicks.push(ref);
    else if (key === "risky_meta"    && riskyMeta.length    < MAX_SUMMARY) riskyMeta.push(ref);
    else if (key === "meta_priority" && metaPriority.length < MAX_SUMMARY) metaPriority.push(ref);
    else if (key === "niche_pick"    && nichePicks.length   < MAX_SUMMARY) nichePicks.push(ref);
  }

  return { hiddenOp, safePicks, riskyMeta, metaPriority, nichePicks };
}

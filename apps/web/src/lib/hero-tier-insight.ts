

export type DraftPriority = "First Pick" | "Safe Pick" | "Counter Pick" | "Situational";
export type RiskLevel = "Low" | "Medium" | "High";
export type PowerSpike = "Early" | "Mid" | "Late";
export type MetricTone = "tier" | "win" | "pressure" | "flex";

export interface MetricBar {
  readonly label: string;
  readonly value: number;
  readonly tone: MetricTone;
}

export interface HeroInsightData {
  readonly reasons: readonly string[];
  readonly priority: DraftPriority;
  readonly risk: RiskLevel;
  readonly spike: PowerSpike;
  readonly bars: readonly MetricBar[];
  readonly strongVs: string;
  readonly weakVs: string;
  readonly synergy: string;
}

export interface HeroInsightInput {
  readonly rolePrimary: string;
  readonly roleSecondary?: string | null;
  readonly lanes: readonly string[];
}

const TIER_SCORE: Readonly<Record<string, number>> = {
  SS: 0.98,
  S: 0.84,
  A: 0.68,
  B: 0.52,
  C: 0.38,
  D: 0.22
};

const ROLE_REASONS: Readonly<Record<string, readonly [string, string, string]>> = {
  tank: [
    "Frontline anchor — absorbs engage and creates space",
    "Hard to punish in most draft compositions",
    "Enables carry by peeling dive threats"
  ],
  fighter: [
    "Lane-dominant with solo kill threat",
    "Flexible between Gold and Exp lane assignments",
    "Good denial target due to high base scaling"
  ],
  assassin: [
    "High burst threat forces defensive rotations",
    "Strong pick-off potential in early skirmishes",
    "Jungle pressure disrupts enemy lane priority"
  ],
  mage: [
    "Teamfight AoE stacks reliable DPS",
    "Mid lane presence forces blue buff contest",
    "Crowd-control utility adds draft flexibility"
  ],
  marksman: [
    "Hypercarry scaling controls late-game tempo",
    "Gold lane priority secures objective windows",
    "High-value ban magnet that protects your carry"
  ],
  support: [
    "Healing and shielding multiplies team survivability",
    "Vision and roam tempo controls map rhythm",
    "Pick-off assist amplifies jungler snowball"
  ]
};

const LANE_REASON: Readonly<Record<string, string>> = {
  gold: "Gold lane prio generates critical objective windows",
  exp: "Exp lane bully denies enemy fighter scaling",
  mid: "Mid vision rotates pressure to both side lanes",
  roam: "Early map pressure synergises with aggressive jungler",
  jungle: "Jungle tempo dictates first-blood and tower windows"
};

const STRONG_VS: Readonly<Record<string, string>> = {
  tank: "Assassins, burst-heavy dive comps",
  fighter: "Marksmen, isolated and unpeeled carries",
  assassin: "Squishy mages, unprotected backline carries",
  mage: "Grouped melee dive, engage-heavy comps",
  marksman: "Poke sustain comps, structure-rush drafts",
  support: "High-burst assassin comps, all-in poke"
};

const WEAK_VS: Readonly<Record<string, string>> = {
  tank: "Percentage HP / true damage dealers",
  fighter: "CC-heavy poke lanes, long-range mages",
  assassin: "Tanky frontlines, shields and stasis items",
  mage: "Mobile assassins, hard-engage with gap-close",
  marksman: "Dive assassins, fast-engage frontlines",
  support: "Anti-heal comps, aggressive sustain-denial"
};

const BEST_SYNERGY: Readonly<Record<string, string>> = {
  tank: "Marksman + Mage sustained damage cores",
  fighter: "Assassin burst + Support peel combos",
  assassin: "Tank CC setup + Marksman cleanup",
  mage: "Roam/Support peel + Physical damage core",
  marksman: "Support shielding + Tank engage frontline",
  support: "Hypercarry marksman + Burst mage combo"
};

function derivePriority(tier: string, score: number): DraftPriority {
  if (tier === "SS" || score >= 0.88) return "First Pick";
  if (tier === "S" || score >= 0.72) return "Safe Pick";
  if (tier === "A" || score >= 0.55) return "Safe Pick";
  if (tier === "B" || score >= 0.40) return "Situational";
  return "Counter Pick";
}

function deriveRisk(tier: string): RiskLevel {
  if (tier === "SS" || tier === "S") return "Low";
  if (tier === "A" || tier === "B") return "Medium";
  return "High";
}

function derivePowerSpike(role: string, lane: string): PowerSpike {
  if (role === "marksman") return "Late";
  if (role === "support" || lane === "roam") return "Early";
  if (role === "assassin" || lane === "jungle") return "Early";
  if (role === "mage" || role === "fighter") return "Mid";
  return "Mid";
}

function deriveBars(tierScore: number, metaScore: number): readonly MetricBar[] {
  const winInfluence = Math.min(1, metaScore * 1.1 + (tierScore - metaScore) * 0.4);
  const banPressure =
    tierScore >= 0.8
      ? Math.min(1, tierScore * 0.95)
      : Math.min(1, metaScore + 0.1);
  const flexibility = Math.min(1, metaScore * 0.85 + 0.15);
  return [
    { label: "Meta Score", value: metaScore, tone: "tier" },
    { label: "Win Influence", value: winInfluence, tone: "win" },
    { label: "Pick/Ban Pressure", value: banPressure, tone: "pressure" },
    { label: "Flexibility", value: flexibility, tone: "flex" }
  ] as const;
}

export function deriveHeroInsight(
  hero: HeroInsightInput,
  metaScore: number,
  tier: string
): HeroInsightData {
  const role = hero.rolePrimary;
  const lane = hero.lanes[0] ?? "jungle";
  const tierScore = TIER_SCORE[tier] ?? metaScore;
  const roleReasons = ROLE_REASONS[role] ?? ([
    "Strong in current meta context",
    "Reliable in high-rank draft play",
    "Consistent performance across matchups"
  ] as const);

  const laneReason = LANE_REASON[lane] ?? null;
  const reasons: string[] = [roleReasons[0], roleReasons[1]];
  if (laneReason && !reasons.includes(laneReason)) {
    reasons.push(laneReason);
  } else {
    reasons.push(roleReasons[2]);
  }

  return {
    reasons: reasons.slice(0, 3),
    priority: derivePriority(tier, metaScore),
    risk: deriveRisk(tier),
    spike: derivePowerSpike(role, lane),
    bars: deriveBars(tierScore, metaScore),
    strongVs: STRONG_VS[role] ?? "Role-specific matchups",
    weakVs: WEAK_VS[role] ?? "Role-specific matchups",
    synergy: BEST_SYNERGY[role] ?? "Standard team composition"
  };
}

export function metricPercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function priorityChipClass(priority: DraftPriority): string {
  if (priority === "First Pick") return "ht-badge--first";
  if (priority === "Safe Pick") return "ht-badge--safe";
  if (priority === "Counter Pick") return "ht-badge--counter";
  return "ht-badge--situational";
}

export function riskChipClass(risk: RiskLevel): string {
  if (risk === "Low") return "ht-badge--risk-low";
  if (risk === "Medium") return "ht-badge--risk-med";
  return "ht-badge--risk-high";
}



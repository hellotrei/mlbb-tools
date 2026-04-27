/**
 * Shared infotip utilities for Draft Arena.
 * Used by /hero-tier, /hero-statistics, and optionally /draft-master.
 */

export interface InfotipPlacement {
  readonly vertical: "top" | "bottom";
  readonly horizontal: "center" | "left" | "right";
}

export interface InfotipLayout {
  readonly placement: InfotipPlacement;
  readonly position: { readonly top: number; readonly left: number };
}

export interface HeroInfotipData {
  readonly id: string | number;
  readonly name: string;
  readonly imageKey: string;
  // Header
  readonly roleLabel?: string;
  readonly laneLabel?: string;
  readonly tierHint?: string;
  readonly tier?: string;
  // Draft metadata — tier-derived
  readonly priority?: string;      // "First Pick" | "Safe Pick" | "Counter Pick" | "Situational"
  readonly risk?: string;          // "Low" | "Medium" | "High"
  readonly spike?: string;         // "Early Game" | "Mid Game" | "Late Game"
  // Insight — stats-derived
  readonly insightLabel?: string;
  readonly insightEmoji?: string;
  readonly insightKey?: string;    // InsightKey value
  readonly draftUsage?: string;
  readonly draftUsageKey?: string; // DraftUsageKey value
  // Raw rates
  readonly winRate?: number;
  readonly pickRate?: number;
  readonly banRate?: number;
  // "Why this hero" reasons (tier mode)
  readonly reasons?: readonly string[];
  // Metric bars (tier mode)
  readonly bars?: readonly {
    readonly label: string;
    readonly value: number;
    readonly tone: string;
  }[];
  // Match context (tier mode)
  readonly strongVs?: string;
  readonly weakVs?: string;
  readonly synergy?: string;
  // Interpretation text (stats mode)
  readonly insightReason?: string;
  // CTA links
  readonly ctaLinks?: ReadonlyArray<{
    readonly label: string;
    readonly href: string;
    readonly accent?: boolean;
  }>;
}

/**
 * Compute optimal placement and pixel position for a floating infotip
 * anchored to `anchor`. Flips away from viewport edges automatically.
 */
export function computeInfotipLayout(
  anchor: Element,
  tipW = 300,
  tipH = 440
): InfotipLayout {
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pw = Math.min(tipW, vw - 32);
  const gap = 10;
  const margin = 12;

  const centerL = rect.left + rect.width / 2 - pw / 2;
  const horizontal: InfotipPlacement["horizontal"] =
    centerL < margin ? "left" : centerL + pw > vw - margin ? "right" : "center";

  const spaceAbove = rect.top;
  const spaceBelow = vh - rect.bottom;
  const vertical: InfotipPlacement["vertical"] =
    spaceAbove >= tipH || spaceAbove >= spaceBelow ? "top" : "bottom";

  let left = rect.left + rect.width / 2 - pw / 2;
  if (horizontal === "left") left = rect.left;
  if (horizontal === "right") left = rect.right - pw;
  left = Math.max(margin, Math.min(left, vw - pw - margin));

  const top = vertical === "top" ? rect.top : rect.bottom + gap;
  return {
    placement: { vertical, horizontal },
    position: { top: Math.max(margin, top), left },
  };
}

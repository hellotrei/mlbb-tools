<script lang="ts">
  import { onMount } from "svelte";
  import { buildRolePoolMap, evaluateDraftFeasibility, type DraftFeasibilityResult, type DraftLane } from "@mlbb/shared";
  import { HeroAvatar, Skeleton } from "@mlbb/ui";
  import { apiUrl } from "$lib/api";
  import { LANES, ROLES, RANK_SCOPES, TIMEFRAMES, laneLabel, rankScopeLabel, roleLabel, timeframeLabel } from "$lib/options";

  type Hero = {
    mlid: number;
    name: string;
    imageKey: string;
    rolePrimary: string;
    roleSecondary?: string | null;
    lanes: string[];
  };

  type DraftMode = "ranked" | "tournament";
  type DraftAction = {
    type: "pick" | "ban";
    side: "ally" | "enemy";
    count: number;
    text: string;
  };

  type SlotState = "open" | "locked" | "target";
  type SlotView = {
    lane: DraftLane;
    label: string;
    mlid: number | null;
    state: SlotState;
  };
  type FeasibilityPayload = { ally: DraftFeasibilityResult; enemy: DraftFeasibilityResult };
  type HeroActionState = { disabled: boolean; reason: string | null };
  type RecommendationFocus = "balanced" | "meta" | "coverage";
  type RankedRecommendation = RecommendationRow & {
    priority: number;
    coverageLanes: DraftLane[];
    flexCount: number;
    fitReason: string;
  };

  type RecommendationBreakdown = {
    counterImpact: number;
    tierPower: number;
    laneCoverage: number;
    flexValue: number;
    feasibilityGain: number;
    denyValue: number;
  };
  type RecommendationPreview = {
    beforeMissingRoles: DraftLane[];
    afterMissingRoles: DraftLane[];
    newlyCoveredRoles: DraftLane[];
    matchedBefore: number;
    matchedAfter: number;
  };
  type RecommendationRow = {
    mlid: number;
    score: number;
    reasons?: string[];
    tier?: string;
    breakdown?: RecommendationBreakdown;
    preview?: RecommendationPreview | null;
  };
  type MatchupResult = {
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
    };
    details?: {
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
  type DebugSnapshot = {
    mode: DraftMode;
    turnIndex: number;
    actionProgress: number;
    action: string;
    allySlots: Array<number | null>;
    enemySlots: Array<number | null>;
    allyBans: number[];
    enemyBans: number[];
    allyPickCount: number;
    enemyPickCount: number;
  };

  export let data: {
    timeframe: string;
    rankScope: string;
    heroes: Hero[];
  };

  const MAX_PICKS = 5;
  const MAX_BANS = 5;
  const SLOT_LANES: DraftLane[] = ["exp", "jungle", "mid", "gold", "roam"];
  const ROLE_ICON_PATHS: Record<string, string> = {
    tank: "/filters/tank.webp",
    fighter: "/filters/fighter.webp",
    assassin: "/filters/assassin.webp",
    mage: "/filters/mage.webp",
    marksman: "/filters/marksman.webp",
    support: "/filters/support.webp"
  };

  const TOURNAMENT_SEQUENCE: DraftAction[] = [
    { type: "ban", side: "ally", count: 2, text: "Ally ban 2 heroes" },
    { type: "ban", side: "enemy", count: 2, text: "Enemy ban 2 heroes" },
    { type: "ban", side: "ally", count: 1, text: "Ally ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy ban 1 hero" },
    { type: "pick", side: "ally", count: 1, text: "Ally pick 1 hero" },
    { type: "pick", side: "enemy", count: 2, text: "Enemy pick 2 heroes" },
    { type: "pick", side: "ally", count: 2, text: "Ally pick 2 heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy pick 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally ban 1 hero" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy pick 1 hero" },
    { type: "pick", side: "ally", count: 2, text: "Ally pick 2 last heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy pick 1 last hero" }
  ];

  const RANKED_SEQUENCE: DraftAction[] = [
    { type: "ban", side: "ally", count: 3, text: "Ally ban 3 heroes" },
    { type: "ban", side: "enemy", count: 3, text: "Enemy ban 3 heroes" },
    { type: "ban", side: "ally", count: 2, text: "Ally ban 2 heroes" },
    { type: "ban", side: "enemy", count: 2, text: "Enemy ban 2 heroes" },
    { type: "pick", side: "ally", count: 1, text: "Ally pick 1 hero" },
    { type: "pick", side: "enemy", count: 2, text: "Enemy pick 2 heroes" },
    { type: "pick", side: "ally", count: 2, text: "Ally pick 2 heroes" },
    { type: "pick", side: "enemy", count: 2, text: "Enemy pick 2 heroes" },
    { type: "pick", side: "ally", count: 2, text: "Ally pick 2 heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy pick 1 hero" }
  ];

  let timeframe = "7d";
  let rankScope = "mythic_glory";
  let mode: DraftMode = "ranked";

  let turnIndex = 0;
  let actionProgress = 0;

  let allySlotMlids: Array<number | null> = [null, null, null, null, null];
  let enemySlotMlids: Array<number | null> = [null, null, null, null, null];
  let allyBans: number[] = [];
  let enemyBans: number[] = [];

  let loading = false;
  let error = "";
  let hasLoadedOnce = false;
  let actionBusy = false;
  let autoAnalyzed = false;
  let matchupLoading = false;
  let matchupError = "";
  let matchup: MatchupResult | null = null;
  let debugLogs: string[] = [];
  let lastTurnKey = "";
  let payload: {
    recommendedPicks: RecommendationRow[];
    recommendedBans: RecommendationRow[];
    notes: string[];
  } | null = null;
  let feasibility: FeasibilityPayload | null = null;
  let heroActionMap = new Map<number, HeroActionState>();
  let recommendationFocus: RecommendationFocus = "balanced";
  let poolRoleFilter = "";
  let poolLaneFilter = "";

  const heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero]));
  const fallbackRolePool = buildRolePoolMap(
    data.heroes.map((hero) => ({
      mlid: hero.mlid,
      lanes: heroLanePool(hero)
    }))
  );

  $: sequence = mode === "tournament" ? TOURNAMENT_SEQUENCE : RANKED_SEQUENCE;
  $: currentState = computeActionState(turnIndex, actionProgress);
  $: currentAction = currentState.action;

  $: allyPicks = normalizeMlids(allySlotMlids, MAX_PICKS);
  $: enemyPicks = normalizeMlids(enemySlotMlids, MAX_PICKS);
  $: allyBansView = normalizeMlids(allyBans, MAX_BANS);
  $: enemyBansView = normalizeMlids(enemyBans, MAX_BANS);
  $: occupiedMlids = new Set<number>([...allyPicks, ...enemyPicks, ...allyBansView, ...enemyBansView]);
  $: allyPickCount = allyPicks.length;
  $: enemyPickCount = enemyPicks.length;

  $: allyFeasibility = feasibility?.ally ?? evaluateDraftFeasibility(allyPicks, fallbackRolePool);
  $: enemyFeasibility = feasibility?.enemy ?? evaluateDraftFeasibility(enemyPicks, fallbackRolePool);
  $: heroActionMap = buildHeroActionMap(data.heroes, currentAction);
  $: currentMissingRoles =
    currentAction?.type === "pick"
      ? currentAction.side === "ally"
        ? allyFeasibility.missingRoles
        : enemyFeasibility.missingRoles
      : [];

  $: recommendationRows =
    currentAction?.type === "ban" ? (payload?.recommendedBans ?? []) : (payload?.recommendedPicks ?? []);
  $: rankedRecommendations = rankRecommendations(
    recommendationRows.filter((row) => !occupiedMlids.has(row.mlid) && passesLockedLaneRule(row.mlid, currentAction))
  );
  $: actionableRecommendations = rankedRecommendations;
  $: heroPoolRows = data.heroes
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((hero) => {
      if (poolRoleFilter && hero.rolePrimary !== poolRoleFilter && hero.roleSecondary !== poolRoleFilter) return false;
      if (poolLaneFilter) {
        const lanes = heroLanePool(hero);
        if (!lanes.includes(poolLaneFilter as DraftLane)) return false;
      }
      return true;
    })
    .map((hero) => ({
      hero,
      state: actionStateFor(hero.mlid)
    }));
  $: coverageHint =
    currentAction?.type === "pick" && currentMissingRoles.length > 0
      ? `Priority lanes: ${currentMissingRoles.map((lane) => laneLabel(lane)).join(", ")}`
      : currentAction?.type === "pick"
        ? "Core lane coverage is complete. Prioritize counter edge and comfort."
        : "";
  $: canAnalyze = allyPickCount === MAX_PICKS && enemyPickCount === MAX_PICKS;
  $: scoreTotal = matchup ? matchup.allyScore + matchup.enemyScore : 0;
  $: allyScorePct =
    scoreTotal > 0 && matchup ? Math.max(6, Math.min(94, (matchup.allyScore / scoreTotal) * 100)) : 50;
  $: enemyScorePct =
    scoreTotal > 0 && matchup ? Math.max(6, Math.min(94, (matchup.enemyScore / scoreTotal) * 100)) : 50;
  $: analysisHeadline = matchup
    ? matchup.allyScore === matchup.enemyScore
      ? "Draft looks balanced"
      : matchup.allyScore > matchup.enemyScore
        ? "Ally Team Wins"
        : "Enemy Team Wins"
    : "Draft Matchup";
  $: hideAnalyzeButton = !currentAction && Boolean(matchup);
  $: isAllyBanTurn = currentAction?.type === "ban" && currentAction.side === "ally";
  $: analysisWinner = matchup
    ? matchup.allyScore === matchup.enemyScore
      ? "balanced"
      : matchup.allyScore > matchup.enemyScore
        ? "ally"
        : "enemy"
    : null;
  $: focusModeHint =
    recommendationFocus === "balanced"
      ? "Balanced = mix counter value, lane coverage, and consistency."
      : recommendationFocus === "meta"
        ? "Meta First = prioritize highest-performing heroes in current scope."
        : "Role Coverage = prioritize heroes that close missing lane coverage first.";
  $: if (canAnalyze && !currentAction && !matchupLoading && !matchup && !autoAnalyzed) {
    autoAnalyzed = true;
    void analyzeMatchup();
  }
  $: {
    const key = `${turnIndex}:${actionProgress}:${currentAction?.type ?? "done"}:${currentAction?.side ?? "-"}`;
    if (key !== lastTurnKey) {
      lastTurnKey = key;
      addDebug("turn-state", snapshotState());
    }
  }

  $: allySlots = buildSlots("ally", allySlotMlids, currentAction, allyFeasibility);
  $: enemySlots = buildSlots("enemy", enemySlotMlids, currentAction, enemyFeasibility);

  onMount(() => {
    normalizeTurnState();
    addDebug("mount-init", snapshotState());
    void analyze();
  });

  function sideLabel(side: "ally" | "enemy") {
    return side === "ally" ? "Ally" : "Enemy";
  }

  function sideLabelFull(side: "ally" | "enemy") {
    return side === "ally" ? "Ally Team" : "Enemy Team";
  }

  function heroName(mlid: number) {
    return heroMap.get(mlid)?.name ?? `Hero #${mlid}`;
  }

  function heroImage(mlid: number) {
    return heroMap.get(mlid)?.imageKey ?? "";
  }

  function heroRoleText(mlid: number) {
    const hero = heroMap.get(mlid);
    if (!hero) return "Unknown role";
    const secondary = hero.roleSecondary ? ` / ${roleLabel(hero.roleSecondary)}` : "";
    return `${roleLabel(hero.rolePrimary)}${secondary}`;
  }

  function heroLaneLabels(mlid: number) {
    const hero = heroMap.get(mlid);
    if (!hero || !hero.lanes?.length) return ["Unknown lane"];
    return hero.lanes.map((lane) => laneLabel(lane));
  }

  function heroRoleIcon(mlid: number) {
    const hero = heroMap.get(mlid);
    if (!hero) return "";
    return ROLE_ICON_PATHS[hero.rolePrimary] ?? "";
  }

  function normalizeDraftLane(value: string): DraftLane | null {
    const normalized = value.toLowerCase().trim();
    if (normalized === "exp") return "exp";
    if (normalized === "jungle") return "jungle";
    if (normalized === "mid") return "mid";
    if (normalized === "gold") return "gold";
    if (normalized === "roam") return "roam";
    return null;
  }

  function heroLanePool(hero: Hero): DraftLane[] {
    const lanes = (hero.lanes ?? []).map((lane) => normalizeDraftLane(lane)).filter((lane): lane is DraftLane => Boolean(lane));
    return Array.from(new Set(lanes));
  }

  function tierLabel(score: number, tier?: string) {
    if (tier) return tier;
    if (score >= 0.72) return "SS";
    if (score >= 0.62) return "S";
    if (score >= 0.54) return "A";
    if (score >= 0.47) return "B";
    if (score >= 0.38) return "C";
    return "D";
  }

  function metricPercent(value: number | undefined) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(value ?? NaN) ? (value as number) : 0));
    return Math.round(clamped * 100);
  }

  function laneListText(lanes: DraftLane[] | undefined) {
    if (!lanes || lanes.length === 0) return "None";
    return lanes.map((lane) => laneLabel(lane)).join(", ");
  }

  function tierCountsText(value: Record<string, number> | undefined) {
    if (!value) return "No tier data";
    const order = ["SS", "S", "A", "B", "C", "D"];
    const parts = order
      .map((tier) => ({ tier, count: Number(value[tier] ?? 0) }))
      .filter((entry) => entry.count > 0)
      .map((entry) => `${entry.tier}: ${entry.count}`);
    return parts.length ? parts.join("  |  ") : "No tier data";
  }

  function normalizeMlid(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
  }

  function normalizeMlids(values: unknown[], limit: number): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const value of values) {
      const mlid = normalizeMlid(value);
      if (!mlid || seen.has(mlid)) continue;
      out.push(mlid);
      seen.add(mlid);
      if (out.length >= limit) break;
    }
    return out;
  }

  function picksOf(side: "ally" | "enemy") {
    const source = side === "ally" ? allySlotMlids : enemySlotMlids;
    return normalizeMlids(source, MAX_PICKS);
  }

  function bansOf(side: "ally" | "enemy") {
    return normalizeMlids(side === "ally" ? allyBans : enemyBans, MAX_BANS);
  }

  function takenSet() {
    return new Set<number>([...picksOf("ally"), ...picksOf("enemy"), ...bansOf("ally"), ...bansOf("enemy")]);
  }

  function evaluateHeroActionState(
    mlid: number,
    action: (DraftAction & { limit: number }) | null,
    options?: { ignoreBusy?: boolean }
  ): HeroActionState {
    if (!action) return { disabled: true, reason: "Draft is complete." };

    if (takenSet().has(mlid)) {
      return { disabled: true, reason: "Hero is already picked or banned." };
    }

    if (action.type === "ban") {
      const usedBans = bansOf(action.side).length;
      if (usedBans >= MAX_BANS) return { disabled: true, reason: "Ban slots are full." };
      return { disabled: false, reason: null };
    }

    const sidePicks = picksOf(action.side);
    if (sidePicks.length >= MAX_PICKS) {
      return { disabled: true, reason: "Pick slots are full." };
    }

    const simulatedPicks = [...sidePicks, mlid];
    const simulated = evaluateDraftFeasibility(simulatedPicks, fallbackRolePool);
    if (simulated.matchedCount < simulatedPicks.length) {
      return { disabled: true, reason: "Lane conflict with current picks." };
    }

    return { disabled: false, reason: null };
  }

  function buildHeroActionMap(candidates: Hero[], action: (DraftAction & { limit: number }) | null) {
    const map = new Map<number, HeroActionState>();
    for (const hero of candidates) {
      map.set(hero.mlid, evaluateHeroActionState(hero.mlid, action));
    }
    return map;
  }

  function actionStateFor(mlid: number, options?: { ignoreBusy?: boolean }): HeroActionState {
    if (!options?.ignoreBusy) {
      const state = heroActionMap.get(mlid);
      if (state) return state;
    }
    return evaluateHeroActionState(mlid, currentAction, options);
  }

  function lockedNonFlexLanesForSide(side: "ally" | "enemy") {
    const picks = picksOf(side);
    const locked = new Set<DraftLane>();
    for (const mlid of picks) {
      const lanes = fallbackRolePool.get(mlid) ?? [];
      if (lanes.length === 1) locked.add(lanes[0]);
    }
    return locked;
  }

  function passesLockedLaneRule(mlid: number, action: (DraftAction & { limit: number }) | null) {
    if (!action || action.type !== "pick") return true;
    const locked = lockedNonFlexLanesForSide(action.side);
    if (locked.size === 0) return true;
    const lanes = fallbackRolePool.get(mlid) ?? [];
    if (lanes.length === 0) return true;
    return !lanes.every((lane) => locked.has(lane));
  }

  function recommendationPriority(baseScore: number, coverageCount: number, flexCount: number) {
    const flexBonus = Math.max(0, flexCount - 1) * 0.05;
    if (recommendationFocus === "meta") {
      return baseScore * 1.2 + coverageCount * 0.08 + flexBonus * 0.6;
    }
    if (recommendationFocus === "coverage") {
      return baseScore * 0.9 + coverageCount * 0.35 + flexBonus;
    }
    return baseScore + coverageCount * 0.2 + flexBonus * 0.8;
  }

  function rankRecommendations(rows: RecommendationRow[]): RankedRecommendation[] {
    return rows
      .map((row) => {
        const lanes = fallbackRolePool.get(row.mlid) ?? [];
        const coverageLanes =
          currentAction?.type === "pick" ? lanes.filter((lane) => currentMissingRoles.includes(lane)) : [];
        const priority = recommendationPriority(row.score, coverageLanes.length, lanes.length);
        const fitReason =
          currentAction?.type === "ban"
            ? "High impact ban target."
            : coverageLanes.length > 0
              ? `Covers ${coverageLanes.map((lane) => laneLabel(lane)).join(", ")}`
              : currentMissingRoles.length > 0
                ? "Does not cover current missing lanes."
                : "Good flex/comfort candidate.";

        return {
          ...row,
          priority,
          coverageLanes,
          flexCount: lanes.length,
          fitReason
        };
      })
      .sort((a, b) => b.priority - a.priority);
  }

  function snapshotState(): DebugSnapshot {
    return {
      mode,
      turnIndex,
      actionProgress,
      action: currentAction ? `${currentAction.side}:${currentAction.type}:${currentAction.limit}` : "complete",
      allySlots: allySlotMlids.slice(),
      enemySlots: enemySlotMlids.slice(),
      allyBans: bansOf("ally"),
      enemyBans: bansOf("enemy"),
      allyPickCount: picksOf("ally").length,
      enemyPickCount: picksOf("enemy").length
    };
  }

  function addDebug(event: string, detail?: unknown) {
    const stamp = new Date().toISOString();
    const detailText = detail ? ` | ${JSON.stringify(detail)}` : "";
    debugLogs = [...debugLogs, `${stamp} | ${event}${detailText}`].slice(-220);
  }

  function listFor(action: Pick<DraftAction, "type" | "side">): number[] {
    if (action.type === "pick") {
      return picksOf(action.side);
    }
    return bansOf(action.side);
  }

  function assignList(action: Pick<DraftAction, "type" | "side">, next: number[]) {
    const limit = action.type === "pick" ? MAX_PICKS : MAX_BANS;
    const normalized = normalizeMlids(next, limit);
    if (action.type === "pick") {
      const filled = new Array<number | null>(MAX_PICKS).fill(null);
      normalized.forEach((mlid, index) => {
        if (index < MAX_PICKS) filled[index] = mlid;
      });
      if (action.side === "ally") allySlotMlids = filled;
      else enemySlotMlids = filled;
      return;
    }
    if (action.side === "ally") allyBans = normalized;
    else enemyBans = normalized;
  }

  function appendPick(side: "ally" | "enemy", mlid: number) {
    const source = side === "ally" ? allySlotMlids.slice() : enemySlotMlids.slice();
    const emptyIndex = source.findIndex((slot) => !slot);
    if (emptyIndex < 0) return false;
    source[emptyIndex] = mlid;
    if (side === "ally") allySlotMlids = source;
    else enemySlotMlids = source;
    return true;
  }

  function limitFor(action: DraftAction, progress: number) {
    const current = listFor(action).length;
    const max = action.type === "pick" ? MAX_PICKS : MAX_BANS;
    const remaining = Math.max(max - current + progress, 0);
    return Math.min(action.count, remaining);
  }

  function computeActionState(startIndex: number, startProgress: number) {
    let idx = startIndex;
    let progress = startProgress;

    while (idx < sequence.length) {
      const action = sequence[idx];
      const limit = limitFor(action, progress);
      if (limit <= 0 || progress >= limit) {
        idx += 1;
        progress = 0;
        continue;
      }
      return { idx, progress, action: { ...action, limit } as DraftAction & { limit: number } };
    }

    return { idx, progress, action: null as (DraftAction & { limit: number }) | null };
  }

  function normalizeTurnState() {
    const normalized = computeActionState(turnIndex, actionProgress);
    if (normalized.idx !== turnIndex || normalized.progress !== actionProgress) {
      turnIndex = normalized.idx;
      actionProgress = normalized.progress;
    }
  }

  function fallbackAssignment(rawSlots: Array<number | null>) {
    const picks = normalizeMlids(rawSlots, MAX_PICKS);
    const assignment: Partial<Record<DraftLane, number>> = {};
    picks.forEach((mlid, index) => {
      const lane = SLOT_LANES[index];
      if (!lane) return;
      assignment[lane] = mlid;
    });
    return assignment;
  }

  function buildSlots(
    side: "ally" | "enemy",
    rawSlots: Array<number | null>,
    action: (DraftAction & { limit: number }) | null,
    teamFeasibility: DraftFeasibilityResult
  ): SlotView[] {
    const assignment = Object.keys(teamFeasibility.assignment ?? {}).length
      ? teamFeasibility.assignment
      : fallbackAssignment(rawSlots);

    const nextTargetLane =
      action?.type === "pick" && action.side === side
        ? teamFeasibility.missingRoles[0] ?? SLOT_LANES.find((lane) => !assignment[lane]) ?? null
        : null;

    return SLOT_LANES.map((lane) => {
      const mlid = normalizeMlid(assignment[lane]) ?? null;
      let state: SlotState = "open";

      if (mlid) {
        state = "locked";
      } else if (nextTargetLane === lane) {
        state = "target";
      }

      return { lane, label: laneLabel(lane), mlid, state };
    });
  }

  function turnHint(action: (DraftAction & { limit: number }) | null) {
    if (!action) return "All pick and ban phases are completed.";
    if (action.type === "pick") return "Choose a hero from recommendations or from the full hero list below.";
    return "Ban high-impact threats to reduce enemy draft options.";
  }

  async function analyze() {
    loading = !hasLoadedOnce;
    error = "";
    const requestBody = {
      timeframe: mode === "ranked" ? timeframe : "7d",
      rankScope: mode === "ranked" ? rankScope : "mythic_glory",
      mode,
      allyMlids: picksOf("ally"),
      enemyMlids: picksOf("enemy"),
      allyBans: bansOf("ally"),
      enemyBans: bansOf("enemy"),
      turnType: currentAction?.type ?? "pick",
      turnSide: currentAction?.side ?? "ally"
    };

    addDebug("analyze-start", {
      timeframe: requestBody.timeframe,
      rankScope: requestBody.rankScope,
      allyMlids: requestBody.allyMlids,
      enemyMlids: requestBody.enemyMlids,
      allyBans: requestBody.allyBans,
      enemyBans: requestBody.enemyBans
    });

    try {
      const [analyzeResponse, feasibilityResponse] = await Promise.all([
        fetch(apiUrl("/draft/analyze"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody)
        }),
        fetch(apiUrl("/draft/feasibility"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            allyMlids: requestBody.allyMlids,
            enemyMlids: requestBody.enemyMlids
          })
        })
      ]);

      const [analyzeJson, feasibilityJson] = await Promise.all([analyzeResponse.json(), feasibilityResponse.json()]);
      if (!analyzeResponse.ok) {
        throw new Error(analyzeJson?.message ?? analyzeJson?.detail ?? `HTTP ${analyzeResponse.status}`);
      }
      if (!feasibilityResponse.ok) {
        throw new Error(feasibilityJson?.message ?? feasibilityJson?.detail ?? `HTTP ${feasibilityResponse.status}`);
      }

      payload = analyzeJson;
      feasibility = feasibilityJson as FeasibilityPayload;
      hasLoadedOnce = true;
      addDebug("analyze-success", {
        recPicks: analyzeJson?.recommendedPicks?.length ?? 0,
        recBans: analyzeJson?.recommendedBans?.length ?? 0
      });
      addDebug("feasibility-success", {
        allyMatched: feasibilityJson?.ally?.matchedCount ?? 0,
        enemyMatched: feasibilityJson?.enemy?.matchedCount ?? 0
      });
    } catch (e) {
      error = `Failed to load draft recommendations: ${String(e)}`;
      payload = null;
      feasibility = {
        ally: evaluateDraftFeasibility(requestBody.allyMlids, fallbackRolePool),
        enemy: evaluateDraftFeasibility(requestBody.enemyMlids, fallbackRolePool)
      };
      addDebug("analyze-error", { message: String(e) });
    } finally {
      loading = false;
    }
  }

  async function analyzeMatchup() {
    if (!canAnalyze) {
      addDebug("matchup-skip-not-ready", snapshotState());
      return;
    }
    matchupLoading = true;
    matchupError = "";
    addDebug("matchup-start", {
      timeframe: mode === "ranked" ? timeframe : "7d",
      rankScope: mode === "ranked" ? rankScope : "mythic_glory",
      allyMlids: picksOf("ally"),
      enemyMlids: picksOf("enemy")
    });

    try {
      const response = await fetch(apiUrl("/draft/matchup"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeframe: mode === "ranked" ? timeframe : "7d",
          rankScope: mode === "ranked" ? rankScope : "mythic_glory",
          allyMlids: picksOf("ally"),
          enemyMlids: picksOf("enemy")
        })
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.message ?? json?.detail ?? `HTTP ${response.status}`);
      }

      matchup = json as MatchupResult;
      addDebug("matchup-success", json);
    } catch (e) {
      matchupError = `Failed to analyze matchup: ${String(e)}`;
      matchup = null;
      addDebug("matchup-error", { message: String(e) });
    } finally {
      matchupLoading = false;
    }
  }

  async function applyHero(mlid: number) {
    if (actionBusy) return;
    const pickedMlid = normalizeMlid(mlid);
    if (!pickedMlid) {
      error = "Invalid hero ID.";
      addDebug("apply-hero-reject-invalid-id", { mlid });
      return;
    }

    const guard = actionStateFor(pickedMlid, { ignoreBusy: true });
    if (guard.disabled) {
      error = guard.reason ?? "Hero cannot be selected right now.";
      addDebug("apply-hero-reject-guard", { mlid: pickedMlid, reason: guard.reason, snapshot: snapshotState() });
      return;
    }

    actionBusy = true;

    try {
      addDebug("apply-hero-request", { mlid: pickedMlid, snapshot: snapshotState() });
      const state = computeActionState(turnIndex, actionProgress);
      const action = state.action;

      if (!action) {
        error = "Draft is already complete.";
        addDebug("apply-hero-reject-complete");
        return;
      }

      if (takenSet().has(pickedMlid)) {
        error = "Hero is already picked or banned.";
        addDebug("apply-hero-reject-occupied", { mlid: pickedMlid });
        return;
      }

      const currentList = listFor(action);
      const max = action.type === "pick" ? MAX_PICKS : MAX_BANS;
      if (currentList.length >= max) {
        error = `No more ${action.type} slots for ${sideLabel(action.side)}.`;
        addDebug("apply-hero-reject-no-slot", { action, current: currentList.length, max });
        return;
      }

      if (action.type === "pick") {
        const appended = appendPick(action.side, pickedMlid);
        if (!appended) {
          error = `No more ${action.type} slots for ${sideLabel(action.side)}.`;
          addDebug("apply-hero-reject-append-failed", { side: action.side, mlid: pickedMlid, slots: snapshotState() });
          return;
        }
      } else {
        assignList(action, [...currentList, pickedMlid]);
      }
      const nextProgress = actionProgress + 1;
      if (nextProgress >= action.limit) {
        turnIndex = state.idx + 1;
        actionProgress = 0;
      } else {
        turnIndex = state.idx;
        actionProgress = nextProgress;
      }

      normalizeTurnState();
      error = "";
      matchup = null;
      matchupError = "";
      autoAnalyzed = false;
      addDebug("apply-hero-success", { mlid: pickedMlid, snapshot: snapshotState() });
      void analyze();
    } finally {
      actionBusy = false;
    }
  }

  async function resetDraft(reload = true) {
    turnIndex = 0;
    actionProgress = 0;
    allySlotMlids = [null, null, null, null, null];
    enemySlotMlids = [null, null, null, null, null];
    allyBans = [];
    enemyBans = [];
    poolRoleFilter = "";
    poolLaneFilter = "";
    payload = null;
    feasibility = null;
    error = "";
    matchup = null;
    matchupError = "";
    autoAnalyzed = false;
    normalizeTurnState();
    addDebug("reset-draft", snapshotState());
    if (reload) await analyze();
  }

  async function setMode(nextMode: DraftMode) {
    if (mode === nextMode) return;
    mode = nextMode;
    if (mode === "ranked") {
      timeframe = "7d";
      rankScope = "mythic_glory";
    }
    await resetDraft(true);
  }

  async function setTimeframe(nextTimeframe: string) {
    timeframe = nextTimeframe;
    await resetDraft(true);
  }

  async function setRankScope(nextRankScope: string) {
    rankScope = nextRankScope;
    await resetDraft(true);
  }
</script>

<h1 class="page-title">Draft Master</h1>
<p class="page-subtitle">Live drafting assistant with Liquipedia-style composition, tuned for ranked and tournament flows.</p>

<section class="draft-master">
  <div class="draft-head">
    <h2>Draft Assistant</h2>
    <p>Real-time pick/ban helper with phase tracking, role-safe slots, and contextual recommendations.</p>
  </div>

  <div class="draft-toolbar">
    <div class="toolbar-card">
      {#if mode === "ranked"}
        <label class="field">
          <span class="field-label">Timeframe</span>
          <select value={timeframe} on:change={(e) => void setTimeframe((e.currentTarget as HTMLSelectElement).value)}>
            {#each TIMEFRAMES as tf}
              <option value={tf}>{timeframeLabel(tf)}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span class="field-label">Rank Scope</span>
          <select value={rankScope} on:change={(e) => void setRankScope((e.currentTarget as HTMLSelectElement).value)}>
            {#each RANK_SCOPES as scope}
              <option value={scope}>{rankScopeLabel(scope)}</option>
            {/each}
          </select>
        </label>
      {:else}
        <div class="field">
          <span class="field-label">Dataset</span>
          <div class="pill-info">Tournament mode uses default 7 days and Mythical Glory+ scope.</div>
        </div>
      {/if}
    </div>

    <div class="toolbar-card">
      <span class="field-label">Mode</span>
      <div class="mode-switch">
        <button class:active={mode === "ranked"} class="mode-btn" on:click={() => void setMode("ranked")}>Ranked</button>
        <button class:active={mode === "tournament"} class="mode-btn" on:click={() => void setMode("tournament")}>Tournament</button>
      </div>
    </div>

    <div class="toolbar-card action-field">
      <span class="field-label">Action</span>
      <button class="btn-danger" on:click={() => void resetDraft(true)}>Clear Matchup</button>
    </div>
  </div>

  <div class="draft-grid">
    <aside class="team-panel ally-side">
      <div class="panel-title">
        <h3>Ally Team</h3>
        <span>{allyPickCount}/{MAX_PICKS}</span>
      </div>

      <div class="role-indicators">
        {#each allySlots as slot}
          <span class="role-chip {slot.state}">{slot.label}</span>
        {/each}
      </div>

      <div class="slot-list">
        {#each allySlots as slot}
          <div class="slot-item {slot.mlid ? 'filled' : 'empty'} {slot.state === 'target' ? 'target-slot' : ''}">
            <div class="slot-head">
              <strong>{slot.label}</strong>
              <em class="slot-state {slot.state}">
                {#if slot.mlid}
                  LOCKED
                {:else if slot.state === "target"}
                  NEXT PICK
                {:else}
                  OPEN
                {/if}
              </em>
            </div>
            {#if slot.mlid}
              <span class="slot-hero">
                <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={24} />
                {heroName(slot.mlid)}
              </span>
            {:else}
              <span>Empty slot</span>
            {/if}
          </div>
        {/each}
      </div>
      {#if allyFeasibility.unassignedHeroes.length > 0}
        <p class="slot-warning">Flex unresolved: {allyFeasibility.unassignedHeroes.map((mlid) => heroName(mlid)).join(", ")}</p>
      {/if}

      <div class="sub-title">Bans</div>
      <div class="ban-list">
        {#if allyBans.length === 0}
          <span class="ban-chip empty">No bans yet</span>
        {:else}
          {#each allyBans as mlid}
            <span class="ban-chip">
              <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={18} />
              <em>{heroName(mlid)}</em>
            </span>
          {/each}
        {/if}
      </div>
    </aside>

    <section class="draft-center">
      <div class="turn-card" class:turn-card-ban-ally={isAllyBanTurn}>
        <p class="turn-label">
          {#if currentAction}
            {sideLabelFull(currentAction.side)} {currentAction.type.toUpperCase()} TURN
          {:else}
            Draft Complete
          {/if}
        </p>
        <p class="turn-hint">{turnHint(currentAction)}</p>
        {#if currentAction}
          <p class="turn-progress">{currentAction.text} ({actionProgress}/{currentAction.limit})</p>
        {/if}
        {#if coverageHint}
          <p class="turn-meta">{coverageHint}</p>
        {/if}
        {#if currentAction?.type === "pick"}
          <div class="focus-wrap">
            <div class="focus-switch" role="group" aria-label="Recommendation focus">
              <button
                class="focus-btn"
                class:active={recommendationFocus === "balanced"}
                on:click={() => (recommendationFocus = "balanced")}
              >
                Balanced
                <span class="focus-tip">Mix counter value, lane coverage, and stability.</span>
              </button>
              <button
                class="focus-btn"
                class:active={recommendationFocus === "meta"}
                on:click={() => (recommendationFocus = "meta")}
              >
                Meta First
                <span class="focus-tip">Push top win-rate and top-tier picks first.</span>
              </button>
              <button
                class="focus-btn"
                class:active={recommendationFocus === "coverage"}
                on:click={() => (recommendationFocus = "coverage")}
              >
                Role Coverage
                <span class="focus-tip">Prioritize heroes that fill uncovered lanes.</span>
              </button>
            </div>
            <p class="focus-desc">{focusModeHint}</p>
          </div>
        {/if}
      </div>

      {#if currentAction}
        <div class="recommend-wrap {actionableRecommendations.length === 0 && !loading ? 'is-hidden' : ''}">
          <h3>Recommended for Current Turn</h3>
          {#if loading}
            <Skeleton height="180px" />
          {:else}
            <div class="recommend-list">
              {#each actionableRecommendations as row}
                {@const recommendationState = actionStateFor(row.mlid)}
                <button
                  class="rec-card"
                  disabled={recommendationState.disabled}
                  on:click={() => void applyHero(row.mlid)}
                >
                  <div class="rec-main">
                    <div class="rec-hero">
                      <span class="rec-avatar-wrap">
                        <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={34} />
                        <span class="rec-tooltip">
                          <strong>Why this hero</strong>
                          <span>{row.fitReason}</span>
                          {#if row.reasons?.[0]}
                            <span>{row.reasons[0]}</span>
                          {/if}
                          {#if row.breakdown}
                            <span>
                              {currentAction?.type === "ban" ? "Deny" : "Counter"} {metricPercent(
                                currentAction?.type === "ban" ? row.breakdown.denyValue : row.breakdown.counterImpact
                              )}% | Tier {metricPercent(row.breakdown.tierPower)}% | Coverage {metricPercent(
                                row.breakdown.laneCoverage
                              )}% | Flex {metricPercent(row.breakdown.flexValue)}%
                            </span>
                          {/if}
                          {#if currentAction?.type === "pick" && row.preview}
                            <span>Before: {laneListText(row.preview.beforeMissingRoles)}</span>
                            <span>After: {laneListText(row.preview.afterMissingRoles)}</span>
                            {#if row.preview.newlyCoveredRoles.length > 0}
                              <span>New: {laneListText(row.preview.newlyCoveredRoles)}</span>
                            {/if}
                          {/if}
                        </span>
                      </span>
                      <div class="rec-hero-meta">
                        <div class="rec-title-row">
                          <strong>{heroName(row.mlid)}</strong>
                          {#if heroRoleIcon(row.mlid)}
                            <span class="rec-role-dot" title={heroRoleText(row.mlid)}>
                              <img src={heroRoleIcon(row.mlid)} alt={heroRoleText(row.mlid)} loading="lazy" />
                            </span>
                          {/if}
                        </div>
                        <span>{heroRoleText(row.mlid)}</span>
                      </div>
                    </div>
                    <div class="rec-pill-stack">
                      <span class="tier-pill">Tier {tierLabel(row.score, row.tier)}</span>
                      {#if currentAction?.type === "pick"}
                        <span class="priority-pill">Priority {row.priority.toFixed(2)}</span>
                      {/if}
                    </div>
                  </div>
                  <div class="rec-foot">
                    <div class="rec-lanes">
                      {#each heroLaneLabels(row.mlid) as lane}
                        <span class="rec-lane-chip">{lane}</span>
                      {/each}
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="pool-wrap">
          <div class="pool-head">
            <h3>All Heroes</h3>
            <div class="pool-filters">
              <label>
                <span>Role</span>
                <select bind:value={poolRoleFilter}>
                  <option value="">All</option>
                  {#each ROLES as role}
                    <option value={role}>{roleLabel(role)}</option>
                  {/each}
                </select>
              </label>
              <label>
                <span>Lane</span>
                <select bind:value={poolLaneFilter}>
                  <option value="">All</option>
                  {#each LANES as lane}
                    <option value={lane}>{laneLabel(lane)}</option>
                  {/each}
                </select>
              </label>
            </div>
          </div>
          <p class="pool-helper">Role/Lane filter narrows hero list. Disabled heroes are already used or invalid for this turn.</p>
          <div class="pool-grid">
            {#each heroPoolRows as row}
              <button
                class="pool-card"
                disabled={row.state.disabled}
                title={row.state.reason ?? ""}
                on:click={() => void applyHero(row.hero.mlid)}
              >
                <HeroAvatar name={row.hero.name} imageKey={row.hero.imageKey} size={32} />
                <span>{row.hero.name}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <p class="draft-complete-hint">Draft complete. Focus on matchup analysis below.</p>
      {/if}

      <section
        class="analysis-card"
        class:analysis-focus={!currentAction}
        class:analysis-centered={!currentAction}
        class:analysis-winner-ally={analysisWinner === "ally"}
        class:analysis-winner-enemy={analysisWinner === "enemy"}
      >
        <div class="analysis-head">
          <h3>{analysisHeadline}</h3>
          {#if !hideAnalyzeButton}
            <button class="btn-action" disabled={matchupLoading || !canAnalyze} on:click={() => void analyzeMatchup()}>
              {matchupLoading ? "Analyzing..." : "Analyze Matchup"}
            </button>
          {/if}
        </div>

        {#if !canAnalyze}
          <p class="analysis-hint">Need full picks first: Ally {allyPickCount}/5, Enemy {enemyPickCount}/5.</p>
        {/if}

        {#if matchupError}
          <p class="analysis-error">{matchupError}</p>
        {/if}

        {#if matchup}
          <div class="analysis-grid">
            <article class="analysis-team ally">
              <strong>Ally Team Score: {matchup.allyScore.toFixed(1)}</strong>
              <div class="analysis-avatars">
                {#each allyPicks as mlid}
                  <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={34} />
                {/each}
              </div>
              <div class="metric">
                <div class="metric-head">
                  <span>Overall Score</span>
                  <span>{matchup.allyScore.toFixed(1)}</span>
                </div>
                <div class="metric-bar"><span style={`width:${allyScorePct}%`}></span></div>
              </div>
              <div class="metric">
                <div class="metric-head">
                  <span>Counter Edge</span>
                  <span>{matchup.components.allyCounterEdge.toFixed(2)}</span>
                </div>
                <div class="metric-bar alt"><span style={`width:${Math.min(100, Math.max(8, matchup.allyWinProb))}%`}></span></div>
              </div>
              <p class="analysis-prob">Win Probability: {matchup.allyWinProb.toFixed(1)}%</p>
              {#if matchup.details?.ally}
                <div class="analysis-extra">
                  <p class="analysis-extra-line"><strong>Covered:</strong> {laneListText(matchup.details.ally.coveredLanes)}</p>
                  <p class="analysis-extra-line"><strong>Missing:</strong> {laneListText(matchup.details.ally.missingLanes)}</p>
                  <p class="analysis-extra-line"><strong>Tier Mix:</strong> {tierCountsText(matchup.details.ally.tierCounts)}</p>
                  {#if matchup.details.ally.topCounterPairs.length > 0}
                    <div class="analysis-pairs">
                      {#each matchup.details.ally.topCounterPairs as pair}
                        <span>
                          {heroName(pair.counterMlid)} vs {heroName(pair.enemyMlid)} ({pair.score.toFixed(2)})
                        </span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </article>
            <article class="analysis-team enemy">
              <strong>Enemy Team Score: {matchup.enemyScore.toFixed(1)}</strong>
              <div class="analysis-avatars">
                {#each enemyPicks as mlid}
                  <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={34} />
                {/each}
              </div>
              <div class="metric">
                <div class="metric-head">
                  <span>Overall Score</span>
                  <span>{matchup.enemyScore.toFixed(1)}</span>
                </div>
                <div class="metric-bar enemy"><span style={`width:${enemyScorePct}%`}></span></div>
              </div>
              <div class="metric">
                <div class="metric-head">
                  <span>Counter Edge</span>
                  <span>{matchup.components.enemyCounterEdge.toFixed(2)}</span>
                </div>
                <div class="metric-bar alt enemy"><span style={`width:${Math.min(100, Math.max(8, matchup.enemyWinProb))}%`}></span></div>
              </div>
              <p class="analysis-prob">Win Probability: {matchup.enemyWinProb.toFixed(1)}%</p>
              {#if matchup.details?.enemy}
                <div class="analysis-extra">
                  <p class="analysis-extra-line"><strong>Covered:</strong> {laneListText(matchup.details.enemy.coveredLanes)}</p>
                  <p class="analysis-extra-line"><strong>Missing:</strong> {laneListText(matchup.details.enemy.missingLanes)}</p>
                  <p class="analysis-extra-line"><strong>Tier Mix:</strong> {tierCountsText(matchup.details.enemy.tierCounts)}</p>
                  {#if matchup.details.enemy.topCounterPairs.length > 0}
                    <div class="analysis-pairs">
                      {#each matchup.details.enemy.topCounterPairs as pair}
                        <span>
                          {heroName(pair.counterMlid)} vs {heroName(pair.enemyMlid)} ({pair.score.toFixed(2)})
                        </span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </article>
          </div>
          <p class="analysis-verdict">{matchup.verdict}</p>
          {#if matchup.details?.keyFactors?.length}
            <div class="analysis-key-factors">
              <h4>Key Factors Analysis</h4>
              {#each matchup.details.keyFactors as factor}
                <p>{factor}</p>
              {/each}
            </div>
          {/if}
        {/if}
      </section>

    </section>

    <aside class="team-panel enemy-side">
      <div class="panel-title">
        <h3>Enemy Team</h3>
        <span>{enemyPickCount}/{MAX_PICKS}</span>
      </div>

      <div class="role-indicators">
        {#each enemySlots as slot}
          <span class="role-chip {slot.state}">{slot.label}</span>
        {/each}
      </div>

      <div class="slot-list">
        {#each enemySlots as slot}
          <div class="slot-item {slot.mlid ? 'filled' : 'empty'} {slot.state === 'target' ? 'target-slot' : ''}">
            <div class="slot-head">
              <strong>{slot.label}</strong>
              <em class="slot-state {slot.state}">
                {#if slot.mlid}
                  LOCKED
                {:else if slot.state === "target"}
                  NEXT PICK
                {:else}
                  OPEN
                {/if}
              </em>
            </div>
            {#if slot.mlid}
              <span class="slot-hero">
                <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={24} />
                {heroName(slot.mlid)}
              </span>
            {:else}
              <span>Empty slot</span>
            {/if}
          </div>
        {/each}
      </div>
      {#if enemyFeasibility.unassignedHeroes.length > 0}
        <p class="slot-warning">Flex unresolved: {enemyFeasibility.unassignedHeroes.map((mlid) => heroName(mlid)).join(", ")}</p>
      {/if}

      <div class="sub-title">Bans</div>
      <div class="ban-list">
        {#if enemyBans.length === 0}
          <span class="ban-chip empty">No bans yet</span>
        {:else}
          {#each enemyBans as mlid}
            <span class="ban-chip">
              <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={18} />
              <em>{heroName(mlid)}</em>
            </span>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
</section>

<style>
  .draft-master {
    margin: 8px 0 24px;
    border: 1px solid rgba(128, 174, 243, 0.16);
    border-radius: 26px;
    padding: 16px;
    background: rgba(16, 30, 54, 0.66);
    box-shadow: inset 0 1px 0 rgba(209, 232, 255, 0.05), 0 18px 40px rgba(0, 0, 0, 0.24);
    backdrop-filter: blur(8px);
  }

  .draft-head h2 {
    margin: 0;
    letter-spacing: 0.4px;
    font-size: 1.2rem;
  }

  .draft-head p {
    margin: 8px 0 14px;
    color: #97acd0;
    font-size: 0.88rem;
  }

  .draft-toolbar {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr) 250px;
    gap: 12px;
    margin-bottom: 12px;
  }

  .toolbar-card {
    border: 1px solid rgba(132, 176, 244, 0.18);
    border-radius: 18px;
    padding: 10px;
    background: rgba(17, 31, 56, 0.64);
    box-shadow: inset 0 1px 0 rgba(205, 228, 255, 0.04);
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .field-label {
    font-size: 0.72rem;
    color: #9cb1d3;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .field select {
    width: 100%;
    min-width: 0;
    background: rgba(20, 37, 62, 0.8);
    border: 1px solid rgba(129, 172, 239, 0.24);
    border-radius: 12px;
    color: #d9e8ff;
    padding: 8px 10px;
    font-size: 0.88rem;
  }

  .pill-info {
    border: 1px solid rgba(129, 172, 239, 0.2);
    border-radius: 12px;
    background: rgba(20, 37, 62, 0.72);
    color: #c4d7f5;
    padding: 9px 10px;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .mode-switch {
    display: inline-flex;
    width: 100%;
    gap: 6px;
    min-height: 39px;
    padding: 2px;
    border-radius: 12px;
    border: 1px solid rgba(129, 172, 239, 0.22);
    background: rgba(16, 29, 52, 0.74);
  }

  .mode-btn {
    flex: 1 1 0;
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 8px 8px;
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1;
    color: #9eb5d8;
    background: transparent;
    white-space: nowrap;
  }

  .mode-btn.active {
    border-color: rgba(116, 190, 255, 0.35);
    background: rgba(44, 84, 131, 0.5);
    color: #e0efff;
  }

  .btn-action,
  .btn-muted,
  .btn-danger {
    border: 0;
    border-radius: 10px;
    padding: 8px 10px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-action {
    background: rgba(58, 130, 246, 0.84);
    color: #eff6ff;
  }

  .btn-muted {
    background: rgba(41, 63, 106, 0.82);
    color: #d4e1ff;
  }

  .btn-danger {
    background: rgba(145, 48, 61, 0.78);
    color: #ffe0e3;
    height: 39px;
  }

  .action-field button {
    width: 100%;
    min-height: 39px;
  }

  .btn-action:disabled,
  .btn-muted:disabled,
  .rec-card:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .draft-grid {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr) 250px;
    gap: 12px;
  }

  .team-panel {
    border: 1px solid rgba(132, 176, 244, 0.18);
    border-radius: 18px;
    padding: 12px;
    background: rgba(18, 33, 58, 0.64);
    box-shadow: inset 0 1px 0 rgba(206, 230, 255, 0.04);
  }

  .ally-side {
    border-color: rgba(64, 133, 255, 0.55);
  }

  .enemy-side {
    border-color: rgba(255, 92, 122, 0.36);
  }

  .panel-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .panel-title h3 {
    margin: 0;
    font-size: 1.02rem;
  }

  .panel-title span {
    font-size: 1.45rem;
    font-weight: 900;
  }

  .role-indicators {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .role-chip {
    border-radius: 999px;
    border: 1px solid rgba(64, 102, 164, 0.62);
    padding: 3px 8px;
    font-size: 0.64rem;
    color: #8fa3cf;
    background: rgba(8, 19, 45, 0.88);
  }

  .role-chip.open {
    border-color: #2f4b88;
    color: #7e9bd3;
  }

  .role-chip.locked {
    border-color: #2dd4bf;
    color: #b6fff4;
  }

  .role-chip.target {
    border-color: #22c55e;
    color: #bbf7d0;
    box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.25);
    animation: pulse-green 1.1s ease-in-out infinite;
  }

  .slot-list {
    display: grid;
    gap: 8px;
  }

  .slot-warning {
    margin: 8px 0 2px;
    font-size: 0.72rem;
    color: #fbbf24;
  }

  .slot-item {
    border: 1px dashed rgba(64, 102, 164, 0.62);
    border-radius: 9px;
    padding: 8px 10px;
    display: grid;
    gap: 3px;
  }

  .slot-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .slot-item strong {
    color: #7fb5ff;
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .slot-state {
    font-size: 0.59rem;
    font-style: normal;
    border-radius: 999px;
    padding: 2px 7px;
    letter-spacing: 0.4px;
  }

  .slot-state.open {
    color: #87a2d6;
    border: 1px solid #2f4b88;
  }

  .slot-state.locked {
    color: #b3fff0;
    border: 1px solid #2dd4bf;
  }

  .slot-state.target {
    color: #c8ffd9;
    border: 1px solid #22c55e;
    background: rgba(34, 197, 94, 0.14);
  }

  .slot-item span {
    color: #dbe9ff;
    font-size: 0.8rem;
  }

  .slot-item.empty span {
    color: #5e7bb8;
  }

  .slot-item.filled {
    border-style: solid;
  }

  .slot-item.target-slot {
    border-style: solid;
    border-color: #22c55e;
    box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.3), 0 0 18px rgba(34, 197, 94, 0.2);
    animation: pulse-green 1.1s ease-in-out infinite;
  }

  .slot-hero {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .sub-title {
    margin: 10px 0 8px;
    color: #97acd0;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .ban-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ban-chip {
    border: 1px solid rgba(255, 122, 145, 0.5);
    border-radius: 999px;
    padding: 4px 8px 4px 5px;
    font-size: 0.72rem;
    color: #ffbeca;
    background: rgba(36, 15, 28, 0.6);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .ban-chip em {
    font-style: normal;
  }

  .ban-chip.empty {
    border-color: rgba(64, 102, 164, 0.62);
    color: #9cb1d3;
    background: rgba(8, 19, 45, 0.62);
  }

  .draft-center {
    border: 1px solid rgba(132, 176, 244, 0.18);
    border-radius: 18px;
    padding: 12px;
    background: rgba(17, 31, 56, 0.66);
    box-shadow: inset 0 1px 0 rgba(206, 230, 255, 0.04);
    min-width: 0;
  }

  .turn-card {
    border: 1px solid rgba(129, 172, 239, 0.24);
    border-radius: 14px;
    padding: 10px;
    margin-bottom: 10px;
    background: rgba(19, 35, 61, 0.72);
  }

  .turn-card.turn-card-ban-ally {
    border-color: rgba(74, 222, 128, 0.35);
    background: linear-gradient(145deg, rgba(30, 73, 52, 0.56), rgba(20, 37, 62, 0.75));
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.2), inset 0 1px 0 rgba(187, 247, 208, 0.08);
  }

  .turn-label {
    margin: 0;
    font-weight: 900;
    color: #d4e6ff;
    font-size: 0.96rem;
  }

  .turn-hint {
    margin: 6px 0;
    color: #97acd0;
    font-size: 0.82rem;
  }

  .turn-progress {
    margin: 0;
    color: #90bfff;
    font-size: 0.76rem;
  }

  .turn-meta {
    margin: 4px 0 0;
    color: #b8cdf2;
    font-size: 0.74rem;
  }

  .focus-wrap {
    margin-top: 8px;
    display: grid;
    justify-items: center;
    gap: 6px;
  }

  .focus-switch {
    display: inline-flex;
    gap: 6px;
    border: 1px solid rgba(129, 172, 239, 0.24);
    border-radius: 999px;
    padding: 3px;
    background: rgba(16, 29, 52, 0.72);
  }

  .focus-btn {
    position: relative;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: #9cb1d3;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 4px 10px;
    cursor: pointer;
  }

  .focus-btn.active {
    border-color: rgba(116, 190, 255, 0.34);
    background: rgba(44, 84, 131, 0.48);
    color: #e0efff;
  }

  .focus-tip {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translate(-50%, 4px);
    border: 1px solid rgba(101, 137, 196, 0.44);
    border-radius: 8px;
    background: rgba(8, 20, 47, 0.96);
    color: #c9ddff;
    padding: 6px 7px;
    font-size: 0.64rem;
    line-height: 1.25;
    width: 190px;
    text-align: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
    z-index: 20;
    box-shadow: 0 10px 24px rgba(3, 9, 24, 0.5);
  }

  .focus-btn:hover .focus-tip {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .focus-desc {
    margin: 0;
    color: #a8c0df;
    font-size: 0.7rem;
    text-align: center;
    max-width: 480px;
  }

  .turn-warning {
    margin: 8px 0 0;
    color: #fecaca;
    background: rgba(127, 29, 29, 0.3);
    border: 1px solid rgba(248, 113, 113, 0.35);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 0.74rem;
  }

  .recommend-wrap {
    padding-top: 4px;
    margin-bottom: 12px;
  }

  .recommend-wrap.is-hidden {
    display: none;
  }

  .recommend-wrap h3 {
    margin: 0 0 8px;
    padding-left: 2px;
    font-size: 0.92rem;
  }

  .recommend-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 8px;
  }

  .rec-card {
    border: 1px solid rgba(129, 172, 239, 0.2);
    background: rgba(20, 37, 62, 0.78);
    color: var(--text);
    border-radius: 12px;
    text-align: left;
    padding: 9px;
    display: grid;
    gap: 4px;
    cursor: pointer;
  }

  .rec-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .rec-pill-stack {
    display: grid;
    gap: 4px;
    justify-items: end;
    flex-shrink: 0;
  }

  .rec-hero {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .rec-avatar-wrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    border-radius: 999px;
    outline: none;
  }

  .rec-tooltip {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    width: 270px;
    max-width: 56vw;
    border: 1px solid rgba(101, 137, 196, 0.46);
    border-radius: 10px;
    background: rgba(8, 20, 47, 0.96);
    color: #c9ddff;
    padding: 8px 9px;
    font-size: 0.67rem;
    line-height: 1.35;
    display: grid;
    gap: 4px;
    z-index: 30;
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
    box-shadow: 0 10px 26px rgba(3, 9, 24, 0.55);
  }

  .rec-tooltip strong {
    color: #e3f0ff;
    font-size: 0.69rem;
  }

  .rec-avatar-wrap:hover .rec-tooltip,
  .rec-card:focus-visible .rec-tooltip {
    opacity: 1;
    transform: translateY(0);
  }

  .rec-hero-meta {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .rec-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .rec-hero-meta strong {
    font-size: 0.84rem;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rec-hero-meta span {
    font-size: 0.7rem;
    color: #9cb1d3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rec-role-dot {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 1px solid rgba(176, 215, 255, 0.32);
    background: #132840;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .rec-role-dot img {
    width: 11px;
    height: 11px;
    object-fit: contain;
  }

  .tier-pill {
    border-radius: 999px;
    border: 1px solid rgba(119, 210, 156, 0.45);
    background: rgba(21, 72, 53, 0.52);
    color: #b9f3d6;
    padding: 2px 8px;
    font-size: 0.68rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .priority-pill {
    border-radius: 999px;
    border: 1px solid rgba(97, 148, 219, 0.42);
    background: rgba(14, 43, 81, 0.66);
    color: #b8d7ff;
    padding: 2px 8px;
    font-size: 0.62rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .rec-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .rec-lanes {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 0;
  }

  .rec-lane-chip {
    border-radius: 999px;
    border: 1px solid rgba(126, 158, 211, 0.38);
    background: rgba(11, 25, 54, 0.74);
    color: #9cb1d3;
    padding: 2px 7px;
    font-size: 0.62rem;
    white-space: nowrap;
  }

  .rec-card:hover {
    border-color: #60a5fa;
  }

  .pool-wrap {
    border: 1px solid rgba(129, 172, 239, 0.18);
    border-radius: 14px;
    background: rgba(16, 30, 53, 0.6);
    padding: 10px;
    display: grid;
    gap: 10px;
    margin-bottom: 12px;
  }

  .pool-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pool-head h3 {
    margin: 0;
    font-size: 0.88rem;
    color: #d9e8ff;
  }

  .pool-filters {
    display: inline-flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pool-filters label {
    display: grid;
    gap: 3px;
  }

  .pool-filters span {
    font-size: 0.62rem;
    color: #9eb5d8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }

  .pool-filters select {
    min-width: 112px;
    background: rgba(10, 23, 54, 0.85);
    border: 1px solid rgba(79, 118, 182, 0.42);
    border-radius: 8px;
    color: #d8e8ff;
    padding: 5px 8px;
    font-size: 0.72rem;
  }

  .pool-helper {
    margin: -2px 0 0;
    color: #97acd0;
    font-size: 0.68rem;
  }

  .pool-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 6px;
    max-height: 380px;
    overflow: auto;
    padding-right: 2px;
  }

  .pool-card {
    border: 1px solid rgba(79, 118, 182, 0.34);
    border-radius: 8px;
    background: rgba(12, 18, 30, 0.92);
    color: #dce8ff;
    padding: 6px 4px;
    display: grid;
    justify-items: center;
    gap: 4px;
    text-align: center;
    cursor: pointer;
  }

  .pool-card span {
    font-size: 0.58rem;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .pool-card:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .pool-card:not(:disabled):hover {
    border-color: rgba(124, 176, 255, 0.62);
    background: rgba(19, 32, 56, 0.92);
  }

  .draft-complete-hint {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(132, 177, 245, 0.32);
    background: rgba(18, 33, 58, 0.72);
    color: #c6daff;
    font-size: 0.82rem;
  }

  .analysis-card {
    margin-bottom: 12px;
    border: 1px solid rgba(129, 172, 239, 0.2);
    border-radius: 16px;
    padding: 12px;
    background: rgba(18, 33, 58, 0.72);
    display: grid;
    gap: 10px;
    position: relative;
    overflow: hidden;
  }

  .analysis-card::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 160ms ease;
    z-index: 0;
  }

  .analysis-card.analysis-winner-ally::before {
    opacity: 1;
    background: linear-gradient(90deg, rgba(74, 140, 255, 0.34), rgba(74, 140, 255, 0.05) 34%, rgba(0, 0, 0, 0) 62%);
  }

  .analysis-card.analysis-winner-enemy::before {
    opacity: 1;
    background: linear-gradient(270deg, rgba(255, 106, 126, 0.34), rgba(255, 106, 126, 0.05) 34%, rgba(0, 0, 0, 0) 62%);
  }

  .analysis-card > * {
    position: relative;
    z-index: 1;
  }

  .analysis-card.analysis-focus {
    border-color: rgba(119, 162, 231, 0.56);
    box-shadow: 0 0 0 1px rgba(89, 149, 239, 0.24), inset 0 1px 0 rgba(189, 218, 255, 0.07);
  }

  .analysis-card.analysis-centered {
    text-align: center;
  }

  .analysis-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .analysis-head h3 {
    margin: 0;
    font-size: 1.05rem;
    color: #e7f1ff;
  }

  .analysis-centered .analysis-head {
    justify-content: center;
  }

  .analysis-hint {
    margin: 0;
    color: #aec4e1;
    font-size: 0.78rem;
  }

  .analysis-error {
    margin: 0;
    color: #fecaca;
    font-size: 0.76rem;
  }

  .analysis-verdict {
    margin: 0;
    color: #cfe4ff;
    font-size: 0.9rem;
    font-weight: 700;
    text-align: center;
  }

  .analysis-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .analysis-centered .analysis-grid {
    max-width: 1020px;
    margin: 0 auto;
  }

  .analysis-team {
    border: 1px solid rgba(129, 172, 239, 0.2);
    border-radius: 12px;
    background: rgba(17, 31, 56, 0.72);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .analysis-team.ally {
    border-color: rgba(96, 165, 250, 0.5);
  }

  .analysis-team.enemy {
    border-color: rgba(251, 113, 133, 0.45);
  }

  .analysis-team strong {
    font-size: 0.95rem;
    color: #deebff;
    text-align: left;
  }

  .analysis-avatars {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 34px;
    justify-content: flex-start;
  }

  .metric {
    display: grid;
    gap: 5px;
    text-align: left;
  }

  .metric-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    color: #d8e8ff;
    font-size: 0.77rem;
    font-weight: 600;
  }

  .metric-bar {
    width: 100%;
    height: 8px;
    border-radius: 999px;
    background: rgba(124, 152, 194, 0.26);
    overflow: hidden;
  }

  .metric-bar span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(101, 186, 255, 0.95), rgba(110, 168, 255, 0.2));
  }

  .metric-bar.enemy span {
    background: linear-gradient(90deg, rgba(251, 113, 133, 0.95), rgba(251, 113, 133, 0.2));
  }

  .metric-bar.alt span {
    background: linear-gradient(90deg, rgba(94, 234, 212, 0.95), rgba(94, 234, 212, 0.2));
  }

  .metric-bar.alt.enemy span {
    background: linear-gradient(90deg, rgba(253, 186, 116, 0.95), rgba(253, 186, 116, 0.2));
  }

  .analysis-prob {
    margin: 0;
    color: #a8c0df;
    font-size: 0.75rem;
    text-align: left;
  }

  .analysis-extra {
    border-top: 1px solid rgba(93, 119, 160, 0.24);
    padding-top: 7px;
    display: grid;
    gap: 4px;
    text-align: left;
  }

  .analysis-extra-line {
    margin: 0;
    color: #9eb9dc;
    font-size: 0.7rem;
    line-height: 1.35;
  }

  .analysis-extra-line strong {
    font-size: 0.7rem;
    color: #d8e8ff;
    margin-right: 4px;
  }

  .analysis-pairs {
    margin-top: 2px;
    display: grid;
    gap: 3px;
    font-size: 0.67rem;
    color: #86c2ff;
  }

  .analysis-key-factors {
    border: 1px solid rgba(129, 172, 239, 0.18);
    border-radius: 12px;
    background: rgba(18, 33, 58, 0.66);
    padding: 10px;
    display: grid;
    gap: 5px;
    text-align: center;
  }

  .analysis-key-factors h4 {
    margin: 0 0 2px;
    color: #dbe9ff;
    font-size: 0.9rem;
  }

  .analysis-key-factors p {
    margin: 0;
    color: #a8c0df;
    font-size: 0.74rem;
  }

  @keyframes pulse-green {
    0% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.32);
    }
    50% {
      box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.05);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.28);
    }
  }

  @media (max-width: 1200px) {
    .draft-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 980px) {
    .draft-toolbar {
      grid-template-columns: 1fr;
    }

    .analysis-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 620px) {
    .draft-toolbar {
      grid-template-columns: 1fr;
    }
  }
</style>

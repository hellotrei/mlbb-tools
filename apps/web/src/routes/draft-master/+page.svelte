<script lang="ts">
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { buildRolePoolMap, evaluateDraftFeasibility, type DraftFeasibilityResult, type DraftLane } from "@mlbb/shared";
  import { HeroAvatar, Skeleton } from "@mlbb/ui";
  import { apiUrl } from "$lib/api";
  import { LANES, ROLES, RANK_SCOPES, TIMEFRAMES, laneLabel, rankScopeLabel, roleLabel, timeframeLabel } from "$lib/options";
  import { engine, m7Available, m7StatusLoaded, m7StatusReason, mplPhAvailable, mplPhStatusLoaded, mplPhStatusReason } from "$lib/stores/engine";

  type Hero = {
    mlid: number;
    name: string;
    imageKey: string;
    rolePrimary: string;
    roleSecondary?: string | null;
    lanes: string[];
  };

  type DraftMode = "ranked" | "tournament" | "custom";
  type PickOrder = "first" | "second";
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
  type DragPointer = { side: "ally" | "enemy"; index: number };
  type FeasibilityPayload = { ally: DraftFeasibilityResult; enemy: DraftFeasibilityResult };
  type HeroActionState = { disabled: boolean; reason: string | null };
  type RecommendationFocus = "balanced" | "meta" | "coverage";
  type RecommendationPanelKind = "recommended" | "meta" | "counter";
  type PoolFilterMode = "role" | "lane";
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
    synergyValue?: number;
    denialValue?: number;
    protectionValue?: number;
    communitySignal?: number;
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
    pickPhase?: "meta" | "flex" | "counter";
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

  type BestDraftLanePick = {
    lane: DraftLane;
    row: RecommendationRow;
    heroScore: number;
  };
  type MobileRecommendationDetail = {
    kind: RecommendationPanelKind;
    row: RankedRecommendation;
  };
  type DesktopRecommendationPlacement = {
    horizontal: "center" | "left" | "right";
    vertical: "top" | "bottom";
  };
  type DesktopRecommendationPopoverPosition = {
    top: number;
    left: number;
  };
  type RecommendationMetricBar = {
    label: string;
    value: number;
    tone: "tier" | "win" | "flex" | "synergy" | "coverage" | "counter" | "community";
  };

  export let data: {
    timeframe: string;
    rankScope: string;
    heroes: Hero[];
  };

  const MAX_PICKS = 5;
  const MAX_BANS = 5;
  const RECOMMENDATION_MIN = 4;
  const RECOMMENDATION_MAX = 8;
  const DESKTOP_RECOMMENDATION_SKELETON_SLOTS = [0, 1, 2, 3];
  const MOBILE_REC_LOADING_MIN_MS = 150;
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
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "pick", side: "ally", count: 1, text: "Ally team pick 1 hero" },
    { type: "pick", side: "enemy", count: 2, text: "Enemy team pick 2 heroes" },
    { type: "pick", side: "ally", count: 2, text: "Ally team pick 2 heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy team pick 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy team pick 1 hero" },
    { type: "pick", side: "ally", count: 2, text: "Ally team pick 2 heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy team pick 1 hero" }
  ];

  const RANKED_PICK_SEQUENCE: DraftAction[] = [
    { type: "pick", side: "ally", count: 1, text: "Ally pick 1 hero" },
    { type: "pick", side: "enemy", count: 2, text: "Enemy pick 2 heroes" },
    { type: "pick", side: "ally", count: 2, text: "Ally pick 2 heroes" },
    { type: "pick", side: "enemy", count: 2, text: "Enemy pick 2 heroes" },
    { type: "pick", side: "ally", count: 2, text: "Ally pick 2 heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy pick 1 hero" }
  ];

  function isTournamentEngine(eng: string) {
    return eng === "m7" || eng === "mpl_ph";
  }

  function draftEngineLabel(eng: string) {
    if (eng === "m7") return "M7 World Championship";
    if (eng === "mpl_ph") return "MPL PH Regular Season";
    return "Community";
  }

  function swapActionText(text: string): string {
    return text
      .replace(/\bAlly\b/g, "__SIDE_ALLY__")
      .replace(/\bEnemy\b/g, "Ally")
      .replace(/__SIDE_ALLY__/g, "Enemy");
  }

  function applyPickOrderPerspective(actions: DraftAction[], pickOrder: PickOrder | null): DraftAction[] {
    if (pickOrder !== "second") return actions;
    return actions.map((action): DraftAction => ({
      ...action,
      side: action.type === "pick" ? (action.side === "ally" ? "enemy" : "ally") : action.side,
      text: action.type === "pick" ? swapActionText(action.text) : action.text
    }));
  }

  function tournamentSequenceForOrder(pickOrder: PickOrder | null): DraftAction[] {
    return applyPickOrderPerspective(TOURNAMENT_SEQUENCE, pickOrder);
  }

  const CUSTOM_SEQUENCE: DraftAction[] = [
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "pick", side: "ally", count: 1, text: "Ally team pick 1 hero" },
    { type: "pick", side: "enemy", count: 2, text: "Enemy team pick 2 heroes" },
    { type: "pick", side: "ally", count: 2, text: "Ally team pick 2 heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy team pick 1 hero" },
    { type: "ban", side: "enemy", count: 1, text: "Enemy team ban 1 hero" },
    { type: "ban", side: "ally", count: 1, text: "Ally team ban 1 hero" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy team pick 1 hero" },
    { type: "pick", side: "ally", count: 2, text: "Ally team pick 2 heroes" },
    { type: "pick", side: "enemy", count: 1, text: "Enemy team pick 1 hero" }
  ];

  function customSequenceForOrder(pickOrder: PickOrder | null): DraftAction[] {
    return applyPickOrderPerspective(CUSTOM_SEQUENCE, pickOrder);
  }

  function rankedSequenceForScope(scope: string, pickOrder: PickOrder | null): DraftAction[] {
    const applyPerspective = (actions: DraftAction[]) => applyPickOrderPerspective(actions, pickOrder);

    if (scope === "legend") {
      return applyPerspective([
        { type: "ban", side: "ally", count: 4, text: "Ally ban 4 heroes" },
        { type: "ban", side: "enemy", count: 4, text: "Enemy ban 4 heroes" },
        ...RANKED_PICK_SEQUENCE
      ]);
    }

    if (scope === "epic") {
      return applyPerspective([
        { type: "ban", side: "ally", count: 3, text: "Ally ban 3 heroes" },
        { type: "ban", side: "enemy", count: 3, text: "Enemy ban 3 heroes" },
        ...RANKED_PICK_SEQUENCE
      ]);
    }

    return applyPerspective([
      { type: "ban", side: "ally", count: 3, text: "Ally ban 3 heroes" },
      { type: "ban", side: "enemy", count: 3, text: "Enemy ban 3 heroes" },
      { type: "ban", side: "ally", count: 2, text: "Ally ban 2 heroes" },
      { type: "ban", side: "enemy", count: 2, text: "Enemy ban 2 heroes" },
      ...RANKED_PICK_SEQUENCE
    ]);
  }

  let timeframe = data.timeframe ?? "7d";
  let rankScope = data.rankScope ?? "mythic_glory";
  let mode: DraftMode = "ranked";
  let allyPickOrder: PickOrder | null = null;

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
  let matchupLoading = false;
  let matchupError = "";
  let matchup: MatchupResult | null = null;
  let liveMatchup: MatchupResult | null = null;
  let winningConditionUnlocked = false;
  let lastTurnKey = "";
  let payload: {
    recommendedPicks: RecommendationRow[];
    recommendedBans: RecommendationRow[];
    recommendedMetaPicks?: RecommendationRow[];
    recommendedCounterPicks?: RecommendationRow[];
    notes: string[];
    archetype?: {
      primary: string;
      confidence: number;
      secondary: string | null;
    } | null;
    draftProbability?: {
      allyWinProb: number;
      enemyWinProb: number;
      confidence: number;
    } | null;
  } | null = null;
  let feasibility: FeasibilityPayload | null = null;
  let heroActionMap = new Map<number, HeroActionState>();
  let poolFilterMode: PoolFilterMode = "role";
  let poolRoleFilter = "";
  let poolLaneFilter = "";
  let poolSearchQuery = "";
  let actionableRecommendations: RankedRecommendation[] = [];
  let metaRecommendations: RankedRecommendation[] = [];
  let counterRecommendations: RankedRecommendation[] = [];
  let lastStableActionableRecommendations: RankedRecommendation[] = [];
  let lastStableMetaRecommendations: RankedRecommendation[] = [];
  let lastStableCounterRecommendations: RankedRecommendation[] = [];
  let mobileRecommendedHeroes: RankedRecommendation[] = [];
  let mobileMetaRecommendations: RankedRecommendation[] = [];
  let mobileCounterRecommendations: RankedRecommendation[] = [];
  let mobileShowRecommendedOnly = false;
  let mobileShowMetaCounterOnly = false;
  let lastAutoMatchupKey = "";
  let picksReady = false;
  let laneSlotsReady = false;
  let canAnalyze = false;
  let laneAdjustmentMode = false;
  let isLastEnemyPickPhase = false;
  let showBanAwarenessPanels = false;
  let allyPanelPulse = false;
  let enemyPanelPulse = false;
  let pulseFrozen = false;
  let displayAllySlots: SlotView[] = [];
  let displayEnemySlots: SlotView[] = [];
  let laneAdjustInitialized = false;
  let allyLaneMlids: Array<number | null> = [null, null, null, null, null];
  let enemyLaneMlids: Array<number | null> = [null, null, null, null, null];
  let swapSelection: DragPointer | null = null;
  let analyzeRequestSeq = 0;
  let matchupRequestSeq = 0;
  let analyzeAbortController: AbortController | null = null;
  let matchupAbortController: AbortController | null = null;
  let didMount = false;
  let lastAutoAnalyzeKey = "";
  let previousBodyOverflow = "";
  let previousHtmlOverflow = "";
  let mobileScrollLocked = false;
  let mobilePortraitActionBusy: "home" | "reset" | null = null;

  let isMobilePortrait = browser ? window.innerWidth <= 500 && window.innerHeight > window.innerWidth : false;
  let isMobileLandscape = browser ? window.innerWidth <= 500 && window.innerWidth > window.innerHeight : false;
  let mobileSearchOpen = false;
  let mobileModeConfirmed = false;
  let mobileRecommendationDetail: MobileRecommendationDetail | null = null;
  let desktopRecommendationDetail: MobileRecommendationDetail | null = null;
  let desktopRecommendationPlacement: DesktopRecommendationPlacement = { horizontal: "center", vertical: "top" };
  let desktopRecommendationPopoverPosition: DesktopRecommendationPopoverPosition = { top: 0, left: 0 };
  let lastRecommendationTrigger: HTMLElement | null = null;
  let desktopRecommendationCloseTimer: ReturnType<typeof setTimeout> | null = null;

  const heroMap = new Map(data.heroes.map((hero) => [hero.mlid, hero]));
  const fallbackRolePool = buildRolePoolMap(
    data.heroes.map((hero) => ({
      mlid: hero.mlid,
      lanes: heroLanePool(hero)
    }))
  );

  $: sequence = mode === "tournament"
    ? tournamentSequenceForOrder(allyPickOrder)
    : mode === "custom"
      ? customSequenceForOrder(allyPickOrder)
      : rankedSequenceForScope(rankScope, allyPickOrder);
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
  $: heroActionMap = buildHeroActionMap(data.heroes, currentAction, allySlotMlids, enemySlotMlids, allyBans, enemyBans);
  $: currentMissingRoles =
    currentAction?.type === "pick"
      ? currentAction.side === "ally"
        ? allyFeasibility.missingRoles
        : enemyFeasibility.missingRoles
      : [];
  $: showBanAwarenessPanels = false;

  $: recommendationRows =
    currentAction?.type === "ban" ? (payload?.recommendedBans ?? []) : (payload?.recommendedPicks ?? []);
  $: rankedRecommendations = rankRecommendations(
    recommendationRows.filter((row) => !occupiedMlids.has(row.mlid) && passesLockedLaneRule(row.mlid, currentAction)),
    "balanced"
  );
  $: {
    const base = rankedRecommendations
      .filter((row) => !actionStateFor(row.mlid, { ignoreBusy: true }).disabled)
      .slice(0, RECOMMENDATION_MAX);
    const seen = new Set(base.map((row) => row.mlid));
    const filled = [...base];

    if (filled.length < RECOMMENDATION_MIN) {
      for (const hero of data.heroes) {
        if (seen.has(hero.mlid) || occupiedMlids.has(hero.mlid)) continue;
        const state = actionStateFor(hero.mlid, { ignoreBusy: true });
        if (state.disabled) continue;
        filled.push(buildFallbackRecommendation(hero.mlid, "balanced"));
        seen.add(hero.mlid);
        if (filled.length >= RECOMMENDATION_MIN || filled.length >= RECOMMENDATION_MAX) break;
      }
    }

    actionableRecommendations = filled.slice(0, RECOMMENDATION_MAX);
  }

  $: metaRecommendations = (currentAction?.type === "pick" || showBanAwarenessPanels)
    ? buildPaddedPanel(payload?.recommendedMetaPicks ?? [], 4)
    : [];

  $: counterRecommendations = (currentAction?.type === "pick" || showBanAwarenessPanels)
    ? (() => {
        const rows = payload?.recommendedCounterPicks ?? [];
        return rows.length > 0 ? buildPaddedPanel(rows, 4) : [];
      })()
    : [];
  $: mobileRecommendedHeroes = displayedActionableRecommendations.slice(0, 4);
  $: {
    const mobilePinnedMlids = new Set(mobileRecommendedHeroes.map((row) => row.mlid));
    mobileMetaRecommendations = buildMobilePanel(displayedMetaRecommendations, 4, mobilePinnedMlids);
    const mobileExcludedMlids = new Set([
      ...mobilePinnedMlids,
      ...mobileMetaRecommendations.map((row) => row.mlid)
    ]);
    mobileCounterRecommendations =
      displayedCounterRecommendations.length > 0
        ? buildMobilePanel(displayedCounterRecommendations, 4, mobileExcludedMlids)
        : [];
  }
  $: mobileShowRecommendedOnly = currentAction?.type === "pick" && allyPicks.length + enemyPicks.length === 0;
  $: mobileShowMetaCounterOnly = currentAction?.type === "pick" && allyPicks.length + enemyPicks.length > 0;
  $: desktopShowRecommendedHeroes =
    (isBanTurn && !showBanAwarenessPanels) || (currentAction?.type === "pick" && allyPicks.length + enemyPicks.length === 0);
  $: desktopShowMetaCounterPanels = (currentAction?.type === "pick" && allyPicks.length + enemyPicks.length > 0) || showBanAwarenessPanels;
  $: desktopShowMetaCounterHeroes = desktopShowMetaCounterPanels;
  $: if (!loading) lastStableActionableRecommendations = actionableRecommendations;
  $: if (!loading) lastStableMetaRecommendations = metaRecommendations;
  $: if (!loading) lastStableCounterRecommendations = counterRecommendations;
  $: displayedActionableRecommendations =
    loading && lastStableActionableRecommendations.length > 0
      ? lastStableActionableRecommendations
      : actionableRecommendations;
  $: displayedMetaRecommendations =
    loading && lastStableMetaRecommendations.length > 0 ? lastStableMetaRecommendations : metaRecommendations;
  $: displayedCounterRecommendations =
    loading && lastStableCounterRecommendations.length > 0 ? lastStableCounterRecommendations : counterRecommendations;

  $: heroPoolRows = data.heroes
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((hero) => {
      if (poolFilterMode === "role") {
        if (poolRoleFilter && hero.rolePrimary !== poolRoleFilter && hero.roleSecondary !== poolRoleFilter) return false;
      } else {
        if (poolLaneFilter) {
          const lanes = heroLanePool(hero);
          if (!lanes.includes(poolLaneFilter as DraftLane)) return false;
        }
      }
      if (poolSearchQuery.trim()) {
        const q = poolSearchQuery.trim().toLowerCase();
        if (!hero.name.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .map((hero) => ({
      ...hero,
      state: heroActionMap.get(hero.mlid) ?? evaluateHeroActionState(hero.mlid, currentAction)
    }));
  $: picksReady = allyPickCount === MAX_PICKS && enemyPickCount === MAX_PICKS;
  $: scoreTotal = matchup ? matchup.allyScore + matchup.enemyScore : 0;
  $: allyScorePct =
    scoreTotal > 0 && matchup ? Math.max(6, Math.min(94, (matchup.allyScore / scoreTotal) * 100)) : 50;
  $: enemyScorePct =
    scoreTotal > 0 && matchup ? Math.max(6, Math.min(94, (matchup.enemyScore / scoreTotal) * 100)) : 50;
  $: allyCounterEdgePct = matchup ? Math.max(0, Math.min(100, matchup.components.allyCounterEdge * 100)) : 0;
  $: enemyCounterEdgePct = matchup ? Math.max(0, Math.min(100, matchup.components.enemyCounterEdge * 100)) : 0;
  $: displayDraftProbability = liveMatchup
    ? {
        allyWinProb: liveMatchup.allyWinProb,
        enemyWinProb: liveMatchup.enemyWinProb,
        confidence: 1
      }
    : payload?.draftProbability ?? null;
  $: analysisHeadline = matchup
    ? matchup.allyScore === matchup.enemyScore
      ? "Draft looks balanced"
      : matchup.allyScore > matchup.enemyScore
        ? "Ally Team Wins"
        : "Enemy Team Wins"
    : "Final Draft Intelligence";
  $: isBanTurn = currentAction?.type === "ban";
  $: isAllyPickTurn = currentAction?.type === "pick" && currentAction.side === "ally";
  $: isEnemyPickTurn = currentAction?.type === "pick" && currentAction.side === "enemy";
  $: banTargetPerSide = mode === "ranked" ? (rankScope === "legend" ? 4 : rankScope === "epic" ? 3 : 5) : mode === "custom" ? 3 : 5;
  $: analysisWinner = matchup
    ? matchup.allyScore === matchup.enemyScore
      ? "balanced"
      : matchup.allyScore > matchup.enemyScore
        ? "ally"
        : "enemy"
    : null;
  $: laneAdjustmentMode = picksReady && !currentAction;
  $: manualSwapEnabled = laneAdjustmentMode && !winningConditionUnlocked;
  $: isLastEnemyPickPhase =
    laneAdjustmentMode &&
    sequence.length > 0 &&
    sequence[sequence.length - 1]?.type === "pick" &&
    sequence[sequence.length - 1]?.side === "enemy";
  $: {
    const key = `${turnIndex}:${actionProgress}:${currentAction?.type ?? "done"}:${currentAction?.side ?? "-"}`;
    if (key !== lastTurnKey) {
      lastTurnKey = key;
      addDebug("turn-state", snapshotState());
    }
  }

  $: allySlots = buildSlots("ally", allySlotMlids, currentAction, allyFeasibility);
  $: enemySlots = buildSlots("enemy", enemySlotMlids, currentAction, enemyFeasibility);
  $: if (laneAdjustmentMode && !laneAdjustInitialized) {
    allyLaneMlids = laneMlidsFromAssignment(allySlotMlids, allyFeasibility);
    enemyLaneMlids = laneMlidsFromAssignment(enemySlotMlids, enemyFeasibility);
    laneAdjustInitialized = true;
  }
  $: if (!laneAdjustmentMode) {
    laneAdjustInitialized = false;
    swapSelection = null;
  }
  $: if (!manualSwapEnabled) {
    swapSelection = null;
  }
  $: displayAllySlots = laneAdjustmentMode ? buildLaneAdjustSlots(allyLaneMlids) : allySlots;
  $: displayEnemySlots = laneAdjustmentMode ? buildLaneAdjustSlots(enemyLaneMlids) : enemySlots;
  $: laneSlotsReady =
    !laneAdjustmentMode ||
    (displayAllySlots.filter((slot) => slot.mlid).length === MAX_PICKS &&
      displayEnemySlots.filter((slot) => slot.mlid).length === MAX_PICKS);
  $: canAnalyze = picksReady && laneSlotsReady;
  $: needsPickOrderSelection =
    allyPickOrder === null &&
    turnIndex === 0 &&
    actionProgress === 0 &&
    allyPicks.length === 0 &&
    enemyPicks.length === 0 &&
    allyBans.length === 0 &&
    enemyBans.length === 0;
  $: showPickOrderSelection = needsPickOrderSelection;
  $: allyPickOrderLabel = allyPickOrder === "first" ? "1st Pick" : allyPickOrder === "second" ? "2nd Pick" : "TBD";
  $: enemyPickOrderLabel = allyPickOrder === "first" ? "2nd Pick" : allyPickOrder === "second" ? "1st Pick" : "TBD";
  $: selectedEngineInfo = isTournamentEngine($engine)
    ? `Engine uses ${draftEngineLabel($engine)} dataset for this draft.`
    : "Engine uses Community stats, tier, matrix, and community blend.";
  $: m7UnavailableHint = $engine === "m7" && $m7StatusLoaded && !$m7Available
    ? `M7 World Championship unavailable${$m7StatusReason ? `: ${$m7StatusReason}` : "."}`
    : $engine === "mpl_ph" && $mplPhStatusLoaded && !$mplPhAvailable
      ? `MPL PH Regular Season unavailable${$mplPhStatusReason ? `: ${$mplPhStatusReason}` : "."}`
    : "";
  $: topBanSlotCount = Math.max(0, Math.min(MAX_BANS, banTargetPerSide));
  $: allyTopBanSlots = Array.from({ length: topBanSlotCount }, (_, index) => allyBans[index] ?? null);
  $: enemyTopBanSlots = Array.from({ length: topBanSlotCount }, (_, index) => enemyBans[index] ?? null);
  $: bannedMlids = new Set<number>([...allyBansView, ...enemyBansView]);
  $: allyTopBanTargetIndexes = banTargetIndexesFor("ally", allyTopBanSlots);
  $: enemyTopBanTargetIndexes = banTargetIndexesFor("enemy", enemyTopBanSlots);
  $: banAnimationEnabled = !needsPickOrderSelection && (mode !== "ranked" || allyPickOrder !== null);
  $: showAnalysisCard = winningConditionUnlocked && (matchupLoading || Boolean(matchupError) || Boolean(matchup));
  $: allyPanelPulse = !pulseFrozen && (isAllyPickTurn || laneAdjustmentMode);
  $: enemyPanelPulse = !pulseFrozen && (isEnemyPickTurn || laneAdjustmentMode || isLastEnemyPickPhase);
  $: autoAnalyzeKey = JSON.stringify({
    mode,
    engine: $engine,
    timeframe: mode === "ranked" ? timeframe : "7d",
    rankScope: mode === "ranked" ? rankScope : "mythic_glory",
    pickOrder: allyPickOrder,
    turnIndex,
    actionProgress,
    allySlots: allySlotMlids,
    enemySlots: enemySlotMlids,
    allyBans,
    enemyBans
  });
  $: if (didMount && !actionBusy && autoAnalyzeKey !== lastAutoAnalyzeKey) {
    lastAutoAnalyzeKey = autoAnalyzeKey;
    void analyze();
  }
  $: laneAutoMatchupKey = laneAdjustmentMode
    ? `${allyLaneMlids.join(",")}|${enemyLaneMlids.join(",")}|${laneSlotsReady ? "1" : "0"}`
    : "";
  $: if (
    didMount &&
    laneAdjustmentMode &&
    !isMobileLandscape &&
    !isMobilePortrait &&
    laneSlotsReady &&
    laneAutoMatchupKey &&
    laneAutoMatchupKey !== lastAutoMatchupKey
  ) {
    lastAutoMatchupKey = laneAutoMatchupKey;
    void analyzeMatchup({ reveal: false, silent: true });
  }

  $: mobileSequenceLabel = currentAction
    ? `${currentAction.side === "ally" ? "Ally" : "Enemy"} ${currentAction.type === "pick" ? "Pick" : "Ban"}`
    : "Draft Complete";
  $: desktopPhaseLabel = showPickOrderSelection
    ? "Set your draft side"
    : laneAdjustmentMode
      ? "Lane Phase: finalize best lane assignment"
      : currentAction?.type === "ban"
        ? "Ban Phase: deny enemy comfort and meta"
        : currentAction?.type === "pick"
          ? "Pick Phase: build your core"
          : "Draft Complete";
  $: desktopPhaseSubtitle = showPickOrderSelection
    ? "Select First Pick or Second Pick"
    : laneAdjustmentMode
      ? "Review lane fit and swap heroes into the strongest final setup."
      : currentAction
        ? `${currentAction.text} (${actionProgress}/${currentAction.limit})`
        : "All draft actions are complete.";
  $: if (didMount) {
    syncMobileScrollLock(isMobileLandscape || isMobilePortrait || Boolean(mobileRecommendationDetail));
  }

  onMount(() => {
    didMount = true;
    normalizeTurnState();
    addDebug("mount-init", snapshotState());
    void analyze();
    checkMobileOrientation();
    window.addEventListener("resize", checkMobileOrientation);
    window.addEventListener("orientationchange", checkMobileOrientation);
    return () => {
      window.removeEventListener("resize", checkMobileOrientation);
      window.removeEventListener("orientationchange", checkMobileOrientation);
      syncMobileScrollLock(false, true);
    };
  });

  function checkMobileOrientation() {
    if (typeof window === "undefined") return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const smallSide = Math.min(w, h);
    const isPhone = smallSide <= 500;
    const wasLandscape = isMobileLandscape;
    const wasMobile = isMobileLandscape || isMobilePortrait;
    isMobilePortrait = isPhone && h > w;
    isMobileLandscape = isPhone && w > h;
    const isNowMobile = isMobileLandscape || isMobilePortrait;
    if (isNowMobile !== wasMobile) {
      resetRecommendationDetails();
    }
    if (isMobileLandscape && !wasLandscape) {
      const el = document.documentElement;
      try {
        if (document.fullscreenEnabled && el.requestFullscreen && !document.fullscreenElement) {
          el.requestFullscreen().catch(() => {});
        }
      } catch {}
    }
    if (!isMobileLandscape && !isMobilePortrait && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function onMobileSearchInput() {
    if (poolSearchQuery.trim()) {
      poolRoleFilter = "";
      poolLaneFilter = "";
    }
  }

  function syncMobileScrollLock(locked: boolean, forceReset = false) {
    if (typeof document === "undefined") return;

    const body = document.body;
    const html = document.documentElement;

    if (locked && !mobileScrollLocked) {
      previousBodyOverflow = body.style.overflow;
      previousHtmlOverflow = html.style.overflow;
      body.style.overflow = "hidden";
      html.style.overflow = "hidden";
      mobileScrollLocked = true;
      return;
    }

    if ((!locked || forceReset) && mobileScrollLocked) {
      body.style.overflow = previousBodyOverflow;
      html.style.overflow = previousHtmlOverflow;
      mobileScrollLocked = false;
    }
  }

  function selectMobileMode(m: DraftMode) {
    mobileModeConfirmed = true;
    if (mode !== m) void setMode(m);
  }

  async function backToMobileHome() {
    if (mobilePortraitActionBusy) return;
    mobilePortraitActionBusy = "home";
    try {
      await goto("/hero-tier");
    } finally {
      mobilePortraitActionBusy = null;
    }
  }

  async function closeMobileLandscape() {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {}
    }

    const orientation = typeof screen !== "undefined"
      ? (screen.orientation as ScreenOrientation & { unlock?: () => void })
      : null;
    try {
      orientation?.unlock?.();
    } catch {}

    mobileModeConfirmed = false;
    await goto("/hero-tier");
  }

  function analyzeEndpoint() {
    if ($engine === "m7") return "/draft/m7/analyze";
    if ($engine === "mpl_ph") return "/draft/mpl-ph/analyze";
    return "/draft/analyze";
  }

  function matchupEndpoint() {
    if ($engine === "m7") return "/draft/m7/matchup";
    if ($engine === "mpl_ph") return "/draft/mpl-ph/matchup";
    return "/draft/matchup";
  }

  async function tryLockLandscape() {
    if (typeof window === "undefined") return;

    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: OrientationLockType) => Promise<void>;
    };

    if (!orientation?.lock) return;

    try {
      if (document.fullscreenEnabled && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      await orientation.lock("landscape");
    } catch {}
  }

  async function resetMobileDraft() {
    if (mobilePortraitActionBusy) return;
    mobilePortraitActionBusy = "reset";
    try {
      await tryLockLandscape();
      mobileModeConfirmed = false;
      mobileSearchOpen = false;
      resetRecommendationDetails();
      poolSearchQuery = "";
      await resetDraft(false);
    } finally {
      mobilePortraitActionBusy = null;
    }
  }

  function shortLaneName(lane: DraftLane): string {
    const map: Record<DraftLane, string> = { exp: "EXP", jungle: "JGL", mid: "MID", gold: "GLD", roam: "RMD" };
    return map[lane] ?? lane.toUpperCase().slice(0, 3);
  }

  function sideLabel(side: "ally" | "enemy") {
    return side === "ally" ? "Ally" : "Enemy";
  }

  function sideLabelFull(side: "ally" | "enemy") {
    return side === "ally" ? "Ally Team" : "Enemy Team";
  }

  function isBannedHero(mlid: number) {
    return bannedMlids.has(mlid);
  }

  function shouldShowBannedInPool(mlid: number) {
    if (!bannedMlids.has(mlid)) return false;
    if (currentAction?.type === "ban") return false;
    return true;
  }

  function setPoolFilterMode(nextMode: PoolFilterMode) {
    if (poolFilterMode === nextMode) return;
    poolFilterMode = nextMode;
  }

  function setPoolFilterValue(value: string) {
    if (poolFilterMode === "role") {
      poolRoleFilter = value;
      poolLaneFilter = "";
      return;
    }
    poolLaneFilter = value;
    poolRoleFilter = "";
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

  function recommendationPanelTitle(kind: RecommendationPanelKind) {
    if (kind === "recommended") {
      return currentAction?.type === "ban" ? "Recommended Bans" : "Recommended Heroes";
    }
    return kind === "meta" ? "Meta Picks" : "Counter Picks";
  }

  function recommendationPanelSummary(kind: RecommendationPanelKind) {
    if (kind === "recommended") {
      return currentAction?.type === "ban"
        ? "Best deny targets for the current board."
        : "Best overall heroes for the current board.";
    }
    if (kind === "meta") return "Strongest available heroes with stable value.";
    return "Best answers to the enemy draft so far.";
  }

  function recommendationExplainLines(row: RankedRecommendation, kind: RecommendationPanelKind) {
    const lines: string[] = [];
    const breakdown = row.breakdown;
    const needs = currentAction ? sideRoleNeeds(currentAction.side) : [];

    if (kind === "recommended") {
      if (currentAction?.type === "ban") {
        if ((breakdown?.denialValue ?? breakdown?.denyValue ?? 0) >= 0.55) lines.push("High-value deny target for the current board.");
        if ((breakdown?.protectionValue ?? 0) >= 0.35) lines.push("Protects your draft from a strong enemy response.");
      } else {
        if (row.coverageLanes.length > 0) lines.push(`Covers ${row.coverageLanes.map((lane) => laneLabel(lane)).join(", ")} for your current setup.`);
        if (needs.length > 0) lines.push(`Helps your team add ${needs.join(", ")}.`);
        if ((breakdown?.synergyValue ?? 0) >= 0.35) lines.push("Pairs well with heroes already locked in.");
      }
    }

    if (kind === "meta") {
      if ((breakdown?.tierPower ?? row.score) >= 0.62) lines.push("One of the strongest available tournament-value heroes.");
      if (row.flexCount > 1 || (breakdown?.flexValue ?? 0) >= 0.45) lines.push("Flexible enough to keep your draft options open.");
      if ((breakdown?.synergyValue ?? 0) >= 0.28) lines.push("Still fits cleanly into your current composition.");
    }

    if (kind === "counter") {
      if ((breakdown?.counterImpact ?? 0) >= 0.42) lines.push("Directly pressures the enemy draft that is already showing.");
      if (row.coverageLanes.length > 0) lines.push(`Answers the board while still covering ${row.coverageLanes.map((lane) => laneLabel(lane)).join(", ")}.`);
      if ((breakdown?.communitySignal ?? 0) >= 0.45) lines.push("Backed by a stronger counter signal than other options.");
    }

    if (lines.length === 0) lines.push(row.fitReason);
    if (lines.length < 2 && row.fitReason && !lines.includes(row.fitReason)) lines.push(row.fitReason);
    if (lines.length < 3 && row.reasons?.[0] && !lines.includes(row.reasons[0])) lines.push(row.reasons[0]);

    return lines.slice(0, 3);
  }

  function recommendationMetricBars(row: RankedRecommendation, kind: RecommendationPanelKind): RecommendationMetricBar[] {
    const breakdown = row.breakdown;
    const tierValue = breakdown?.tierPower ?? row.score;
    const synergyValue = breakdown?.synergyValue ?? 0;
    const winValue = breakdown?.denialValue ?? breakdown?.denyValue ?? row.score;
    const flexValue = breakdown?.flexValue ?? Math.min(1, row.flexCount / 3);
    const coverageValue =
      breakdown?.laneCoverage ??
      (currentAction?.type === "pick"
        ? Math.min(1, row.coverageLanes.length / Math.max(1, currentMissingRoles.length || 1))
        : 0);
    const counterValue = breakdown?.counterImpact ?? breakdown?.denyValue ?? breakdown?.denialValue ?? row.score;
    const communityValue = breakdown?.communitySignal ?? row.score;

    if (kind === "recommended") {
      return [
        { label: "Tier", value: tierValue, tone: "tier" },
        { label: "Win", value: winValue, tone: "win" },
        { label: "Coverage", value: coverageValue, tone: "coverage" },
        { label: "Synergy", value: synergyValue, tone: "synergy" }
      ];
    }

    if (kind === "counter") {
      return [
        { label: "Tier", value: tierValue, tone: "tier" },
        { label: "Counter", value: counterValue, tone: "counter" },
        { label: "Community", value: communityValue, tone: "community" },
        { label: "Synergy", value: synergyValue, tone: "synergy" }
      ];
    }

    return [
      { label: "Tier", value: tierValue, tone: "tier" },
      { label: "Win", value: winValue, tone: "win" },
      { label: "Flex", value: flexValue, tone: "flex" },
      { label: "Synergy", value: synergyValue, tone: "synergy" }
    ];
  }

  function calculateDesktopRecommendationPlacement(anchor: HTMLElement): DesktopRecommendationPlacement {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = Math.min(320, Math.max(260, viewportWidth - 32));
    const popoverHeight = 320;
    const margin = 16;
    const centerLeft = rect.left + rect.width / 2 - popoverWidth / 2;
    const centerRight = rect.left + rect.width / 2 + popoverWidth / 2;
    const horizontal =
      centerLeft < margin ? "left" : centerRight > viewportWidth - margin ? "right" : "center";
    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;
    const vertical = spaceAbove >= popoverHeight || spaceAbove >= spaceBelow ? "top" : "bottom";
    return { horizontal, vertical };
  }

  function calculateDesktopRecommendationPopoverPosition(
    anchor: HTMLElement,
    placement: DesktopRecommendationPlacement
  ): DesktopRecommendationPopoverPosition {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = Math.min(320, Math.max(260, viewportWidth - 32));
    const gap = 10;
    const margin = 16;

    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    if (placement.horizontal === "left") left = rect.left;
    if (placement.horizontal === "right") left = rect.right - popoverWidth;
    left = Math.max(margin, Math.min(left, viewportWidth - popoverWidth - margin));

    let top = rect.top;
    if (placement.vertical === "bottom") {
      top = rect.bottom + gap;
    }

    top = Math.max(margin, Math.min(top, viewportHeight - margin));
    return { top, left };
  }

  async function focusRecommendationDetail() {
    await tick();
    if (typeof document === "undefined") return;
    const selector =
      isMobileLandscape || isMobilePortrait
        ? ".m-rec-sheet .m-rec-sheet-select, .m-rec-sheet .m-rec-sheet-close"
        : ".rec-popover--desktop .rec-popover-close";
    const target = document.querySelector<HTMLElement>(selector);
    target?.focus();
  }

  function restoreRecommendationTriggerFocus() {
    const trigger = lastRecommendationTrigger;
    lastRecommendationTrigger = null;
    if (!trigger) return;
    requestAnimationFrame(() => {
      trigger.focus();
    });
  }

  async function openMobileRecommendationDetail(row: RankedRecommendation, kind: RecommendationPanelKind, anchor?: HTMLElement) {
    if (anchor) lastRecommendationTrigger = anchor;
    if (!isMobileLandscape && !isMobilePortrait) {
      if (desktopRecommendationDetail?.row.mlid === row.mlid && desktopRecommendationDetail.kind === kind) {
        desktopRecommendationDetail = null;
        restoreRecommendationTriggerFocus();
        return;
      }
      if (anchor) {
        desktopRecommendationPlacement = calculateDesktopRecommendationPlacement(anchor);
        desktopRecommendationPopoverPosition = calculateDesktopRecommendationPopoverPosition(anchor, desktopRecommendationPlacement);
      }
      desktopRecommendationDetail = { row, kind };
      await focusRecommendationDetail();
      return;
    }
    mobileSearchOpen = false;
    poolSearchQuery = "";
    mobileRecommendationDetail = { row, kind };
    await focusRecommendationDetail();
  }

  function cancelDesktopRecommendationClose() {
    if (!desktopRecommendationCloseTimer) return;
    clearTimeout(desktopRecommendationCloseTimer);
    desktopRecommendationCloseTimer = null;
  }

  function openDesktopRecommendationPreview(row: RankedRecommendation, kind: RecommendationPanelKind, anchor: HTMLElement) {
    if (isMobileLandscape || isMobilePortrait) return;
    cancelDesktopRecommendationClose();
    desktopRecommendationPlacement = calculateDesktopRecommendationPlacement(anchor);
    desktopRecommendationPopoverPosition = calculateDesktopRecommendationPopoverPosition(anchor, desktopRecommendationPlacement);
    desktopRecommendationDetail = { row, kind };
  }

  function queueDesktopRecommendationClose() {
    if (isMobileLandscape || isMobilePortrait || !desktopRecommendationDetail) return;
    cancelDesktopRecommendationClose();
    desktopRecommendationCloseTimer = setTimeout(() => {
      desktopRecommendationDetail = null;
      desktopRecommendationCloseTimer = null;
    }, 120);
  }

  function closeMobileRecommendationDetail() {
    const hadOpenDetail = Boolean(mobileRecommendationDetail || desktopRecommendationDetail);
    cancelDesktopRecommendationClose();
    mobileRecommendationDetail = null;
    desktopRecommendationDetail = null;
    if (hadOpenDetail) restoreRecommendationTriggerFocus();
  }

  function isDesktopRecommendationDetailOpen(row: RankedRecommendation, kind: RecommendationPanelKind) {
    return (
      !isMobileLandscape &&
      !isMobilePortrait &&
      desktopRecommendationDetail?.row.mlid === row.mlid &&
      desktopRecommendationDetail.kind === kind
    );
  }

  function handleDesktopRecommendationOutsidePointerDown(event: PointerEvent) {
    if (isMobileLandscape || isMobilePortrait || !desktopRecommendationDetail) return;
    const target = event.target;
    if (!(target instanceof Element)) {
      desktopRecommendationDetail = null;
      return;
    }
    if (target.closest(".rec-card-anchor") || target.closest(".rec-popover--desktop")) return;
    desktopRecommendationDetail = null;
  }

  function handleRecommendationKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (!mobileRecommendationDetail && !desktopRecommendationDetail) return;
    event.preventDefault();
    closeMobileRecommendationDetail();
  }

  function activeRecommendationDetail() {
    return isMobileLandscape || isMobilePortrait ? mobileRecommendationDetail : desktopRecommendationDetail;
  }

  async function applyMobileRecommendationDetail() {
    const detail = activeRecommendationDetail();
    if (!detail) return;
    const mlid = detail.row.mlid;
    closeMobileRecommendationDetail();
    await applyHero(mlid);
  }

  function closeDesktopRecommendationDetail() {
    if (!desktopRecommendationDetail) return;
    desktopRecommendationDetail = null;
    restoreRecommendationTriggerFocus();
  }

  function resetRecommendationDetails() {
    mobileRecommendationDetail = null;
    desktopRecommendationDetail = null;
  }

  function sideLaneState(side: "ally" | "enemy") {
    const slots = side === "ally" ? displayAllySlots : displayEnemySlots;
    const filled = slots.filter((slot) => slot.mlid).map((slot) => slot.lane);
    const filledSet = new Set(filled);
    return {
      filled: SLOT_LANES.filter((lane) => filledSet.has(lane)),
      missing: SLOT_LANES.filter((lane) => !filledSet.has(lane))
    };
  }

  function sideRoleNeeds(side: "ally" | "enemy") {
    const picks = side === "ally" ? allyPicks : enemyPicks;
    const roles = picks
      .map((mlid) => heroMap.get(mlid))
      .flatMap((hero) => (hero ? [hero.rolePrimary, hero.roleSecondary].filter(Boolean) as string[] : []));
    const unique = new Set(roles);
    const needs: string[] = [];

    if (!unique.has("tank") && !unique.has("support")) needs.push("frontline");
    if (!unique.has("mage")) needs.push("magic damage");
    if (!unique.has("marksman") && !unique.has("assassin")) needs.push("backline threat");
    if (!unique.has("support")) needs.push("utility");

    return needs.slice(0, 3);
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



  const DRAFT_Wh  = 1.0;
  const DRAFT_Ws  = 0.6;
  const DRAFT_Wc  = 0.8;
  const DRAFT_Wco = 0.5;
  const DRAFT_Wf  = 0.2;




  function computeHeroScore(row: RecommendationRow, lane: DraftLane): number {
    const hero = heroMap.get(row.mlid);
    const inPool = hero ? heroLanePool(hero).includes(lane) : false;
    if (!inPool) return 0;
    const M = (row.breakdown?.tierPower ?? row.score) * 100;
    const L = 1.0;
    return M * 0.7 + L * 0.3;
  }



  function computeFlexValue(mlid: number): number {
    const hero = heroMap.get(mlid);
    if (!hero) return 0;
    return Math.max(0, heroLanePool(hero).length - 1);
  }



  function approximateTotalSynergy(picks: BestDraftLanePick[]): number {
    return picks.reduce((sum, p) => sum + (p.row.breakdown?.synergyValue ?? 0) * 10, 0);
  }



  function approximateInternalConflict(picks: BestDraftLanePick[]): number {
    return picks.reduce((sum, p) => {
      const sv = (p.row.breakdown?.synergyValue ?? 0) * 10;
      return sum + Math.max(0, -sv);
    }, 0);
  }



  function computeCoherence(_picks: BestDraftLanePick[]): number {
    return 0;
  }


  function computeCompositionScore(picks: BestDraftLanePick[]): number {
    const heroSum   = picks.reduce((s, p) => s + p.heroScore, 0);
    const synergy   = approximateTotalSynergy(picks);
    const conflict  = approximateInternalConflict(picks);
    const coherence = computeCoherence(picks);
    const flex      = picks.reduce((s, p) => s + computeFlexValue(p.row.mlid), 0);
    return (
      heroSum   * DRAFT_Wh  +
      synergy   * DRAFT_Ws  -
      conflict  * DRAFT_Wc  +
      coherence * DRAFT_Wco +
      flex      * DRAFT_Wf
    );
  }




  function buildBestDraftLanePicks(picks: RecommendationRow[]): BestDraftLanePick[] {
    const rowByMlid = new Map<number, RecommendationRow>(picks.map((row) => [row.mlid, row]));
    const hasCandidateForLane = (lane: DraftLane) =>
      Array.from(rowByMlid.values()).some((row) => {
        const hero = heroMap.get(row.mlid);
        return hero ? heroLanePool(hero).includes(lane) : false;
      });

    for (const lane of SLOT_LANES) {
      if (hasCandidateForLane(lane)) continue;

      for (const hero of data.heroes) {
        if (rowByMlid.has(hero.mlid) || occupiedMlids.has(hero.mlid)) continue;
        if (!heroLanePool(hero).includes(lane)) continue;
        if (!passesLockedLaneRule(hero.mlid, currentAction)) continue;

        const state = actionStateFor(hero.mlid, { ignoreBusy: true });
        if (state.disabled) continue;

        rowByMlid.set(hero.mlid, buildFallbackRecommendation(hero.mlid, "coverage"));
        break;
      }
    }

    const candidatePool = Array.from(rowByMlid.values());


    const candidateByLane = new Map<DraftLane, Array<{ row: RecommendationRow; heroScore: number }>>();
    for (const lane of SLOT_LANES) {
      const laneCandidates = candidatePool
        .map((row) => ({ row, heroScore: computeHeroScore(row, lane) }))
        .filter((c) => c.heroScore > 0)
        .sort((a, b) => b.heroScore - a.heroScore || b.row.score - a.row.score)
        .slice(0, 12);
      candidateByLane.set(lane, laneCandidates);
    }


    const laneOrder: DraftLane[] = [...SLOT_LANES].sort(
      (a, b) => (candidateByLane.get(a)?.length ?? 0) - (candidateByLane.get(b)?.length ?? 0)
    );

    let best: BestDraftLanePick[] = [];
    let bestScore = -Infinity;

    function dfs(index: number, usedMlids: Set<number>, acc: BestDraftLanePick[]) {
      if (index >= laneOrder.length) {
        if (acc.length < SLOT_LANES.length) return;

        const score = computeCompositionScore(acc);
        if (score > bestScore) {
          bestScore = score;
          best = acc.map((p) => ({ ...p }));
        }
        return;
      }

      const lane = laneOrder[index];
      const candidates = candidateByLane.get(lane) ?? [];
      let picked = false;
      for (const candidate of candidates) {
        if (usedMlids.has(candidate.row.mlid)) continue;
        picked = true;
        usedMlids.add(candidate.row.mlid);
        acc.push({ lane, row: candidate.row, heroScore: candidate.heroScore });
        dfs(index + 1, usedMlids, acc);
        acc.pop();
        usedMlids.delete(candidate.row.mlid);
      }
      if (!picked) dfs(index + 1, usedMlids, acc);
    }

    dfs(0, new Set<number>(), []);


    const laneIndex = new Map(SLOT_LANES.map((lane, i) => [lane, i]));
    return best.sort((a, b) => (laneIndex.get(a.lane) ?? 0) - (laneIndex.get(b.lane) ?? 0));
  }

  $: bestDraftLanePicks = needsPickOrderSelection
    ? buildBestDraftLanePicks(payload?.recommendedPicks ?? [])
    : [];
  $: bestDraftLoading = needsPickOrderSelection && (loading || (!payload && !error));
  $: bestDraftReady = !bestDraftLoading && bestDraftLanePicks.length > 0;
  $: bestDraftCompositionScore =
    bestDraftLanePicks.length === SLOT_LANES.length
      ? computeCompositionScore(bestDraftLanePicks)
      : 0;
  $: allyLaneState = sideLaneState("ally");
  $: enemyLaneState = sideLaneState("enemy");
  $: allyRoleNeeds = sideRoleNeeds("ally");
  $: enemyRoleNeeds = sideRoleNeeds("enemy");

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

  function firstPhaseBanSet() {
    return new Set<number>([...bansOf("ally").slice(0, 3), ...bansOf("enemy").slice(0, 3)]);
  }

  function currentTurnNumber() {
    return currentAction ? turnIndex + 1 : null;
  }

  function banTargetIndexesFor(side: "ally" | "enemy", slots: Array<number | null>) {
    if (!banAnimationEnabled) return new Set<number>();
    if (!currentAction || currentAction.type !== "ban" || currentAction.side !== side) return new Set<number>();
    const bansLeftThisTurn = Math.max(currentAction.limit - actionProgress, 0);
    if (bansLeftThisTurn <= 0) return new Set<number>();
    const openIndexes = slots
      .map((mlid, index) => (mlid ? -1 : index))
      .filter((index) => index >= 0)
      .slice(0, bansLeftThisTurn);
    return new Set(openIndexes);
  }

  function evaluateHeroActionState(
    mlid: number,
    action: (DraftAction & { limit: number }) | null,
    _options?: { ignoreBusy?: boolean }
  ): HeroActionState {
    if (!action) return { disabled: true, reason: "Draft is complete." };

    if (action.type === "ban") {
      const ownBans = bansOf(action.side);
      if (ownBans.includes(mlid)) {
        return { disabled: true, reason: "Hero is already banned by this side." };
      }

      const turnNo = currentTurnNumber();
      if (turnNo === 3 || turnNo === 4) {
        if (firstPhaseBanSet().has(mlid)) {
          return { disabled: true, reason: "Hero was already banned in phase 1 (3-hero ban)." };
        }
      }

      const usedBans = bansOf(action.side).length;
      if (usedBans >= MAX_BANS) return { disabled: true, reason: "Ban slots are full." };
      return { disabled: false, reason: null };
    }

    if (takenSet().has(mlid)) {
      return { disabled: true, reason: "Hero is already picked or banned." };
    }

    const sidePicks = picksOf(action.side);
    if (sidePicks.length >= MAX_PICKS) {
      return { disabled: true, reason: "Pick slots are full." };
    }

    return { disabled: false, reason: null };
  }

  function buildHeroActionMap(
    candidates: Hero[],
    action: (DraftAction & { limit: number }) | null,
    _allySlots?: Array<number | null>,
    _enemySlots?: Array<number | null>,
    _allyBans?: number[],
    _enemyBans?: number[]
  ) {
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

  function committedSingleLanesForSide(side: "ally" | "enemy") {
    const committed = new Set<DraftLane>();
    for (const mlid of picksOf(side)) {
      const lanes = fallbackRolePool.get(mlid) ?? [];
      if (lanes.length === 1) committed.add(lanes[0]);
    }
    return committed;
  }

  function passesPanelLaneRule(mlid: number, action: (DraftAction & { limit: number }) | null) {
    if (!action || action.type !== "pick") return true;
    const blocked = committedSingleLanesForSide(action.side);
    if (blocked.size === 0) return true;
    const lanes = fallbackRolePool.get(mlid) ?? [];
    if (lanes.length === 0) return true;
    return !lanes.some((lane) => blocked.has(lane));
  }

  function recommendationPriority(
    baseScore: number,
    coverageCount: number,
    flexCount: number,
    focus: RecommendationFocus
  ) {
    const flexBonus = Math.max(0, flexCount - 1) * 0.05;
    if (focus === "meta") {
      return baseScore * 1.2 + coverageCount * 0.08 + flexBonus * 0.6;
    }
    if (focus === "coverage") {
      return baseScore * 0.9 + coverageCount * 0.35 + flexBonus;
    }
    return baseScore + coverageCount * 0.2 + flexBonus * 0.8;
  }

  function rankRecommendations(rows: RecommendationRow[], focus: RecommendationFocus): RankedRecommendation[] {
    const ranked = rows
      .map((row) => {
        const lanes = fallbackRolePool.get(row.mlid) ?? [];
        const coverageLanes =
          currentAction?.type === "pick" ? lanes.filter((lane) => currentMissingRoles.includes(lane)) : [];
        const priority = recommendationPriority(row.score, coverageLanes.length, lanes.length, focus);
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

    if (focus === "meta") {
      return ranked.sort((a, b) => b.score - a.score || b.priority - a.priority || b.flexCount - a.flexCount);
    }

    if (focus === "coverage") {
      return ranked.sort(
        (a, b) => b.coverageLanes.length - a.coverageLanes.length || b.flexCount - a.flexCount || b.priority - a.priority
      );
    }

    return ranked.sort((a, b) => b.priority - a.priority || b.score - a.score || b.flexCount - a.flexCount);
  }

  function buildFallbackRecommendation(mlid: number, focus: RecommendationFocus): RankedRecommendation {
    const lanes = fallbackRolePool.get(mlid) ?? [];
    const coverageLanes =
      currentAction?.type === "pick" ? lanes.filter((lane) => currentMissingRoles.includes(lane)) : [];
    const score = 0.35;
    return {
      mlid,
      score,
      tier: undefined,
      reasons: ["Valid fallback option for current phase."],
      breakdown: {
        counterImpact: 0.25,
        tierPower: 0.25,
        laneCoverage: coverageLanes.length > 0 ? 0.45 : 0.2,
        flexValue: Math.min(1, lanes.length / 3),
        feasibilityGain: coverageLanes.length > 0 ? 0.35 : 0.18,
        denyValue: 0.2,
        synergyValue: 0,
        denialValue: 0,
        protectionValue: 0
      },
      preview: null,
      priority: recommendationPriority(score, coverageLanes.length, lanes.length, focus),
      coverageLanes,
      flexCount: lanes.length,
      fitReason:
        currentAction?.type === "ban"
          ? "General high-impact fallback ban."
          : coverageLanes.length > 0
            ? `Fallback that still covers ${coverageLanes.map((lane) => laneLabel(lane)).join(", ")}`
            : "Fallback pick to keep draft moving."
    };
  }

  function buildPaddedPanel(rows: RecommendationRow[], count: number): RankedRecommendation[] {
    const ranked = rankRecommendations(
      rows.filter((row) => !occupiedMlids.has(row.mlid) && passesPanelLaneRule(row.mlid, currentAction)),
      "balanced"
    ).filter((row) => !actionStateFor(row.mlid, { ignoreBusy: true }).disabled);

    const seen = new Set(ranked.slice(0, count).map((r) => r.mlid));
    const filled: RankedRecommendation[] = ranked.slice(0, count);

    for (const hero of data.heroes) {
      if (filled.length >= count) break;
      if (seen.has(hero.mlid) || occupiedMlids.has(hero.mlid)) continue;
      if (!passesPanelLaneRule(hero.mlid, currentAction)) continue;
      const state = actionStateFor(hero.mlid, { ignoreBusy: true });
      if (state.disabled) continue;
      filled.push(buildFallbackRecommendation(hero.mlid, "balanced"));
      seen.add(hero.mlid);
    }

    return filled.slice(0, count);
  }

  function buildMobilePanel(rows: RecommendationRow[], count: number, excludeMlids: Set<number>): RankedRecommendation[] {
    const ranked = rankRecommendations(
      rows.filter(
        (row) =>
          !excludeMlids.has(row.mlid) &&
          !occupiedMlids.has(row.mlid) &&
          passesPanelLaneRule(row.mlid, currentAction)
      ),
      "balanced"
    ).filter((row) => !actionStateFor(row.mlid, { ignoreBusy: true }).disabled);

    const seen = new Set<number>(excludeMlids);
    const filled: RankedRecommendation[] = [];

    for (const row of ranked) {
      if (filled.length >= count) break;
      if (seen.has(row.mlid)) continue;
      filled.push(row);
      seen.add(row.mlid);
    }

    for (const hero of data.heroes) {
      if (filled.length >= count) break;
      if (seen.has(hero.mlid) || occupiedMlids.has(hero.mlid)) continue;
      if (!passesPanelLaneRule(hero.mlid, currentAction)) continue;
      const state = actionStateFor(hero.mlid, { ignoreBusy: true });
      if (state.disabled) continue;
      filled.push(buildFallbackRecommendation(hero.mlid, "balanced"));
      seen.add(hero.mlid);
    }

    return filled.slice(0, count);
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
    void event;
    void detail;
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

  function hydrateAssignmentWithPickedHeroes(
    rawSlots: Array<number | null>,
    partialAssignment: Partial<Record<DraftLane, number>>
  ) {
    const picks = normalizeMlids(rawSlots, MAX_PICKS);
    const assignment: Partial<Record<DraftLane, number>> = { ...partialAssignment };
    const assigned = new Set<number>(Object.values(assignment).filter((value): value is number => Number.isInteger(value)));
    const unassigned = picks.filter((mlid) => !assigned.has(mlid));

    if (unassigned.length === 0) return assignment;

    const emptyLanes = SLOT_LANES.filter((lane) => !assignment[lane]);
    const roamEmpty = emptyLanes.includes("roam");
    if (roamEmpty) {
      const roamHero = unassigned.shift();
      if (roamHero) {
        assignment.roam = roamHero;
      }
    }

    const remainingLanes = SLOT_LANES.filter((lane) => !assignment[lane]);
    for (const lane of remainingLanes) {
      const hero = unassigned.shift();
      if (!hero) break;
      assignment[lane] = hero;
    }

    return assignment;
  }

  function buildSlots(
    side: "ally" | "enemy",
    rawSlots: Array<number | null>,
    action: (DraftAction & { limit: number }) | null,
    _teamFeasibility: DraftFeasibilityResult
  ): SlotView[] {
    const orderedSlots = rawSlots.slice(0, MAX_PICKS).map((value) => normalizeMlid(value) ?? null);
    while (orderedSlots.length < MAX_PICKS) orderedSlots.push(null);

    const targetIndexes =
      action?.type === "pick" && action.side === side
        ? (() => {
            const picksLeftThisTurn = Math.max(action.limit - actionProgress, 1);
            const openIndexes = orderedSlots.map((mlid, index) => (mlid ? -1 : index)).filter((index) => index >= 0);
            return new Set(openIndexes.slice(0, picksLeftThisTurn));
          })()
        : new Set<number>();

    return SLOT_LANES.map((lane, index) => {
      const mlid = orderedSlots[index] ?? null;
      let state: SlotState = "open";

      if (mlid) {
        state = "locked";
      } else if (targetIndexes.has(index)) {
        state = "target";
      }

      return { lane, label: laneLabel(lane), mlid, state };
    });
  }

  function laneMlidsFromAssignment(rawSlots: Array<number | null>, teamFeasibility: DraftFeasibilityResult) {
    const baseAssignment = Object.keys(teamFeasibility.assignment ?? {}).length
      ? teamFeasibility.assignment
      : fallbackAssignment(rawSlots);
    const assignment = hydrateAssignmentWithPickedHeroes(rawSlots, baseAssignment);
    return SLOT_LANES.map((lane) => normalizeMlid(assignment[lane]) ?? null);
  }

  function buildLaneAdjustSlots(laneMlids: Array<number | null>): SlotView[] {
    return SLOT_LANES.map((lane, index) => {
      const mlid = normalizeMlid(laneMlids[index]) ?? null;
      return {
        lane,
        label: laneLabel(lane),
        mlid,
        state: mlid ? "locked" : "open"
      };
    });
  }

  function picksForMatchup(side: "ally" | "enemy") {
    if (!laneAdjustmentMode) return picksOf(side);
    return normalizeMlids(side === "ally" ? allyLaneMlids : enemyLaneMlids, MAX_PICKS);
  }

  function laneMlidAt(side: "ally" | "enemy", index: number) {
    const source = side === "ally" ? allyLaneMlids : enemyLaneMlids;
    return normalizeMlid(source[index]) ?? null;
  }

  function isSwapSource(side: "ally" | "enemy", index: number) {
    return Boolean(manualSwapEnabled && swapSelection && swapSelection.side === side && swapSelection.index === index);
  }

  function isSwapTarget(side: "ally" | "enemy", index: number) {
    return Boolean(
      manualSwapEnabled &&
        swapSelection &&
        swapSelection.side === side &&
        swapSelection.index !== index &&
        laneMlidAt(side, index)
    );
  }

  function swapSourceName(side: "ally" | "enemy") {
    if (!swapSelection || swapSelection.side !== side) return "";
    const mlid = laneMlidAt(side, swapSelection.index);
    return mlid ? heroName(mlid) : "";
  }

  function swapButtonLabel(side: "ally" | "enemy", index: number) {
    const mlid = laneMlidAt(side, index);
    if (!mlid) return `No hero assigned to ${sideLabelFull(side)} ${laneLabel(SLOT_LANES[index])}`;
    if (isSwapTarget(side, index)) {
      return `Swap ${swapSourceName(side)} to ${laneLabel(SLOT_LANES[index])}`;
    }
    if (isSwapSource(side, index)) {
      return `Cancel swap selection for ${heroName(mlid)}`;
    }
    return `Select ${heroName(mlid)} in ${laneLabel(SLOT_LANES[index])} for swapping`;
  }

  function swapTargetText(side: "ally" | "enemy", index: number) {
    return `Swap ${swapSourceName(side)} to ${laneLabel(SLOT_LANES[index])} Lane`;
  }

  function handleLaneSwapPress(side: "ally" | "enemy", index: number) {
    if (!manualSwapEnabled || matchupLoading) return;

    const mlid = laneMlidAt(side, index);
    if (!mlid) return;

    if (!swapSelection || swapSelection.side !== side) {
      swapSelection = { side, index };
      return;
    }

    if (swapSelection.index === index) {
      swapSelection = null;
      return;
    }

    swapLaneSlots(side, swapSelection.index, index);
    swapSelection = null;
  }

  function swapLaneSlots(side: "ally" | "enemy", from: number, to: number) {
    if (from === to) return;

    const next = (side === "ally" ? allyLaneMlids : enemyLaneMlids).slice();
    [next[from], next[to]] = [next[to], next[from]];

    if (side === "ally") allyLaneMlids = next;
    else enemyLaneMlids = next;

    matchup = null;
    matchupError = "";
    pulseFrozen = false;
  }

  function turnHint(action: (DraftAction & { limit: number }) | null) {
    if (!action) return "All pick and ban phases are completed.";
    if (action.type === "pick") return "Choose a hero from recommendations or from the full hero list below.";
    return "Ban high-impact threats to reduce enemy draft options.";
  }

  async function analyze() {
    const requestSeq = ++analyzeRequestSeq;
    const loadingStartedAt = Date.now();
    analyzeAbortController?.abort();
    const controller = new AbortController();
    analyzeAbortController = controller;
    loading = true;
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
      turnSide: currentAction?.side ?? "ally",
      draftSide: allyPickOrder === "first" ? "blue" : allyPickOrder === "second" ? "red" : undefined
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
        fetch(apiUrl(analyzeEndpoint()), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(requestBody)
        }),
        fetch(apiUrl("/draft/feasibility"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            allyMlids: requestBody.allyMlids,
            enemyMlids: requestBody.enemyMlids
          })
        })
      ]);

      const [analyzeJson, feasibilityJson] = await Promise.all([analyzeResponse.json(), feasibilityResponse.json()]);
      if (requestSeq !== analyzeRequestSeq) return;
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
      if (requestSeq !== analyzeRequestSeq) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      error = `Failed to load draft recommendations: ${String(e)}`;
      payload = null;
      feasibility = {
        ally: evaluateDraftFeasibility(requestBody.allyMlids, fallbackRolePool),
        enemy: evaluateDraftFeasibility(requestBody.enemyMlids, fallbackRolePool)
      };
      addDebug("analyze-error", { message: String(e) });
    } finally {
      if (analyzeAbortController === controller) {
        analyzeAbortController = null;
      }
      if (requestSeq === analyzeRequestSeq && analyzeAbortController === null) {
        const remaining = MOBILE_REC_LOADING_MIN_MS - (Date.now() - loadingStartedAt);
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }
        loading = false;
      }
    }
  }

  async function analyzeMatchup(options?: { reveal?: boolean; silent?: boolean }) {
    const reveal = options?.reveal ?? false;
    const silent = options?.silent ?? false;
    const requestSeq = ++matchupRequestSeq;
    if (reveal) swapSelection = null;
    if (!canAnalyze) {
      if (!silent && laneAdjustmentMode && !laneSlotsReady) {
        matchupError = "Please assign all lanes for both teams before running Analyze.";
      }
      addDebug("matchup-skip-not-ready", snapshotState());
      return;
    }

    if (laneAdjustmentMode && (allyLaneMlids.some((mlid) => !mlid) || enemyLaneMlids.some((mlid) => !mlid))) {
      if (!silent) matchupError = "Please assign all lanes for both teams before running Analyze.";
      addDebug("matchup-skip-lane-incomplete", {
        ally: allyLaneMlids,
        enemy: enemyLaneMlids
      });
      return;
    }

    pulseFrozen = true;
    const allyMlids = picksForMatchup("ally");
    const enemyMlids = picksForMatchup("enemy");
    matchupAbortController?.abort();
    const controller = new AbortController();
    matchupAbortController = controller;
    matchupLoading = true;
    if (!silent) matchupError = "";
    addDebug("matchup-start", {
      timeframe: mode === "ranked" ? timeframe : "7d",
      rankScope: mode === "ranked" ? rankScope : "mythic_glory",
      allyMlids,
      enemyMlids
    });

    try {
      const response = await fetch(apiUrl(matchupEndpoint()), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          timeframe: mode === "ranked" ? timeframe : "7d",
          rankScope: mode === "ranked" ? rankScope : "mythic_glory",
          allyMlids,
          enemyMlids,
          draftSide: allyPickOrder === "first" ? "blue" : allyPickOrder === "second" ? "red" : undefined,
          allyLaneMlids: laneAdjustmentMode ? normalizeMlids(allyLaneMlids, MAX_PICKS) : undefined,
          enemyLaneMlids: laneAdjustmentMode ? normalizeMlids(enemyLaneMlids, MAX_PICKS) : undefined
        })
      });

      const json = await response.json();
      if (requestSeq !== matchupRequestSeq) return;
      if (!response.ok) {
        throw new Error(json?.message ?? json?.detail ?? `HTTP ${response.status}`);
      }

      const nextMatchup = json as MatchupResult;
      liveMatchup = nextMatchup;
      if (reveal) {
        winningConditionUnlocked = true;
        matchup = nextMatchup;
      } else if (winningConditionUnlocked) {
        matchup = nextMatchup;
      }
      addDebug("matchup-success", json);
    } catch (e) {
      if (requestSeq !== matchupRequestSeq) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!silent) {
        winningConditionUnlocked = reveal || winningConditionUnlocked;
        matchupError = `Failed to analyze matchup: ${String(e)}`;
        matchup = null;
      }
      addDebug("matchup-error", { message: String(e) });
    } finally {
      if (matchupAbortController === controller) {
        matchupAbortController = null;
      }
      if (requestSeq === matchupRequestSeq && matchupAbortController === null) {
        matchupLoading = false;
      }
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

      if (action.type === "pick" && takenSet().has(pickedMlid)) {
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
      liveMatchup = null;
      winningConditionUnlocked = false;
      matchupError = "";
      pulseFrozen = false;
      addDebug("apply-hero-success", { mlid: pickedMlid, snapshot: snapshotState() });
      void analyze();
    } finally {
      actionBusy = false;
    }
  }

  async function resetDraft(reload = true) {
    analyzeRequestSeq += 1;
    matchupRequestSeq += 1;
    turnIndex = 0;
    actionProgress = 0;
    allySlotMlids = [null, null, null, null, null];
    enemySlotMlids = [null, null, null, null, null];
    allyBans = [];
    enemyBans = [];
    allyPickOrder = null;
    poolRoleFilter = "";
    poolLaneFilter = "";
    poolSearchQuery = "";
    resetRecommendationDetails();
    payload = null;
    feasibility = null;
    hasLoadedOnce = false;
    error = "";
    loading = false;
    actionBusy = false;
    matchup = null;
    liveMatchup = null;
    winningConditionUnlocked = false;
    matchupError = "";
    matchupLoading = false;
    pulseFrozen = false;
    laneAdjustInitialized = false;
    lastAutoMatchupKey = "";
    allyLaneMlids = [null, null, null, null, null];
    enemyLaneMlids = [null, null, null, null, null];
    swapSelection = null;
    normalizeTurnState();
    addDebug("reset-draft", snapshotState());
    if (reload) await analyze();
  }

  async function setMode(nextMode: DraftMode) {
    if (mode === nextMode) return;
    allyPickOrder = null;
    mode = nextMode;
    if (mode === "ranked") {
      timeframe = "7d";
      rankScope = "mythic_glory";
    }
    await resetDraft(true);
  }

  async function setTimeframe(nextTimeframe: string) {
    if (timeframe === nextTimeframe) return;
    allyPickOrder = null;
    timeframe = nextTimeframe;
    await resetDraft(true);
  }

  async function setRankScope(nextRankScope: string) {
    if (rankScope === nextRankScope) return;
    allyPickOrder = null;
    rankScope = nextRankScope;
    await resetDraft(true);
  }

  async function choosePickOrder(order: PickOrder) {
    if (allyPickOrder === order) return;
    allyPickOrder = order;
    normalizeTurnState();
    addDebug("pick-order-selected", { order, engine: $engine });
    await analyze();
  }
</script>

<svelte:window on:pointerdown={handleDesktopRecommendationOutsidePointerDown} on:keydown={handleRecommendationKeydown} />

<!-- Mobile: Portrait overlay -->
{#if isMobilePortrait}
<div class="m-portrait-overlay" role="alert" aria-live="polite">
  <p class="m-portrait-text">Rotate your phone for better experience</p>
  <div class="m-rotate-anim" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 19.29.99 14.18.2L16.48 2.52zm-6.25-.77c-1.17.1-2.25.44-3.23.9L8.44 4.1C9.71 3.7 11.06 3.5 12.46 3.5c.06 0 .12.01.18.01L10.23 1.75zM1.5 3.27L.06 4.71l2.34 2.34C1.51 8.57 1 10.22 1 12c0 5.52 4.48 10 10 10 1.78 0 3.45-.49 4.88-1.34l2.34 2.34 1.44-1.44L1.5 3.27zM12 20c-4.42 0-8-3.58-8-8 0-1.31.33-2.55.88-3.65L16.65 19.12C15.55 19.67 14.31 20 12 20z"/></svg>
  </div>
  <div class="m-portrait-actions">
    <button
      class="m-portrait-btn m-portrait-btn-secondary"
      disabled={mobilePortraitActionBusy !== null}
      aria-busy={mobilePortraitActionBusy === "home"}
      on:click={() => void backToMobileHome()}
    >
      {mobilePortraitActionBusy === "home" ? "Opening..." : "Back to Home"}
    </button>
    <button
      class="m-portrait-btn"
      disabled={mobilePortraitActionBusy !== null}
      aria-busy={mobilePortraitActionBusy === "reset"}
      on:click={() => void resetMobileDraft()}
    >
      {mobilePortraitActionBusy === "reset" ? "Resetting..." : "Reset Draft"}
    </button>
  </div>
</div>
{/if}

<!-- Mobile: Landscape full-screen layout -->
{#if isMobileLandscape}
<div
  class="m-shell"
  class:m-led-ally={Boolean(currentAction && banAnimationEnabled && currentAction.side === "ally")}
  class:m-led-enemy={Boolean(currentAction && banAnimationEnabled && currentAction.side === "enemy")}
>

  <!-- ── Mode selection overlay (first step) ── -->
  {#if !mobileModeConfirmed}
  <div class="m-mode-overlay">
    <div class="m-mode-card">
      <button class="m-mode-close" type="button" aria-label="Close Draft Master" on:click={() => void closeMobileLandscape()}>
        ×
      </button>
      <p class="m-mode-title">Draft Master</p>
      <p class="m-mode-sub">Select game mode to start</p>
      <div class="m-mode-btns">
        <button
          class="m-mode-btn {mode === 'ranked' ? 'active' : ''}"
          on:click={() => selectMobileMode("ranked")}
        >
          <span class="m-mode-icon">🏆</span>
          <span>Ranked</span>
        </button>
        <button
          class="m-mode-btn {mode === 'tournament' ? 'active' : ''}"
          on:click={() => selectMobileMode("tournament")}
        >
          <span class="m-mode-icon">⚔️</span>
          <span>Tournament</span>
        </button>
        <button
          class="m-mode-btn {mode === 'custom' ? 'active' : ''}"
          on:click={() => selectMobileMode("custom")}
        >
          <span class="m-mode-icon">⚙️</span>
          <span>Custom</span>
        </button>
      </div>
    </div>
  </div>
  {:else}

  <!-- ── Top bar: ally bans | turn info | enemy bans ── -->
  <div class="m-top">
    <div class="m-bans m-bans-ally">
      {#each allyTopBanSlots as mlid, i}
        <span class="m-ban-slot {mlid ? 'filled' : 'empty'} {allyTopBanTargetIndexes.has(i) ? 'target' : ''}">
          {#if mlid}
            <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={20} />
            <span class="m-ban-x" aria-hidden="true">✕</span>
          {/if}
        </span>
      {/each}
    </div>
    <div class="m-turn">
      <div class="m-turn-line">
        {#if currentAction?.side === "ally"}
          <span class="m-phase-arrow m-phase-arrow-left active" aria-hidden="true">
            <svg viewBox="0 0 80 20" fill="none">
              <path d="M26 4L18 10L26 16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M44 4L36 10L44 16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M62 4L54 10L62 16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        {/if}
        {#if currentAction?.side === "enemy"}
          <span class="m-phase-arrow-spacer" aria-hidden="true"></span>
        {/if}
        <strong>{mobileSequenceLabel}</strong>
        {#if currentAction?.side === "enemy"}
          <span class="m-phase-arrow m-phase-arrow-right active" aria-hidden="true">
            <svg viewBox="0 0 96 20" fill="none">
              <path d="M18 4L26 10L18 16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M38 4L46 10L38 16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M58 4L66 10L58 16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M78 4L86 10L78 16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        {/if}
        {#if currentAction?.side === "ally"}
          <span class="m-phase-arrow-spacer" aria-hidden="true"></span>
        {/if}
      </div>
      {#if currentAction}<span>{actionProgress}/{currentAction.limit}</span>{/if}
    </div>
    <div class="m-bans m-bans-enemy">
      {#each enemyTopBanSlots as mlid, i}
        <span class="m-ban-slot {mlid ? 'filled' : 'empty'} {enemyTopBanTargetIndexes.has(i) ? 'target' : ''}">
          {#if mlid}
            <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={20} />
            <span class="m-ban-x" aria-hidden="true">✕</span>
          {/if}
        </span>
      {/each}
    </div>
  </div>

  <!-- ── Main area: ally | center | enemy ── -->
  <div class="m-main">

    <!-- Ally picks column -->
    <div class="m-team m-team-ally" class:m-pulse={allyPanelPulse}>
      {#each displayAllySlots as slot, i}
        <div
          class="m-slot {slot.mlid ? 'filled' : 'empty'} {laneAdjustmentMode ? 'lane-adjust' : ''} {slot.state === 'target' ? 'target' : ''} {isSwapSource('ally', i) ? 'swap-source' : ''} {isSwapTarget('ally', i) ? 'swap-target' : ''}"
          aria-label="Ally slot {i + 1}"
        >
          {#if slot.mlid && manualSwapEnabled}
            <button
              type="button"
              class="m-slot-btn m-slot-btn--ally {isSwapSource('ally', i) ? 'is-source' : ''} {isSwapTarget('ally', i) ? 'is-target' : ''}"
              aria-label={swapButtonLabel('ally', i)}
              on:click={() => handleLaneSwapPress('ally', i)}
            >
              <span class="m-lane-corner m-lane-corner--ally" aria-hidden="true">
                <img src="/filters/{slot.lane}.webp" alt="" class="m-lane-img-corner" />
              </span>
              <span class="m-slot-avatar-wrap">
                <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={38} />
              </span>
              <span class="m-slot-label-wrap">
                {#if isSwapSource('ally', i)}
                  <span class="m-slot-label m-slot-label-source">Selected</span>
                {:else if isSwapTarget('ally', i)}
                  <span class="m-slot-label m-slot-label-target m-slot-label-marquee">{swapTargetText('ally', i)}</span>
                {:else}
                  <span class="m-slot-label">{heroName(slot.mlid)}</span>
                {/if}
              </span>
            </button>
          {:else if slot.mlid}
            <span class="m-slot-btn m-slot-btn--ally m-slot-btn-static">
              <span class="m-lane-corner m-lane-corner--ally" aria-hidden="true">
                <img src="/filters/{slot.lane}.webp" alt="" class="m-lane-img-corner" />
              </span>
              <span class="m-slot-avatar-wrap">
                <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={38} />
              </span>
              <span class="m-slot-label-wrap">
                <span class="m-slot-label">{heroName(slot.mlid)}</span>
              </span>
            </span>
          {:else}
            <span class="m-slot-btn m-slot-btn--ally m-slot-btn-empty">
              <span class="m-slot-dot"></span>
              <span class="m-slot-label-wrap">
                <span class="m-slot-label">Player {i + 1}</span>
              </span>
            </span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Center content -->
    <div class="m-center">

      {#if showPickOrderSelection}
        <!-- Step 2: Pick order selection -->
      <div class="m-pick-order">
          <div class="m-pick-order-head">
            <button class="m-back-btn" on:click={() => { mobileModeConfirmed = false; }}>← Mode</button>
            <span class="m-mode-badge">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
          </div>
          <p class="m-pick-order-hint">Choose your team's pick order</p>
          <div class="m-pick-order-btns">
            <button class="m-pick-order-btn" on:click={() => void choosePickOrder("first")}>
              <span class="m-po-num">1st</span>
              <span>First Pick</span>
            </button>
            <button class="m-pick-order-btn m-btn-muted" on:click={() => void choosePickOrder("second")}>
              <span class="m-po-num">2nd</span>
              <span>Second Pick</span>
            </button>
          </div>
        </div>

      {:else if !picksReady}
        <!-- Draft phase: filter + hero grid + rec bar -->

        <!-- Filter row -->
        <div class="m-filter">
          {#if !mobileSearchOpen}
            <button
              class="m-filter-switch"
              on:click={() => setPoolFilterMode(poolFilterMode === "role" ? "lane" : "role")}
              title={poolFilterMode === "role" ? "Switch to Lane" : "Switch to Role"}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4 8h12l-2.8-2.8 1.4-1.4L20 9.2l-5.4 5.4-1.4-1.4L16 10H4V8zm16 8H8l2.8 2.8-1.4 1.4L4 14.8l5.4-5.4 1.4 1.4L8 14h12v2z"/></svg>
            </button>
            <div class="m-filter-tabs">
              <button
                class="m-ftab {(poolFilterMode === 'role' ? poolRoleFilter : poolLaneFilter) === '' ? 'active' : ''}"
                on:click={() => setPoolFilterValue("")}
              >All</button>
              {#if poolFilterMode === "role"}
                {#each ROLES as role}
                  <button
                    class="m-ftab {poolRoleFilter === role ? 'active' : ''}"
                    on:click={() => setPoolFilterValue(role)}
                  >{roleLabel(role)}</button>
                {/each}
              {:else}
                {#each LANES as lane}
                  <button
                    class="m-ftab {poolLaneFilter === lane ? 'active' : ''}"
                    on:click={() => setPoolFilterValue(lane)}
                  >{laneLabel(lane)}</button>
                {/each}
              {/if}
            </div>
          {:else}
            <input
              class="m-search-input"
              type="search"
              inputmode="search"
              placeholder="Search hero..."
              bind:value={poolSearchQuery}
              on:input={onMobileSearchInput}
            />
          {/if}
          <button
            class="m-search-btn {mobileSearchOpen ? 'active' : ''}"
            on:click={() => { mobileSearchOpen = !mobileSearchOpen; if (!mobileSearchOpen) poolSearchQuery = ""; }}
            aria-label={mobileSearchOpen ? "Close search" : "Search hero"}
          >
            {#if mobileSearchOpen}
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            {/if}
          </button>
        </div>

        <!-- Hero grid: 7 cols, scrollable -->
        <div class="m-hero-grid">
          {#each heroPoolRows as row}
            <button
              class="m-hero-card {shouldShowBannedInPool(row.mlid) ? 'banned' : ''}"
              disabled={row.state.disabled}
              title={row.name}
              on:click={() => { void applyHero(row.mlid); poolSearchQuery = ""; mobileSearchOpen = false; }}
            >
              <HeroAvatar name={row.name} imageKey={row.imageKey} size={32} />
              <span class="m-hero-name">{row.name}</span>
            </button>
          {/each}
        </div>

        <!-- Bottom recommendation bar -->
        <div class="m-rec-bar">
          {#if mobileShowRecommendedOnly}
            <div class="m-rec-panel m-rec-panel-single">
              <span class="m-rec-panel-title">{recommendationPanelTitle("recommended")}</span>
              <span class="m-rec-panel-summary">{recommendationPanelSummary("recommended")}</span>
              <div class="m-rec-list m-rec-list-fixed m-rec-list-centered">
                {#each [0, 1, 2, 3] as i}
                  {@const row = mobileRecommendedHeroes[i]}
                  {#if loading && !row}
                    <div class="m-rec-item m-rec-item-loading" aria-hidden="true">
                      <span class="m-rec-avatar-skeleton"></span>
                      <span class="m-rec-name-skeleton"></span>
                    </div>
                  {:else if row}
                    {@const s = actionStateFor(row.mlid, { ignoreBusy: true })}
                    {@const explain = recommendationExplainLines(row, "recommended")[0] ?? row.fitReason}
                    <button class="m-rec-item" disabled={s.disabled} aria-haspopup="dialog" aria-expanded={mobileRecommendationDetail?.row.mlid === row.mlid && mobileRecommendationDetail.kind === "recommended"} title={`${heroName(row.mlid)} - ${explain}`} on:click={(event) => void openMobileRecommendationDetail(row, "recommended", event.currentTarget as HTMLElement)}>
                      <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={34} />
                      <span class="m-rec-name">{heroName(row.mlid)}</span>
                      <span class="m-rec-tier">Tier {tierLabel(row.score, row.tier)}</span>
                    </button>
                  {:else}
                    <div class="m-rec-item m-rec-item-empty" aria-hidden="true">
                      <span class="m-rec-avatar-skeleton"></span>
                      <span class="m-rec-name-skeleton"></span>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {:else if mobileShowMetaCounterOnly}
            <div class="m-rec-panels m-rec-panels-dual">
              <div class="m-rec-panel m-rec-panel-left">
                <span class="m-rec-panel-title">{recommendationPanelTitle("meta")}</span>
                <span class="m-rec-panel-summary m-rec-panel-summary-left">{recommendationPanelSummary("meta")}</span>
                <div class="m-rec-list m-rec-list-fixed">
                  {#each [0, 1, 2, 3] as i}
                    {@const row = mobileMetaRecommendations[i]}
                    {#if loading && !row}
                      <div class="m-rec-item m-rec-item-loading" aria-hidden="true">
                        <span class="m-rec-avatar-skeleton"></span>
                        <span class="m-rec-name-skeleton"></span>
                      </div>
                    {:else if row}
                      {@const s = actionStateFor(row.mlid, { ignoreBusy: true })}
                      {@const explain = recommendationExplainLines(row, "meta")[0] ?? row.fitReason}
                      <button class="m-rec-item" disabled={s.disabled} aria-haspopup="dialog" aria-expanded={mobileRecommendationDetail?.row.mlid === row.mlid && mobileRecommendationDetail.kind === "meta"} title={`${heroName(row.mlid)} - ${explain}`} on:click={(event) => void openMobileRecommendationDetail(row, "meta", event.currentTarget as HTMLElement)}>
                        <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={34} />
                        <span class="m-rec-name">{heroName(row.mlid)}</span>
                        <span class="m-rec-tier">Tier {tierLabel(row.score, row.tier)}</span>
                      </button>
                    {:else}
                      <div class="m-rec-item m-rec-item-empty" aria-hidden="true">
                        <span class="m-rec-avatar-skeleton"></span>
                        <span class="m-rec-name-skeleton"></span>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
              <div class="m-rec-panel m-rec-panel-right">
                <span class="m-rec-panel-title">{recommendationPanelTitle("counter")}</span>
                <span class="m-rec-panel-summary m-rec-panel-summary-right">{recommendationPanelSummary("counter")}</span>
                <div class="m-rec-list m-rec-list-fixed">
                  {#each [0, 1, 2, 3] as i}
                    {@const row = mobileCounterRecommendations[i]}
                    {#if loading && !row}
                      <div class="m-rec-item m-rec-item-loading" aria-hidden="true">
                        <span class="m-rec-avatar-skeleton"></span>
                        <span class="m-rec-name-skeleton"></span>
                      </div>
                    {:else if row}
                      {@const s = actionStateFor(row.mlid, { ignoreBusy: true })}
                      {@const explain = recommendationExplainLines(row, "counter")[0] ?? row.fitReason}
                      <button class="m-rec-item" disabled={s.disabled} aria-haspopup="dialog" aria-expanded={mobileRecommendationDetail?.row.mlid === row.mlid && mobileRecommendationDetail.kind === "counter"} title={`${heroName(row.mlid)} - ${explain}`} on:click={(event) => void openMobileRecommendationDetail(row, "counter", event.currentTarget as HTMLElement)}>
                        <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={34} />
                        <span class="m-rec-name">{heroName(row.mlid)}</span>
                        <span class="m-rec-tier">Tier {tierLabel(row.score, row.tier)}</span>
                      </button>
                    {:else}
                      <div class="m-rec-item m-rec-item-empty" aria-hidden="true">
                        <span class="m-rec-avatar-skeleton"></span>
                        <span class="m-rec-name-skeleton"></span>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            </div>
          {:else}
            <div class="m-rec-panel m-rec-panel-single">
              <span class="m-rec-panel-title">
                {#if currentAction?.type === "ban"}
                  Recommended Bans
                {:else}
                  Recommended Heroes
                {/if}
              </span>
              <div class="m-rec-list m-rec-list-fixed m-rec-list-centered">
                {#each [0, 1, 2, 3] as i}
                  {@const row = mobileRecommendedHeroes[i]}
                  {#if loading && !row}
                    <div class="m-rec-item m-rec-item-loading" aria-hidden="true">
                      <span class="m-rec-avatar-skeleton"></span>
                      <span class="m-rec-name-skeleton"></span>
                    </div>
                  {:else if row}
                    {@const s = actionStateFor(row.mlid, { ignoreBusy: true })}
                    {@const explain = recommendationExplainLines(row, "recommended")[0] ?? row.fitReason}
                    <button class="m-rec-item" disabled={s.disabled} aria-haspopup="dialog" aria-expanded={mobileRecommendationDetail?.row.mlid === row.mlid && mobileRecommendationDetail.kind === "recommended"} title={`${heroName(row.mlid)} - ${explain}`} on:click={(event) => void openMobileRecommendationDetail(row, "recommended", event.currentTarget as HTMLElement)}>
                      <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={34} />
                      <span class="m-rec-name">{heroName(row.mlid)}</span>
                      <span class="m-rec-tier">Tier {tierLabel(row.score, row.tier)}</span>
                    </button>
                  {:else}
                    <div class="m-rec-item m-rec-item-empty" aria-hidden="true">
                      <span class="m-rec-avatar-skeleton"></span>
                      <span class="m-rec-name-skeleton"></span>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        </div>

      {:else if !winningConditionUnlocked}
        <!-- Post-draft: manual lane swap + analyze -->
        <div class="m-analyze-wrap">
          <p class="m-analyze-sub">{mode.charAt(0).toUpperCase() + mode.slice(1)} Mode</p>
          <p class="m-analyze-hint">Tap the swap icon, then tap the target lane to adjust assignments</p>
          <button
            class="m-analyze-btn"
            disabled={matchupLoading || !canAnalyze}
            on:click={() => void analyzeMatchup({ reveal: true })}
          >
            {#if matchupLoading}
              <svg class="m-spin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
              Analyzing...
            {:else}
              Analyze Matchup
            {/if}
          </button>
          <button class="m-reset-btn" on:click={resetMobileDraft}>↩ Reset Draft</button>
        </div>

      {:else if showAnalysisCard}
        <!-- Full analysis result — scrollable, mirrors desktop -->
        <div class="m-analysis-scroll">
          {#if matchupLoading}
            <div class="m-analysis-loading-wrap">
              <svg class="m-spin" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="#60a5fa" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
              <p>Analyzing matchup...</p>
            </div>
          {:else if matchupError}
            <p class="m-analysis-err">{matchupError}</p>
          {:else if matchup}
            <!-- Headline + verdict -->
            <div class="m-analysis-headline-row"
              class:m-winner-ally={analysisWinner === "ally"}
              class:m-winner-enemy={analysisWinner === "enemy"}
              class:m-winner-balanced={analysisWinner === "balanced"}
            >
              <h3>{analysisHeadline}</h3>
              <p class="m-analysis-verdict-text">{matchup.verdict}</p>
            </div>

            <!-- Two team cards side by side -->
            <div class="m-analysis-teams">
              <!-- Ally team -->
              <div class="m-analysis-team m-at-ally">
                <div class="m-at-header">
                  <span class="m-at-label">Ally Team</span>
                  <span class="m-at-score">{matchup.allyScore.toFixed(1)}</span>
                </div>
                <div class="m-at-avatars">
                  {#each allyPicks as mlid}
                    <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={28} />
                  {/each}
                </div>
                <div class="m-at-metric">
                  <div class="m-at-metric-head">
                    <span>Score</span><span>{matchup.allyScore.toFixed(1)}</span>
                  </div>
                  <div class="m-at-bar"><span class="m-at-bar-fill ally" style="width:{allyScorePct}%"></span></div>
                </div>
                <div class="m-at-metric">
                  <div class="m-at-metric-head">
                    <span>Counter Edge</span><span>{matchup.components.allyCounterEdge.toFixed(2)}</span>
                  </div>
                  <div class="m-at-bar"><span class="m-at-bar-fill ally-counter" style="width:{allyCounterEdgePct}%"></span></div>
                </div>
                <p class="m-at-prob">Win Prob: <strong>{matchup.allyWinProb.toFixed(1)}%</strong></p>
                {#if matchup.details?.ally}
                  <p class="m-at-detail"><span class="m-at-detail-key">Covered:</span> {laneListText(matchup.details.ally.coveredLanes)}</p>
                  <p class="m-at-detail"><span class="m-at-detail-key">Missing:</span> {laneListText(matchup.details.ally.missingLanes)}</p>
                  <p class="m-at-detail"><span class="m-at-detail-key">Tiers:</span> {tierCountsText(matchup.details.ally.tierCounts)}</p>
                {/if}
              </div>

              <!-- Enemy team -->
              <div class="m-analysis-team m-at-enemy">
                <div class="m-at-header">
                  <span class="m-at-label">Enemy Team</span>
                  <span class="m-at-score">{matchup.enemyScore.toFixed(1)}</span>
                </div>
                <div class="m-at-avatars">
                  {#each enemyPicks as mlid}
                    <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={28} />
                  {/each}
                </div>
                <div class="m-at-metric">
                  <div class="m-at-metric-head">
                    <span>Score</span><span>{matchup.enemyScore.toFixed(1)}</span>
                  </div>
                  <div class="m-at-bar"><span class="m-at-bar-fill enemy" style="width:{enemyScorePct}%"></span></div>
                </div>
                <div class="m-at-metric">
                  <div class="m-at-metric-head">
                    <span>Counter Edge</span><span>{matchup.components.enemyCounterEdge.toFixed(2)}</span>
                  </div>
                  <div class="m-at-bar"><span class="m-at-bar-fill enemy-counter" style="width:{enemyCounterEdgePct}%"></span></div>
                </div>
                <p class="m-at-prob">Win Prob: <strong>{matchup.enemyWinProb.toFixed(1)}%</strong></p>
                {#if matchup.details?.enemy}
                  <p class="m-at-detail"><span class="m-at-detail-key">Covered:</span> {laneListText(matchup.details.enemy.coveredLanes)}</p>
                  <p class="m-at-detail"><span class="m-at-detail-key">Missing:</span> {laneListText(matchup.details.enemy.missingLanes)}</p>
                  <p class="m-at-detail"><span class="m-at-detail-key">Tiers:</span> {tierCountsText(matchup.details.enemy.tierCounts)}</p>
                {/if}
              </div>
            </div>

            <!-- Key factors -->
            {#if matchup.details?.keyFactors?.length}
              <div class="m-analysis-factors">
                <p class="m-factors-title">Key Factors</p>
                {#each matchup.details.keyFactors as factor}
                  <p class="m-factor-item">· {factor}</p>
                {/each}
              </div>
            {/if}

            <button class="m-reset-btn m-reset-analysis" on:click={resetMobileDraft}>↩ New Draft</button>
          {/if}
        </div>
      {/if}

    </div>

    <!-- Enemy picks column -->
    <div class="m-team m-team-enemy" class:m-pulse={enemyPanelPulse}>
      {#each displayEnemySlots as slot, i}
        <div
          class="m-slot {slot.mlid ? 'filled' : 'empty'} {laneAdjustmentMode ? 'lane-adjust' : ''} {slot.state === 'target' ? 'target' : ''} {isSwapSource('enemy', i) ? 'swap-source' : ''} {isSwapTarget('enemy', i) ? 'swap-target' : ''}"
          aria-label="Enemy slot {i + 1}"
        >
          {#if slot.mlid && manualSwapEnabled}
            <button
              type="button"
              class="m-slot-btn m-slot-btn--enemy {isSwapSource('enemy', i) ? 'is-source' : ''} {isSwapTarget('enemy', i) ? 'is-target' : ''}"
              aria-label={swapButtonLabel('enemy', i)}
              on:click={() => handleLaneSwapPress('enemy', i)}
            >
              <span class="m-lane-corner m-lane-corner--enemy" aria-hidden="true">
                <img src="/filters/{slot.lane}.webp" alt="" class="m-lane-img-corner" />
              </span>
              <span class="m-slot-avatar-wrap">
                <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={38} />
              </span>
              <span class="m-slot-label-wrap">
                {#if isSwapSource('enemy', i)}
                  <span class="m-slot-label m-slot-label-source">Selected</span>
                {:else if isSwapTarget('enemy', i)}
                  <span class="m-slot-label m-slot-label-target m-slot-label-marquee">{swapTargetText('enemy', i)}</span>
                {:else}
                  <span class="m-slot-label">{heroName(slot.mlid)}</span>
                {/if}
              </span>
            </button>
          {:else if slot.mlid}
            <span class="m-slot-btn m-slot-btn--enemy m-slot-btn-static">
              <span class="m-lane-corner m-lane-corner--enemy" aria-hidden="true">
                <img src="/filters/{slot.lane}.webp" alt="" class="m-lane-img-corner" />
              </span>
              <span class="m-slot-avatar-wrap">
                <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={38} />
              </span>
              <span class="m-slot-label-wrap">
                <span class="m-slot-label">{heroName(slot.mlid)}</span>
              </span>
            </span>
          {:else}
            <span class="m-slot-btn m-slot-btn--enemy m-slot-btn-empty">
              <span class="m-slot-dot"></span>
              <span class="m-slot-label-wrap">
                <span class="m-slot-label">Player {i + 1}</span>
              </span>
            </span>
          {/if}
        </div>
      {/each}
    </div>

  </div>
  {/if}
</div>
{/if}

{#if mobileRecommendationDetail && (isMobileLandscape || isMobilePortrait)}
  {@const detailState = actionStateFor(mobileRecommendationDetail.row.mlid, { ignoreBusy: true })}
  {@const detailLines = recommendationExplainLines(mobileRecommendationDetail.row, mobileRecommendationDetail.kind)}
  {@const detailMetrics = recommendationMetricBars(mobileRecommendationDetail.row, mobileRecommendationDetail.kind)}
  <div
    class="m-rec-sheet-backdrop"
    role="presentation"
    on:click={closeMobileRecommendationDetail}
    transition:fade={{ duration: 120 }}
  >
    <div
      class="m-rec-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="m-rec-sheet-title"
      on:click|stopPropagation
      transition:fade={{ duration: 140 }}
    >
      <div class="m-rec-sheet-grabber" aria-hidden="true"></div>
      <div class="m-rec-sheet-head">
        <div class="m-rec-sheet-hero">
          <HeroAvatar
            name={heroName(mobileRecommendationDetail.row.mlid)}
            imageKey={heroImage(mobileRecommendationDetail.row.mlid)}
            size={48}
          />
          <div class="m-rec-sheet-copy">
            <span class="m-rec-sheet-kicker">{recommendationPanelTitle(mobileRecommendationDetail.kind)}</span>
            <strong id="m-rec-sheet-title">{heroName(mobileRecommendationDetail.row.mlid)}</strong>
            <span>{heroRoleText(mobileRecommendationDetail.row.mlid)}</span>
            <span>{heroLaneLabels(mobileRecommendationDetail.row.mlid).join(" • ")}</span>
          </div>
        </div>
        <div class="m-rec-sheet-head-actions">
          <button
            class="m-rec-sheet-select"
            type="button"
            disabled={detailState.disabled}
            title={detailState.reason ?? undefined}
            on:click={() => void applyMobileRecommendationDetail()}
          >
            Select
          </button>
          <button class="m-rec-sheet-close" type="button" aria-label="Close details" on:click={closeMobileRecommendationDetail}>
            ×
          </button>
        </div>
      </div>

      <div class="m-rec-sheet-body">
        <div class="m-rec-sheet-badges">
          <span class="tier-pill">Tier {tierLabel(mobileRecommendationDetail.row.score, mobileRecommendationDetail.row.tier)}</span>
          {#if mobileRecommendationDetail.kind !== "recommended"}
            <span class="phase-chip phase-chip--{mobileRecommendationDetail.kind}">{mobileRecommendationDetail.kind}</span>
          {:else if mobileRecommendationDetail.row.pickPhase && currentAction?.type === "pick"}
            <span class="phase-chip phase-chip--{mobileRecommendationDetail.row.pickPhase}">{mobileRecommendationDetail.row.pickPhase}</span>
          {/if}
        </div>

        <div class="m-rec-sheet-section">
          <strong>Why this hero</strong>
          {#each detailLines as line}
            <p>{line}</p>
          {/each}
        </div>

        <div class="m-rec-sheet-metrics">
          {#each detailMetrics as metric}
            <div class="m-rec-metric-card m-rec-metric-card--{metric.tone}">
              <div class="m-rec-metric-head">
                <span>{metric.label}</span>
                <strong>{metricPercent(metric.value)}%</strong>
              </div>
              <div class="m-rec-metric-bar">
                <span class="m-rec-metric-fill" style={`width: ${metricPercent(metric.value)}%`}></span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if desktopRecommendationDetail && !isMobileLandscape && !isMobilePortrait}
  {@const detailLines = recommendationExplainLines(desktopRecommendationDetail.row, desktopRecommendationDetail.kind)}
  {@const detailMetrics = recommendationMetricBars(desktopRecommendationDetail.row, desktopRecommendationDetail.kind)}
  <div
    class="rec-popover rec-popover--desktop rec-popover--{desktopRecommendationPlacement.vertical} rec-popover--{desktopRecommendationPlacement.horizontal}"
    role="dialog"
    aria-modal="false"
    aria-labelledby="desktop-rec-popover-title"
    style={`top:${desktopRecommendationPopoverPosition.top}px; left:${desktopRecommendationPopoverPosition.left}px;`}
    on:click|stopPropagation
    on:mouseenter={cancelDesktopRecommendationClose}
    on:mouseleave={queueDesktopRecommendationClose}
    transition:fade={{ duration: 110 }}
  >
    <div class="rec-popover-arrow rec-popover-arrow--{desktopRecommendationPlacement.vertical} rec-popover-arrow--{desktopRecommendationPlacement.horizontal}" aria-hidden="true"></div>
    <div class="rec-popover-head">
      <div class="rec-popover-hero">
        <HeroAvatar name={heroName(desktopRecommendationDetail.row.mlid)} imageKey={heroImage(desktopRecommendationDetail.row.mlid)} size={44} />
        <div class="rec-popover-copy">
          <span class="rec-popover-kicker">{recommendationPanelTitle(desktopRecommendationDetail.kind)}</span>
          <strong id="desktop-rec-popover-title">{heroName(desktopRecommendationDetail.row.mlid)}</strong>
          <span>{heroRoleText(desktopRecommendationDetail.row.mlid)}</span>
        </div>
      </div>
      <div class="rec-popover-actions">
        <button class="rec-popover-close" type="button" aria-label="Close details" on:click={closeDesktopRecommendationDetail}>×</button>
      </div>
    </div>
    <div class="rec-popover-badges">
      <span class="tier-pill">Tier {tierLabel(desktopRecommendationDetail.row.score, desktopRecommendationDetail.row.tier)}</span>
      {#if desktopRecommendationDetail.kind !== "recommended"}
        <span class="phase-chip phase-chip--{desktopRecommendationDetail.kind}">{desktopRecommendationDetail.kind}</span>
      {:else if desktopRecommendationDetail.row.pickPhase && currentAction?.type === "pick"}
        <span class="phase-chip phase-chip--{desktopRecommendationDetail.row.pickPhase}">{desktopRecommendationDetail.row.pickPhase}</span>
      {/if}
    </div>
    <div class="rec-popover-section">
      <strong>Why this hero</strong>
      {#each detailLines as line}
        <p>{line}</p>
      {/each}
    </div>
    <div class="rec-popover-metrics">
      {#each detailMetrics as metric}
        <div class="m-rec-metric-card m-rec-metric-card--{metric.tone}">
          <div class="m-rec-metric-head">
            <span>{metric.label}</span>
            <strong>{metricPercent(metric.value)}%</strong>
          </div>
          <div class="m-rec-metric-bar">
            <span class="m-rec-metric-fill" style={`width: ${metricPercent(metric.value)}%`}></span>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<h1 class="page-title draft-page-title" class:m-hidden={isMobileLandscape || isMobilePortrait}>Draft Master</h1>

<section class="draft-master" class:m-hidden={isMobileLandscape || isMobilePortrait}>
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
      {:else if mode === "tournament"}
        <div class="field">
          <span class="field-label">Dataset</span>
          <div class="pill-info">{allyPickOrder ? selectedEngineInfo : "Tournament mode uses default 7 days and Mythical Glory+ scope."}</div>
          {#if m7UnavailableHint}
            <div class="pill-info pill-info-warning">{m7UnavailableHint}</div>
          {/if}
        </div>
      {:else}
        <div class="field">
          <span class="field-label">Dataset</span>
          <div class="pill-info">{allyPickOrder ? selectedEngineInfo : "Custom mode uses default 7 days and Mythical Glory+ scope."}</div>
          {#if m7UnavailableHint}
            <div class="pill-info pill-info-warning">{m7UnavailableHint}</div>
          {/if}
        </div>
      {/if}
    </div>

      <div class="toolbar-card">
        <span class="field-label">Mode</span>
        <div class="mode-switch">
          <button class:active={mode === "ranked"} class="mode-btn" on:click={() => void setMode("ranked")}>Ranked</button>
          <button class:active={mode === "tournament"} class="mode-btn" on:click={() => void setMode("tournament")}>Tournament</button>
          <button class:active={mode === "custom"} class="mode-btn" on:click={() => void setMode("custom")}>Custom</button>
        </div>
      </div>

    <div class="toolbar-card action-field">
      <span class="field-label">Action</span>
      <button class="btn-danger" on:click={() => void resetDraft(false)}>Clear Matchup</button>
    </div>
  </div>

  <div
    class="draft-top-strip"
    class:led-ally={Boolean(currentAction && banAnimationEnabled && currentAction.side === "ally")}
    class:led-enemy={Boolean(currentAction && banAnimationEnabled && currentAction.side === "enemy")}
  >
    <div class="top-bans ally">
      {#each allyTopBanSlots as mlid, index}
        <span
          class="top-ban-avatar {mlid ? 'filled' : 'empty'} {allyTopBanTargetIndexes.has(index) ? 'active-target' : ''}"
          title={mlid ? heroName(mlid) : "Empty ban slot"}
        >
          {#if mlid}
            <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={28} />
            <span class="banned-badge" aria-hidden="true">⊘</span>
          {/if}
        </span>
      {/each}
    </div>
    <div class="top-order ally">{allyPickOrderLabel}</div>
    <div class="top-turn">
      <strong>
        {#if showPickOrderSelection}
          Choose Your Pick Order
        {:else if currentAction}
          {sideLabelFull(currentAction.side)} {currentAction.type.toUpperCase()} TURN
        {:else}
          Draft Complete
        {/if}
      </strong>
      <span class="top-turn-phase">{desktopPhaseLabel}</span>
      <span>{desktopPhaseSubtitle}</span>
    </div>
    <div class="top-order enemy">{enemyPickOrderLabel}</div>
    <div class="top-bans enemy">
      {#each enemyTopBanSlots as mlid, index}
        <span
          class="top-ban-avatar {mlid ? 'filled' : 'empty'} {enemyTopBanTargetIndexes.has(index) ? 'active-target' : ''}"
          title={mlid ? heroName(mlid) : "Empty ban slot"}
        >
          {#if mlid}
            <HeroAvatar name={heroName(mlid)} imageKey={heroImage(mlid)} size={28} />
            <span class="banned-badge" aria-hidden="true">⊘</span>
          {/if}
        </span>
      {/each}
    </div>
  </div>

  <div class="draft-grid">
    <aside class="team-panel ally-side" class:panel-pulse={allyPanelPulse}>
      <div class="panel-title">
        <h3>Ally Team</h3>
        <span>{allyPickCount}/{MAX_PICKS}</span>
      </div>
      <p class="panel-meta">Picks {allyPickCount}/{MAX_PICKS} | Bans {allyBans.length}/{banTargetPerSide}</p>
      {#if currentAction}
        <div class="panel-summary">
          <span><strong>Filled:</strong> {laneListText(allyLaneState.filled)}</span>
          <span><strong>Missing:</strong> {laneListText(allyLaneState.missing)}</span>
          <span><strong>Team needs:</strong> {allyRoleNeeds.length ? allyRoleNeeds.join(", ") : "balanced coverage"}</span>
        </div>
      {/if}

      {#if laneAdjustmentMode}
        <div class="role-indicators">
          {#each displayAllySlots as slot}
            <span class="role-chip {slot.state}">{slot.label}</span>
          {/each}
        </div>
        {#if manualSwapEnabled}
          <p class="slot-helper-copy">Tap one hero card, then tap another lane card to swap positions.</p>
        {/if}
      {/if}

      <div class="slot-list">
        {#each displayAllySlots as slot, index}
          <div
            class="slot-item {slot.mlid ? 'filled' : 'empty'} {slot.state === 'target' ? 'target-slot' : ''} {laneAdjustmentMode ? 'lane-adjust' : ''} {isSwapSource('ally', index) ? 'swap-source' : ''} {isSwapTarget('ally', index) ? 'swap-target' : ''}"
            aria-label={`Ally ${slot.label} slot`}
          >
            <div class="slot-head">
              <strong class:slot-lane-head={laneAdjustmentMode}>
                {#if laneAdjustmentMode}
                  <span class="slot-lane-head">
                    <img src="/filters/{slot.lane}.webp" alt="" class="slot-head-lane-icon" />
                    <span>{slot.label}</span>
                  </span>
                {:else}
                  Player {index + 1}
                {/if}
              </strong>
              <em class="slot-state {slot.state}">
                {#if slot.mlid}
                  {laneAdjustmentMode ? (winningConditionUnlocked ? "FIX" : isSwapSource('ally', index) ? "READY" : "SWAP") : "LOCKED"}
                {:else if slot.state === "target"}
                  NEXT PICK
                {:else}
                  OPEN
                {/if}
              </em>
            </div>
            {#if slot.mlid}
              <span class="slot-hero slot-hero--ally">
                {#if manualSwapEnabled}
                  <button
                    type="button"
                    class="slot-swap-card {isSwapTarget('ally', index) ? 'is-callout' : ''} {isSwapSource('ally', index) ? 'is-selected' : ''}"
                    aria-label={swapButtonLabel('ally', index)}
                    on:click={() => handleLaneSwapPress('ally', index)}
                  >
                    <span class="slot-avatar-shell slot-avatar-shell--featured">
                      <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={32} />
                    </span>
                    <span class="slot-swap-copy">
                      {#if isSwapSource('ally', index)}
                        <span class="slot-hero-name slot-hero-name-selected">{heroName(slot.mlid)}</span>
                        <span class="slot-swap-hint">Selected. Tap another lane to swap.</span>
                      {:else if isSwapTarget('ally', index)}
                        <span class="slot-swap-text slot-swap-text-marquee">{swapTargetText('ally', index)}</span>
                      {:else}
                        <span class="slot-hero-name">{heroName(slot.mlid)}</span>
                      {/if}
                    </span>
                  </button>
                {:else}
                  <span class="slot-avatar-shell slot-avatar-shell--featured">
                    <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={32} />
                  </span>
                  <span class="slot-swap-copy">
                    <span class="slot-hero-name">{heroName(slot.mlid)}</span>
                  </span>
                {/if}
              </span>
            {:else}
              <span>Waiting pick</span>
            {/if}
          </div>
        {/each}
      </div>
      {#if allyFeasibility.unassignedHeroes.length > 0}
        <p class="slot-warning">Flex unresolved: {allyFeasibility.unassignedHeroes.map((mlid) => heroName(mlid)).join(", ")}</p>
      {/if}
    </aside>

    <section class="draft-center">
      {#if displayDraftProbability}
        <div class="win-prob-bar" class:is-loading={matchupLoading} style:opacity={displayDraftProbability.confidence < 0.3 ? 0.5 : 1}>
          <span class="prob-label ally">{displayDraftProbability.allyWinProb.toFixed(0)}%</span>
          <div class="prob-track">
            <div class="prob-fill ally" style="width: {displayDraftProbability.allyWinProb}%"></div>
            <div class="prob-fill enemy" style="width: {displayDraftProbability.enemyWinProb}%"></div>
          </div>
          <span class="prob-label enemy">{displayDraftProbability.enemyWinProb.toFixed(0)}%</span>
          {#if matchupLoading}
            <span class="prob-loading">Updating...</span>
          {/if}
        </div>
      {/if}
      {#if currentAction}
        {#if showPickOrderSelection}
          {#if bestDraftLoading}
            <div class="best-draft-wrap best-draft-skeleton-wrap" aria-hidden="true">
              <div class="best-draft-head">
                <Skeleton height="12px" width="220px" radius="999px" />
                <Skeleton height="24px" width="92px" radius="999px" />
              </div>
              <div class="best-draft-tier">
                <div class="best-draft-tier-label">Optimal 5-Lane Composition</div>
                <div class="best-draft-tier-grid best-draft-tier-grid-lanes">
                  {#each SLOT_LANES as lane (lane)}
                    <div class="best-draft-card best-draft-card-lane-pick best-draft-card-skeleton">
                      <span class="best-draft-lane-chip">{laneLabel(lane)}</span>
                      <Skeleton height="44px" width="44px" radius="14px" />
                      <Skeleton height="10px" width="64px" radius="999px" />
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {:else if bestDraftReady}
            <div class="best-draft-wrap">
              <div class="best-draft-head">
                <span class="best-draft-title">Best Draft Picks Recomendation</span>
                <span class="best-draft-comp-score" title="CompositionScore = Σ HeroScore×1.0 + Synergy×0.6 − Conflict×0.8 + Coherence×0.5 + Flex×0.2">
                  Score {bestDraftCompositionScore.toFixed(1)}
                </span>
              </div>
              <div class="best-draft-tier">
                <div class="best-draft-tier-label">Optimal 5-Lane Composition</div>
                <div class="best-draft-tier-grid best-draft-tier-grid-lanes">
                  {#each bestDraftLanePicks as pick (pick.lane)}
                    {@const tl = tierLabel(pick.row.score, pick.row.tier)}
                    <div class="best-draft-card best-draft-card-lane-pick">
                      <span class="best-draft-lane-chip">{laneLabel(pick.lane)}</span>
                      <div class="best-draft-avatar">
                        <HeroAvatar name={heroName(pick.row.mlid)} imageKey={heroImage(pick.row.mlid)} size={44} />
                        <span class="best-draft-card-tier" class:badge-ss={tl === 'SS'} class:badge-s={tl === 'S'}>
                          {tl}
                        </span>
                        <span class="best-draft-tooltip-mini">
                          <strong>Why this hero</strong>
                          <span>Meta Power (M): {metricPercent(pick.row.breakdown?.tierPower ?? pick.row.score)}</span>
                          <span>Layer-1 Lane Score (L1): {pick.heroScore.toFixed(1)}</span>
                          <span>Flex Bonus: +{computeFlexValue(pick.row.mlid)}</span>
                          <span>L1 = 70% meta power + 30% lane fit.</span>
                        </span>
                      </div>
                      <span class="best-draft-card-name">{heroName(pick.row.mlid)}</span>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {:else}
            <div class="best-draft-loading">Not enough lane data to compose 5-lane core yet.</div>
          {/if}
          <div class="pick-order-wrap">
            <h3>Set Your Draft Perspective</h3>
            <p>Choose whether your team opens first or answers second to unlock turn-accurate draft simulation.</p>
            <div class="pick-order-actions">
              <button class="btn-action" on:click={() => void choosePickOrder("first")}>First Pick</button>
              <button class="btn-muted" on:click={() => void choosePickOrder("second")}>Second Pick</button>
            </div>
          </div>
        {:else}
        {#if laneAdjustmentMode}
          <p class="turn-meta turn-meta-highlight">
            Lane Phase: finalize best lane assignment before running the final matchup.
          </p>
        {:else if currentAction?.type === "pick" && isLastEnemyPickPhase}
          <p class="turn-meta turn-meta-highlight">
            Please assign heroes to your preferred lanes before finalizing.
          </p>
        {/if}

        <div class="pool-wrap">
          <div class="pool-head">
            <div class="pool-filter-rail">
              <button
                class="pool-switch-btn"
                on:click={() => setPoolFilterMode(poolFilterMode === "role" ? "lane" : "role")}
                title={poolFilterMode === "role" ? "Switch to Lane filter" : "Switch to Role filter"}
                aria-label={poolFilterMode === "role" ? "Switch to Lane filter" : "Switch to Role filter"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 8h12l-2.8-2.8 1.4-1.4L20 9.2l-5.4 5.4-1.4-1.4L16 10H4V8zm16 8H8l2.8 2.8-1.4 1.4L4 14.8l5.4-5.4 1.4 1.4L8 14h12v2z"></path>
                </svg>
              </button>
              <div class="pool-tabs" style={`grid-template-columns: repeat(${poolFilterMode === "role" ? ROLES.length + 1 : LANES.length + 1}, minmax(0, 1fr));`}>
                <button
                  class="pool-tab-btn"
                  class:active={(poolFilterMode === "role" ? poolRoleFilter : poolLaneFilter) === ""}
                  on:click={() => setPoolFilterValue("")}
                >
                  {poolFilterMode === "role" ? "All Role" : "All Lane"}
                </button>
                {#if poolFilterMode === "role"}
                  {#each ROLES as role}
                    <button
                      class="pool-tab-btn"
                      class:active={poolRoleFilter === role}
                      on:click={() => setPoolFilterValue(role)}
                    >
                      {roleLabel(role)}
                    </button>
                  {/each}
                {:else}
                  {#each LANES as lane}
                    <button
                      class="pool-tab-btn"
                      class:active={poolLaneFilter === lane}
                      on:click={() => setPoolFilterValue(lane)}
                    >
                      {laneLabel(lane)}
                    </button>
                  {/each}
                {/if}
              </div>
            </div>
            <input
              class="pool-search-compact"
              type="search"
              placeholder="Filter by typing to find hero"
              bind:value={poolSearchQuery}
            />
          </div>
          <div class="pool-grid">
            {#each heroPoolRows as row}
              <button
                class="pool-card {shouldShowBannedInPool(row.mlid) ? 'banned' : ''}"
                disabled={row.state.disabled}
                title={row.state.reason ?? ""}
                on:click={() => void applyHero(row.mlid)}
              >
                <HeroAvatar name={row.name} imageKey={row.imageKey} size={44} />
                <span>{row.name}</span>
                {#if shouldShowBannedInPool(row.mlid)}
                  <span class="banned-badge" aria-hidden="true">⊘</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        {#if desktopShowRecommendedHeroes}
        <div transition:fade={{ duration: 180 }} class="recommend-divider" role="separator">
          <div class="recommend-divider-copy">
            <span>{recommendationPanelTitle("recommended")}</span>
            <small>{recommendationPanelSummary("recommended")}</small>
          </div>
        </div>

        <div transition:fade={{ duration: 180 }} class="recommend-wrap {displayedActionableRecommendations.length === 0 && !loading ? 'is-hidden' : ''} {loading && displayedActionableRecommendations.length > 0 ? 'is-refreshing' : ''}">
          {#if loading && displayedActionableRecommendations.length === 0}
            <div class="desktop-rec-loading" aria-hidden="true">
              {#each DESKTOP_RECOMMENDATION_SKELETON_SLOTS as slot}
                <div class="desktop-rec-loading-card" data-slot={slot}>
                  <Skeleton height="40px" width="40px" radius="999px" />
                  <div class="desktop-rec-loading-meta">
                    <Skeleton height="10px" width="72%" radius="999px" />
                    <Skeleton height="8px" width="54%" radius="999px" />
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="recommend-list">
              {#each displayedActionableRecommendations as row}
                {@const recommendationState = actionStateFor(row.mlid)}
                <div
                  class="rec-card-anchor"
                  class:is-open={isDesktopRecommendationDetailOpen(row, "recommended")}
                  on:click|stopPropagation
                  on:mouseenter={(event) => openDesktopRecommendationPreview(row, "recommended", event.currentTarget as HTMLElement)}
                  on:mouseleave={queueDesktopRecommendationClose}
                >
                  <button
                    class="rec-card"
                    disabled={recommendationState.disabled || loading}
                    aria-haspopup="dialog"
                    aria-expanded={isDesktopRecommendationDetailOpen(row, "recommended")}
                    on:click={() => void applyHero(row.mlid)}
                  >
                    <span class="rec-avatar-mini">
                      <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={40} />
                    </span>
                    <span class="rec-meta-mini">
                      <strong>{heroName(row.mlid)}</strong>
                      <span class="pills-row">
                        <span class="tier-pill">Tier {tierLabel(row.score, row.tier)}</span>
                        {#if row.pickPhase && currentAction?.type === "pick"}
                          <span class="phase-chip phase-chip--{row.pickPhase}">{row.pickPhase}</span>
                        {/if}
                      </span>
                    </span>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        {/if}

        {#if loading && desktopShowMetaCounterPanels && displayedMetaRecommendations.length === 0 && displayedCounterRecommendations.length === 0}
          <div transition:fade={{ duration: 180 }}>
            <div class="recommend-divider" role="separator">
              <div class="recommend-divider-copy">
                <span>{recommendationPanelTitle("meta")}</span>
                <small>{recommendationPanelSummary("meta")}</small>
              </div>
            </div>
            <div class="recommend-wrap">
              <div class="desktop-rec-loading" aria-hidden="true">
                {#each DESKTOP_RECOMMENDATION_SKELETON_SLOTS as slot}
                  <div class="desktop-rec-loading-card" data-slot={slot}>
                    <Skeleton height="40px" width="40px" radius="999px" />
                    <div class="desktop-rec-loading-meta">
                      <Skeleton height="10px" width="72%" radius="999px" />
                      <Skeleton height="8px" width="54%" radius="999px" />
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <div class="recommend-divider" role="separator">
              <div class="recommend-divider-copy">
                <span>{recommendationPanelTitle("counter")}</span>
                <small>{recommendationPanelSummary("counter")}</small>
              </div>
            </div>
            <div class="recommend-wrap">
              <div class="desktop-rec-loading" aria-hidden="true">
                {#each DESKTOP_RECOMMENDATION_SKELETON_SLOTS as slot}
                  <div class="desktop-rec-loading-card" data-slot={slot}>
                    <Skeleton height="40px" width="40px" radius="999px" />
                    <div class="desktop-rec-loading-meta">
                      <Skeleton height="10px" width="72%" radius="999px" />
                      <Skeleton height="8px" width="54%" radius="999px" />
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {:else if desktopShowMetaCounterHeroes}
          <div transition:fade={{ duration: 180 }}>
            <div class="recommend-divider" role="separator">
              <div class="recommend-divider-copy">
                <span>{recommendationPanelTitle("meta")}</span>
                <small>{recommendationPanelSummary("meta")}</small>
              </div>
            </div>
            <div class="recommend-wrap {displayedMetaRecommendations.length === 0 ? 'is-hidden' : ''} {loading && displayedMetaRecommendations.length > 0 ? 'is-refreshing' : ''}">
              <div class="recommend-list">
                {#each displayedMetaRecommendations as row}
                  {@const s = actionStateFor(row.mlid)}
                  <div
                    class="rec-card-anchor"
                    class:is-open={isDesktopRecommendationDetailOpen(row, "meta")}
                    on:click|stopPropagation
                    on:mouseenter={(event) => openDesktopRecommendationPreview(row, "meta", event.currentTarget as HTMLElement)}
                    on:mouseleave={queueDesktopRecommendationClose}
                  >
                    <button class="rec-card" disabled={s.disabled || loading} aria-haspopup="dialog" aria-expanded={isDesktopRecommendationDetailOpen(row, "meta")} on:click={() => void applyHero(row.mlid)}>
                      <span class="rec-avatar-mini">
                        <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={40} />
                      </span>
                      <span class="rec-meta-mini">
                        <strong>{heroName(row.mlid)}</strong>
                        <span class="pills-row">
                          <span class="tier-pill">Tier {tierLabel(row.score, row.tier)}</span>
                          <span class="phase-chip phase-chip--meta">meta</span>
                        </span>
                      </span>
                    </button>
                  </div>
                {/each}
              </div>
            </div>

            <div class="recommend-divider" role="separator">
              <div class="recommend-divider-copy">
                <span>{recommendationPanelTitle("counter")}</span>
                <small>{recommendationPanelSummary("counter")}</small>
              </div>
            </div>
            <div class="recommend-wrap {loading && displayedCounterRecommendations.length > 0 ? 'is-refreshing' : ''}">
              {#if displayedCounterRecommendations.length === 0}
                <p class="counter-empty-hint">Counter picks will appear after enemy picks are revealed.</p>
              {:else}
                <div class="recommend-list">
                  {#each displayedCounterRecommendations as row}
                    {@const s = actionStateFor(row.mlid)}
                    <div
                      class="rec-card-anchor"
                      class:is-open={isDesktopRecommendationDetailOpen(row, "counter")}
                      on:click|stopPropagation
                      on:mouseenter={(event) => openDesktopRecommendationPreview(row, "counter", event.currentTarget as HTMLElement)}
                      on:mouseleave={queueDesktopRecommendationClose}
                    >
                      <button class="rec-card" disabled={s.disabled || loading} aria-haspopup="dialog" aria-expanded={isDesktopRecommendationDetailOpen(row, "counter")} on:click={() => void applyHero(row.mlid)}>
                        <span class="rec-avatar-mini">
                          <HeroAvatar name={heroName(row.mlid)} imageKey={heroImage(row.mlid)} size={40} />
                        </span>
                        <span class="rec-meta-mini">
                          <strong>{heroName(row.mlid)}</strong>
                          <span class="pills-row">
                            <span class="tier-pill">Tier {tierLabel(row.score, row.tier)}</span>
                            <span class="phase-chip phase-chip--counter">counter</span>
                          </span>
                        </span>
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
        {/if}
      {:else}
        {#if !winningConditionUnlocked}
          <p class="draft-complete-hint">Draft picks are complete. Tap a hero card, then tap the target lane to tune lane power and team composition before running final matchup analysis.</p>
          <div class="analysis-cta-wrap">
            <button class="btn-action analysis-cta-btn" disabled={matchupLoading || !canAnalyze} on:click={() => void analyzeMatchup({ reveal: true })}>
              {matchupLoading ? "Analyzing..." : "Analyze Matchup"}
            </button>
          </div>
        {/if}
      {/if}

      {#if showAnalysisCard}
        <section
          class="analysis-card"
          class:analysis-focus={!currentAction}
          class:analysis-centered={!currentAction}
          class:analysis-winner-ally={analysisWinner === "ally"}
          class:analysis-winner-enemy={analysisWinner === "enemy"}
        >
          <div class="analysis-head">
            <h3>{analysisHeadline}</h3>
          </div>

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
                <div class="metric-bar alt"><span style={`width:${allyCounterEdgePct}%`}></span></div>
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
                <div class="metric-bar alt enemy"><span style={`width:${enemyCounterEdgePct}%`}></span></div>
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
      {/if}

    </section>

    <aside class="team-panel enemy-side" class:panel-pulse={enemyPanelPulse}>
      <div class="panel-title">
        <h3>Enemy Team</h3>
        <span>{enemyPickCount}/{MAX_PICKS}</span>
      </div>
      <p class="panel-meta">Picks {enemyPickCount}/{MAX_PICKS} | Bans {enemyBans.length}/{banTargetPerSide}</p>
      {#if currentAction}
        <div class="panel-summary">
          <span><strong>Filled:</strong> {laneListText(enemyLaneState.filled)}</span>
          <span><strong>Missing:</strong> {laneListText(enemyLaneState.missing)}</span>
          <span><strong>Team needs:</strong> {enemyRoleNeeds.length ? enemyRoleNeeds.join(", ") : "balanced coverage"}</span>
        </div>
      {/if}

      {#if laneAdjustmentMode}
        <div class="role-indicators">
          {#each displayEnemySlots as slot}
            <span class="role-chip {slot.state}">{slot.label}</span>
          {/each}
        </div>
        {#if manualSwapEnabled}
          <p class="slot-helper-copy">Tap one hero card, then tap another lane card to swap positions.</p>
        {/if}
      {/if}

      <div class="slot-list">
        {#each displayEnemySlots as slot, index}
          <div
            class="slot-item {slot.mlid ? 'filled' : 'empty'} {slot.state === 'target' ? 'target-slot' : ''} {laneAdjustmentMode ? 'lane-adjust' : ''} {isSwapSource('enemy', index) ? 'swap-source' : ''} {isSwapTarget('enemy', index) ? 'swap-target' : ''}"
            aria-label={`Enemy ${slot.label} slot`}
          >
            <div class="slot-head">
              <strong class:slot-lane-head={laneAdjustmentMode}>
                {#if laneAdjustmentMode}
                  <span class="slot-lane-head">
                    <img src="/filters/{slot.lane}.webp" alt="" class="slot-head-lane-icon" />
                    <span>{slot.label}</span>
                  </span>
                {:else}
                  Player {index + 1}
                {/if}
              </strong>
              <em class="slot-state {slot.state}">
                {#if slot.mlid}
                  {laneAdjustmentMode ? (winningConditionUnlocked ? "FIX" : isSwapSource('enemy', index) ? "READY" : "SWAP") : "LOCKED"}
                {:else if slot.state === "target"}
                  NEXT PICK
                {:else}
                  OPEN
                {/if}
              </em>
            </div>
            {#if slot.mlid}
              <span class="slot-hero slot-hero--enemy">
                {#if manualSwapEnabled}
                  <button
                    type="button"
                    class="slot-swap-card {isSwapTarget('enemy', index) ? 'is-callout' : ''} {isSwapSource('enemy', index) ? 'is-selected' : ''}"
                    aria-label={swapButtonLabel('enemy', index)}
                    on:click={() => handleLaneSwapPress('enemy', index)}
                  >
                    <span class="slot-avatar-shell slot-avatar-shell--featured">
                      <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={32} />
                    </span>
                    <span class="slot-swap-copy">
                      {#if isSwapSource('enemy', index)}
                        <span class="slot-hero-name slot-hero-name-selected">{heroName(slot.mlid)}</span>
                        <span class="slot-swap-hint">Selected. Tap another lane to swap.</span>
                      {:else if isSwapTarget('enemy', index)}
                        <span class="slot-swap-text slot-swap-text-marquee">{swapTargetText('enemy', index)}</span>
                      {:else}
                        <span class="slot-hero-name">{heroName(slot.mlid)}</span>
                      {/if}
                    </span>
                  </button>
                {:else}
                  <span class="slot-avatar-shell slot-avatar-shell--featured">
                    <HeroAvatar name={heroName(slot.mlid)} imageKey={heroImage(slot.mlid)} size={32} />
                  </span>
                  <span class="slot-swap-copy">
                    <span class="slot-hero-name">{heroName(slot.mlid)}</span>
                  </span>
                {/if}
              </span>
            {:else}
              <span>Waiting pick</span>
            {/if}
          </div>
        {/each}
      </div>
      {#if enemyFeasibility.unassignedHeroes.length > 0}
        <p class="slot-warning">Flex unresolved: {enemyFeasibility.unassignedHeroes.map((mlid) => heroName(mlid)).join(", ")}</p>
      {/if}
    </aside>
  </div>
</section>

<style>
  .draft-page-title {
    margin-bottom: 8px;
  }

  .draft-master {
    --draft-shell-min-height: calc(100dvh - 150px);
    --recommend-card-height: 64px;
    --recommend-panel-height: 74px;
    margin: 4px 0 20px;
    border: 1px solid rgba(128, 174, 243, 0.16);
    border-radius: 26px;
    padding: 14px;
    min-height: var(--draft-shell-min-height);
    display: flex;
    flex-direction: column;
    background: rgba(16, 30, 54, 0.66);
    box-shadow: inset 0 1px 0 rgba(209, 232, 255, 0.05), 0 18px 40px rgba(0, 0, 0, 0.24);
    backdrop-filter: blur(8px);
  }

  .draft-toolbar {
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr) 180px;
    gap: 6px;
    margin-bottom: 6px;
  }

  .draft-top-strip {
    border: 1px solid rgba(132, 176, 244, 0.2);
    border-radius: 16px;
    background: linear-gradient(90deg, rgba(17, 43, 79, 0.86), rgba(15, 29, 56, 0.84), rgba(66, 22, 43, 0.8));
    padding: 6px 8px;
    margin-bottom: 10px;
    display: grid;
    grid-template-columns: minmax(190px, 1fr) auto auto auto minmax(190px, 1fr);
    align-items: center;
    gap: 10px;
    position: relative;
    overflow: hidden;
  }

  .draft-top-strip::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 2px;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(
      90deg,
      rgba(34, 197, 94, 0) 0%,
      rgba(34, 197, 94, 0.2) 45%,
      rgba(34, 197, 94, 1) 50%,
      rgba(34, 197, 94, 0.2) 55%,
      rgba(34, 197, 94, 0) 100%
    );
    background-size: 190% 100%;
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }

  .draft-top-strip.led-ally::after {
    opacity: 1;
    animation: border-led-left 2.4s ease-in-out infinite;
  }

  .draft-top-strip.led-enemy::after {
    opacity: 1;
    animation: border-led-right 2.4s ease-in-out infinite;
  }

  .top-bans {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    flex-wrap: wrap;
  }

  .top-bans.enemy {
    justify-content: flex-end;
  }

  .top-turn {
    border: 1px solid rgba(147, 197, 253, 0.36);
    border-radius: 12px;
    padding: 5px 10px;
    background: rgba(8, 21, 45, 0.66);
    display: grid;
    justify-items: center;
    gap: 2px;
    min-width: 260px;
    text-align: center;
  }

  .top-turn strong {
    color: #e7f2ff;
    font-size: 0.86rem;
    letter-spacing: 0.04em;
  }

  .top-turn span {
    color: #9bc1f9;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .top-turn-phase {
    color: #d7e8ff;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: none;
  }

  .top-ban-avatar {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    border: 1px solid rgba(140, 183, 250, 0.42);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 1px rgba(8, 20, 43, 0.6);
    background: rgba(8, 21, 45, 0.7);
    position: relative;
  }

  .top-ban-avatar.empty {
    border-style: dashed;
    border-color: rgba(135, 170, 223, 0.5);
    background: rgba(10, 24, 50, 0.5);
  }

  .top-ban-avatar.filled {
    border-color: rgba(140, 183, 250, 0.72);
    filter: grayscale(0.35) saturate(0.85);
    opacity: 0.9;
  }

  .top-ban-avatar.active-target {
    border-style: solid;
    border-color: #22c55e;
    box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.3), 0 0 18px rgba(34, 197, 94, 0.24);
    animation: pulse-green 2.2s ease-in-out infinite alternate;
  }

  .top-order {
    border: 1px solid rgba(147, 197, 253, 0.42);
    border-radius: 999px;
    background: rgba(8, 21, 45, 0.78);
    color: #e8f2ff;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 8px 13px;
    line-height: 1;
    white-space: nowrap;
  }

  .top-order.ally {
    border-color: rgba(110, 177, 255, 0.62);
    box-shadow: 0 0 0 1px rgba(88, 156, 255, 0.2);
  }

  .top-order.enemy {
    border-color: rgba(255, 149, 170, 0.62);
    box-shadow: 0 0 0 1px rgba(255, 109, 139, 0.2);
  }

  .toolbar-card {
    border: 1px solid rgba(132, 176, 244, 0.18);
    border-radius: 12px;
    padding: 5px 7px;
    background: rgba(17, 31, 56, 0.64);
    box-shadow: inset 0 1px 0 rgba(205, 228, 255, 0.04);
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .field {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .field-label {
    font-size: 0.58rem;
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
    border-radius: 8px;
    color: #d9e8ff;
    padding: 4px 8px;
    font-size: 0.72rem;
  }

  .pill-info {
    border: 1px solid rgba(129, 172, 239, 0.2);
    border-radius: 12px;
    background: rgba(20, 37, 62, 0.72);
    color: #c4d7f5;
    padding: 7px 9px;
    font-size: 0.72rem;
    line-height: 1.25;
  }

  .pill-info-warning {
    margin-top: 6px;
    border-color: rgba(248, 113, 113, 0.28);
    background: rgba(78, 24, 34, 0.44);
    color: #fecaca;
  }

  .mode-switch {
    display: inline-flex;
    width: 100%;
    gap: 4px;
    min-height: 28px;
    padding: 2px;
    border-radius: 9px;
    border: 1px solid rgba(129, 172, 239, 0.22);
    background: rgba(16, 29, 52, 0.74);
  }

  .mode-btn {
    flex: 1 1 0;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 5px 6px;
    font-size: 0.68rem;
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

  .mode-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-action,
  .btn-muted,
  .btn-danger {
    border: 0;
    border-radius: 8px;
    padding: 5px 8px;
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
    height: 28px;
  }

  .action-field button {
    width: 100%;
    min-height: 28px;
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
    flex: 1 1 auto;
    min-height: 0;
    align-items: stretch;
  }

  .team-panel {
    border: 1px solid rgba(132, 176, 244, 0.18);
    border-radius: 18px;
    padding: 12px;
    min-height: 0;
    background: rgba(18, 33, 58, 0.64);
    box-shadow: inset 0 1px 0 rgba(206, 230, 255, 0.04);
  }

  .ally-side {
    border-color: rgba(64, 133, 255, 0.55);
  }

  .enemy-side {
    border-color: rgba(255, 92, 122, 0.36);
  }

  .team-panel.panel-pulse .slot-item.filled {
    border-color: rgba(74, 222, 128, 0.62);
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.2), 0 0 14px rgba(74, 222, 128, 0.16);
    animation: heartbeat-neon 1.25s ease-in-out infinite;
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

  .panel-meta {
    margin: -4px 0 8px;
    color: #9eb6d7;
    font-size: 0.68rem;
    letter-spacing: 0.01em;
  }

  .panel-summary {
    display: grid;
    gap: 4px;
    margin: 0 0 10px;
    padding: 8px 10px;
    border: 1px solid rgba(129, 172, 239, 0.14);
    border-radius: 10px;
    background: rgba(13, 25, 47, 0.48);
  }

  .panel-summary span {
    min-width: 0;
    color: #9eb6d7;
    font-size: 0.64rem;
    line-height: 1.35;
  }

  .panel-summary strong {
    color: #d6e6ff;
    font-weight: 700;
  }

  .archetype-badge {
    display: inline-block;
    padding: 2px 8px;
    margin-bottom: 6px;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #c8e0ff;
    background: rgba(59, 130, 246, 0.18);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 4px;
  }

  .win-prob-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    margin-bottom: 8px;
    transition: opacity 0.3s;
  }

  .win-prob-bar.is-loading {
    opacity: 0.82;
  }

  .prob-track {
    flex: 1;
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.06);
  }

  .prob-fill.ally {
    background: linear-gradient(90deg, #3b82f6, #60a5fa);
    transition: width 0.4s ease;
  }

  .prob-fill.enemy {
    background: linear-gradient(90deg, #ef4444, #f87171);
    transition: width 0.4s ease;
  }

  .prob-label {
    font-size: 0.7rem;
    font-weight: 700;
    min-width: 36px;
    text-align: center;
  }

  .prob-label.ally {
    color: #60a5fa;
  }

  .prob-label.enemy {
    color: #f87171;
  }

  .prob-loading {
    position: absolute;
    top: -8px;
    right: 0;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(169, 205, 255, 0.88);
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
    animation: pulse-green 2.2s ease-in-out infinite alternate;
  }

  .slot-list {
    display: grid;
    gap: 8px;
  }

  .slot-helper-copy {
    margin: -2px 0 8px;
    color: #9fc4f1;
    font-size: 0.68rem;
    line-height: 1.4;
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
    position: relative;
    overflow: hidden;
    transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease, transform 180ms ease;
  }

  .slot-item::before {
    content: "";
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(120deg, rgba(96, 165, 250, 0) 0%, rgba(96, 165, 250, 0.16) 35%, rgba(56, 189, 248, 0.34) 50%, rgba(96, 165, 250, 0.16) 65%, rgba(96, 165, 250, 0) 100%);
    background-size: 220% 100%;
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

  .slot-lane-head {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .slot-head-lane-icon {
    width: 16px;
    height: 16px;
    object-fit: contain;
    display: block;
    filter: drop-shadow(0 0 4px rgba(96, 165, 250, 0.22));
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
    animation: pulse-green 2.2s ease-in-out infinite alternate;
  }

  .slot-item.lane-adjust {
    border-style: solid;
    border-color: rgba(94, 150, 226, 0.45);
    cursor: default;
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .slot-item.lane-adjust.swap-source {
    border-color: rgba(74, 222, 128, 0.72);
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.28), 0 16px 34px rgba(17, 24, 39, 0.28), 0 0 28px rgba(56, 189, 248, 0.2);
    transform: translateY(-2px) scale(1.01);
    background: linear-gradient(135deg, rgba(18, 60, 98, 0.99) 0%, rgba(26, 82, 132, 0.99) 34%, rgba(17, 47, 84, 0.97) 100%);
  }

  .slot-item.lane-adjust.swap-target {
    border-color: rgba(251, 191, 36, 0.82);
    box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.28), 0 0 16px rgba(245, 158, 11, 0.18);
    background: linear-gradient(135deg, rgba(69, 45, 8, 0.46), rgba(54, 37, 11, 0.36));
  }

  .slot-item.lane-adjust.swap-source::before {
    opacity: 1;
    animation: slot-gradient-shift 2.2s linear infinite;
  }

  .slot-hero {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    position: relative;
  }

  .slot-avatar-shell {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .slot-avatar-shell--featured :global(.avatar) {
    width: 38px !important;
    height: 38px !important;
    border-radius: 50% !important;
    border: 1px solid rgba(160, 209, 255, 0.34) !important;
    box-shadow: 0 8px 18px rgba(10, 20, 38, 0.28);
  }

  .slot-item.swap-source .slot-avatar-shell--featured :global(.avatar) {
    border-color: rgba(125, 211, 252, 0.82) !important;
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.18), 0 10px 24px rgba(8, 21, 45, 0.36), 0 0 18px rgba(56, 189, 248, 0.18);
  }

  .slot-item.swap-target .slot-avatar-shell--featured :global(.avatar) {
    border-color: rgba(252, 211, 77, 0.74) !important;
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.14), 0 8px 18px rgba(8, 21, 45, 0.28);
  }

  .slot-hero--ally {
    justify-content: flex-start;
  }

  .slot-hero--enemy {
    justify-content: flex-start;
  }

  .slot-hero-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.84rem;
    font-weight: 700;
  }

  .slot-hero-name-selected {
    color: #eff8ff;
    text-shadow: 0 0 16px rgba(96, 165, 250, 0.22);
  }

  .slot-swap-card {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    color: inherit;
  }

  .slot-swap-copy {
    min-width: 0;
    display: grid;
    gap: 2px;
    overflow: hidden;
  }

  .slot-swap-card.is-selected {
    transform: translateY(-1px);
  }

  .slot-swap-card.is-callout {
    color: #fef3c7;
  }

  .slot-swap-hint {
    font-size: 0.66rem;
    color: #b7d2f7;
    letter-spacing: 0.02em;
  }

  .slot-swap-text {
    display: inline-block;
    max-width: 100%;
    font-size: 0.76rem;
    line-height: 1.2;
    white-space: nowrap;
    color: #fef3c7;
    font-weight: 700;
  }

  .slot-swap-text-marquee {
    animation: slot-marquee 8s linear infinite;
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

  .ban-chip.empty {
    border-color: rgba(64, 102, 164, 0.62);
    color: #9cb1d3;
    background: rgba(8, 19, 45, 0.62);
  }

  .draft-center {
    border: 1px solid rgba(132, 176, 244, 0.18);
    border-radius: 18px;
    padding: 12px;
    min-height: 0;
    display: flex;
    flex-direction: column;
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

  .turn-card.turn-card-ban {
    border-color: rgba(74, 222, 128, 0.35);
    background: linear-gradient(145deg, rgba(30, 73, 52, 0.56), rgba(20, 37, 62, 0.75));
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.2), inset 0 1px 0 rgba(187, 247, 208, 0.08);
  }

  .turn-card.turn-card-pick-ally {
    border-color: rgba(74, 222, 128, 0.35);
    background: linear-gradient(145deg, rgba(30, 73, 52, 0.56), rgba(20, 37, 62, 0.75));
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.2), inset 0 1px 0 rgba(187, 247, 208, 0.08);
  }

  .turn-card.turn-card-pick-enemy {
    border-color: rgba(74, 222, 128, 0.35);
    background: linear-gradient(145deg, rgba(30, 73, 52, 0.56), rgba(20, 37, 62, 0.75));
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.2), inset 0 1px 0 rgba(187, 247, 208, 0.08);
  }

  .turn-card.turn-card-last-enemy {
    border-color: rgba(74, 222, 128, 0.76);
    background: linear-gradient(145deg, rgba(28, 85, 54, 0.64), rgba(18, 39, 64, 0.86));
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.34), 0 0 28px rgba(74, 222, 128, 0.14), inset 0 1px 0 rgba(187, 247, 208, 0.14);
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

  .turn-meta-highlight {
    margin-top: 8px;
    border: 1px solid rgba(74, 222, 128, 0.45);
    border-radius: 10px;
    background: rgba(19, 74, 47, 0.45);
    color: #bbf7d0;
    padding: 7px 9px;
    font-weight: 600;
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
    padding: 6px 0 4px;
    margin-bottom: 4px;
    min-height: var(--recommend-panel-height);
    display: flex;
    align-items: stretch;
    transition: opacity 0.2s ease;
    position: relative;
    overflow: visible;
  }

  .recommend-wrap.is-refreshing::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: linear-gradient(90deg, rgba(17, 31, 56, 0) 0%, rgba(145, 185, 245, 0.08) 50%, rgba(17, 31, 56, 0) 100%);
    animation: recommend-refresh-sheen 1.2s ease-in-out infinite;
    pointer-events: none;
  }

  .recommend-divider {
    position: relative;
    margin: 0;
    padding: 6px 0;
    border-top: 1px solid rgba(129, 172, 239, 0.22);
    display: flex;
    justify-content: center;
  }

  .recommend-divider span {
    margin-top: -11px;
    padding: 0 10px;
    background: rgba(17, 31, 56, 0.92);
    color: #9cb1d3;
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .recommend-divider-copy {
    display: grid;
    justify-items: center;
    gap: 2px;
    margin-top: -11px;
    padding: 0 10px;
    background: rgba(17, 31, 56, 0.92);
  }

  .recommend-divider-copy small {
    color: #7f9cc2;
    font-size: 0.63rem;
    letter-spacing: 0.01em;
    text-transform: none;
  }

  .recommend-wrap.is-hidden {
    visibility: hidden;
  }

  @keyframes recommend-refresh-sheen {
    0% { transform: translateX(-18%); opacity: 0; }
    20% { opacity: 1; }
    100% { transform: translateX(18%); opacity: 0; }
  }

  .recommend-list {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    min-height: var(--recommend-card-height);
    width: 100%;
    overflow: visible;
    align-items: stretch;
  }

  .desktop-rec-loading {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    min-height: var(--recommend-card-height);
    width: 100%;
  }

  .desktop-rec-loading-card {
    border: 1px solid rgba(129, 172, 239, 0.16);
    border-radius: 12px;
    background: rgba(20, 37, 62, 0.52);
    padding: 7px 8px;
    min-height: var(--recommend-card-height);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .desktop-rec-loading-meta {
    min-width: 0;
    flex: 1 1 auto;
    display: grid;
    gap: 4px;
  }

  .rec-card {
    border: 1px solid rgba(129, 172, 239, 0.2);
    background: rgba(20, 37, 62, 0.78);
    color: var(--text);
    border-radius: 12px;
    text-align: left;
    padding: 8px 10px;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-height: var(--recommend-card-height);
    width: 100%;
    cursor: pointer;
    position: relative;
    transition: opacity 0.18s ease, transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .rec-card-anchor {
    position: relative;
    min-width: 0;
    width: 100%;
    overflow: visible;
    display: block;
  }

  .rec-card-anchor.is-open {
    z-index: 8;
  }

  .rec-card-anchor.is-open .rec-card {
    border-color: rgba(96, 165, 250, 0.68);
    box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.18);
  }

  .rec-meta-mini {
    min-width: 0;
    display: grid;
    gap: 5px;
    justify-items: start;
    text-align: left;
    width: 100%;
    align-content: center;
  }

  .rec-avatar-mini {
    width: 40px;
    height: 40px;
    border-radius: 999px;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .rec-card strong {
    font-size: 0.72rem;
    line-height: 1.1;
    color: #dce8ff;
    width: 100%;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .pills-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
  }

  .tier-pill {
    border-radius: 999px;
    border: 1px solid rgba(119, 210, 156, 0.45);
    background: rgba(21, 72, 53, 0.52);
    color: #b9f3d6;
    padding: 2px 7px;
    min-width: 0;
    max-width: 100%;
    text-align: center;
    font-size: 0.53rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .phase-chip {
    border-radius: 999px;
    padding: 2px 7px;
    min-width: 0;
    max-width: 100%;
    text-align: center;
    font-size: 0.49rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .phase-chip--meta {
    border: 1px solid rgba(255, 205, 60, 0.55);
    background: rgba(80, 55, 0, 0.55);
    color: #ffe57a;
  }
  .phase-chip--flex {
    border: 1px solid rgba(80, 220, 230, 0.45);
    background: rgba(10, 60, 72, 0.55);
    color: #7de8f0;
  }
  .phase-chip--counter {
    border: 1px solid rgba(255, 120, 60, 0.55);
    background: rgba(72, 20, 0, 0.55);
    color: #ffaa70;
  }

  .counter-empty-hint {
    margin: 0 0 10px;
    color: rgba(180, 200, 230, 0.5);
    font-size: 0.72rem;
    text-align: center;
    min-height: var(--recommend-card-height);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }

  .rec-card:hover {
    border-color: #60a5fa;
    box-shadow: 0 10px 20px rgba(8, 21, 45, 0.18);
    transform: translateY(-1px);
  }

  .rec-popover {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 10px);
    transform: translateX(-50%);
    width: min(320px, calc(100vw - 32px));
    border: 1px solid rgba(101, 137, 196, 0.44);
    border-radius: 12px;
    background: rgba(8, 20, 47, 0.96);
    color: #c9ddff;
    padding: 12px;
    display: grid;
    gap: 10px;
    z-index: 160;
    box-shadow: 0 18px 36px rgba(0, 0, 0, 0.32);
    pointer-events: auto;
    animation: rec-popover-in 140ms ease-out;
  }

  .rec-popover--desktop {
    position: fixed;
    width: min(320px, calc(100vw - 32px));
  }

  .rec-popover--desktop.rec-popover--center,
  .rec-popover--desktop.rec-popover--left,
  .rec-popover--desktop.rec-popover--right {
    right: auto;
    bottom: auto;
  }

  .rec-popover--top {
    bottom: calc(100% + 10px);
    top: auto;
  }

  .rec-popover--bottom {
    top: calc(100% + 10px);
    bottom: auto;
  }

  .rec-popover--desktop.rec-popover--top {
    top: 0;
    transform: translateY(calc(-100% - 10px));
  }

  .rec-popover--desktop.rec-popover--bottom {
    top: 0;
    transform: translateY(0);
  }

  .rec-popover--center {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
  }

  .rec-popover--left {
    left: 0;
    right: auto;
    transform: none;
  }

  .rec-popover--right {
    right: 0;
    left: auto;
    transform: none;
  }

  .rec-popover-arrow {
    position: absolute;
    left: 50%;
    bottom: -7px;
    width: 14px;
    height: 14px;
    background: rgba(8, 20, 47, 0.96);
    border-right: 1px solid rgba(101, 137, 196, 0.44);
    border-bottom: 1px solid rgba(101, 137, 196, 0.44);
    transform: translateX(-50%) rotate(45deg);
  }

  .rec-popover-arrow--bottom {
    top: -7px;
    bottom: auto;
    transform: translateX(-50%) rotate(225deg);
  }

  .rec-popover-arrow--left {
    left: 24px;
    transform: rotate(45deg);
  }

  .rec-popover-arrow--right {
    left: auto;
    right: 24px;
    transform: rotate(45deg);
  }

  .rec-popover-arrow--bottom.rec-popover-arrow--left {
    transform: rotate(225deg);
  }

  .rec-popover-arrow--bottom.rec-popover-arrow--right {
    transform: rotate(225deg);
  }

  .rec-popover-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    position: relative;
    z-index: 1;
  }

  .rec-popover-hero {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .rec-popover-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .rec-popover-kicker {
    font-size: 0.52rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7aa0c8;
  }

  .rec-popover-copy strong {
    font-size: 0.9rem;
    color: #eff6ff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rec-popover-copy span {
    font-size: 0.6rem;
    color: #9bb7dc;
    line-height: 1.3;
  }

  .rec-popover-close {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: 1px solid rgba(148, 193, 255, 0.18);
    background: rgba(14, 29, 56, 0.82);
    color: #dbeafe;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
    line-height: 1;
    padding: 0;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
  }

  .rec-popover-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    z-index: 1;
  }

  .rec-popover-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    position: relative;
    z-index: 1;
  }

  .rec-popover-section {
    display: grid;
    gap: 6px;
    padding: 10px;
    border-radius: 10px;
    background: rgba(14, 29, 56, 0.58);
    border: 1px solid rgba(132, 176, 244, 0.1);
    position: relative;
    z-index: 1;
  }

  .rec-popover-section strong {
    font-size: 0.68rem;
    color: #eaf2ff;
  }

  .rec-popover-section p {
    margin: 0;
    font-size: 0.6rem;
    line-height: 1.45;
    color: #a9c2e6;
  }

  .rec-popover-metrics {
    display: grid;
    gap: 8px;
    position: relative;
    z-index: 1;
  }

  .pool-wrap {
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 2px 0;
    display: grid;
    gap: 6px;
    margin-bottom: 8px;
  }

  .pool-head {
    display: grid;
    gap: 8px;
  }

  .pool-filter-rail {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .pool-filter-rail::-webkit-scrollbar {
    display: none;
  }

  .pool-tabs {
    display: grid;
    gap: 0;
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
  }

  .pool-switch-btn {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: #c7dcff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: 0 0 auto;
    box-shadow: none;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .pool-switch-btn svg {
    width: 23px;
    height: 23px;
    fill: currentColor;
  }

  .pool-switch-btn:focus,
  .pool-switch-btn:focus-visible,
  .pool-switch-btn:active {
    outline: none;
    box-shadow: none;
    background: transparent;
  }

  .pool-search-compact {
    width: 100%;
    min-width: 0;
    margin-bottom: 8px;
    border: 1px solid rgba(99, 132, 187, 0.28);
    border-radius: 8px;
    background: rgba(8, 18, 39, 0.58);
    color: #d4e6ff;
    font-size: 0.68rem;
    line-height: 1.15;
    padding: 6px 8px;
    outline: none;
  }

  .pool-search-compact::placeholder {
    color: rgba(168, 190, 224, 0.62);
  }

  .pool-search-compact:focus {
    border-color: rgba(123, 175, 255, 0.55);
    box-shadow: 0 0 0 1px rgba(123, 175, 255, 0.28);
  }

  .pool-tab-btn {
    border: 0;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: #a9c1e7;
    font-size: 0.84rem;
    font-weight: 700;
    padding: 6px 10px 4px;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: none;
    outline: none;
    text-align: center;
    -webkit-tap-highlight-color: transparent;
  }

  .pool-tab-btn.active {
    border-bottom-color: rgba(124, 176, 255, 0.92);
    background: transparent;
    color: #a9c1e7;
    box-shadow: none;
  }

  .pool-tab-btn:focus,
  .pool-tab-btn:focus-visible,
  .pool-tab-btn:active {
    outline: none;
    box-shadow: none;
    background: transparent;
  }

  .pool-grid {
    display: grid;
    grid-template-columns: repeat(9, minmax(0, 1fr));
    grid-auto-rows: 62px;
    align-content: start;
    gap: 6px 4px;
    height: 272px;
    align-content: start;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 2px;
  }

  .pool-card {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #dce8ff;
    padding: 0;
    display: grid;
    justify-items: center;
    gap: 2px;
    text-align: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    position: relative;
    transition: opacity 0.18s ease, filter 0.18s ease;
  }

  .pool-card.banned {
    filter: grayscale(0.65) saturate(0.7);
    opacity: 0.58;
  }

  .pool-card span {
    font-size: 0.54rem;
    line-height: 1.05;
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
    transform: none;
  }

  .pool-card:focus,
  .pool-card:focus-visible,
  .pool-card:active {
    outline: none;
    box-shadow: none;
    background: transparent;
    transform: none;
  }

  .banned-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.72);
    background: rgba(71, 85, 105, 0.95);
    color: #e5e7eb;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.58rem;
    line-height: 1;
    z-index: 3;
    pointer-events: none;
  }

  .draft-complete-hint {
    margin: 0 0 14px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid rgba(132, 177, 245, 0.32);
    background: rgba(18, 33, 58, 0.72);
    color: #c6daff;
    font-size: 0.92rem;
    line-height: 1.4;
    text-align: center;
  }

  .analysis-cta-wrap {
    margin-bottom: 14px;
    display: flex;
    justify-content: center;
  }

  .analysis-cta-btn {
    min-width: 220px;
    padding: 10px 18px;
    font-size: 0.92rem;
    font-weight: 800;
  }

  .best-draft-wrap {
    margin: 0 auto 14px;
    width: min(100%, 680px);
    border: 1px solid rgba(132, 177, 245, 0.2);
    border-radius: 16px;
    background: rgba(14, 26, 50, 0.72);
    overflow: visible;
    box-sizing: border-box;
  }

  .best-draft-skeleton-wrap {
    overflow: hidden;
  }

  .best-draft-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 14px;
    border-bottom: 1px solid rgba(132, 177, 245, 0.12);
    background: rgba(18, 36, 64, 0.56);
  }

  .best-draft-title {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8ab4f8;
  }

  .best-draft-comp-score {
    font-size: 0.7rem;
    font-weight: 700;
    color: #86efac;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(74, 222, 128, 0.24);
    border-radius: 6px;
    padding: 2px 8px;
    cursor: help;
  }

  .best-draft-loading {
    text-align: center;
    padding: 16px;
    font-size: 0.82rem;
    color: #6b8aad;
  }

  .best-draft-tier {
    padding: 10px 14px 12px;
    border-bottom: 1px solid rgba(132, 177, 245, 0.08);
  }

  .best-draft-tier:last-child {
    border-bottom: none;
  }

  .best-draft-tier-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
    color: #7a99c8;
  }

  .best-draft-tier-grid {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .best-draft-tier-grid-lanes {
    flex-wrap: nowrap;
    justify-content: space-between;
  }

  .best-draft-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 64px;
    position: relative;
  }

  .best-draft-card-lane-pick {
    width: 104px;
    min-width: 104px;
    align-items: center;
  }

  .best-draft-lane-chip {
    border-radius: 999px;
    border: 1px solid rgba(109, 169, 247, 0.4);
    background: rgba(36, 73, 130, 0.45);
    color: #b9d8ff;
    font-size: 0.52rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 6px;
  }

  .best-draft-avatar {
    position: relative;
    width: 44px;
    height: 44px;
  }

  .best-draft-card-tier {
    position: absolute;
    bottom: -4px;
    right: -4px;
    font-size: 0.54rem;
    font-weight: 800;
    line-height: 1;
    padding: 1px 3px;
    border-radius: 4px;
    background: rgba(59, 91, 160, 0.9);
    border: 1px solid rgba(130, 170, 255, 0.4);
    color: #c8e0ff;
    letter-spacing: 0.04em;
  }

  .best-draft-card-tier.badge-ss {
    background: rgba(180, 120, 10, 0.9);
    border-color: rgba(253, 211, 77, 0.5);
    color: #fde68a;
  }

  .best-draft-card-tier.badge-s {
    background: rgba(120, 85, 5, 0.92);
    border-color: rgba(253, 211, 77, 0.36);
    color: #fcd34d;
  }

  .best-draft-card-name {
    font-size: 0.62rem;
    color: #b8d0f0;
    text-align: center;
    line-height: 1.2;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .best-draft-tooltip-mini {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    width: 248px;
    border: 1px solid rgba(101, 137, 196, 0.44);
    border-radius: 8px;
    background: rgba(8, 20, 47, 0.96);
    color: #c9ddff;
    padding: 7px 8px;
    font-size: 0.64rem;
    line-height: 1.35;
    display: grid;
    gap: 3px;
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
    z-index: 120;
    text-align: left;
  }

  .best-draft-tooltip-mini strong {
    font-size: 0.66rem;
    color: #e3f0ff;
  }

  .best-draft-avatar:hover .best-draft-tooltip-mini,
  .best-draft-avatar:focus-within .best-draft-tooltip-mini {
    opacity: 1;
    transform: translateY(0);
  }

  .pick-order-wrap {
    margin: 10px auto 18px;
    width: min(100%, 680px);
    border: 1px solid rgba(132, 177, 245, 0.32);
    border-radius: 16px;
    background: rgba(18, 33, 58, 0.72);
    padding: 22px 24px;
    display: grid;
    gap: 14px;
    text-align: center;
    box-shadow: 0 12px 26px rgba(0, 0, 0, 0.22);
    box-sizing: border-box;
  }

  .pick-order-wrap h3 {
    margin: 0;
    font-size: 1.22rem;
    color: #d9e8ff;
  }

  .pick-order-wrap p {
    margin: 0;
    font-size: 0.92rem;
    color: #aac0e2;
  }

  .pick-order-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
  }

  .pick-order-actions .btn-action,
  .pick-order-actions .btn-muted {
    min-width: 160px;
    min-height: 44px;
    font-size: 0.9rem;
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
    display: grid;
    justify-items: start;
    gap: 8px;
  }

  .analysis-head h3 {
    margin: 0;
    font-size: 1.05rem;
    color: #e7f1ff;
  }

  .analysis-centered .analysis-head {
    justify-items: center;
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
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.3);
      transform: scale(1);
    }
    55% {
      box-shadow: 0 0 0 7px rgba(34, 197, 94, 0.08);
      transform: scale(1.01);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.2);
      transform: scale(1);
    }
  }

  @keyframes border-led-left {
    0% {
      background-position: 50% 0;
    }
    100% {
      background-position: 114% 0;
    }
  }

  @keyframes border-led-right {
    0% {
      background-position: 50% 0;
    }
    100% {
      background-position: -14% 0;
    }
  }

  @keyframes heartbeat-neon {
    0% {
      transform: scale(1);
      filter: saturate(1);
    }
    30% {
      transform: scale(1.005);
      filter: saturate(1.08);
    }
    44% {
      transform: scale(1);
      filter: saturate(1);
    }
    62% {
      transform: scale(1.01);
      filter: saturate(1.12);
    }
    100% {
      transform: scale(1);
      filter: saturate(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .top-ban-avatar.active-target,
    .slot-item.target-slot,
    .role-chip.target {
      animation: none;
      box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
    }
  }

  .team-panel.mobile-condensed .panel-title {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  .team-panel.mobile-condensed .panel-meta {
    font-size: 0.62rem;
    margin-bottom: 4px;
  }

  .team-panel.mobile-condensed :global(.avatar) {
    width: 30px !important;
    height: 30px !important;
  }

  @media (max-width: 1200px) {
    .draft-master {
      max-width: 960px;
      margin-left: auto;
      margin-right: auto;
      grid-template-columns: minmax(0, 1fr);
    }

    .draft-grid {
      grid-template-columns: 1fr;
    }

    .draft-top-strip {
      grid-template-columns: 1fr;
    }

    .top-bans,
    .top-bans.enemy {
      justify-content: center;
    }

    .top-order {
      justify-self: center;
    }

    .top-turn {
      min-width: 0;
    }
  }

  @media (max-width: 900px) {
    .draft-toolbar {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .draft-toolbar > * {
      border-left: 0;
      border-right: 0;
    }

    .analysis-grid {
      grid-template-columns: 1fr;
    }

    .analysis-card.mobile .analysis-grid {
      display: none;
    }

    .analysis-card.mobile.details-open .analysis-grid {
      display: grid;
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .pool-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-auto-rows: auto;
      height: auto;
      max-height: 340px;
    }

    .pool-card {
      padding: 6px 4px;
    }

    .pool-card.compact .pool-card-reasons {
      display: none;
    }

    .pool-card.compact:focus .pool-card-reasons,
    .pool-card.compact:focus-within .pool-card-reasons {
      display: block;
    }
  }

  @media (max-width: 640px) {
    .pool-tabs {
      display: flex;
      overflow-x: auto;
      flex-wrap: nowrap;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    .pool-tabs::-webkit-scrollbar {
      display: none;
    }

    .pool-tab-btn {
      min-width: fit-content;
      flex: 0 0 auto;
    }

    .pool-tab-btn:first-child {
      display: none;
    }

    .win-prob-bar {
      padding: 3px 0;
      margin-bottom: 4px;
    }

    .prob-track {
      height: 5px;
    }

    .analysis-stick {
      position: sticky;
      bottom: 0;
      z-index: 10;
      background: rgba(12, 24, 48, 0.92);
      backdrop-filter: blur(6px);
      padding: 8px 12px;
      margin: 0 -12px -12px;
      border-top: 1px solid rgba(99, 132, 187, 0.22);
    }

    .btn-action {
      min-height: 48px;
      width: 100%;
    }

    .pool-search-compact {
      position: sticky;
      top: 0;
      z-index: 5;
      height: 36px;
      padding: 4px 8px;
      background: rgba(8, 18, 39, 0.92);
      backdrop-filter: blur(4px);
      margin-bottom: 6px;
    }
  }

  .m-hidden { display: none !important; }

  .m-portrait-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(6, 13, 32, 0.98);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
  }

  .m-portrait-text {
    color: #d4e8ff;
    font-size: 1rem;
    font-weight: 600;
    text-align: center;
    padding: 0 32px;
    line-height: 1.45;
  }

  .m-rotate-anim {
    width: 72px;
    height: 72px;
    color: #60a5fa;
    animation: m-rotate-phone 1.8s ease-in-out infinite;
  }

  .m-portrait-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .m-portrait-btn {
    min-width: 128px;
    height: 38px;
    border: 1px solid rgba(116, 190, 255, 0.35);
    border-radius: 999px;
    background: rgba(44, 84, 140, 0.72);
    color: #e7f2ff;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 0 14px;
    cursor: pointer;
  }

  .m-portrait-btn-secondary {
    background: rgba(20, 38, 68, 0.78);
    color: #cfe2ff;
  }

  .m-portrait-btn:disabled {
    opacity: 0.62;
    cursor: wait;
    filter: saturate(0.82);
  }

  @keyframes m-rotate-phone {
    0%   { transform: rotate(0deg) scale(1); }
    25%  { transform: rotate(-90deg) scale(1.1); }
    60%  { transform: rotate(-90deg) scale(1); }
    85%  { transform: rotate(0deg) scale(1); }
    100% { transform: rotate(0deg) scale(1); }
  }

  .m-shell {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100dvh;
    height: 100vh;
    z-index: 100;
    background: linear-gradient(180deg, rgba(4, 10, 24, 0.9) 0%, rgba(8, 18, 42, 0.88) 100%);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    overscroll-behavior: none;
  }

  @supports (height: 100dvh) {
    .m-shell {
      height: 100dvh;
    }
  }

  .m-shell::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(5, 10, 22, 0.6) 0%, rgba(8, 16, 36, 0.52) 40%, rgba(7, 14, 30, 0.72) 100%),
      url("/mobile/draft-bg.png") center center / cover no-repeat;
    opacity: 0.8;
    pointer-events: none;
  }

  .m-shell::after {
    content: "";
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at center 70%, rgba(160, 215, 255, 0.08), transparent 28%),
      linear-gradient(90deg, rgba(5, 12, 30, 0.38) 0%, rgba(5, 12, 30, 0.08) 18%, rgba(5, 12, 30, 0.08) 82%, rgba(5, 12, 30, 0.38) 100%);
    pointer-events: none;
  }

  .m-mode-overlay {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    position: relative;
    z-index: 1;
  }

  .m-mode-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    max-width: 340px;
    width: 100%;
    padding: 16px 14px;
    border: 1px solid rgba(173, 216, 255, 0.12);
    border-radius: 16px;
    background: linear-gradient(180deg, rgba(7, 18, 42, 0.58), rgba(9, 19, 40, 0.42));
    backdrop-filter: blur(8px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  }

  .m-mode-close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid rgba(148, 193, 255, 0.2);
    background: rgba(14, 29, 56, 0.86);
    color: #dbeafe;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 700;
    line-height: 1;
    padding: 0;
  }

  .m-mode-close:active {
    background: rgba(24, 45, 82, 0.96);
    border-color: rgba(116, 190, 255, 0.34);
  }

  .m-mode-title {
    font-size: 1.2rem;
    font-weight: 800;
    color: #e7f2ff;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0;
  }

  .m-mode-sub {
    font-size: 0.72rem;
    color: #7a9cc4;
    margin: 0;
    letter-spacing: 0.03em;
  }

  .m-mode-btns {
    display: flex;
    gap: 10px;
    width: 100%;
  }

  .m-mode-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px;
    border-radius: 10px;
    border: 1px solid rgba(132, 176, 244, 0.14);
    background: linear-gradient(180deg, rgba(18, 34, 64, 0.56), rgba(14, 28, 54, 0.38));
    color: #9eb5d8;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 150ms, background 150ms, color 150ms;
  }

  .m-mode-btn:active,
  .m-mode-btn.active {
    border-color: rgba(116, 190, 255, 0.34);
    background: linear-gradient(180deg, rgba(44, 84, 140, 0.46), rgba(24, 50, 82, 0.32));
    color: #e0efff;
    box-shadow: 0 6px 18px rgba(59, 130, 246, 0.12);
  }

  .m-mode-icon {
    font-size: 1.3rem;
    line-height: 1;
  }

  .m-top {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    height: 34px;
    flex-shrink: 0;
    background: linear-gradient(90deg, rgba(10, 26, 52, 0.54), rgba(10, 21, 42, 0.38), rgba(45, 16, 28, 0.5));
    border-bottom: 1px solid rgba(168, 208, 255, 0.12);
    backdrop-filter: blur(8px);
    position: relative;
    z-index: 1;
  }

  .m-phase-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 44px;
    height: 16px;
    pointer-events: none;
    color: rgba(191, 219, 254, 0.7);
    filter: drop-shadow(0 0 10px rgba(96, 165, 250, 0.28));
  }

  .m-phase-arrow-left {
    margin-right: 6px;
  }

  .m-phase-arrow-right {
    width: 52px;
    margin-left: 6px;
  }

  .m-phase-arrow svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .m-phase-arrow-spacer {
    display: inline-block;
    width: 44px;
    height: 16px;
    flex-shrink: 0;
  }

  .m-phase-arrow-left.active {
    animation: m-phase-left 0.8s ease-in-out infinite;
    color: rgba(96, 165, 250, 0.92);
  }

  .m-phase-arrow-right.active {
    animation: m-phase-right 0.8s ease-in-out infinite;
    color: rgba(248, 113, 113, 0.92);
    filter: drop-shadow(0 0 10px rgba(248, 113, 113, 0.28));
  }

  .m-shell.m-led-ally .m-top {
    border-bottom-color: rgba(34, 197, 94, 0.28);
    box-shadow: 0 0 10px rgba(34, 197, 94, 0.08) inset;
  }

  .m-shell.m-led-enemy .m-top {
    border-bottom-color: rgba(239, 68, 68, 0.28);
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.08) inset;
  }

  .m-bans {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .m-bans-enemy { justify-content: flex-end; }

  .m-ban-slot {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid rgba(162, 202, 247, 0.16);
    background: rgba(8, 18, 38, 0.38);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  .m-ban-slot.filled {
    border-color: rgba(140, 183, 250, 0.28);
    filter: grayscale(0.35) saturate(0.8);
  }

  .m-ban-slot.target {
    border-color: #22c55e;
    border-style: solid;
    animation: pulse-green 2.2s ease-in-out infinite alternate;
  }

  .m-ban-x {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(180, 25, 25, 0.55);
    font-size: 7px;
    color: #fff;
    font-weight: 900;
  }

  .m-turn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    text-align: center;
  }

  .m-turn-line {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    gap: 0;
  }

  .m-turn strong {
    font-size: 0.62rem;
    color: #e7f2ff;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
    line-height: 1.2;
  }

  .m-turn span {
    font-size: 0.52rem;
    color: #9bc1f9;
    letter-spacing: 0.06em;
  }

  .m-main {
    display: grid;
    grid-template-columns: 96px 1fr 96px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    z-index: 1;
  }

  .m-team {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px;
    overflow: visible;
  }

  .m-team-ally {
    border-right: 1px solid rgba(116, 190, 255, 0.12);
    background: linear-gradient(to right, rgba(56, 132, 255, 0.18) 0%, rgba(56, 132, 255, 0.04) 70%, transparent 100%);
  }

  .m-team-enemy {
    border-left: 1px solid rgba(255, 124, 143, 0.12);
    background: linear-gradient(to left, rgba(239, 68, 68, 0.18) 0%, rgba(239, 68, 68, 0.04) 70%, transparent 100%);
  }

  .m-slot {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 3px 0 1px;
    border-radius: 5px;
    border: 1px solid transparent;
    background: transparent;
    min-height: 0;
    max-height: 20%;
    position: relative;
    overflow: visible;
    cursor: default;
  }

  .m-slot.filled {
    background: transparent;
  }

  .m-slot.target {
    border: 1px solid #22c55e;
    animation: pulse-green 2.2s ease-in-out infinite alternate;
  }

  .m-slot.swap-source {
    opacity: 1;
    z-index: 2;
    transform: scale(1.02);
  }

  .m-slot.swap-target {
    border: 1px solid rgba(251, 191, 36, 0.92);
    background: linear-gradient(180deg, rgba(94, 65, 12, 0.42), rgba(64, 42, 8, 0.3));
  }

  .m-slot.swap-source::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: linear-gradient(120deg, rgba(96, 165, 250, 0) 0%, rgba(96, 165, 250, 0.18) 35%, rgba(34, 211, 238, 0.28) 50%, rgba(96, 165, 250, 0.18) 65%, rgba(96, 165, 250, 0) 100%);
    background-size: 220% 100%;
    opacity: 0;
  }

  .m-slot.lane-adjust {
    touch-action: manipulation;
  }

  .m-team-ally .m-slot.swap-source {
    border-color: rgba(96, 165, 250, 0.48);
    background: linear-gradient(180deg, rgba(33, 83, 145, 0.99) 0%, rgba(14, 42, 91, 0.97) 62%, rgba(8, 27, 63, 0.95) 100%);
    box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.24), inset 0 1px 0 rgba(191, 219, 254, 0.16), 0 12px 26px rgba(8, 21, 45, 0.3), 0 0 20px rgba(56, 189, 248, 0.18);
    overflow: visible;
    z-index: 2;
  }

  .m-team-ally .m-slot.swap-source::before,
  .m-team-enemy .m-slot.swap-source::before {
    opacity: 1;
    animation: slot-gradient-shift 2.2s linear infinite;
  }

  .m-team-enemy .m-slot.swap-source {
    border-color: rgba(248, 113, 113, 0.46);
    background: linear-gradient(180deg, rgba(155, 40, 61, 0.99) 0%, rgba(102, 23, 38, 0.97) 62%, rgba(58, 12, 22, 0.95) 100%);
    box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.22), inset 0 1px 0 rgba(254, 202, 202, 0.12), 0 12px 26px rgba(36, 8, 12, 0.3), 0 0 20px rgba(248, 113, 113, 0.16);
    overflow: visible;
    z-index: 2;
  }

  .m-slot-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    flex: 1;
    gap: 2px;
    padding: 3px 2px 2px;
    background: transparent;
    border: none;
    cursor: pointer;
    position: relative;
    min-height: 0;
    overflow: visible;
    -webkit-tap-highlight-color: transparent;
  }

  .m-slot-btn-static,
  .m-slot-btn-empty {
    cursor: default;
  }

  .m-slot-btn.is-source {
    transform: scale(1.02);
  }

  .m-slot-btn.is-target {
    color: #fef3c7;
  }

  .m-lane-corner {
    position: absolute;
    top: -4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(8, 21, 45, 0.88);
    border: 1px solid rgba(148, 197, 255, 0.30);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 1px rgba(8, 21, 45, 0.24);
    pointer-events: none;
    z-index: 4;
  }

  .m-lane-corner--ally {
    left: -2px;
  }

  .m-lane-corner--enemy {
    right: -2px;
    left: auto;
  }

  .m-lane-img-corner {
    width: 13px;
    height: 13px;
    object-fit: contain;
    display: block;
  }

  .m-slot-avatar-wrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }

  .m-slot-btn :global(.avatar) {
    border-radius: 50% !important;
    border: 1px solid rgba(140, 183, 250, 0.35) !important;
    transition: border-color 120ms, box-shadow 120ms;
  }

  .m-team-enemy .m-slot-btn :global(.avatar) {
    border-color: rgba(255, 124, 143, 0.35) !important;
  }

  .m-team-ally .m-slot.swap-source .m-slot-btn :global(.avatar) {
    border-color: rgba(96, 165, 250, 0.7) !important;
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.22), 0 0 14px rgba(59, 130, 246, 0.34);
  }

  .m-team-enemy .m-slot.swap-source .m-slot-btn :global(.avatar) {
    border-color: rgba(248, 113, 113, 0.7) !important;
    box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.22), 0 0 14px rgba(239, 68, 68, 0.32);
  }

  .m-slot.swap-target .m-slot-btn :global(.avatar) {
    border-color: rgba(251, 191, 36, 0.7) !important;
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.28);
  }

  .m-team.m-pulse .m-slot.filled .m-slot-btn :global(.avatar) {
    animation: none;
  }

  .m-slot-label-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 12px;
    width: 100%;
    overflow: hidden;
  }

  .m-slot-label {
    font-size: 0.38rem;
    font-weight: 700;
    color: #6a90c4;
    letter-spacing: 0.02em;
    white-space: nowrap;
    line-height: 1;
    text-align: center;
  }

  .m-team-enemy .m-slot-label {
    color: #d87a8a;
  }

  .m-slot-label-source {
    color: #e0efff;
    font-size: 0.38rem;
  }

  .m-slot-label-target {
    color: #fbbf24;
    font-size: 0.38rem;
    font-weight: 800;
  }

  .m-slot-label-marquee {
    display: inline-block;
    animation: m-marquee 5.4s linear infinite;
    white-space: nowrap;
  }

  @keyframes m-marquee {
    0%   { transform: translateX(60%); opacity: 0; }
    10%  { opacity: 1; }
    80%  { opacity: 1; }
    100% { transform: translateX(-60%); opacity: 0; }
  }

  @keyframes slot-marquee {
    0% { transform: translateX(105%); }
    100% { transform: translateX(-105%); }
  }

  @keyframes slot-gradient-shift {
    0% { background-position: 0% 50%; }
    100% { background-position: 220% 50%; }
  }


  .m-slot-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(132, 176, 244, 0.16);
    flex-shrink: 0;
  }

  .m-center {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    flex: 1;
  }

  .m-filter {
    display: flex;
    align-items: center;
    height: 32px;
    flex-shrink: 0;
    background: rgba(12, 24, 48, 0.44);
    border-bottom: 1px solid rgba(168, 208, 255, 0.08);
    backdrop-filter: blur(8px);
    padding: 0 3px;
    gap: 2px;
  }

  .m-filter-switch {
    width: 26px;
    height: 25px;
    flex-shrink: 0;
    border: 1px solid rgba(132, 176, 244, 0.14);
    border-radius: 4px;
    background: rgba(20, 38, 68, 0.42);
    color: #9bc1f9;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .m-filter-tabs {
    display: flex;
    flex: 1;
    overflow: hidden;
    gap: 1px;
  }

  .m-ftab {
    flex: 1;
    min-width: 0;
    height: 24px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: #5e7ca0;
    font-size: 0.54rem;
    font-weight: 700;
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    line-height: 1;
  }

  .m-ftab.active {
    border-color: rgba(116, 190, 255, 0.2);
    background: rgba(44, 84, 131, 0.26);
    color: #dde8ff;
  }

  .m-search-input {
    flex: 1;
    height: 25px;
    border: 1px solid rgba(132, 176, 244, 0.14);
    border-radius: 4px;
    background: rgba(12, 24, 48, 0.42);
    color: #e0efff;
    font-size: 16px;
    transform-origin: left center;
    transform: scale(0.75);
    width: calc(100% / 0.75);
    margin-right: 2px;
    padding: 0 8px;
    outline: none;
  }

  .m-search-btn {
    width: 26px;
    height: 25px;
    flex-shrink: 0;
    border: 1px solid rgba(132, 176, 244, 0.14);
    border-radius: 4px;
    background: rgba(20, 38, 68, 0.42);
    color: #9bc1f9;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .m-search-btn.active {
    border-color: rgba(116, 190, 255, 0.24);
    background: rgba(44, 84, 131, 0.28);
    color: #e0efff;
  }

  .m-hero-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    justify-content: center;
    gap: 5px;
    padding: 6px 5px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(132, 176, 244, 0.2) transparent;
    align-content: start;
  }

  .m-hero-grid::-webkit-scrollbar { width: 2px; }
  .m-hero-grid::-webkit-scrollbar-thumb { background: rgba(132, 176, 244, 0.22); border-radius: 2px; }

  .m-hero-card {
    border: none;
    background: transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 3px;
    padding: 3px 1px;
    width: auto;
    cursor: pointer;
    transition: opacity 100ms;
    position: relative;
  }

  .m-hero-card :global(.avatar) {
    border-radius: 50% !important;
    border: 3px solid rgba(168, 208, 255, 0.18) !important;
  }

  .m-hero-card:active:not(:disabled) :global(.avatar) {
    border-color: rgba(116, 190, 255, 0.85) !important;
    box-shadow: 0 0 6px rgba(59, 130, 246, 0.35);
    outline: none;
  }

  .m-hero-card:disabled { opacity: 0.2; cursor: not-allowed; }
  .m-hero-card.banned { filter: grayscale(0.4) saturate(0.7); }
  .m-hero-card.banned::after {
    content: '✕';
    position: absolute;
    top: 1px;
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 32px;
    background: rgba(185, 28, 28, 0.78);
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 10px;
    font-weight: 900;
    border-radius: 50%;
    pointer-events: none;
  }

  .m-hero-name {
    font-size: 0.5rem;
    color: #7a9ec8;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    line-height: 1.2;
    width: 100%;
  }

  .m-rec-bar {
    flex-shrink: 0;
    border-top: 1px solid rgba(168, 208, 255, 0.08);
    background: rgba(8, 18, 42, 0.42);
    padding: 2px 4px;
    backdrop-filter: blur(8px);
  }

  .m-rec-panels {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
    align-items: start;
  }

  .m-rec-panels-dual {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .m-rec-panel {
    min-width: 0;
  }

  .best-draft-card-skeleton {
    gap: 10px;
  }

  .m-rec-panels-dual .m-rec-panel {
    flex: 1 1 0;
  }

  .m-rec-panel-single {
    width: 100%;
  }

  .m-rec-panel-title {
    display: block;
    font-size: 0.5rem;
    font-weight: 700;
    color: #7aa0c8;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .m-rec-panel-summary {
    display: block;
    font-size: 0.42rem;
    color: #6f8fb8;
    line-height: 1.2;
    margin-bottom: 3px;
    text-align: center;
  }

  .m-rec-panel-left .m-rec-panel-title {
    text-align: left;
  }

  .m-rec-panel-left .m-rec-panel-summary {
    text-align: left;
  }

  .m-rec-panel-center .m-rec-panel-title,
  .m-rec-panel-single .m-rec-panel-title {
    text-align: center;
  }

  .m-rec-panel-right .m-rec-panel-title {
    text-align: right;
  }

  .m-rec-panel-right .m-rec-panel-summary {
    text-align: right;
  }

  .m-rec-list {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 3px;
    padding: 0 2px;
  }

  .m-rec-list-fixed {
    min-height: 64px;
  }

  .m-rec-list-centered {
    justify-content: center;
  }

  .m-rec-item {
    border: none;
    background: transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    border-radius: 4px;
    gap: 1px;
    padding: 1px;
    cursor: pointer;
    flex-shrink: 0;
    width: 48px;
    min-height: 62px;
    outline: none;
    box-shadow: none;
    -webkit-tap-highlight-color: transparent;
  }

  .m-rec-panel-left .m-rec-list {
    justify-content: flex-start;
  }

  .m-rec-panel-center .m-rec-list,
  .m-rec-panel-single .m-rec-list {
    justify-content: center;
  }

  .m-rec-panel-right .m-rec-list {
    justify-content: flex-end;
  }

  .m-rec-item :global(.avatar) {
    border-radius: 50% !important;
    border: 1.5px solid rgba(132, 176, 244, 0.32) !important;
  }

  .m-rec-item:focus,
  .m-rec-item:focus-visible {
    outline: none;
    box-shadow: none;
  }

  .m-rec-item:active:not(:disabled) :global(.avatar),
  .m-rec-item:focus:not(:disabled) :global(.avatar),
  .m-rec-item:focus-visible:not(:disabled) :global(.avatar) {
    border-color: rgba(132, 176, 244, 0.32) !important;
    box-shadow: none !important;
    outline: none;
  }

  .m-rec-item:disabled { opacity: 0.22; cursor: not-allowed; }

  .m-rec-item-loading,
  .m-rec-item-empty {
    cursor: default;
  }

  .m-rec-avatar-skeleton {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(90deg, rgba(48, 69, 108, 0.75), rgba(77, 101, 146, 0.85), rgba(48, 69, 108, 0.75));
    background-size: 200% 100%;
    animation: m-skeleton-shift 1.15s linear infinite;
  }

  .m-rec-name-skeleton {
    width: 30px;
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(48, 69, 108, 0.65), rgba(77, 101, 146, 0.8), rgba(48, 69, 108, 0.65));
    background-size: 200% 100%;
    animation: m-skeleton-shift 1.15s linear infinite;
  }

  .m-rec-name {
    font-size: 0.38rem;
    color: #7a9ec8;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40px;
    line-height: 1.2;
  }

  .m-rec-note {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.31rem;
    line-height: 1.15;
    color: #5f82ae;
    text-align: center;
    max-width: 48px;
    min-height: 0.72rem;
  }

  .m-rec-tier {
    font-size: 0.34rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #d8e8ff;
    line-height: 1.1;
  }

  .m-rec-sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 180;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 12px 10px calc(env(safe-area-inset-bottom, 0px) + 8px);
    background: rgba(4, 8, 20, 0.2);
  }

  .m-rec-sheet {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 320px;
    max-height: 90%;
    border-radius: 18px 18px 14px 14px;
    border: 1px solid rgba(132, 176, 244, 0.2);
    background: linear-gradient(180deg, rgba(7, 18, 42, 0.96), rgba(9, 19, 40, 0.98));
    box-shadow: 0 18px 38px rgba(0, 0, 0, 0.34);
    overflow: hidden;
    animation: m-rec-sheet-in 160ms ease-out;
  }

  .m-rec-sheet-grabber {
    width: 48px;
    height: 4px;
    border-radius: 999px;
    background: rgba(154, 191, 242, 0.28);
    margin: 10px auto 0;
  }

  .m-rec-sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 14px 10px;
  }

  .m-rec-sheet-head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .m-rec-sheet-hero {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .m-rec-sheet-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .m-rec-sheet-kicker {
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7aa0c8;
  }

  .m-rec-sheet-copy strong {
    font-size: 0.92rem;
    color: #eff6ff;
    line-height: 1.1;
  }

  .m-rec-sheet-copy span {
    font-size: 0.58rem;
    color: #9bb7dc;
    line-height: 1.3;
  }

  .m-rec-sheet-close {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid rgba(148, 193, 255, 0.18);
    background: rgba(14, 29, 56, 0.82);
    color: #dbeafe;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    line-height: 1;
    padding: 0;
    flex-shrink: 0;
  }

  .m-rec-sheet-select {
    min-height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid rgba(147, 197, 253, 0.28);
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.88), rgba(37, 99, 235, 0.88));
    color: #eff6ff;
    font-size: 0.54rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .m-rec-sheet-select:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  .m-rec-sheet-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 14px 14px;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }

  .m-rec-sheet-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .m-rec-sheet-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border-radius: 12px;
    background: rgba(14, 29, 56, 0.58);
    border: 1px solid rgba(132, 176, 244, 0.1);
  }

  .m-rec-sheet-section strong {
    font-size: 0.68rem;
    color: #eaf2ff;
  }

  .m-rec-sheet-section p {
    margin: 0;
    font-size: 0.58rem;
    line-height: 1.45;
    color: #a9c2e6;
  }

  .m-rec-sheet-metrics {
    display: grid;
    gap: 8px;
  }

  .m-rec-metric-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(10, 22, 46, 0.72);
    border: 1px solid rgba(132, 176, 244, 0.1);
  }

  .m-rec-metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .m-rec-metric-head span {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #9bb7dc;
  }

  .m-rec-metric-head strong {
    font-size: 0.66rem;
    color: #eff6ff;
  }

  .m-rec-metric-bar {
    position: relative;
    height: 8px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.16);
    overflow: hidden;
  }

  .m-rec-metric-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
  }

  .m-rec-metric-card--tier .m-rec-metric-fill {
    background: linear-gradient(90deg, #f59e0b, #fcd34d);
  }

  .m-rec-metric-card--win .m-rec-metric-fill {
    background: linear-gradient(90deg, #ef4444, #fb7185);
  }

  .m-rec-metric-card--flex .m-rec-metric-fill {
    background: linear-gradient(90deg, #38bdf8, #60a5fa);
  }

  .m-rec-metric-card--coverage .m-rec-metric-fill {
    background: linear-gradient(90deg, #a78bfa, #c4b5fd);
  }

  .m-rec-metric-card--counter .m-rec-metric-fill {
    background: linear-gradient(90deg, #f97316, #fb923c);
  }

  .m-rec-metric-card--community .m-rec-metric-fill {
    background: linear-gradient(90deg, #14b8a6, #5eead4);
  }

  .m-rec-metric-card--synergy .m-rec-metric-fill {
    background: linear-gradient(90deg, #22c55e, #86efac);
  }

  @keyframes m-skeleton-shift {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @keyframes rec-popover-in {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }

  @keyframes m-rec-sheet-in {
    0% {
      opacity: 0;
      transform: translateY(10px) scale(0.985);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes m-phase-left {
    0% { transform: translateX(0); opacity: 0.45; }
    50% { transform: translateX(-3px); opacity: 1; }
    100% { transform: translateX(0); opacity: 0.45; }
  }

  @keyframes m-phase-right {
    0% { transform: translateX(0); opacity: 0.45; }
    50% { transform: translateX(3px); opacity: 1; }
    100% { transform: translateX(0); opacity: 0.45; }
  }

  .m-pick-order {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 14px;
    padding: 12px;
  }

  .m-pick-order-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .m-back-btn {
    border: 1px solid rgba(132, 176, 244, 0.28);
    border-radius: 6px;
    background: rgba(20, 38, 68, 0.75);
    color: #9bc1f9;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 4px 8px;
    cursor: pointer;
  }

  .m-mode-badge {
    font-size: 0.62rem;
    font-weight: 700;
    color: #60a5fa;
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.32);
    border-radius: 6px;
    padding: 3px 8px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .m-pick-order-hint {
    color: #c4d7f5;
    font-size: 0.82rem;
    font-weight: 600;
    text-align: center;
    line-height: 1.35;
    margin: 0;
  }

  .m-pick-order-btns {
    display: flex;
    gap: 12px;
  }

  .m-pick-order-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 22px;
    border-radius: 10px;
    border: 1px solid rgba(116, 190, 255, 0.35);
    background: rgba(44, 84, 140, 0.7);
    color: #eff6ff;
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .m-pick-order-btn.m-btn-muted {
    border-color: rgba(132, 176, 244, 0.22);
    background: rgba(32, 54, 96, 0.6);
    color: #c8dcf5;
  }

  .m-po-num {
    font-size: 1.1rem;
    font-weight: 900;
    color: #60a5fa;
    line-height: 1;
  }

  .m-pick-order-btn.m-btn-muted .m-po-num { color: #9bc1f9; }

  .m-analyze-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 10px;
    padding: 10px;
  }

  .m-analyze-sub {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #60a5fa;
    margin: 0;
  }

  .m-analyze-hint {
    color: #8ab0d8;
    font-size: 0.68rem;
    text-align: center;
    margin: 0;
  }

  .m-analyze-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 28px;
    border-radius: 8px;
    border: none;
    background: rgba(58, 130, 246, 0.88);
    color: #eff6ff;
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
    min-width: 170px;
    justify-content: center;
  }

  .m-analyze-btn:disabled { opacity: 0.38; cursor: not-allowed; }

  .m-reset-btn {
    border: 1px solid rgba(132, 176, 244, 0.24);
    border-radius: 6px;
    background: rgba(20, 38, 68, 0.7);
    color: #8ab0d8;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 5px 14px;
    cursor: pointer;
  }

  .m-spin {
    animation: m-spin-anim 1s linear infinite;
  }

  @keyframes m-spin-anim {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  .m-analysis-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(132, 176, 244, 0.2) transparent;
  }

  .m-analysis-loading-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 10px;
    color: #7aa0c8;
    font-size: 0.72rem;
    padding: 20px;
  }

  .m-analysis-err {
    color: #f87171;
    font-size: 0.72rem;
    text-align: center;
    padding: 10px;
  }

  .m-analysis-headline-row {
    border-radius: 8px;
    padding: 6px 10px;
    background: rgba(22, 40, 78, 0.8);
    border: 1px solid rgba(132, 176, 244, 0.2);
    text-align: center;
  }

  .m-analysis-headline-row h3 {
    font-size: 0.82rem;
    font-weight: 800;
    color: #e7f2ff;
    margin: 0 0 2px;
    letter-spacing: 0.03em;
  }

  .m-analysis-headline-row.m-winner-ally {
    border-color: rgba(59, 130, 246, 0.5);
    background: rgba(20, 50, 110, 0.7);
  }

  .m-analysis-headline-row.m-winner-enemy {
    border-color: rgba(239, 68, 68, 0.5);
    background: rgba(80, 18, 30, 0.7);
  }

  .m-analysis-headline-row.m-winner-balanced {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(14, 55, 36, 0.6);
  }

  .m-analysis-verdict-text {
    font-size: 0.6rem;
    color: #a8c0df;
    margin: 0;
    line-height: 1.4;
  }

  .m-analysis-teams {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }

  .m-analysis-team {
    border-radius: 8px;
    padding: 6px 7px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .m-at-ally {
    background: rgba(18, 45, 95, 0.7);
    border: 1px solid rgba(59, 130, 246, 0.38);
  }

  .m-at-enemy {
    background: rgba(60, 16, 28, 0.7);
    border: 1px solid rgba(239, 68, 68, 0.35);
  }

  .m-at-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .m-at-label {
    font-size: 0.56rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9bc1f9;
  }

  .m-at-enemy .m-at-label { color: #fca5a5; }

  .m-at-score {
    font-size: 0.88rem;
    font-weight: 900;
    color: #e7f2ff;
  }

  .m-at-avatars {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
  }

  .m-at-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .m-at-metric-head {
    display: flex;
    justify-content: space-between;
    font-size: 0.5rem;
    color: #7a9cc4;
  }

  .m-at-bar {
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }

  .m-at-bar-fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  .m-at-bar-fill.ally { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
  .m-at-bar-fill.ally-counter { background: linear-gradient(90deg, #06b6d4, #38bdf8); }
  .m-at-bar-fill.enemy { background: linear-gradient(90deg, #ef4444, #f87171); }
  .m-at-bar-fill.enemy-counter { background: linear-gradient(90deg, #f97316, #fb923c); }

  .m-at-prob {
    font-size: 0.56rem;
    color: #a8c0df;
    margin: 0;
  }

  .m-at-prob strong {
    color: #e0efff;
    font-weight: 800;
  }

  .m-at-detail {
    font-size: 0.5rem;
    color: #7a9cc4;
    margin: 0;
    line-height: 1.35;
  }

  .m-at-detail-key {
    color: #9bc1f9;
    font-weight: 700;
  }

  .m-analysis-factors {
    border-radius: 7px;
    border: 1px solid rgba(132, 176, 244, 0.16);
    background: rgba(14, 26, 52, 0.7);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .m-factors-title {
    font-size: 0.56rem;
    font-weight: 800;
    color: #9bc1f9;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 0 0 3px;
  }

  .m-factor-item {
    font-size: 0.52rem;
    color: #8ab0d8;
    margin: 0;
    line-height: 1.4;
  }

  .m-reset-analysis {
    align-self: center;
    margin-top: 2px;
  }
</style>

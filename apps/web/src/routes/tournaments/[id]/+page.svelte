<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { browser } from "$app/environment";
  import { invalidateAll } from "$app/navigation";
  import { apiUrl } from "$lib/api";
  import { Card } from "@mlbb/ui";

  export let data: {
    event: {
      id: number;
      code: string;
      name: string;
      format: string;
      eventMode: string;
      playoffFormat?: string | null;
      playoffThirdPlaceBestOf?: number | null;
      advanceToPlayoffs?: number;
      totalTeams: number;
      totalRounds: number;
      eventDate: string;
      status: string;
      grandFinalTeamALogoUrl?: string | null;
      grandFinalTeamBLogoUrl?: string | null;
      grandFinalYoutubeUrl?: string | null;
    };
    bracket: Array<{
      id: number;
      roundNumber: number;
      stage?: string;
      stageNumber?: number;
      label?: string | null;
      status: string;
      matches: Array<{
        id: number;
        pairingOrder: number;
        matchBestOf?: number | null;
        result: string;
        scoreA: number | null;
        scoreB: number | null;
        winnerTeamId: number | null;
        teamA: { id: number; name: string; seed: number | null; captainWhatsapp?: string | null } | null;
        teamB: { id: number; name: string; seed: number | null; captainWhatsapp?: string | null } | null;
      }>;
    }>;
    standings: Array<{
      rank: number;
      teamId: number;
      teamName: string;
      played: number;
      win: number;
      lose: number;
      draw: number;
      bye: number;
      score: number;
      headToHead: number;
      buchholz: number;
      pointDiff: number;
    }>;
    postmatchIntelligence?: {
      methodologyNote?: string;
      draftLogCoverage?: number;
      items?: Array<{
        matchId: number;
        roundNumber?: number | null;
        roundLabel?: string | null;
        scoreline: string;
        winnerTeam: { id: number; name: string } | null;
        loserTeam: { id: number; name: string } | null;
        winnerAnalysis: string[];
        loserAnalysis: string[];
        loserRecommendations: Array<{
          lane: string;
          mlid: number;
          heroName: string;
          confidence: string;
          reason: string;
          swapOutHeroName?: string | null;
        }>;
        confidence: string;
        confidenceReason?: string;
        dataMode?: string;
      }>;
    } | null;
    entry?: string | null;
  };

  $: showPostmatchIntelligence = data.entry === "tournament_intelligence_meta";

  let selectedStandingTeamId: number | null = null;
  let bracketAnchor: HTMLDivElement | null = null;

  function isRoundOpen(roundNumber: number) {
    if (selectedStandingTeamId === null) {
      const nextOpenRound = data.bracket.find((round) => round.status !== "completed" && round.status !== "finished");

      if (!nextOpenRound) {
        return false;
      }

      return roundNumber === nextOpenRound.roundNumber;
    }

    return data.bracket.some(
      (round) =>
        round.roundNumber === roundNumber &&
        round.matches.some(
          (match) => match.teamA?.id === selectedStandingTeamId || match.teamB?.id === selectedStandingTeamId
        )
    );
  }

  async function toggleStandingTeam(teamId: number) {
    const nextSelectedTeamId = selectedStandingTeamId === teamId ? null : teamId;
    selectedStandingTeamId = nextSelectedTeamId;

    if (nextSelectedTeamId !== null) {
      await tick();
      bracketAnchor?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function matchContainsSelectedTeam(match: {
    teamA: { id: number | null } | null;
    teamB: { id: number | null } | null;
  }) {
    if (selectedStandingTeamId === null) return false;
    return match.teamA?.id === selectedStandingTeamId || match.teamB?.id === selectedStandingTeamId;
  }

  function visibleRoundMatches(round: (typeof data.bracket)[number]) {
    if (selectedStandingTeamId === null) {
      return round.matches;
    }

    return round.matches.filter((match) => matchContainsSelectedTeam(match));
  }

  let isRefreshing = false;
  let isManualRefresh = false;
  let playoffAutoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshTournamentView(manual = true) {
    if (isRefreshing) return;
    isRefreshing = true;
    isManualRefresh = manual;

    try {
      await invalidateAll();
    } finally {
      isRefreshing = false;
      isManualRefresh = false;
    }
  }

  function setupPlayoffAutoRefresh() {
    if (!browser) return;
    const shouldAutoRefresh = data.event.eventMode === "playoffs" && data.event.status === "ongoing";

    if (!shouldAutoRefresh && playoffAutoRefreshTimer) {
      clearInterval(playoffAutoRefreshTimer);
      playoffAutoRefreshTimer = null;
      return;
    }

    if (shouldAutoRefresh && !playoffAutoRefreshTimer) {
      playoffAutoRefreshTimer = setInterval(() => {
        void refreshTournamentView(false);
      }, 8000);
    }
  }

  $: setupPlayoffAutoRefresh();

  onDestroy(() => {
    if (playoffAutoRefreshTimer) {
      clearInterval(playoffAutoRefreshTimer);
      playoffAutoRefreshTimer = null;
    }
  });

  function statusTone(status: string) {
    if (status === "ongoing") return "is-ongoing";
    if (status === "completed") return "is-completed";
    return "is-default";
  }

  function formatTournamentFormat(value: string) {
    if (value === "regular_season") return "Regular Season";
    if (value === "double_round_robin") return "Double Round Robin";
    if (value === "round_robin") return "Round Robin";
    if (value === "five_round") return "5 Round";
    if (value === "custom_round") return "Custom Round";
    if (value === "playoffs") return "Playoffs";
    if (value === "single_elimination") return "Single Elimination";
    if (value === "double_elimination") return "Double Elimination";
    if (value === "swiss_stage") return "Swiss Stage";
    return value.replace(/_/g, " ");
  }

  function formatEventLabel(event: { eventMode?: string; playoffFormat?: string; regularSeasonFormat?: string; format: string }) {
    const mode = event.eventMode ?? event.format;
    if (mode === "playoffs" && event.playoffFormat) {
      return `Playoffs ${formatTournamentFormat(event.playoffFormat)}`;
    }
    if (mode === "regular_season" && event.regularSeasonFormat) {
      return `Regular Season ${formatTournamentFormat(event.regularSeasonFormat)}`;
    }
    return formatTournamentFormat(mode);
  }

  function formatPointDiff(value: number) {
    return value > 0 ? `+${value}` : `${value}`;
  }

  function buildWhatsappUrl(phone: string, roundNumber: number, opponentName: string) {
    const text = [
      `Halo captain ${opponentName}, salam dari kami.`,
      "",
      `Round ${roundNumber} sudah dimulai.`,
      "Untuk match kali ini, tim kamu akan melawan kami.",
      "",
      "Yuk segera koordinasi untuk matching.",
      "Selamat bermain dan good luck untuk kedua tim."
    ].join("\n");

    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  type PlayoffDisplayTeam = {
    id: number | null;
    name: string;
    seed: number | null;
    captainWhatsapp?: string | null;
  };

  type PlayoffDisplayMatch = {
    id: string | number;
    pairingOrder: number;
    matchLabel: string | null;
    result: string;
    scoreA: number | null;
    scoreB: number | null;
    winnerTeamId: number | null;
    teamA: PlayoffDisplayTeam | null;
    teamB: PlayoffDisplayTeam | null;
    isPlaceholder: boolean;
    isBye: boolean;
    centerY: number;
    topOffset: number;
  };

  type PlayoffDisplayRound = {
    id: string | number;
    roundNumber: number;
    status: string;
    stageLabel: string;
    stageMeta: string;
    matches: PlayoffDisplayMatch[];
  };

  type PlayoffConnectorLine = {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };

  type DEBracketMatch = {
    id: string | number;
    pairingOrder: number;
    matchBestOf: number | null;
    result: string;
    scoreA: number | null;
    scoreB: number | null;
    winnerTeamId: number | null;
    teamA: PlayoffDisplayTeam | null;
    teamB: PlayoffDisplayTeam | null;
    isPlaceholder: boolean;
    isBye: boolean;
    bracketType: "upper" | "lower" | "grand_final";
    centerY: number;
    topOffset: number;
  };

  type DEBracketColumn = {
    id: string | number;
    stageNumber: number;
    label: string;
    status: string;
    bracketType: "upper" | "lower" | "grand_final";
    colIndex: number;
    matches: DEBracketMatch[];
  };

  type DEBracketBoard = {
    upperColumns: DEBracketColumn[];
    lowerColumns: DEBracketColumn[];
    gfColumns: DEBracketColumn[];
    upperSectionHeight: number;
    lowerSectionHeight: number;
    lowerYStart: number;
    boardHeight: number;
    boardWidth: number;
    gfColumnStartX: number;
    upperConnectors: PlayoffConnectorLine[];
    lowerConnectors: PlayoffConnectorLine[];
    gfConnectors: PlayoffConnectorLine[];
  };

  type SwissDisplayMatch = {
    id: number;
    leftTeamId: number | null;
    rightTeamId: number | null;
    left: string;
    right: string;
    leftSeed: number | null;
    rightSeed: number | null;
    scoreA: number | null;
    scoreB: number | null;
    score: string;
    result: string;
    winnerTeamId: number | null;
    leftIsWinner: boolean;
    leftIsLoser: boolean;
    rightIsWinner: boolean;
    rightIsLoser: boolean;
  };

  type SwissDisplayGroup = {
    id: string;
    label: string;
    bestOf: "BO1" | "BO3";
    bestOfLabel: string;
    roundNumber: number;
    status: string;
    tone: "gold" | "lavender" | "blue";
    topOffset: number;
    height: number;
    centerY: number;
    matches: SwissDisplayMatch[];
  };

  type SwissDisplayColumn = {
    id: string;
    roundNumber: number;
    status: string;
    leftOffset: number;
    height: number;
    groups: SwissDisplayGroup[];
  };

  type SwissConnectorLine = {
    key: string;
    d: string;
    tone: "win" | "loss";
  };

  type SwissBracketLayout = {
    boardWidth: number;
    boardHeight: number;
    columnWidth: number;
    connectors: SwissConnectorLine[];
  };

  type SwissStageDisplay = {
    columns: SwissDisplayColumn[];
    layout: SwissBracketLayout;
    teamStandings: SwissTeamStanding[];
  };

  type SwissTeamStanding = {
    teamId: number;
    teamName: string;
    win: number;
    lose: number;
    score: string;
    tone: "gold" | "lavender" | "blue";
    type: "qualified" | "eliminated" | "active";
  };

  const SWISS_COLUMN_WIDTH = 284;
  const SWISS_COLUMN_GAP = 72;
  const SWISS_COLUMN_PADDING_TOP = 58;
  const SWISS_GROUP_GAP = 14;
  const SWISS_GROUP_HEADER_HEIGHT = 34;
  const SWISS_GROUP_PADDING_TOP = 10;
  const SWISS_GROUP_PADDING_BOTTOM = 16;
  const SWISS_MATCH_ROW_HEIGHT = 42;
  const SWISS_MATCH_ROW_GAP = 8;
  const SWISS_BOARD_VERTICAL_PADDING = 16;

  const PLAYOFF_COLUMN_WIDTH = 280;
  const PLAYOFF_COLUMN_GAP = 92;
  const PLAYOFF_MATCH_LABEL_HEIGHT = 16;
  const PLAYOFF_MATCH_BODY_HEIGHT = 82;
  const PLAYOFF_MATCH_STACK_GAP = 6;
  const PLAYOFF_MATCH_META_HEIGHT = 18;
  const PLAYOFF_MATCH_ANCHOR_OFFSET =
    PLAYOFF_MATCH_LABEL_HEIGHT
    + PLAYOFF_MATCH_STACK_GAP
    + PLAYOFF_MATCH_META_HEIGHT
    + PLAYOFF_MATCH_STACK_GAP
    + (PLAYOFF_MATCH_BODY_HEIGHT / 2);
  const PLAYOFF_MATCH_HEIGHT =
    PLAYOFF_MATCH_LABEL_HEIGHT
    + PLAYOFF_MATCH_STACK_GAP
    + PLAYOFF_MATCH_META_HEIGHT
    + PLAYOFF_MATCH_STACK_GAP
    + PLAYOFF_MATCH_BODY_HEIGHT;
  const PLAYOFF_MATCH_GAP = 8;
  const DE_SECTION_LABEL_HEIGHT = 26;
  const DE_SECTION_GAP = 28;

  function formatPlayoffStageLabel(roundNumber: number, totalRounds: number, matchCount = 1) {
    if (totalRounds <= 1 || roundNumber === totalRounds) {
      return "Grand Final";
    }
    if (roundNumber === totalRounds - 1) return "Semifinal";

    const knockoutIndex = roundNumber;
    const knockoutRounds = Math.max(1, totalRounds - 2);
    return knockoutRounds > 1 ? `Knockout Stage ${knockoutIndex}` : "Knockout Stage";
  }

  function formatPlayoffMatchLabel(roundNumber: number, totalRounds: number, pairingOrder: number, matchCount: number) {
    if (roundNumber !== totalRounds || matchCount <= 1) return null;
    if (pairingOrder === 1) return "Grand Final";
    if (pairingOrder === 2) return "Third Place Match";
    return `Placement Match #${pairingOrder}`;
  }

  function getPlayoffMatchCenterY(
    roundNumber: number,
    totalRounds: number,
    matchCount: number,
    matchIndex: number,
    boardHeight: number
  ) {
    const isFinalDay = roundNumber === totalRounds;
    if (isFinalDay && matchCount === 2) {
      if (matchIndex === 0) {
        return boardHeight / 2;
      }

      const minTopOffset = (boardHeight / 2) - PLAYOFF_MATCH_ANCHOR_OFFSET + PLAYOFF_MATCH_HEIGHT + PLAYOFF_MATCH_GAP;
      const maxTopOffset = boardHeight - PLAYOFF_MATCH_HEIGHT;
      const safeTopOffset = Math.min(minTopOffset, maxTopOffset);
      return safeTopOffset + PLAYOFF_MATCH_ANCHOR_OFFSET;
    }

    if (matchCount === 1) {
      return boardHeight / 2;
    }

    return ((matchIndex + 0.5) / matchCount) * boardHeight;
  }

  function buildPlayoffPlaceholderMatches(
    previousMatches: PlayoffDisplayMatch[],
    roundNumber: number,
    fallbackMatchCount = 1,
    showThirdPlaceMatch = false
  ) {
    if (showThirdPlaceMatch && previousMatches.length >= 2 && fallbackMatchCount >= 2) {
      const semiOne = previousMatches[0];
      const semiTwo = previousMatches[1];

      return [
        {
          id: `playoff-placeholder-${roundNumber}-1`,
          pairingOrder: 1,
          matchLabel: "Grand Final",
          result: "pending",
          scoreA: null,
          scoreB: null,
          winnerTeamId: null,
          teamA: semiOne ? { id: null, name: `Winner of R${roundNumber - 1}M${semiOne.pairingOrder}`, seed: null } : { id: null, name: "TBD", seed: null },
          teamB: semiTwo ? { id: null, name: `Winner of R${roundNumber - 1}M${semiTwo.pairingOrder}`, seed: null } : { id: null, name: "TBD", seed: null },
          isPlaceholder: true,
          isBye: false,
          centerY: 0,
          topOffset: 0
        },
        {
          id: `playoff-placeholder-${roundNumber}-2`,
          pairingOrder: 2,
          matchLabel: "Third Place Match",
          result: "pending",
          scoreA: null,
          scoreB: null,
          winnerTeamId: null,
          teamA: semiOne ? { id: null, name: `Loser of R${roundNumber - 1}M${semiOne.pairingOrder}`, seed: null } : { id: null, name: "TBD", seed: null },
          teamB: semiTwo ? { id: null, name: `Loser of R${roundNumber - 1}M${semiTwo.pairingOrder}`, seed: null } : { id: null, name: "TBD", seed: null },
          isPlaceholder: true,
          isBye: false,
          centerY: 0,
          topOffset: 0
        }
      ];
    }

    const totalMatches = previousMatches.length > 0
      ? Math.max(1, Math.ceil(previousMatches.length / 2))
      : Math.max(1, fallbackMatchCount);
    return Array.from({ length: totalMatches }, (_, matchIndex) => {
      const feederA = previousMatches[matchIndex * 2];
      const feederB = previousMatches[(matchIndex * 2) + 1] ?? null;

      return {
        id: `playoff-placeholder-${roundNumber}-${matchIndex + 1}`,
        pairingOrder: matchIndex + 1,
        matchLabel: null,
        result: "pending",
        scoreA: null,
        scoreB: null,
        winnerTeamId: null,
        teamA: feederA ? { id: null, name: `Winner of R${roundNumber - 1}M${feederA.pairingOrder}`, seed: null } : { id: null, name: "TBD", seed: null },
        teamB: feederB ? { id: null, name: `Winner of R${roundNumber - 1}M${feederB.pairingOrder}`, seed: null } : { id: null, name: "BYE", seed: null },
        isPlaceholder: true,
        isBye: !feederB,
        centerY: 0,
        topOffset: 0
      };
    });
  }

  function buildPlayoffBracketRounds(
    rounds: typeof data.bracket,
    totalRounds: number,
    totalTeams: number,
    playoffThirdPlaceBestOf?: number | null
  ) {
    const orderedRounds = rounds.slice().sort((left, right) => left.roundNumber - right.roundNumber);
    const hasThirdPlaceMatch = Boolean(playoffThirdPlaceBestOf && playoffThirdPlaceBestOf > 0);
    const firstRoundMatchCount = Math.max(orderedRounds[0]?.matches.length ?? Math.ceil(totalTeams / 2), 1);
    const boardHeight = Math.max(
      260,
      (firstRoundMatchCount * PLAYOFF_MATCH_HEIGHT) + (Math.max(firstRoundMatchCount - 1, 0) * PLAYOFF_MATCH_GAP)
    );

    const displayRounds: PlayoffDisplayRound[] = [];
    const connectorLines: PlayoffConnectorLine[] = [];
    let previousMatches: PlayoffDisplayMatch[] = [];

    for (let roundNumber = 1; roundNumber <= totalRounds; roundNumber += 1) {
      const roundData = orderedRounds.find((round) => round.roundNumber === roundNumber) ?? null;
      const finalRoundFallbackMatches = hasThirdPlaceMatch && roundNumber === totalRounds ? 2 : 1;
      const baseMatches =
        roundData?.matches
          .slice()
          .sort((left, right) => left.pairingOrder - right.pairingOrder)
          .map((match) => ({
          id: match.id,
          pairingOrder: match.pairingOrder,
          matchLabel: null,
          result: match.result,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          winnerTeamId: match.winnerTeamId,
          teamA: match.teamA
            ? { id: match.teamA.id, name: match.teamA.name, seed: match.teamA.seed, captainWhatsapp: match.teamA.captainWhatsapp ?? null }
            : null,
          teamB: match.teamB
            ? { id: match.teamB.id, name: match.teamB.name, seed: match.teamB.seed, captainWhatsapp: match.teamB.captainWhatsapp ?? null }
            : null,
          isPlaceholder: false,
          isBye: !match.teamB,
          centerY: 0,
          topOffset: 0
        })) ?? buildPlayoffPlaceholderMatches(
          previousMatches,
          roundNumber,
          roundNumber === 1 ? firstRoundMatchCount : finalRoundFallbackMatches,
          hasThirdPlaceMatch && roundNumber === totalRounds
        );

      const matchCount = Math.max(baseMatches.length, 1);
      const positionedMatches = baseMatches.map((match, matchIndex) => {
        const centerY = getPlayoffMatchCenterY(roundNumber, totalRounds, matchCount, matchIndex, boardHeight);

        return {
          ...match,
          matchLabel: formatPlayoffMatchLabel(roundNumber, totalRounds, match.pairingOrder, matchCount),
          centerY,
          topOffset: centerY - PLAYOFF_MATCH_ANCHOR_OFFSET
        };
      });

      displayRounds.push({
        id: roundData?.id ?? `playoff-round-${roundNumber}`,
        roundNumber,
        status: roundData?.status ?? "upcoming",
        stageLabel: formatPlayoffStageLabel(roundNumber, totalRounds, matchCount),
        stageMeta: roundNumber === totalRounds && matchCount > 1 ? `${matchCount} matches` : `Round ${roundNumber}`,
        matches: positionedMatches
      });

      const roundIndex = roundNumber - 1;
      if (previousMatches.length > 0) {
        const columnRightX = (roundIndex - 1) * (PLAYOFF_COLUMN_WIDTH + PLAYOFF_COLUMN_GAP) + PLAYOFF_COLUMN_WIDTH;
        const connectorMidX = columnRightX + (PLAYOFF_COLUMN_GAP / 2);
        const nextColumnLeftX = columnRightX + PLAYOFF_COLUMN_GAP;

        for (let pairIndex = 0; pairIndex < previousMatches.length; pairIndex += 2) {
          const topMatch = previousMatches[pairIndex];
          const bottomMatch = previousMatches[pairIndex + 1] ?? null;
          const targetMatch = positionedMatches[Math.floor(pairIndex / 2)] ?? null;
          if (!topMatch || !targetMatch) continue;

          connectorLines.push({
            key: `h-top-${roundNumber}-${pairIndex}`,
            x1: columnRightX,
            y1: topMatch.centerY,
            x2: connectorMidX,
            y2: topMatch.centerY
          });

          if (bottomMatch) {
            connectorLines.push({
              key: `h-bottom-${roundNumber}-${pairIndex}`,
              x1: columnRightX,
              y1: bottomMatch.centerY,
              x2: connectorMidX,
              y2: bottomMatch.centerY
            });
            connectorLines.push({
              key: `v-${roundNumber}-${pairIndex}`,
              x1: connectorMidX,
              y1: Math.min(topMatch.centerY, bottomMatch.centerY),
              x2: connectorMidX,
              y2: Math.max(topMatch.centerY, bottomMatch.centerY)
            });
          }

          connectorLines.push({
            key: `next-${roundNumber}-${pairIndex}`,
            x1: connectorMidX,
            y1: targetMatch.centerY,
            x2: nextColumnLeftX,
            y2: targetMatch.centerY
          });
        }
      }

      previousMatches = positionedMatches;
    }

    const boardWidth = (displayRounds.length * PLAYOFF_COLUMN_WIDTH) + (Math.max(displayRounds.length - 1, 0) * PLAYOFF_COLUMN_GAP);

    return {
      rounds: displayRounds,
      boardHeight,
      boardWidth,
      connectorLines
    };
  }

  function buildDoubleEliminationBracket(rounds: typeof data.bracket): DEBracketBoard {
    const W = PLAYOFF_COLUMN_WIDTH;
    const G = PLAYOFF_COLUMN_GAP;

    const upperRounds = rounds
      .filter((r) => r.stage === "upper")
      .sort((a, b) => (a.stageNumber ?? 0) - (b.stageNumber ?? 0));
    const lowerRounds = rounds
      .filter((r) => r.stage === "lower")
      .sort((a, b) => (a.stageNumber ?? 0) - (b.stageNumber ?? 0));
    const gfRounds = rounds
      .filter((r) => r.stage === "grand_final")
      .sort((a, b) => a.roundNumber - b.roundNumber);

    const maxUBCount = Math.max(1, upperRounds[0]?.matches.length ?? 1);
    const maxLBCount = Math.max(1, lowerRounds[0]?.matches.length ?? 1);
    const upperSectionHeight = Math.max(
      260,
      maxUBCount * PLAYOFF_MATCH_HEIGHT + Math.max(maxUBCount - 1, 0) * PLAYOFF_MATCH_GAP
    );
    const lowerSectionHeight = Math.max(
      260,
      maxLBCount * PLAYOFF_MATCH_HEIGHT + Math.max(maxLBCount - 1, 0) * PLAYOFF_MATCH_GAP
    );
    const lowerYStart = upperSectionHeight + 90;
    const boardHeight = lowerYStart + lowerSectionHeight;
    const maxCols = Math.max(upperRounds.length, lowerRounds.length, 1);
    const gfColumnStartX = maxCols * (W + G);
    const boardWidth = gfColumnStartX + (gfRounds.length > 0 ? W : 0);

    function buildMatch(
      raw: (typeof data.bracket)[number]["matches"][number],
      bracketType: "upper" | "lower" | "grand_final",
      sectionHeight: number,
      sectionOffsetY: number,
      matchCount: number,
      matchIndex: number
    ): DEBracketMatch {
      const centerY =
        matchCount === 1
          ? sectionOffsetY + sectionHeight / 2
          : sectionOffsetY + ((matchIndex + 0.5) / matchCount) * sectionHeight;
      return {
        id: raw.id,
        pairingOrder: raw.pairingOrder,
        matchBestOf: raw.matchBestOf ?? null,
        result: raw.result,
        scoreA: raw.scoreA,
        scoreB: raw.scoreB,
        winnerTeamId: raw.winnerTeamId,
        teamA: raw.teamA
          ? { id: raw.teamA.id, name: raw.teamA.name, seed: raw.teamA.seed, captainWhatsapp: raw.teamA.captainWhatsapp ?? null }
          : null,
        teamB: raw.teamB
          ? { id: raw.teamB.id, name: raw.teamB.name, seed: raw.teamB.seed, captainWhatsapp: raw.teamB.captainWhatsapp ?? null }
          : null,
        isPlaceholder: false,
        isBye: !raw.teamB,
        bracketType,
        centerY,
        topOffset: centerY - PLAYOFF_MATCH_ANCHOR_OFFSET
      };
    }

    const upperColumns: DEBracketColumn[] = upperRounds.map((round, colIndex) => {
      const sorted = round.matches.slice().sort((a, b) => a.pairingOrder - b.pairingOrder);
      return {
        id: round.id,
        stageNumber: round.stageNumber ?? colIndex + 1,
        label: round.label ?? `Upper R${colIndex + 1}`,
        status: round.status,
        bracketType: "upper" as const,
        colIndex,
        matches: sorted.map((m, idx) =>
          buildMatch(m, "upper", upperSectionHeight, 0, sorted.length, idx)
        )
      };
    });

    const lowerColumns: DEBracketColumn[] = lowerRounds.map((round, colIndex) => {
      const sorted = round.matches.slice().sort((a, b) => a.pairingOrder - b.pairingOrder);
      return {
        id: round.id,
        stageNumber: round.stageNumber ?? colIndex + 1,
        label: round.label ?? `Lower R${colIndex + 1}`,
        status: round.status,
        bracketType: "lower" as const,
        colIndex,
        matches: sorted.map((m, idx) =>
          buildMatch(m, "lower", lowerSectionHeight, lowerYStart, sorted.length, idx)
        )
      };
    });

    const gfColumns: DEBracketColumn[] = gfRounds.map((round, colIndex) => {
      const sorted = round.matches.slice().sort((a, b) => a.pairingOrder - b.pairingOrder);
      return {
        id: round.id,
        stageNumber: round.stageNumber ?? 1,
        label: round.label ?? "Grand Final",
        status: round.status,
        bracketType: "grand_final" as const,
        colIndex,
        matches: sorted.map((m, idx) =>
          buildMatch(m, "grand_final", boardHeight, 0, sorted.length, idx)
        )
      };
    });

    function buildSectionConnectors(columns: DEBracketColumn[], prefix: string): PlayoffConnectorLine[] {
      const lines: PlayoffConnectorLine[] = [];
      for (let ci = 1; ci < columns.length; ci++) {
        const prevCol = columns[ci - 1];
        const currCol = columns[ci];
        const rightX = (ci - 1) * (W + G) + W;
        const midX = rightX + G / 2;
        const nextLeftX = rightX + G;
        for (let pi = 0; pi < prevCol.matches.length; pi += 2) {
          const top = prevCol.matches[pi];
          const bot = prevCol.matches[pi + 1] ?? null;
          const target = currCol.matches[Math.floor(pi / 2)] ?? null;
          if (!top || !target) continue;
          lines.push({ key: `${prefix}-ht-${ci}-${pi}`, x1: rightX, y1: top.centerY, x2: midX, y2: top.centerY });
          if (bot) {
            lines.push({ key: `${prefix}-hb-${ci}-${pi}`, x1: rightX, y1: bot.centerY, x2: midX, y2: bot.centerY });
            lines.push({ key: `${prefix}-v-${ci}-${pi}`, x1: midX, y1: Math.min(top.centerY, bot.centerY), x2: midX, y2: Math.max(top.centerY, bot.centerY) });
          }
          lines.push({ key: `${prefix}-nx-${ci}-${pi}`, x1: midX, y1: target.centerY, x2: nextLeftX, y2: target.centerY });
        }
      }
      return lines;
    }

    const upperConnectors = buildSectionConnectors(upperColumns, "ub");
    const lowerConnectors = buildSectionConnectors(lowerColumns, "lb");
    const gfConnectors: PlayoffConnectorLine[] = [];

    if (gfColumns.length > 0 && gfColumns[0].matches.length > 0) {
      const gfCol = gfColumns[0];
      const mergeX = gfColumnStartX - G / 2;
      const gfMatch = gfCol.matches[0];

      const ubFinal = upperColumns[upperColumns.length - 1];
      if (ubFinal?.matches[0]) {
        const m = ubFinal.matches[0];
        const fromX = ubFinal.colIndex * (W + G) + W;
        gfConnectors.push({ key: "gf-ub-h1", x1: fromX, y1: m.centerY, x2: mergeX, y2: m.centerY });
        if (m.centerY !== gfMatch.centerY) {
          gfConnectors.push({ key: "gf-ub-v", x1: mergeX, y1: Math.min(m.centerY, gfMatch.centerY), x2: mergeX, y2: Math.max(m.centerY, gfMatch.centerY) });
        }
        gfConnectors.push({ key: "gf-ub-h2", x1: mergeX, y1: gfMatch.centerY, x2: gfColumnStartX, y2: gfMatch.centerY });
      }

      const lbFinal = lowerColumns[lowerColumns.length - 1];
      if (lbFinal?.matches[0]) {
        const m = lbFinal.matches[0];
        const fromX = lbFinal.colIndex * (W + G) + W;
        gfConnectors.push({ key: "gf-lb-h1", x1: fromX, y1: m.centerY, x2: mergeX, y2: m.centerY });
        if (m.centerY !== gfMatch.centerY) {
          gfConnectors.push({ key: "gf-lb-v", x1: mergeX, y1: Math.min(m.centerY, gfMatch.centerY), x2: mergeX, y2: Math.max(m.centerY, gfMatch.centerY) });
        }
        gfConnectors.push({ key: "gf-lb-h2", x1: mergeX, y1: gfMatch.centerY, x2: gfColumnStartX, y2: gfMatch.centerY });
      }
    }

    return {
      upperColumns,
      lowerColumns,
      gfColumns,
      upperSectionHeight,
      lowerSectionHeight,
      lowerYStart,
      boardHeight,
      boardWidth,
      gfColumnStartX,
      upperConnectors,
      lowerConnectors,
      gfConnectors
    };
  }

  function parseSwissRecord(label: string) {
    const [winRaw, loseRaw] = label.split("-");
    const win = Number.parseInt(winRaw ?? "", 10);
    const lose = Number.parseInt(loseRaw ?? "", 10);
    if (!Number.isFinite(win) || !Number.isFinite(lose)) return null;
    return { win, lose };
  }

  function swissGroupOrder(leftLabel: string, rightLabel: string) {
    const left = parseSwissRecord(leftLabel);
    const right = parseSwissRecord(rightLabel);
    if (!left || !right) return leftLabel.localeCompare(rightLabel);
    if (left.win !== right.win) return right.win - left.win;
    return left.lose - right.lose;
  }

  function swissGroupTone(label: string): "gold" | "lavender" | "blue" {
    const parsed = parseSwissRecord(label);
    if (!parsed) return "gold";
    const { win, lose } = parsed;
    if (win === lose) return "gold";
    return win > lose ? "lavender" : "blue";
  }

  function swissBestOf(matchBestOf: number | null | undefined): "BO1" | "BO3" {
    return (matchBestOf ?? 1) >= 3 ? "BO3" : "BO1";
  }

  function swissBestOfLabel(matchBestOf: number | null | undefined) {
    return `BEST OF ${matchBestOf ?? 1}`;
  }

  function swissExpectedBestOf(groupLabel: string, winThreshold: number): "BO1" | "BO3" {
    const parsed = parseSwissRecord(groupLabel);
    if (!parsed) return "BO1";
    const isDeciderGroup = parsed.win === winThreshold - 1 && parsed.lose === winThreshold - 1;
    return isDeciderGroup ? "BO3" : "BO1";
  }

  function swissScoreValue(match: (typeof data.bracket)[number]["matches"][number]) {
    if (match.scoreA === null || match.scoreB === null) {
      return match.result === "pending" ? "VS" : "-";
    }
    return `${match.scoreA}-${match.scoreB}`;
  }

  function swissGroupHeight(matchCount: number) {
    const safeMatchCount = Math.max(1, matchCount);
    return SWISS_GROUP_HEADER_HEIGHT
      + SWISS_GROUP_PADDING_TOP
      + SWISS_GROUP_PADDING_BOTTOM
      + (safeMatchCount * SWISS_MATCH_ROW_HEIGHT)
      + ((safeMatchCount - 1) * SWISS_MATCH_ROW_GAP);
  }

  function buildSwissExpectedGroupsByRound(winThreshold: number, totalRounds: number): Record<number, string[]> {
    const groupsByRound: Record<number, string[]> = {};
    for (let round = 1; round <= totalRounds; round++) {
      const gamesPlayed = round - 1;
      const labels: string[] = [];
      for (let win = gamesPlayed; win >= 0; win--) {
        const lose = gamesPlayed - win;
        if (win >= winThreshold || lose >= winThreshold) continue;
        labels.push(`${win}-${lose}`);
      }
      groupsByRound[round] = labels;
    }
    return groupsByRound;
  }

  function buildSwissExpectedMatchCountsByRound(totalTeams: number, winThreshold: number, totalRounds: number) {
    const expected: Record<number, Record<string, number>> = {};
    let activeCounts = new Map<string, number>([["0-0", Math.max(0, totalTeams)]]);

    for (let round = 1; round <= totalRounds; round++) {
      const currentRound: Record<string, number> = {};
      const nextCounts = new Map<string, number>();

      for (const [label, teamCount] of activeCounts.entries()) {
        if (teamCount <= 0) continue;
        const record = parseSwissRecord(label);
        if (!record) continue;

        currentRound[label] = Math.max(1, Math.floor(teamCount / 2));

        const winners = Math.ceil(teamCount / 2);
        const losers = Math.floor(teamCount / 2);

        if (record.win + 1 < winThreshold && winners > 0) {
          const nextLabel = `${record.win + 1}-${record.lose}`;
          nextCounts.set(nextLabel, (nextCounts.get(nextLabel) ?? 0) + winners);
        }
        if (record.lose + 1 < winThreshold && losers > 0) {
          const nextLabel = `${record.win}-${record.lose + 1}`;
          nextCounts.set(nextLabel, (nextCounts.get(nextLabel) ?? 0) + losers);
        }
      }

      expected[round] = currentRound;
      activeCounts = nextCounts;
    }

    return expected;
  }

  function buildSwissStageDisplay(
    rounds: typeof data.bracket,
    winThreshold: number,
    totalRounds: number,
    totalTeams: number
  ): SwissStageDisplay {
    const expectedGroupsByRound = buildSwissExpectedGroupsByRound(winThreshold, totalRounds);
    const expectedMatchCountsByRound = buildSwissExpectedMatchCountsByRound(totalTeams, winThreshold, totalRounds);
    const swissRounds = rounds
      .filter((round) => round.stage === "swiss")
      .slice()
      .sort((left, right) => left.roundNumber - right.roundNumber);
    const records = new Map<number, { win: number; lose: number; teamName: string }>();
    const columns: SwissDisplayColumn[] = [];

    for (const round of swissRounds) {
      const groupMap = new Map<string, SwissDisplayGroup>();
      const roundMatches = round.matches.slice().sort((left, right) => left.pairingOrder - right.pairingOrder);

      for (const match of roundMatches) {
        const teamAId = match.teamA?.id ?? null;
        const teamBId = match.teamB?.id ?? null;
        const teamAName = match.teamA?.name ?? "TBD";
        const teamBName = match.teamB?.name ?? (teamBId ? "TBD" : "BYE");

        if (teamAId && !records.has(teamAId)) {
          records.set(teamAId, { win: 0, lose: 0, teamName: teamAName });
        }
        if (teamBId && !records.has(teamBId)) {
          records.set(teamBId, { win: 0, lose: 0, teamName: teamBName });
        }

        const teamARecord = teamAId ? (records.get(teamAId) ?? { win: 0, lose: 0, teamName: teamAName }) : { win: 0, lose: 0, teamName: teamAName };
        const groupLabel = `${teamARecord.win}-${teamARecord.lose}`;
        const tone = swissGroupTone(groupLabel);
        const bestOf = swissBestOf(match.matchBestOf);

        const targetGroup = groupMap.get(groupLabel) ?? {
          id: `${round.id}-${groupLabel}`,
          label: groupLabel,
          bestOf,
          bestOfLabel: swissBestOfLabel(match.matchBestOf),
          roundNumber: round.roundNumber,
          status: round.status,
          tone,
          topOffset: 0,
          height: 0,
          centerY: 0,
          matches: []
        };

        const isTeamAWinner = match.winnerTeamId !== null && match.winnerTeamId === teamAId;
        const isTeamBWinner = match.winnerTeamId !== null && match.winnerTeamId === teamBId;

        targetGroup.matches.push({
          id: match.id,
          leftTeamId: teamAId,
          rightTeamId: teamBId,
          left: teamAName,
          right: teamBName,
          leftSeed: match.teamA?.seed ?? null,
          rightSeed: match.teamB?.seed ?? null,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          score: swissScoreValue(match),
          result: match.result,
          winnerTeamId: match.winnerTeamId,
          leftIsWinner: isTeamAWinner,
          leftIsLoser: isTeamBWinner,
          rightIsWinner: isTeamBWinner,
          rightIsLoser: isTeamAWinner
        });
        groupMap.set(groupLabel, targetGroup);

        const registerResult = (teamId: number | null, teamName: string, outcome: "win" | "lose") => {
          if (!teamId) return;
          const current = records.get(teamId) ?? { win: 0, lose: 0, teamName };
          const next = {
            win: current.win + (outcome === "win" ? 1 : 0),
            lose: current.lose + (outcome === "lose" ? 1 : 0),
            teamName
          };
          records.set(teamId, next);
        };

        if (match.result === "team_a_win" || match.result === "bye") {
          registerResult(teamAId, teamAName, "win");
          registerResult(teamBId, teamBName, "lose");
        } else if (match.result === "team_b_win") {
          registerResult(teamAId, teamAName, "lose");
          registerResult(teamBId, teamBName, "win");
        }
      }

      columns.push({
        id: `swiss-round-${round.roundNumber}`,
        roundNumber: round.roundNumber,
        status: round.status,
        leftOffset: 0,
        height: 0,
        groups: Array.from(groupMap.values()).sort((left, right) => swissGroupOrder(left.label, right.label))
      });
    }

    const existingRoundNums = new Set(swissRounds.map((r) => r.roundNumber));
    for (let roundNum = 1; roundNum <= totalRounds; roundNum++) {
      if (existingRoundNums.has(roundNum)) continue;
      const expectedGroups = expectedGroupsByRound[roundNum] ?? [];
      columns.push({
        id: `swiss-placeholder-round-${roundNum}`,
        roundNumber: roundNum,
        status: "pending",
        leftOffset: 0,
        height: 0,
        groups: expectedGroups.map((label, idx) => {
          const defaultBestOf = swissExpectedBestOf(label, winThreshold);
          const expectedMatchCount = Math.max(1, expectedMatchCountsByRound[roundNum]?.[label] ?? 1);
          return {
            id: `placeholder-${roundNum}-${label}`,
            label,
            bestOf: defaultBestOf,
            bestOfLabel: swissBestOfLabel(defaultBestOf === "BO3" ? 3 : 1),
            roundNumber: roundNum,
            status: "pending",
            tone: swissGroupTone(label),
            topOffset: 0,
            height: 0,
            centerY: 0,
            matches: Array.from({ length: expectedMatchCount }, (_, matchIndex) => ({
              id: -(roundNum * 1000 + idx * 100 + matchIndex + 1),
              leftTeamId: null,
              rightTeamId: null,
              left: "TBD",
              right: "TBD",
              leftSeed: null,
              rightSeed: null,
              scoreA: null,
              scoreB: null,
              score: "VS",
              result: "pending",
              winnerTeamId: null,
              leftIsWinner: false,
              leftIsLoser: false,
              rightIsWinner: false,
              rightIsLoser: false
            }))
          };
        })
      });
    }

    const layoutColumns = columns
      .slice()
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map((column, columnIndex) => {
        let topCursor = SWISS_COLUMN_PADDING_TOP;
        const groups = column.groups.map((group) => {
          const height = swissGroupHeight(group.matches.length);
          const topOffset = topCursor;
          const centerY = topOffset + (height / 2);
          topCursor += height + SWISS_GROUP_GAP;
          return {
            ...group,
            topOffset,
            height,
            centerY
          };
        });

        return {
          ...column,
          leftOffset: columnIndex * (SWISS_COLUMN_WIDTH + SWISS_COLUMN_GAP),
          height: topCursor + SWISS_BOARD_VERTICAL_PADDING,
          groups
        };
      });

    const boardHeight = Math.max(
      260,
      ...layoutColumns.map((column) => column.height)
    );
    const boardWidth = Math.max(1, layoutColumns.length) * SWISS_COLUMN_WIDTH
      + Math.max(0, layoutColumns.length - 1) * SWISS_COLUMN_GAP;

    const connectors: SwissConnectorLine[] = [];
    for (let columnIndex = 0; columnIndex < layoutColumns.length - 1; columnIndex++) {
      const sourceColumn = layoutColumns[columnIndex];
      const targetColumn = layoutColumns[columnIndex + 1];
      const targetGroups = new Map(targetColumn.groups.map((group) => [group.label, group]));
      const startX = sourceColumn.leftOffset + SWISS_COLUMN_WIDTH;
      const endX = targetColumn.leftOffset;
      const midX = startX + (SWISS_COLUMN_GAP / 2);

      for (const group of sourceColumn.groups) {
        const record = parseSwissRecord(group.label);
        if (!record) continue;
        const outcomes: Array<{ label: string; tone: "win" | "loss" }> = [
          { label: `${record.win + 1}-${record.lose}`, tone: "win" },
          { label: `${record.win}-${record.lose + 1}`, tone: "loss" }
        ];

        for (const outcome of outcomes) {
          const targetGroup = targetGroups.get(outcome.label);
          if (!targetGroup) continue;
          connectors.push({
            key: `${sourceColumn.id}-${group.label}-${outcome.label}-${outcome.tone}`,
            d: `M ${startX} ${group.centerY} H ${midX} V ${targetGroup.centerY} H ${endX}`,
            tone: outcome.tone
          });
        }
      }
    }

    for (const standingRow of data.standings) {
      if (records.has(standingRow.teamId)) continue;
      records.set(standingRow.teamId, {
        win: standingRow.win,
        lose: standingRow.lose,
        teamName: standingRow.teamName
      });
    }

    const teamStandings: SwissTeamStanding[] = Array.from(records.entries()).map(([teamId, rec]) => {
      const score = `${rec.win}-${rec.lose}`;
      const qualified = rec.win >= winThreshold;
      const eliminated = rec.lose >= winThreshold;
      return {
        teamId,
        teamName: rec.teamName,
        win: rec.win,
        lose: rec.lose,
        score,
        tone: swissGroupTone(score),
        type: qualified ? "qualified" : eliminated ? "eliminated" : "active"
      };
    });

    return {
      columns: layoutColumns.map((column) => ({ ...column, height: boardHeight })),
      layout: {
        boardWidth,
        boardHeight,
        columnWidth: SWISS_COLUMN_WIDTH,
        connectors
      },
      teamStandings
    };
  }

  const standingsHeaders = [
    { label: "P", title: "Played. Total matches completed, including byes." },
    { label: "W", title: "Wins. Matches recorded as a win in the current tournament format." },
    { label: "L", title: "Losses. Matches recorded as a loss in the current tournament format." },
    { label: "D", title: "Draws. Matches recorded as a draw when the selected BO format allows it." },
    { label: "Bye", title: "Bye. Administrative round without an opponent. Counts toward played and awards standing points, but stays separate from Wins and Point Difference." },
    { label: "Pts", title: "Total standing points. Formula: win = 1, draw = 0.5, loss = 0, bye = 1. Rank is sorted by Pts first." },
    { label: "H2H", title: "Head-to-head. Standing points earned against tied teams with the same Pts value. Used after Pts." },
    { label: "Buchholz", title: "Buchholz. Formula: the sum of all opponent scores faced by this team." },
    { label: "Pts Diff", title: "Point Difference. Formula: total games won minus total games lost across the recorded BO results, excluding byes. Used after Buchholz." }
  ] as const;

  $: advanceToPlayoffs = Math.min(
    Math.max(2, data.event.advanceToPlayoffs ?? 4),
    Math.max(2, data.standings.length)
  );
  $: playoffSeeds = data.standings
    .filter((row) => row.rank <= advanceToPlayoffs)
    .sort((left, right) => left.rank - right.rank);
  $: playoffChampion = data.standings.find((row) => row.rank === 1) ?? null;
  $: isDE = data.event.playoffFormat === "double_elimination";
  $: playoffFinalRound = showPlayoffBracketBoard
    ? (playoffBracketBoard.rounds.find((r) => r.roundNumber === data.event.totalRounds) ?? null)
    : null;
  $: playoffGrandFinalMatch = playoffFinalRound?.matches.find((m) => m.pairingOrder === 1) ?? null;
  $: playoffThirdPlaceMatch = playoffFinalRound?.matches.find((m) => m.matchLabel === "Third Place Match") ?? null;
  $: deGrandFinalRound = isDE
    ? (data.bracket.find((r) => r.stage === "grand_final") ?? null)
    : null;
  $: deGrandFinalMatch = deGrandFinalRound?.matches.find((m) => m.pairingOrder === 1) ?? null;
  $: playoffRunnerUp = (() => {
    const m = isDE ? deGrandFinalMatch : playoffGrandFinalMatch;
    if (!m || !m.winnerTeamId) return null;
    return (m.winnerTeamId === m.teamA?.id ? m.teamB?.name : m.teamA?.name) ?? null;
  })();
  $: playoffChampionName = (() => {
    if (isDE) {
      const m = deGrandFinalMatch;
      if (!m || !m.winnerTeamId) return null;
      return (m.winnerTeamId === m.teamA?.id ? m.teamA?.name : m.teamB?.name) ?? null;
    }
    return playoffChampion?.teamName ?? null;
  })();
  $: playoffThirdPlaceName = (() => {
    const m = playoffThirdPlaceMatch;
    if (!m || !m.winnerTeamId) return null;
    return (m.winnerTeamId === m.teamA?.id ? m.teamA?.name : m.teamB?.name) ?? null;
  })();
  $: nextPendingMatchId = (() => {
    if (!showPlayoffBracketBoard) return null;
    const activeRound = playoffBracketBoard.rounds.find((r) => r.status === "active" || r.status === "ongoing");
    return activeRound?.matches.find((m) => m.result === "pending")?.id ?? null;
  })();
  $: showStandingsTable = data.event.eventMode !== "playoffs" && data.event.regularSeasonFormat !== "swiss_stage";
  $: showPlayoffFinalStanding =
    data.event.eventMode === "playoffs"
    && data.event.status === "completed"
    && data.event.regularSeasonFormat !== "swiss_stage";
  $: swissRounds = data.bracket.filter((round) => round.stage === "swiss");
  $: isSwissStageCompleted = swissRounds.length > 0
    && swissRounds.every((round) => round.status === "completed" || round.status === "finished");
  $: showSwissFinalStanding =
    data.event.regularSeasonFormat === "swiss_stage"
    && isSwissStageCompleted;
  $: showAdvancedPodium = data.event.eventMode === "regular_season" && data.event.regularSeasonFormat !== "swiss_stage" && data.event.status === "completed";
  $: showPlayoffBracketBoard = data.event.eventMode === "playoffs" && data.event.playoffFormat === "single_elimination";
  $: showDEBracketBoard = data.event.eventMode === "playoffs" && data.event.playoffFormat === "double_elimination";
  $: showSwissStageBoard = data.event.regularSeasonFormat === "swiss_stage";
  $: swissWinThreshold = data.event.totalTeams <= 8 ? 2 : 3;
  $: swissTotalRounds = Math.max(1, data.event.totalRounds || (data.event.totalTeams <= 8 ? 3 : 5));
  $: swissMicrocopy = swissWinThreshold <= 2
    ? "Teams with the same record face each other. Reach 2 wins to qualify and 2 losses to stop."
    : "Teams with the same record face each other. Reach 3 wins to qualify and 3 losses to stop.";
  $: playoffBracketBoard = showPlayoffBracketBoard
    ? buildPlayoffBracketRounds(
      data.bracket,
      data.event.totalRounds,
      data.event.totalTeams,
      data.event.playoffThirdPlaceBestOf
    )
    : { rounds: [] as PlayoffDisplayRound[], boardHeight: 0, boardWidth: 0, connectorLines: [] as PlayoffConnectorLine[] };
  $: deBracketBoard = showDEBracketBoard
    ? buildDoubleEliminationBracket(data.bracket)
    : {
        upperColumns: [] as DEBracketColumn[],
        lowerColumns: [] as DEBracketColumn[],
        gfColumns: [] as DEBracketColumn[],
        upperSectionHeight: 0,
        lowerSectionHeight: 0,
        lowerYStart: 0,
        boardHeight: 0,
        boardWidth: 0,
        gfColumnStartX: 0,
        upperConnectors: [] as PlayoffConnectorLine[],
        lowerConnectors: [] as PlayoffConnectorLine[],
        gfConnectors: [] as PlayoffConnectorLine[]
      };
  $: deNextPendingMatchId = (() => {
    if (!showDEBracketBoard) return null;
    const allCols = [...deBracketBoard.upperColumns, ...deBracketBoard.lowerColumns, ...deBracketBoard.gfColumns];
    const activeCol = allCols.find((col) => col.status === "active" || col.status === "ongoing");
    return activeCol?.matches.find((m) => m.result === "pending")?.id ?? null;
  })();
  $: swissStageDisplay = showSwissStageBoard
    ? buildSwissStageDisplay(data.bracket, swissWinThreshold, swissTotalRounds, data.event.totalTeams)
    : {
        columns: [] as SwissDisplayColumn[],
        layout: { boardWidth: SWISS_COLUMN_WIDTH, boardHeight: 260, columnWidth: SWISS_COLUMN_WIDTH, connectors: [] as SwissConnectorLine[] },
        teamStandings: [] as SwissTeamStanding[]
      };
  $: swissStandingsRows = showSwissStageBoard
    ? [...swissStageDisplay.teamStandings].sort((a, b) => {
        const typeOrder: Record<string, number> = { qualified: 0, active: 1, eliminated: 2 };
        const typeDiff = (typeOrder[a.type] ?? 1) - (typeOrder[b.type] ?? 1);
        if (typeDiff !== 0) return typeDiff;
        if (a.win !== b.win) return b.win - a.win;
        return a.lose - b.lose;
      }).map((row) => ({
        ...row,
        needsWins: row.type === "active" ? Math.max(0, swissWinThreshold - row.win) : 0,
        needsLoss: row.type === "active" ? Math.max(0, swissWinThreshold - row.lose) : 0
      }))
    : [];
  $: swissQualifiedTeams = showSwissFinalStanding
    ? swissStandingsRows
      .filter((row) => row.type === "qualified")
      .slice()
      .sort((a, b) => {
        if (a.win !== b.win) return b.win - a.win;
        if (a.lose !== b.lose) return a.lose - b.lose;
        return a.teamName.localeCompare(b.teamName);
      })
    : [];
  $: showSwissStandingsCard = showSwissStageBoard && swissStandingsRows.length > 0;
  $: swissScheduleGroups = showSwissStageBoard
    ? swissStageDisplay.columns.flatMap((column) =>
      column.groups.map((group) => ({
        id: `${column.id}-${group.label}`,
        title: `Round ${group.label}`,
        status: group.status,
        roundNumber: group.roundNumber,
        bestOfLabel: group.bestOfLabel,
        matches: group.matches
      })))
    : [];
  $: playoffScheduleRounds = data.event.eventMode === "playoffs"
    ? data.bracket
      .slice()
      .sort((left, right) => left.roundNumber - right.roundNumber)
      .map((round) => ({
        ...round,
        stageLabel: round.label ?? formatPlayoffStageLabel(round.roundNumber, data.event.totalRounds, round.matches.length),
        matches: round.matches.slice().sort((left, right) => left.pairingOrder - right.pairingOrder)
      }))
    : [];
  $: postmatchItems = (data.postmatchIntelligence?.items ?? []).filter(
    (item) => item.winnerTeam && item.loserTeam
  );
  const isDraftLogAdminEnabled = (import.meta.env.PUBLIC_TOURNAMENT_DRAFTLOG_ADMIN as string) === "1";
  let selectedDraftLogMatchId = "";
  let teamAPicksInput = "";
  let teamBPicksInput = "";
  let teamABansInput = "";
  let teamBBansInput = "";
  let draftLogSource: "manual" | "imported" = "manual";
  let draftLogNotes = "";
  let draftLogSubmitting = false;
  let draftLogMessage = "";
  let draftLogError = "";

  $: if (isDraftLogAdminEnabled && !selectedDraftLogMatchId && postmatchItems.length > 0) {
    selectedDraftLogMatchId = String(postmatchItems[0]?.matchId ?? "");
  }

  function parseMlidsInput(raw: string) {
    const parts = raw
      .split(/[\s,]+/)
      .map((item) => Number(item.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
    return Array.from(new Set(parts)).slice(0, 10);
  }

  async function submitDraftLog() {
    const targetMatchId = Number(selectedDraftLogMatchId);
    if (!Number.isInteger(targetMatchId) || targetMatchId <= 0) return;
    draftLogError = "";
    draftLogMessage = "";
    draftLogSubmitting = true;

    try {
      const response = await fetch(
        apiUrl(`/events/${data.event.id}/matches/${targetMatchId}/draft-log`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamAPicks: parseMlidsInput(teamAPicksInput),
            teamBPicks: parseMlidsInput(teamBPicksInput),
            teamABans: parseMlidsInput(teamABansInput),
            teamBBans: parseMlidsInput(teamBBansInput),
            source: draftLogSource,
            notes: draftLogNotes.trim() || undefined
          })
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        draftLogError = payload?.error ?? "Failed to save draft log.";
        return;
      }
      draftLogMessage = "Draft log saved. Tournament intelligence refreshed.";
      await invalidateAll();
    } catch {
      draftLogError = "Failed to save draft log.";
    } finally {
      draftLogSubmitting = false;
    }
  }
</script>

<section class="event-page">
  <header class="event-header">
    <div class="event-copy">
      <div class="event-topbar">
        <a class="back-link" href="/tournaments">Back to Tournament</a>
        <div class="header-actions">
          <div class={`status-chip ${statusTone(data.event.status)}`}>{data.event.status}</div>
          <button
            class="refresh-button"
            type="button"
            aria-label="Refresh tournament"
            title="Refresh tournament"
            on:click={() => void refreshTournamentView(true)}
            disabled={isRefreshing}
          >
            {#if isRefreshing && isManualRefresh}
              <span class="refresh-spinner" aria-hidden="true">⏳</span>
            {:else}
              <span aria-hidden="true">🔄</span>
            {/if}
          </button>
        </div>
      </div>
      <h1 class="page-title">{data.event.name}</h1>
      <p class="viewer-note">{formatEventLabel(data.event)} · {data.event.totalTeams} teams · {data.event.totalRounds} rounds</p>

    </div>
  </header>

  {#if showPostmatchIntelligence && postmatchItems.length > 0}
    <Card title="Tournament Intelligence · Winner vs Loser Review">
      <section class="postmatch-intel">
        {#if data.postmatchIntelligence?.methodologyNote}
          <p class="postmatch-note">{data.postmatchIntelligence.methodologyNote}</p>
        {/if}
        {#if typeof data.postmatchIntelligence?.draftLogCoverage === "number"}
          <p class="postmatch-coverage">
            Draft log coverage: {Math.round((data.postmatchIntelligence?.draftLogCoverage ?? 0) * 100)}%
            of reviewed completed matches.
          </p>
        {/if}

        <div class="postmatch-grid">
          {#each postmatchItems as item}
            <article class="postmatch-card">
              <div class="postmatch-head">
                <h3>{item.winnerTeam?.name} vs {item.loserTeam?.name}</h3>
                <span class="postmatch-chip">{item.roundLabel ?? `Round ${item.roundNumber ?? "-"}`} · {item.scoreline}</span>
              </div>

              <div class="postmatch-columns">
                <div class="postmatch-block postmatch-block--winner">
                  <h4>Winner Analysis</h4>
                  {#each item.winnerAnalysis as line}
                    <p>{line}</p>
                  {/each}
                </div>
                <div class="postmatch-block postmatch-block--loser">
                  <h4>Loser Analysis</h4>
                  {#each item.loserAnalysis as line}
                    <p>{line}</p>
                  {/each}
                </div>
              </div>

              <div class="postmatch-adjustment">
                <div class="postmatch-adjustment-head">
                  <h4>Recommended Hero Swap for {item.loserTeam?.name}</h4>
                  <div class="postmatch-meta">
                    <span class="postmatch-confidence">{item.confidence}</span>
                    <a class="postmatch-cta" href="/draft-master">Apply to Draft Room</a>
                  </div>
                </div>
                {#if item.confidenceReason}
                  <p class="postmatch-confidence-reason">{item.confidenceReason}</p>
                {/if}
                <ul>
                  {#each item.loserRecommendations as recommendation}
                    <li>
                      <strong>{recommendation.lane.toUpperCase()}:</strong>
                      <span>{recommendation.heroName}</span>
                      {#if recommendation.swapOutHeroName}
                        <small>Swap out: {recommendation.swapOutHeroName}</small>
                      {/if}
                      <em>{recommendation.confidence}</em>
                      <small>{recommendation.reason}</small>
                    </li>
                  {/each}
                </ul>
              </div>
            </article>
          {/each}
        </div>

        {#if isDraftLogAdminEnabled}
          <section class="postmatch-admin">
            <div class="postmatch-admin-head">
              <h3>Admin · Quick Draft Log Input</h3>
              <span>Save picks/bans by MLID to upgrade loser-side matchup recommendations.</span>
            </div>

            {#if postmatchItems.length === 0}
              <p class="postmatch-admin-empty">No completed matches available yet.</p>
            {:else}
              <div class="postmatch-admin-grid">
                <label>
                  <span>Match</span>
                  <select bind:value={selectedDraftLogMatchId}>
                    {#each postmatchItems as item}
                      <option value={String(item.matchId)}>
                        {item.winnerTeam?.name} vs {item.loserTeam?.name} · {item.roundLabel ?? `Round ${item.roundNumber ?? "-"}`}
                      </option>
                    {/each}
                  </select>
                </label>
                <label>
                  <span>Source</span>
                  <select bind:value={draftLogSource}>
                    <option value="manual">manual</option>
                    <option value="imported">imported</option>
                  </select>
                </label>
                <label>
                  <span>Team A Picks (comma-separated MLID)</span>
                  <textarea rows="2" bind:value={teamAPicksInput} placeholder="123, 45, 67, 89, 101"></textarea>
                </label>
                <label>
                  <span>Team B Picks (comma-separated MLID)</span>
                  <textarea rows="2" bind:value={teamBPicksInput} placeholder="201, 202, 203, 204, 205"></textarea>
                </label>
                <label>
                  <span>Team A Bans (optional)</span>
                  <textarea rows="2" bind:value={teamABansInput} placeholder="210, 211, 212"></textarea>
                </label>
                <label>
                  <span>Team B Bans (optional)</span>
                  <textarea rows="2" bind:value={teamBBansInput} placeholder="310, 311, 312"></textarea>
                </label>
                <label class="postmatch-admin-notes">
                  <span>Notes (optional)</span>
                  <textarea rows="2" bind:value={draftLogNotes} placeholder="Source link or admin note..."></textarea>
                </label>
              </div>

              {#if draftLogError}
                <p class="postmatch-admin-error">{draftLogError}</p>
              {/if}
              {#if draftLogMessage}
                <p class="postmatch-admin-success">{draftLogMessage}</p>
              {/if}

              <button
                class="postmatch-admin-submit"
                type="button"
                on:click={() => void submitDraftLog()}
                disabled={draftLogSubmitting}
              >
                {draftLogSubmitting ? "Saving..." : "Save Draft Log"}
              </button>
            {/if}
          </section>
        {/if}
      </section>
    </Card>
  {/if}

  {#if showAdvancedPodium}
    <Card title="Final Standing · Qualified to Playoffs">
      <section class="advanced-podium" aria-label={`Top ${advanceToPlayoffs} teams advanced to playoffs`}>
        <div class="podium-grid">
          {#each playoffSeeds as row}
            <article class={`podium-card ${row.rank === 1 ? "is-rank1" : row.rank === 2 ? "is-rank2" : row.rank === 3 ? "is-rank3" : row.rank === 4 ? "is-rank4" : ""}`}>
              <div class="podium-badge">#{row.rank}</div>
              <div class="podium-team">{row.teamName}</div>
              <div class="podium-caption">Advanced</div>
            </article>
          {/each}
        </div>
      </section>
    </Card>
  {/if}

  {#if showStandingsTable}
    <Card title="Standings">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              {#each standingsHeaders as header}
                <th title={header.title} class="hint-header">
                  <span>{header.label}</span>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.standings as row}
              <tr
                aria-pressed={selectedStandingTeamId === row.teamId}
                class:rank-gold={row.rank === 1}
                class:rank-silver={row.rank === 2}
                class:rank-bronze={row.rank === 3}
                class:rank-top4={row.rank === 4}
                class:standing-row-active={selectedStandingTeamId === row.teamId}
                role="button"
                tabindex="0"
                on:click={() => toggleStandingTeam(row.teamId)}
                on:keydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleStandingTeam(row.teamId);
                  }
                }}
              >
                <td>{row.rank}</td>
                <td>{row.teamName}</td>
                <td>{row.played}</td>
                <td>{row.win}</td>
                <td>{row.lose}</td>
                <td>{row.draw}</td>
                <td>{row.bye}</td>
                <td>{row.score}</td>
                <td>{row.headToHead}</td>
                <td>{row.buchholz}</td>
                <td>{formatPointDiff(row.pointDiff)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Card>
  {/if}

  {#if showPlayoffFinalStanding}
    <Card title="Final Standing">
      <div class="playoff-podium">
        <section class="playoff-champion" aria-label="Playoff Champion">
          <div class="playoff-champion-badge">🥇 Champion</div>
          <div class="playoff-champion-name">{playoffChampionName ?? playoffChampion?.teamName ?? "TBD"}</div>
        </section>
        {#if playoffRunnerUp}
          <section class="playoff-podium-place">
            <div class="playoff-podium-badge">🥈 Runner-up</div>
            <div class="playoff-podium-name">{playoffRunnerUp}</div>
          </section>
        {/if}
        {#if playoffThirdPlaceName}
          <section class="playoff-podium-place">
            <div class="playoff-podium-badge">🥉 3rd Place</div>
            <div class="playoff-podium-name">{playoffThirdPlaceName}</div>
          </section>
        {/if}
      </div>
    </Card>
  {/if}

  {#if showSwissFinalStanding && swissQualifiedTeams.length > 0}
    <Card title={`Final Standing · Qualified to Playoffs`}>
      <section class="swiss-qualified-list" aria-label="Teams qualified to playoffs">
        {#each swissQualifiedTeams as team, index}
          <article class={`swiss-qualified-item ${index === 0 ? "is-top" : ""}`}>
            <span class="swiss-qualified-rank">#{index + 1}</span>
            <span class="swiss-qualified-name">{team.teamName}</span>
            <span class="swiss-qualified-record">{team.score}</span>
          </article>
        {/each}
      </section>
    </Card>
  {/if}

  {#if showSwissStageBoard}
    <Card title="Swiss Stage">
      <p class="swiss-microcopy">{swissMicrocopy}</p>

      <div bind:this={bracketAnchor}></div>

      <div class="swiss-board-wrap">
        <p class="swiss-board-mobile-hint">← Scroll to view full Swiss bracket →</p>
        <div
          class="swiss-board"
          style={`width: ${swissStageDisplay.layout.boardWidth}px; height: ${swissStageDisplay.layout.boardHeight}px;`}
        >
          <svg
            class="swiss-board-connectors"
            viewBox={`0 0 ${swissStageDisplay.layout.boardWidth} ${swissStageDisplay.layout.boardHeight}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {#each swissStageDisplay.layout.connectors as connector}
              <path class={`swiss-connector is-${connector.tone}`} d={connector.d} />
            {/each}
          </svg>

          {#each swissStageDisplay.columns as column}
            {@const colStatus = column.status ?? column.groups[0]?.status ?? "pending"}
            <section
              class="swiss-round-col"
              class:is-active={colStatus === "active" || colStatus === "ongoing"}
              class:is-pending={colStatus === "pending"}
              style={`left: ${column.leftOffset}px; width: ${swissStageDisplay.layout.columnWidth}px; height: ${swissStageDisplay.layout.boardHeight}px;`}
              aria-label={`Round ${column.roundNumber}`}
            >
              <header class="swiss-round-header">
                <span class="swiss-round-title">Round {column.roundNumber}</span>
                <span class={`swiss-round-status is-${colStatus === "completed" || colStatus === "finished" ? "completed" : colStatus === "active" || colStatus === "ongoing" ? "active" : "pending"}`}>
                  {colStatus === "completed" || colStatus === "finished" ? "completed" : colStatus === "active" || colStatus === "ongoing" ? "active" : "pending"}
                </span>
              </header>

              {#each column.groups as group}
                <article
                  class={`swiss-group-card is-${group.tone}`}
                  style={`top: ${group.topOffset}px; height: ${group.height}px;`}
                  aria-label={`Record ${group.label}`}
                >
                  <header class="swiss-group-head">
                    <span class="swiss-group-record">{group.label}</span>
                    <span class="swiss-group-bo">{group.bestOf}</span>
                  </header>
                  <div class="swiss-group-matches">
                    {#each group.matches as match}
                      <div
                        class="swiss-match"
                        class:is-highlight={matchContainsSelectedTeam({ teamA: { id: match.leftTeamId }, teamB: { id: match.rightTeamId } })}
                        aria-label={`${match.left} versus ${match.right}, score ${match.score}`}
                      >
                        <span class="swiss-match-team is-left" class:is-winner={match.leftIsWinner} class:is-loser={match.leftIsLoser}>{match.left}</span>
                        <span class="swiss-match-score" class:is-pending={match.result === "pending"}>{match.score}</span>
                        <span class="swiss-match-team is-right" class:is-winner={match.rightIsWinner} class:is-loser={match.rightIsLoser}>{match.right}</span>
                      </div>
                    {/each}
                  </div>
                </article>
              {/each}
            </section>
          {/each}
        </div>
      </div>

      <!-- Collapsible Standings -->
      {#if showSwissStandingsCard}
        <details class="swiss-standings-panel">
          <summary class="swiss-standings-toggle">View Team Standings</summary>
          <div class="swiss-standings-wrap">
            <table class="swiss-standings-table">
              <thead>
                <tr>
                  <th class="swiss-standings-th-record">Record</th>
                  <th class="swiss-standings-th-team">Team</th>
                  <th class="swiss-standings-th-pressure">Needs</th>
                </tr>
              </thead>
              <tbody>
                {#each swissStandingsRows as row}
                  <tr class={`swiss-standings-row is-${row.type}`}>
                    <td>
                      <span class={`swiss-standings-record is-${row.tone}`}>{row.score}</span>
                    </td>
                    <td class="swiss-standings-team">{row.teamName}</td>
                    <td class="swiss-standings-pressure">
                      {#if row.type === "active"}
                        {#if row.needsWins > 0}
                          <span class="pressure-badge needs-wins">+{row.needsWins}W</span>
                        {/if}
                        {#if row.needsLoss > 0}
                          <span class="pressure-badge safe-loss">{row.needsLoss}L left</span>
                        {/if}
                      {:else}
                        <span class="pressure-badge is-done">—</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {/if}
    </Card>
  {/if}

  {#if data.event.eventMode === "regular_season" || showPlayoffBracketBoard || showSwissStageBoard}
    <Card title={showPlayoffBracketBoard ? "Bracket" : "Schedule"}>
      <div bind:this={bracketAnchor}></div>
      {#if showPlayoffBracketBoard}
      <div class="playoff-board-wrap">
        <p class="playoff-board-mobile-hint">← Scroll to see full bracket →</p>
        <div
          class="playoff-board-head"
          style={`grid-template-columns: repeat(${Math.max(playoffBracketBoard.rounds.length, 1)}, ${PLAYOFF_COLUMN_WIDTH}px); column-gap: ${PLAYOFF_COLUMN_GAP}px; width: ${playoffBracketBoard.boardWidth}px;`}
        >
          {#each playoffBracketBoard.rounds as round}
            <section class="playoff-stage-card">
              <strong class="playoff-stage-label">{round.stageLabel}</strong>
              <span class="playoff-stage-meta">{round.stageMeta} · {round.status}</span>
            </section>
          {/each}
        </div>

        <div
          class="playoff-board"
          style={`width: ${playoffBracketBoard.boardWidth}px; height: ${playoffBracketBoard.boardHeight}px;`}
        >
          <svg
            class="playoff-board-connectors"
            viewBox={`0 0 ${playoffBracketBoard.boardWidth} ${playoffBracketBoard.boardHeight}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {#each playoffBracketBoard.connectorLines as line}
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
              />
            {/each}
          </svg>

          {#each playoffBracketBoard.rounds as round, roundIndex}
            {#each round.matches as match}
              <section
                class:playoff-board-match-highlight={matchContainsSelectedTeam(match)}
                class:playoff-board-match-placeholder={match.isPlaceholder}
                class:playoff-board-match-bye={match.isBye && !match.isPlaceholder}
                class:playoff-board-match-third-place={match.matchLabel === "Third Place Match"}
                class:playoff-board-match-next={match.id === nextPendingMatchId}
                class="playoff-board-match"
                style={`left: ${roundIndex * (PLAYOFF_COLUMN_WIDTH + PLAYOFF_COLUMN_GAP)}px; top: ${match.topOffset}px; width: ${PLAYOFF_COLUMN_WIDTH}px;`}
              >
                <div class="playoff-match-label">{match.matchLabel ?? ""}</div>
                <div class="playoff-match-meta">Match #{match.pairingOrder}</div>
                {#if match.matchLabel === "Grand Final" && (data.event.grandFinalTeamALogoUrl || data.event.grandFinalTeamBLogoUrl || data.event.grandFinalYoutubeUrl)}
                  <div class="gf-meta">
                    <div class="gf-logos">
                      {#if data.event.grandFinalTeamALogoUrl}
                        <img class="gf-logo" src={data.event.grandFinalTeamALogoUrl} alt="{match.teamA?.name ?? 'Team A'} logo" />
                      {/if}
                      <span class="gf-vs">VS</span>
                      {#if data.event.grandFinalTeamBLogoUrl}
                        <img class="gf-logo" src={data.event.grandFinalTeamBLogoUrl} alt="{match.teamB?.name ?? 'Team B'} logo" />
                      {/if}
                    </div>
                    {#if data.event.grandFinalYoutubeUrl}
                      <a class="gf-yt-link" href={data.event.grandFinalYoutubeUrl} target="_blank" rel="noreferrer noopener">▶ Watch Live</a>
                    {/if}
                  </div>
                {/if}
                <div class="playoff-match">
                  <div
                    class:selected-team={selectedStandingTeamId === match.teamA?.id}
                    class:winner={match.winnerTeamId === match.teamA?.id}
                    class="playoff-team"
                  >
                    <span class="playoff-name">{match.teamA?.name ?? "TBD"}</span>
                    {#if round.status === "active" && match.scoreA === null && match.teamA?.captainWhatsapp}
                      <a
                        class="team-contact"
                        href={buildWhatsappUrl(match.teamA.captainWhatsapp, round.roundNumber, match.teamB?.name ?? "captain lawan")}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open WhatsApp contact for ${match.teamA.name}`}
                      >
                        <span class="team-contact-badge">WA</span>
                      </a>
                    {:else}
                      <strong class="playoff-score">{match.scoreA ?? "-"}</strong>
                    {/if}
                  </div>
                  <div
                    class:selected-team={selectedStandingTeamId === match.teamB?.id}
                    class:winner={match.winnerTeamId === match.teamB?.id}
                    class="playoff-team"
                  >
                    <span class="playoff-name">{match.teamB?.name ?? (match.isBye ? "BYE" : "TBD")}</span>
                    {#if round.status === "active" && match.scoreB === null && match.teamB?.captainWhatsapp}
                      <a
                        class="team-contact"
                        href={buildWhatsappUrl(match.teamB.captainWhatsapp, round.roundNumber, match.teamA?.name ?? "captain lawan")}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open WhatsApp contact for ${match.teamB.name}`}
                      >
                        <span class="team-contact-badge">WA</span>
                      </a>
                    {:else}
                      <strong class="playoff-score">{match.scoreB ?? "-"}</strong>
                    {/if}
                  </div>
                </div>
              </section>
            {/each}
          {/each}
        </div>
      </div>
      {:else}
      <div class="round-stack">
        {#if showSwissStageBoard}
          {#each swissScheduleGroups as group}
            <details class="round-panel" open={group.status !== "finished" && group.status !== "completed"}>
              <summary class="round-summary">
                <span class="round-summary-title">{group.title}</span>
                <span class="round-summary-side">
                  <span class="round-summary-meta">{group.bestOfLabel} · {group.status}</span>
                  <span class="round-summary-icon" aria-hidden="true"></span>
                </span>
              </summary>
              <div class="match-stack">
                {#each group.matches as match, index}
                  <section class="match-row">
                    <div class="match-order">#{index + 1}</div>
                    <div class="match-body">
                      <div class="team-line" class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.leftTeamId}>
                        <span class="team-seed">{match.leftSeed ?? "-"}</span>
                        <span class="team-name">{match.left}</span>
                        <strong class="team-score">{match.scoreA ?? (match.result === "pending" ? "VS" : "-")}</strong>
                      </div>
                      <div class="team-line" class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.rightTeamId}>
                        <span class="team-seed">{match.rightSeed ?? "-"}</span>
                        <span class="team-name">{match.right}</span>
                        <strong class="team-score">{match.scoreB ?? (match.result === "pending" ? "VS" : "-")}</strong>
                      </div>
                    </div>
                  </section>
                {/each}
              </div>
            </details>
          {/each}
        {:else}
        {#each data.bracket as round}
          {#key `${selectedStandingTeamId ?? "all"}-${round.id}`}
            {@const roundStatusLabel = round.status === "completed" ? "finished" : round.status}
            <details class="round-panel" open={isRoundOpen(round.roundNumber)}>
              <summary class="round-summary">
                <span class="round-summary-title">Round {round.roundNumber}</span>
                <span class="round-summary-side">
                  <span class="round-summary-meta">{roundStatusLabel}</span>
                  <span class="round-summary-icon" aria-hidden="true"></span>
                </span>
              </summary>

              <div class="match-stack">
                {#each visibleRoundMatches(round) as match}
                  <section class:match-row-highlight={matchContainsSelectedTeam(match)} class="match-row">
                    <div class="match-order">#{match.pairingOrder}</div>
                    <div class="match-body">
                      <div
                        class:selected-team={selectedStandingTeamId === match.teamA?.id}
                        class:winner={match.winnerTeamId === match.teamA?.id}
                        class="team-line"
                      >
                        <span class="team-seed">{match.teamA?.seed ?? "-"}</span>
                        <span class="team-name">{match.teamA?.name ?? "TBD"}</span>
                        {#if round.status === "active" && match.scoreA === null && match.teamA?.captainWhatsapp}
                          <a
                            class="team-contact"
                            href={buildWhatsappUrl(match.teamA.captainWhatsapp, round.roundNumber, match.teamA.name)}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`Open WhatsApp contact for ${match.teamA.name}`}
                          >
                            <span class="team-contact-badge">WA</span>
                          </a>
                        {:else}
                          <strong class="team-score">{match.scoreA ?? "-"}</strong>
                        {/if}
                      </div>
                      <div
                        class:selected-team={selectedStandingTeamId === match.teamB?.id}
                        class:winner={match.winnerTeamId === match.teamB?.id}
                        class="team-line"
                      >
                        <span class="team-seed">{match.teamB?.seed ?? "-"}</span>
                        <span class="team-name">{match.teamB?.name ?? "BYE"}</span>
                        {#if round.status === "active" && match.scoreB === null && match.teamB?.captainWhatsapp}
                          <a
                            class="team-contact"
                            href={buildWhatsappUrl(match.teamB.captainWhatsapp, round.roundNumber, match.teamB.name)}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`Open WhatsApp contact for ${match.teamB.name}`}
                          >
                            <span class="team-contact-badge">WA</span>
                          </a>
                        {:else}
                          <strong class="team-score">{match.scoreB ?? "-"}</strong>
                        {/if}
                      </div>
                    </div>
                  </section>
                {/each}
              </div>
            </details>
          {/key}
        {/each}
        {/if}
      </div>
      {/if}
    </Card>
  {/if}

  {#if showDEBracketBoard}
    <Card title="Bracket">
      <div bind:this={bracketAnchor}></div>
      <div class="playoff-board-wrap">
        <p class="playoff-board-mobile-hint">← Scroll to see full bracket →</p>
        <div
          class="de-board-col-heads"
          style={`width: ${deBracketBoard.boardWidth}px; position: relative; height: 54px;`}
        >
          {#if deBracketBoard.upperColumns.length > 0}
            <div
              class="de-col-heads-upper"
              style={`display: grid; grid-template-columns: repeat(${deBracketBoard.upperColumns.length}, ${PLAYOFF_COLUMN_WIDTH}px); column-gap: ${PLAYOFF_COLUMN_GAP}px; height: 100%; align-items: stretch;`}
            >
              {#each deBracketBoard.upperColumns as col}
                <div
                  class="playoff-stage-card de-stage-upper"
                  class:is-active={col.status === "active" || col.status === "ongoing"}
                >
                  <strong class="playoff-stage-label">{col.label}</strong>
                  <span class="playoff-stage-meta">{col.status}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#each deBracketBoard.gfColumns as col}
            <div
              class="playoff-stage-card de-stage-gf"
              class:is-active={col.status === "active" || col.status === "ongoing"}
              style={`position: absolute; top: 0; left: ${deBracketBoard.gfColumnStartX}px; width: ${PLAYOFF_COLUMN_WIDTH}px; height: 100%;`}
            >
              <strong class="playoff-stage-label">{col.label}</strong>
              <span class="playoff-stage-meta">{col.status}</span>
            </div>
          {/each}
        </div>

        <div
          class="playoff-board"
          style={`width: ${deBracketBoard.boardWidth}px; height: ${deBracketBoard.boardHeight}px;`}
        >
          <svg
            class="playoff-board-connectors"
            viewBox={`0 0 ${deBracketBoard.boardWidth} ${deBracketBoard.boardHeight}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {#each deBracketBoard.upperConnectors as line}
              <line stroke="rgba(219,230,245,0.65)" stroke-width="2" stroke-linecap="round" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            {/each}
            {#each deBracketBoard.lowerConnectors as line}
              <line stroke="rgba(219,230,245,0.5)" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 3" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            {/each}
            {#each deBracketBoard.gfConnectors as line}
              <line stroke="rgba(219,230,245,0.65)" stroke-width="2" stroke-linecap="round" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            {/each}
          </svg>

          <div
            class="de-section-band is-upper"
            style={`height: ${deBracketBoard.upperSectionHeight}px; top: 0; width: ${deBracketBoard.boardWidth}px;`}
          ></div>
          <div
            class="de-section-band is-lower"
            style={`height: ${deBracketBoard.lowerSectionHeight}px; top: ${deBracketBoard.lowerYStart}px; width: ${deBracketBoard.boardWidth}px;`}
          ></div>


          {#if deBracketBoard.lowerColumns.length > 0}
            <div
              class="de-lower-col-heads"
              style={`top: ${deBracketBoard.upperSectionHeight + 18}px; width: ${deBracketBoard.boardWidth}px;`}
            >
              {#each deBracketBoard.lowerColumns as col}
                <div
                  class="playoff-stage-card de-stage-lower"
                  class:is-active={col.status === "active" || col.status === "ongoing"}
                  style={`position: absolute; left: ${col.colIndex * (PLAYOFF_COLUMN_WIDTH + PLAYOFF_COLUMN_GAP)}px; width: ${PLAYOFF_COLUMN_WIDTH}px; height: 100%;`}
                >
                  <strong class="playoff-stage-label">{col.label}</strong>
                  <span class="playoff-stage-meta">{col.status}</span>
                </div>
              {/each}
            </div>
          {/if}

          {#each deBracketBoard.upperColumns as col}
            {#each col.matches as match}
              <section
                class="playoff-board-match de-match-upper"
                class:playoff-board-match-next={match.id === deNextPendingMatchId}
                class:playoff-board-match-highlight={matchContainsSelectedTeam(match)}
                style={`left: ${col.colIndex * (PLAYOFF_COLUMN_WIDTH + PLAYOFF_COLUMN_GAP)}px; top: ${match.topOffset}px; width: ${PLAYOFF_COLUMN_WIDTH}px;`}
              >
                <div class="playoff-match-label"></div>
                <div class="playoff-match-meta">M#{match.pairingOrder}{match.matchBestOf ? ` · BO${match.matchBestOf}` : ""}</div>
                <div class="playoff-match">
                  <div
                    class="playoff-team"
                    class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.teamA?.id}
                    class:selected-team={selectedStandingTeamId === match.teamA?.id}
                  >
                    <span class="playoff-name">{match.teamA?.name ?? "TBD"}</span>
                    <strong class="playoff-score">{match.scoreA ?? "-"}</strong>
                  </div>
                  <div
                    class="playoff-team"
                    class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.teamB?.id}
                    class:selected-team={selectedStandingTeamId === match.teamB?.id}
                  >
                    <span class="playoff-name">{match.teamB?.name ?? (match.isBye ? "BYE" : "TBD")}</span>
                    <strong class="playoff-score">{match.scoreB ?? "-"}</strong>
                  </div>
                </div>
              </section>
            {/each}
          {/each}

          {#each deBracketBoard.lowerColumns as col}
            {#each col.matches as match}
              <section
                class="playoff-board-match de-match-lower"
                class:playoff-board-match-next={match.id === deNextPendingMatchId}
                class:playoff-board-match-highlight={matchContainsSelectedTeam(match)}
                style={`left: ${col.colIndex * (PLAYOFF_COLUMN_WIDTH + PLAYOFF_COLUMN_GAP)}px; top: ${match.topOffset}px; width: ${PLAYOFF_COLUMN_WIDTH}px;`}
              >
                <div class="playoff-match-label"></div>
                <div class="playoff-match-meta">M#{match.pairingOrder}{match.matchBestOf ? ` · BO${match.matchBestOf}` : ""}</div>
                <div class="playoff-match">
                  <div
                    class="playoff-team"
                    class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.teamA?.id}
                    class:selected-team={selectedStandingTeamId === match.teamA?.id}
                  >
                    <span class="playoff-name">{match.teamA?.name ?? "TBD"}</span>
                    <strong class="playoff-score">{match.scoreA ?? "-"}</strong>
                  </div>
                  <div
                    class="playoff-team"
                    class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.teamB?.id}
                    class:selected-team={selectedStandingTeamId === match.teamB?.id}
                  >
                    <span class="playoff-name">{match.teamB?.name ?? (match.isBye ? "BYE" : "TBD")}</span>
                    <strong class="playoff-score">{match.scoreB ?? "-"}</strong>
                  </div>
                </div>
              </section>
            {/each}
          {/each}

          {#each deBracketBoard.gfColumns as col}
            {#each col.matches as match}
              <section
                class="playoff-board-match de-match-gf"
                class:playoff-board-match-next={match.id === deNextPendingMatchId}
                class:playoff-board-match-highlight={matchContainsSelectedTeam(match)}
                style={`left: ${deBracketBoard.gfColumnStartX}px; top: ${match.topOffset}px; width: ${PLAYOFF_COLUMN_WIDTH}px;`}
              >
                <div class="playoff-match-label">Grand Final</div>
                <div class="playoff-match-meta">M#{match.pairingOrder}{match.matchBestOf ? ` · BO${match.matchBestOf}` : ""}</div>
                {#if data.event.grandFinalTeamALogoUrl || data.event.grandFinalTeamBLogoUrl || data.event.grandFinalYoutubeUrl}
                  <div class="gf-meta">
                    <div class="gf-logos">
                      {#if data.event.grandFinalTeamALogoUrl}
                        <img class="gf-logo" src={data.event.grandFinalTeamALogoUrl} alt="{match.teamA?.name ?? 'Team A'} logo" />
                      {/if}
                      <span class="gf-vs">VS</span>
                      {#if data.event.grandFinalTeamBLogoUrl}
                        <img class="gf-logo" src={data.event.grandFinalTeamBLogoUrl} alt="{match.teamB?.name ?? 'Team B'} logo" />
                      {/if}
                    </div>
                    {#if data.event.grandFinalYoutubeUrl}
                      <a class="gf-yt-link" href={data.event.grandFinalYoutubeUrl} target="_blank" rel="noreferrer noopener">▶ Watch Live</a>
                    {/if}
                  </div>
                {/if}
                <div class="playoff-match">
                  <div
                    class="playoff-team"
                    class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.teamA?.id}
                    class:selected-team={selectedStandingTeamId === match.teamA?.id}
                  >
                    <span class="playoff-name">{match.teamA?.name ?? "TBD"}</span>
                    <strong class="playoff-score">{match.scoreA ?? "-"}</strong>
                  </div>
                  <div
                    class="playoff-team"
                    class:winner={match.winnerTeamId !== null && match.winnerTeamId === match.teamB?.id}
                    class:selected-team={selectedStandingTeamId === match.teamB?.id}
                  >
                    <span class="playoff-name">{match.teamB?.name ?? (match.isBye ? "BYE" : "TBD")}</span>
                    <strong class="playoff-score">{match.scoreB ?? "-"}</strong>
                  </div>
                </div>
              </section>
            {/each}
          {/each}
        </div>
      </div>
    </Card>
  {/if}

  {#if data.event.eventMode === "playoffs" && playoffScheduleRounds.length > 0}
    <Card title="Schedule">
      <div class="round-stack">
        {#each playoffScheduleRounds as round, roundIndex}
            {@const roundStatusLabel = round.status === "completed" ? "finished" : round.status}
            <details class="round-panel" open={isRoundOpen(round.roundNumber)}>
              <summary class="round-summary">
                <span class="round-summary-title">{isDE ? round.stageLabel : `${round.stageLabel} · Round ${round.roundNumber}`}</span>
                <span class="round-summary-side">
                  <span class="round-summary-meta">{roundStatusLabel}</span>
                  <span class="round-summary-icon" aria-hidden="true"></span>
                </span>
              </summary>

              <div class="match-stack">
                {#each round.matches as match}
                  {@const playoffMatchLabel = formatPlayoffMatchLabel(round.roundNumber, data.event.totalRounds, match.pairingOrder, round.matches.length)}
                  <section class:match-row-highlight={matchContainsSelectedTeam(match)} class="match-row">
                    <div class="match-order">#{match.pairingOrder}</div>
                    <div class="match-body">
                      {#if playoffMatchLabel}
                        <div class="playoff-schedule-match-label">{playoffMatchLabel}</div>
                      {/if}
                      <div
                        class:selected-team={selectedStandingTeamId === match.teamA?.id}
                        class:winner={match.winnerTeamId === match.teamA?.id}
                        class="team-line"
                      >
                        <span class="team-seed">{match.teamA?.seed ?? "-"}</span>
                        <span class="team-name">{match.teamA?.name ?? "TBD"}</span>
                        {#if round.status === "active" && match.scoreA === null && match.teamA?.captainWhatsapp}
                          <a
                            class="team-contact"
                            href={buildWhatsappUrl(match.teamA.captainWhatsapp, round.roundNumber, match.teamB?.name ?? "captain lawan")}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`Open WhatsApp contact for ${match.teamA.name}`}
                          >
                            <span class="team-contact-badge">WA</span>
                          </a>
                        {:else}
                          <strong class="team-score">{match.scoreA ?? "-"}</strong>
                        {/if}
                      </div>
                      <div
                        class:selected-team={selectedStandingTeamId === match.teamB?.id}
                        class:winner={match.winnerTeamId === match.teamB?.id}
                        class="team-line"
                      >
                        <span class="team-seed">{match.teamB?.seed ?? "-"}</span>
                        <span class="team-name">{match.teamB?.name ?? "BYE"}</span>
                        {#if round.status === "active" && match.scoreB === null && match.teamB?.captainWhatsapp}
                          <a
                            class="team-contact"
                            href={buildWhatsappUrl(match.teamB.captainWhatsapp, round.roundNumber, match.teamA?.name ?? "captain lawan")}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label={`Open WhatsApp contact for ${match.teamB?.name ?? "team B"}`}
                          >
                            <span class="team-contact-badge">WA</span>
                          </a>
                        {:else}
                          <strong class="team-score">{match.scoreB ?? "-"}</strong>
                        {/if}
                      </div>
                    </div>
                  </section>
                {/each}
              </div>
            </details>
          {/each}
      </div>
    </Card>
  {/if}

</section>

<style>
  .event-page {
    --playoff-team-height: 40px;
    display: grid;
    gap: 16px;
    min-width: 0;
  }

  .de-section-header {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 8px 4px 2px;
    margin-top: 8px;
    border-bottom: 1px solid;
    opacity: 0.8;
  }
  .de-ub { color: #60a5fa; border-color: #60a5fa40; }
  .de-lb { color: #f87171; border-color: #f8717140; }
  .de-gf { color: #fbbf24; border-color: #fbbf2440; }

  .event-page :global(.card) {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    overflow: hidden;
  }

  .event-header {
    display: block;
    min-width: 0;
  }

  .event-copy {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .event-copy > * {
    margin: 0;
  }

  .back-link {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .event-topbar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }

  .viewer-note {
    color: var(--muted);
    font-size: 0.92rem;
    max-width: 640px;
  }

  .postmatch-intel {
    display: grid;
    gap: 12px;
  }

  .postmatch-note {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--muted);
  }

  .postmatch-coverage {
    margin: 0;
    font-size: 0.74rem;
    color: #9ee7ff;
    letter-spacing: 0.02em;
  }

  .postmatch-grid {
    display: grid;
    gap: 10px;
  }

  .postmatch-card {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 12px;
    background: rgba(9, 18, 34, 0.52);
    padding: 12px;
    display: grid;
    gap: 10px;
  }

  .postmatch-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .postmatch-head h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text);
    font-weight: 700;
  }

  .postmatch-chip {
    border-radius: 999px;
    padding: 3px 8px;
    border: 1px solid rgba(123, 220, 255, 0.24);
    background: rgba(18, 71, 107, 0.22);
    color: #9ee7ff;
    font-size: 0.68rem;
    font-weight: 700;
  }

  .postmatch-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .postmatch-block {
    border: 1px solid rgba(123, 220, 255, 0.12);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.02);
    padding: 10px;
    display: grid;
    gap: 6px;
  }

  .postmatch-block h4 {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 700;
  }

  .postmatch-block p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--text);
  }

  .postmatch-block--winner {
    border-color: rgba(95, 222, 160, 0.2);
  }

  .postmatch-block--loser {
    border-color: rgba(255, 181, 90, 0.2);
  }

  .postmatch-adjustment {
    border: 1px solid rgba(123, 220, 255, 0.12);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.015);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .postmatch-adjustment-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .postmatch-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .postmatch-adjustment-head h4 {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text);
    font-weight: 700;
  }

  .postmatch-confidence {
    border-radius: 999px;
    padding: 2px 8px;
    border: 1px solid rgba(123, 220, 255, 0.2);
    color: #9ee7ff;
    font-size: 0.65rem;
    font-weight: 700;
  }

  .postmatch-cta {
    border-radius: 999px;
    border: 1px solid rgba(123, 220, 255, 0.3);
    padding: 3px 10px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #9ee7ff;
    text-decoration: none;
    background: rgba(20, 74, 108, 0.28);
  }

  .postmatch-cta:hover {
    border-color: rgba(123, 220, 255, 0.5);
    background: rgba(20, 74, 108, 0.44);
  }

  .postmatch-confidence-reason {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--muted);
  }

  .postmatch-adjustment ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }

  .postmatch-adjustment li {
    border: 1px dashed rgba(123, 220, 255, 0.18);
    border-radius: 8px;
    padding: 8px;
    display: grid;
    gap: 3px;
  }

  .postmatch-adjustment li strong {
    color: #9ee7ff;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
  }

  .postmatch-adjustment li span {
    color: var(--text);
    font-size: 0.86rem;
    font-weight: 600;
  }

  .postmatch-adjustment li em {
    color: #9ed9ff;
    font-size: 0.7rem;
    font-style: normal;
  }

  .postmatch-adjustment li small {
    color: var(--muted);
    font-size: 0.74rem;
    line-height: 1.4;
  }

  .postmatch-admin {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 12px;
    background: rgba(7, 15, 29, 0.5);
    padding: 12px;
    display: grid;
    gap: 10px;
  }

  .postmatch-admin-head {
    display: grid;
    gap: 4px;
  }

  .postmatch-admin-head h3 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text);
  }

  .postmatch-admin-head span {
    font-size: 0.74rem;
    color: var(--muted);
    line-height: 1.45;
  }

  .postmatch-admin-grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .postmatch-admin-grid label {
    display: grid;
    gap: 5px;
  }

  .postmatch-admin-grid span {
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 700;
  }

  .postmatch-admin-grid select,
  .postmatch-admin-grid textarea {
    width: 100%;
    border-radius: 8px;
    border: 1px solid rgba(123, 220, 255, 0.2);
    background: rgba(5, 11, 21, 0.9);
    color: var(--text);
    padding: 8px 9px;
    font-size: 0.8rem;
    resize: vertical;
  }

  .postmatch-admin-notes {
    grid-column: 1 / -1;
  }

  .postmatch-admin-submit {
    justify-self: flex-start;
    border-radius: 999px;
    border: 1px solid rgba(123, 220, 255, 0.34);
    background: rgba(20, 74, 108, 0.3);
    color: #9ee7ff;
    font-size: 0.78rem;
    font-weight: 700;
    padding: 6px 12px;
    cursor: pointer;
  }

  .postmatch-admin-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .postmatch-admin-error,
  .postmatch-admin-success,
  .postmatch-admin-empty {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .postmatch-admin-error {
    color: #ffb3b3;
  }

  .postmatch-admin-success {
    color: #9cefc3;
  }

  .postmatch-admin-empty {
    color: var(--muted);
  }

  .page-title {
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: normal;
    line-height: 1.12;
    margin-bottom: 0;
  }

  .status-chip {
    border-radius: 999px;
    padding: 8px 12px;
    border: 1px solid transparent;
    text-transform: capitalize;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .status-chip.is-ongoing {
    color: #9ee7ff;
    background: rgba(23, 93, 129, 0.32);
    border-color: rgba(102, 213, 255, 0.32);
  }

  .status-chip.is-completed {
    color: #9cffbf;
    background: rgba(20, 110, 74, 0.24);
    border-color: rgba(103, 222, 160, 0.3);
  }

  .status-chip.is-default {
    color: #ffd58c;
    background: rgba(147, 103, 20, 0.22);
    border-color: rgba(255, 191, 89, 0.26);
  }

  .header-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-shrink: 0;
  }

  .refresh-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(123, 220, 255, 0.24);
    border-radius: 999px;
    background: rgba(12, 22, 40, 0.72);
    color: var(--text);
    line-height: 1;
    font-size: 1rem;
    cursor: pointer;
    padding: 0;
  }

  .refresh-button:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .refresh-spinner {
    animation: refresh-pulse 0.8s ease-in-out infinite;
  }

  .round-stack,
  .match-stack {
    display: grid;
    gap: 12px;
    min-width: 0;
  }

  .round-panel {
    border: 1px solid rgba(137, 186, 255, 0.14);
    border-radius: 14px;
    background: rgba(9, 18, 34, 0.58);
    overflow: hidden;
    width: 100%;
    min-width: 0;
  }

  .round-summary {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    padding: 14px 16px;
    cursor: pointer;
    list-style: none;
  }

  .round-summary::-webkit-details-marker {
    display: none;
  }

  .round-summary-title,
  .round-summary-side {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .round-summary-meta {
    color: var(--muted);
    text-transform: capitalize;
    font-size: 0.92rem;
    white-space: nowrap;
  }

  .round-summary-icon::before {
    content: "▾";
    color: var(--muted);
    font-size: 0.9rem;
  }

  .round-panel:not([open]) .round-summary-icon::before {
    content: "▸";
  }

  .round-panel .match-stack {
    padding: 0 14px 14px;
  }

  .match-row {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .match-row-highlight .match-order {
    color: rgba(243, 249, 255, 0.92);
  }

  .match-order {
    color: rgba(220, 228, 240, 0.58);
    font-size: 0.95rem;
    line-height: 1;
  }

  .match-body {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .team-line {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 56px;
    align-items: center;
    min-height: 42px;
    background: linear-gradient(180deg, rgba(28, 57, 98, 0.92), rgba(17, 38, 71, 0.96));
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid rgba(112, 185, 255, 0.16);
  }

  .team-line + .team-line {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .match-body .team-line:first-child {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .team-seed {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: rgba(136, 186, 255, 0.16);
    color: rgba(233, 244, 255, 0.82);
    font-size: 0.95rem;
  }

  .team-name {
    padding: 0 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.95rem;
    min-width: 0;
  }

  .team-score {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: rgba(136, 186, 255, 0.16);
    color: rgba(240, 247, 255, 0.92);
    font-size: 1rem;
    font-weight: 700;
  }

  .team-contact {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: rgba(136, 186, 255, 0.16);
    text-decoration: none;
  }

  .team-contact-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    background: #25d366;
    color: #042b14;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .team-line.winner {
    color: #f5f7fb;
  }

  .team-line.winner .team-score {
    background: #ff8a3d;
    color: #fff;
  }

  .team-line.selected-team {
    box-shadow: inset 0 0 0 1px rgba(123, 220, 255, 0.32);
    background: linear-gradient(180deg, rgba(33, 67, 116, 0.98), rgba(20, 45, 82, 0.98));
  }

  .table-wrap {
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 12px 10px;
    text-align: left;
    border-bottom: 1px solid rgba(137, 186, 255, 0.1);
  }

  th {
    color: var(--muted);
    font-weight: 600;
    font-size: 0.92rem;
  }

  tbody tr.rank-gold {
    background: rgba(201, 163, 72, 0.18);
  }

  tbody tr.rank-silver {
    background: rgba(168, 178, 196, 0.18);
  }

  tbody tr.rank-bronze {
    background: rgba(176, 122, 82, 0.18);
  }

  tbody tr.rank-top4 {
    background: rgba(82, 142, 196, 0.18);
  }

  tbody tr[role="button"] {
    cursor: pointer;
  }

  tbody tr[role="button"]:focus-visible {
    outline: 2px solid rgba(123, 220, 255, 0.45);
    outline-offset: -2px;
  }

  tbody tr.standing-row-active {
    box-shadow: inset 0 0 0 1px rgba(123, 220, 255, 0.28);
  }

  .playoff-board-wrap {
    display: grid;
    gap: 14px;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
    padding-right: 24px;
    -webkit-overflow-scrolling: touch;
  }

  .playoff-board-head {
    display: grid;
    align-items: stretch;
  }

  .playoff-stage-card {
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(137, 186, 255, 0.12);
    min-width: 0;
  }

  .playoff-stage-label {
    color: rgba(238, 244, 255, 0.94);
    font-size: 0.92rem;
    font-weight: 700;
  }

  .playoff-stage-meta {
    color: rgba(220, 228, 240, 0.68);
    font-size: 0.82rem;
    text-transform: capitalize;
  }

  .playoff-board {
    position: relative;
    min-height: 240px;
  }

  .playoff-board-connectors {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .playoff-board-connectors line {
    stroke: rgba(219, 230, 245, 0.78);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .playoff-board-match {
    position: absolute;
    display: grid;
    gap: 6px;
    min-width: 0;
    padding-block: 2px;
    box-sizing: border-box;
  }

  .playoff-board-match-highlight {
    filter: drop-shadow(0 0 0.55rem rgba(123, 220, 255, 0.16));
  }

  .playoff-board-match-placeholder {
    opacity: 0.72;
  }

  .playoff-board-match-third-place {
    border-radius: 8px;
  }

  .playoff-board-match-third-place .playoff-match-label {
    color: rgba(200, 200, 220, 0.6);
  }

  .playoff-board-match-bye {
    opacity: 0.55;
  }

  .playoff-board-match-next {
    outline: 1.5px solid rgba(0, 229, 255, 0.6);
    border-radius: 8px;
    background: rgba(6, 23, 46, 0.85);
    box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.08), 0 0 14px rgba(0, 229, 255, 0.14);
  }

  .playoff-board-match-next .playoff-match-label::before {
    content: none;
  }

  .playoff-board-mobile-hint {
    display: none;
    font-size: 0.76rem;
    color: rgba(243, 246, 250, 0.38);
    text-align: center;
    margin: 0 0 8px;
  }

  .playoff-match-meta {
    color: rgba(220, 228, 240, 0.62);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1;
    min-height: 18px;
    display: inline-flex;
    align-items: center;
    padding-inline: 2px;
  }

  .playoff-match-label {
    color: rgba(239, 246, 255, 0.94);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
    min-height: 16px;
    display: inline-flex;
    align-items: center;
  }

  .playoff-schedule-match-label {
    color: rgba(220, 228, 240, 0.82);
    font-size: 0.78rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 6px;
    background: rgba(136, 186, 255, 0.12);
    border: 1px solid rgba(136, 186, 255, 0.2);
    width: fit-content;
  }

  /* ── Swiss Stage Redesign ── */
  .swiss-qualified-list {
    display: grid;
    gap: 8px;
  }

  .swiss-qualified-item {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    border: 1px solid rgba(123, 193, 255, 0.26);
    background: linear-gradient(180deg, rgba(16, 35, 58, 0.94), rgba(10, 23, 40, 0.96));
    border-radius: 10px;
    padding: 8px 10px;
  }

  .swiss-qualified-item.is-top {
    border-color: rgba(123, 193, 255, 0.44);
    background: linear-gradient(180deg, rgba(20, 44, 74, 0.96), rgba(12, 30, 52, 0.98));
  }

  .swiss-qualified-rank {
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.84rem;
    font-weight: 800;
    color: rgba(236, 245, 255, 0.9);
  }

  .swiss-qualified-name {
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.92rem;
    font-weight: 800;
    color: rgba(243, 246, 250, 0.92);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .swiss-qualified-record {
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.76rem;
    font-weight: 700;
    color: rgba(243, 246, 250, 0.64);
    letter-spacing: 0.04em;
  }

  .swiss-microcopy {
    color: rgba(243, 246, 250, 0.55);
    font-size: 0.76rem;
    line-height: 1.4;
    margin: 0 0 12px;
  }

  /* ── Swiss Bracket Board ── */
  .swiss-board-wrap {
    overflow-x: auto;
    border-radius: 12px;
    border: 1px solid rgba(83, 211, 230, 0.18);
    background: linear-gradient(180deg, rgba(5, 10, 18, 0.99), rgba(8, 14, 26, 0.99));
    box-shadow: inset 0 1px 0 rgba(173, 227, 238, 0.08);
    padding: 10px 10px 20px;
    -webkit-overflow-scrolling: touch;
  }

  .swiss-board-mobile-hint {
    display: none;
    margin: 0 0 8px;
    text-align: center;
    color: rgba(243, 246, 250, 0.4);
    font-size: 0.74rem;
  }

  .swiss-board {
    position: relative;
    min-width: max-content;
  }

  .swiss-board-connectors {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .swiss-connector {
    fill: none;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .swiss-connector.is-win {
    stroke: rgba(123, 216, 255, 0.56);
  }

  .swiss-connector.is-loss {
    stroke: rgba(126, 148, 178, 0.44);
  }

  .swiss-round-col {
    position: absolute;
    top: 0;
  }

  .swiss-round-col.is-pending {
    opacity: 0.62;
  }

  .swiss-round-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 2px;
  }

  .swiss-round-title {
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(243, 246, 250, 0.55);
  }

  .swiss-round-status {
    font-size: 0.64rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 99px;
  }

  .swiss-round-status.is-completed {
    background: rgba(96, 200, 120, 0.12);
    color: #60c878;
  }

  .swiss-round-status.is-active {
    background: rgba(123, 220, 255, 0.2);
    color: #9ee6ff;
  }

  .swiss-round-status.is-pending {
    background: rgba(243, 246, 250, 0.05);
    color: rgba(243, 246, 250, 0.35);
  }

  .swiss-group-card {
    --tone-line: rgba(243, 246, 250, 0.18);
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px 16px;
    background: rgba(14, 24, 38, 0.95);
    border: 1px solid var(--tone-line);
    border-radius: 10px;
    border-left: 3px solid var(--tone-line);
    box-shadow: 0 3px 11px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .swiss-group-card.is-gold {
    --tone-line: rgba(123, 193, 255, 0.44);
  }

  .swiss-group-card.is-lavender {
    --tone-line: rgba(143, 201, 255, 0.4);
  }

  .swiss-group-card.is-blue {
    --tone-line: rgba(100, 134, 176, 0.36);
  }

  .swiss-group-head {
    min-height: 34px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .swiss-group-record {
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 1.06rem;
    font-weight: 900;
    color: rgba(243, 246, 250, 0.92);
    line-height: 1;
  }

  .swiss-group-bo {
    font-size: 0.64rem;
    font-weight: 700;
    text-transform: uppercase;
    color: rgba(243, 246, 250, 0.5);
    letter-spacing: 0.06em;
  }

  .swiss-group-matches {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .swiss-match {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid rgba(243, 246, 250, 0.07);
    background: rgba(243, 246, 250, 0.02);
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .swiss-match:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(243, 246, 250, 0.1);
  }

  .swiss-match.is-highlight {
    background: rgba(83, 211, 230, 0.07);
    border-color: rgba(83, 211, 230, 0.28);
  }

  .swiss-match-team {
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.82rem;
    font-weight: 700;
    text-transform: uppercase;
    color: rgba(243, 246, 250, 0.9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  .swiss-match-team.is-left { text-align: center; }
  .swiss-match-team.is-right { text-align: center; }

  .swiss-match-team.is-winner {
    color: rgba(243, 246, 250, 0.95);
  }

  .swiss-match-team.is-loser {
    color: rgba(243, 246, 250, 0.35);
  }

  .swiss-match-score {
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.88rem;
    font-weight: 900;
    color: rgba(243, 246, 250, 0.9);
    min-width: 40px;
    text-align: center;
    letter-spacing: 0.04em;
  }

  .swiss-match-score.is-pending {
    color: rgba(243, 246, 250, 0.35);
    font-weight: 600;
  }

  /* ── Collapsible Standings ── */
  .swiss-standings-panel {
    margin-top: 16px;
    border-top: 1px solid rgba(243, 246, 250, 0.06);
    padding-top: 12px;
  }

  .swiss-standings-toggle {
    cursor: pointer;
    user-select: none;
    list-style: none;
    font-size: 0.78rem;
    font-weight: 600;
    color: rgba(83, 211, 230, 0.7);
    padding: 6px 0;
    letter-spacing: 0.02em;
  }

  .swiss-standings-toggle::-webkit-details-marker {
    display: none;
  }

  .swiss-standings-toggle::before {
    content: "▸ ";
  }

  .swiss-standings-panel[open] > .swiss-standings-toggle::before {
    content: "▾ ";
  }

  .swiss-standings-wrap {
    overflow-x: auto;
    min-width: 0;
    margin-top: 8px;
  }

  .swiss-standings-table {
    width: 100%;
    border-collapse: collapse;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
  }

  .swiss-standings-table thead tr {
    border-bottom: 1px solid rgba(83, 211, 230, 0.18);
  }

  .swiss-standings-table th {
    padding: 10px 12px;
    color: rgba(243, 246, 250, 0.45);
    font-size: 0.74rem;
    font-weight: 700;
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .swiss-standings-table td {
    padding: 8px 12px;
    font-size: 0.82rem;
    color: rgba(243, 246, 250, 0.82);
    border-bottom: 1px solid rgba(243, 246, 250, 0.04);
  }

  .swiss-standings-record {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 800;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
  }

  .swiss-standings-record.is-gold {
    background: rgba(123, 193, 255, 0.2);
    color: #b8ddff;
  }

  .swiss-standings-record.is-lavender {
    background: rgba(136, 186, 255, 0.18);
    color: #b7d7ff;
  }

  .swiss-standings-record.is-blue {
    background: rgba(107, 183, 214, 0.15);
    color: #70c0da;
  }

  .swiss-standings-row.is-qualified {
    background: rgba(96, 200, 120, 0.04);
  }

  .swiss-standings-row.is-eliminated {
    opacity: 0.5;
  }

  .swiss-standings-team {
    font-weight: 700;
    text-transform: uppercase;
  }

  .swiss-standings-pressure {
    text-align: center;
    padding-left: 6px;
  }

  .swiss-standings-th-pressure {
    text-align: center;
    padding-left: 6px;
  }

  .pressure-badge {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 99px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .pressure-badge.needs-wins {
    background: rgba(96, 200, 120, 0.15);
    color: #60c878;
    border: 1px solid rgba(96, 200, 120, 0.3);
  }

  .pressure-badge.safe-loss {
    background: rgba(240, 100, 90, 0.12);
    color: #f06459;
    border: 1px solid rgba(240, 100, 90, 0.25);
  }

  .pressure-badge.is-done {
    color: rgba(243, 246, 250, 0.3);
    font-weight: 400;
  }

  /* ── Active round pulse ── */
  .swiss-round-col.is-active .swiss-group-card {
    animation: swiss-active-pulse 2s ease-in-out infinite;
  }

  @keyframes swiss-active-pulse {
    0%, 100% { border-left-color: var(--tone-line); }
    50% { border-left-color: rgba(123, 220, 255, 0.72); }
  }

  @media (prefers-reduced-motion: reduce) {
    .swiss-round-col.is-active .swiss-group-card {
      animation: none;
    }
  }

  .round-status-badge {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 99px;
    font-weight: 600;
  }

  .round-status-badge.is-completed {
    background: rgba(96, 200, 120, 0.15);
    color: #60c878;
  }

  .round-status-badge.is-ongoing {
    background: rgba(255, 196, 0, 0.15);
    color: #ffc400;
  }

  .round-status-badge.is-pending {
    background: rgba(243, 246, 250, 0.07);
    color: rgba(243, 246, 250, 0.45);
  }

  .playoff-stage {
    --playoff-title-height: 56px;
    --playoff-column-gap: 14px;
    --playoff-team-height: 56px;
    --playoff-team-gap: 2px;
    --playoff-match-gap: 14px;
    --playoff-connector-width: 88px;
    --playoff-connector-split: 40px;
    --playoff-match-height: calc((var(--playoff-team-height) * 2) + var(--playoff-team-gap));
    --playoff-round-height: calc((var(--playoff-match-height) * 2) + var(--playoff-match-gap));
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--playoff-connector-width) minmax(260px, 0.92fr);
    gap: 0;
    align-items: stretch;
  }

  .advanced-podium {
    display: grid;
    gap: 14px;
    border-radius: 14px;
    background:
      radial-gradient(160% 130% at 50% -10%, rgba(146, 215, 255, 0.24), rgba(16, 38, 66, 0.35) 58%, rgba(10, 20, 34, 0.84) 100%);
    border: 1px solid rgba(126, 199, 255, 0.2);
    padding: 14px;
  }

  .podium-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    align-items: end;
  }

  .podium-card {
    display: grid;
    gap: 8px;
    min-width: 0;
    justify-items: center;
    text-align: center;
    border-radius: 12px;
    border: 1px solid rgba(116, 190, 255, 0.22);
    background: linear-gradient(180deg, rgba(31, 64, 108, 0.92), rgba(15, 33, 61, 0.96));
    padding: 10px 12px;
    box-shadow: inset 0 1px 0 rgba(210, 232, 255, 0.12);
  }

  .podium-card.is-rank1 {
    min-height: 132px;
    border-color: rgba(255, 214, 110, 0.58);
    background: linear-gradient(180deg, rgba(90, 72, 28, 0.96), rgba(57, 44, 18, 0.98));
  }

  .podium-card.is-rank2 {
    min-height: 116px;
    border-color: rgba(200, 214, 236, 0.44);
    background: linear-gradient(180deg, rgba(74, 86, 109, 0.94), rgba(43, 54, 74, 0.98));
  }

  .podium-card.is-rank3 {
    min-height: 104px;
    border-color: rgba(219, 157, 112, 0.48);
    background: linear-gradient(180deg, rgba(93, 67, 45, 0.96), rgba(59, 41, 28, 0.98));
  }

  .podium-card.is-rank4 {
    min-height: 84px;
    border-color: rgba(123, 198, 255, 0.35);
    background: linear-gradient(180deg, rgba(32, 63, 102, 0.92), rgba(18, 38, 67, 0.96));
  }

  .podium-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-width: 46px;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: rgba(233, 244, 255, 0.94);
    background: rgba(123, 190, 255, 0.2);
    border: 1px solid rgba(123, 190, 255, 0.3);
  }

  .podium-team {
    font-size: 0.98rem;
    font-weight: 700;
    max-width: 100%;
    white-space: normal;
    word-break: break-word;
  }

  .podium-caption {
    font-size: 0.78rem;
    color: rgba(216, 230, 248, 0.76);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
  }

  .playoff-podium {
    display: grid;
    gap: 10px;
  }

  .playoff-champion {
    display: grid;
    gap: 10px;
    justify-items: center;
    text-align: center;
    padding: 16px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255, 214, 110, 0.45);
    background: linear-gradient(180deg, rgba(90, 72, 28, 0.96), rgba(57, 44, 18, 0.98));
  }

  .playoff-champion-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: rgba(255, 247, 220, 0.95);
    background: rgba(255, 214, 110, 0.2);
    border: 1px solid rgba(255, 214, 110, 0.4);
    text-transform: uppercase;
  }

  .playoff-champion-name {
    font-size: 1.04rem;
    font-weight: 700;
    color: rgba(255, 245, 220, 0.95);
    word-break: break-word;
  }

  .playoff-podium-place {
    display: grid;
    gap: 6px;
    justify-items: center;
    text-align: center;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(180, 180, 200, 0.18);
    background: rgba(255, 255, 255, 0.04);
  }

  .playoff-podium-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: rgba(220, 228, 245, 0.85);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(200, 210, 230, 0.2);
    text-transform: uppercase;
  }

  .playoff-podium-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: rgba(230, 238, 255, 0.88);
    word-break: break-word;
  }

  .playoff-column {
    display: grid;
    grid-template-rows: var(--playoff-title-height) 1fr;
    gap: var(--playoff-column-gap);
    min-width: 0;
  }

  .playoff-column-title {
    min-height: var(--playoff-title-height);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(238, 244, 255, 0.94);
    font-size: 0.9rem;
    font-weight: 700;
    text-align: center;
  }

  .playoff-round {
    display: grid;
    gap: var(--playoff-match-gap);
  }

  .playoff-round--semis {
    min-height: var(--playoff-round-height);
  }

  .playoff-round--finals {
    min-height: var(--playoff-round-height);
    display: flex;
    align-items: center;
  }

  .playoff-connector {
    position: relative;
    align-self: stretch;
    min-height: var(--playoff-round-height);
    margin-top: calc(var(--playoff-title-height) + var(--playoff-column-gap));
  }

  .playoff-line {
    position: absolute;
    background: rgba(219, 230, 245, 0.78);
    border-radius: 999px;
  }

  .playoff-line-top,
  .playoff-line-bottom {
    left: 0;
    width: var(--playoff-connector-split);
    height: 2px;
  }

  .playoff-line-top {
    top: calc(var(--playoff-match-height) / 2);
  }

  .playoff-line-bottom {
    top: calc(var(--playoff-match-height) + var(--playoff-match-gap) + (var(--playoff-match-height) / 2));
  }

  .playoff-line-vertical {
    left: var(--playoff-connector-split);
    top: calc(var(--playoff-match-height) / 2);
    width: 2px;
    height: calc(var(--playoff-match-height) + var(--playoff-match-gap));
  }

  .playoff-line-final {
    left: var(--playoff-connector-split);
    top: calc(var(--playoff-match-height) + (var(--playoff-match-gap) / 2));
    width: calc(var(--playoff-connector-width) - var(--playoff-connector-split));
    height: 2px;
  }

  .playoff-match {
    display: grid;
    gap: 2px;
  }

  .final-match {
    width: 100%;
  }

  .playoff-team {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px;
    min-height: var(--playoff-team-height);
    border-radius: 10px;
    overflow: hidden;
    background: linear-gradient(180deg, rgba(28, 57, 98, 0.92), rgba(17, 38, 71, 0.96));
    border: 1px solid rgba(112, 185, 255, 0.16);
  }

  .playoff-team + .playoff-team {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .playoff-match .playoff-team:first-child {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .playoff-seed {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(136, 186, 255, 0.16);
    color: rgba(233, 244, 255, 0.82);
    font-size: 0.9rem;
    font-weight: 700;
  }

  .playoff-name {
    display: inline-flex;
    align-items: center;
    padding: 0 14px;
    min-width: 0;
    font-size: 0.95rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .playoff-score {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: rgba(136, 186, 255, 0.16);
    color: rgba(240, 247, 255, 0.92);
    font-size: 1rem;
    font-weight: 700;
  }

  .hint-header span {
    border-bottom: 1px dashed rgba(123, 220, 255, 0.35);
    cursor: help;
  }

  @media (max-width: 900px) {
    .header-actions {
      justify-content: flex-end;
    }

    .match-row {
      grid-template-columns: 1fr;
    }

    .match-order {
      display: none;
    }

    .playoff-stage {
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .playoff-round--finals {
      min-height: 0;
    }

    .finals-column {
      margin-top: -4px;
    }

    .playoff-connector {
      display: none;
    }

    .podium-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .podium-card.is-rank1 {
      min-height: 122px;
    }

    .podium-card.is-rank2,
    .podium-card.is-rank3 {
      min-height: 100px;
    }

    .swiss-board-mobile-hint {
      display: block;
    }
  }

  @media (max-width: 640px) {
    .event-page {
      gap: 12px;
    }

    .event-header {
      gap: 10px;
    }

    .event-topbar {
      gap: 8px;
      align-items: center;
      justify-content: space-between;
    }

    .viewer-note {
      font-size: 0.88rem;
      max-width: 100%;
    }

    .postmatch-columns {
      grid-template-columns: 1fr;
    }

    .postmatch-admin-grid {
      grid-template-columns: 1fr;
    }

    .postmatch-meta {
      width: 100%;
    }

    .page-title {
      font-size: 1.6rem;
    }

    .back-link {
      font-size: 0.82rem;
      line-height: 1.1;
    }

    .header-actions {
      gap: 6px;
    }

    .status-chip {
      padding: 5px 8px;
      font-size: 0.72rem;
      line-height: 1;
    }

    .refresh-button {
      width: 30px;
      height: 30px;
      font-size: 0.82rem;
    }

    .round-summary {
      padding: 12px;
    }

    .round-summary-side {
      gap: 8px;
    }

    .round-panel .match-stack {
      padding: 0 10px 10px;
    }

    .team-line {
      grid-template-columns: 30px minmax(0, 1fr) 38px;
      min-height: 36px;
    }

    .team-seed,
    .team-score {
      font-size: 0.8rem;
    }

    .team-name {
      padding: 0 8px;
      font-size: 0.84rem;
    }

    th,
    td {
      padding: 10px 8px;
      font-size: 0.84rem;
    }

    .playoff-team {
      grid-template-columns: minmax(0, 1fr) 42px;
      min-height: 42px;
    }

    .playoff-board-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      padding-bottom: 12px;
    }

    .playoff-board-mobile-hint {
      display: block;
    }

    .playoff-stage {
      --playoff-title-height: 44px;
      --playoff-column-gap: 10px;
      --playoff-match-gap: 10px;
      gap: 8px;
    }

    .playoff-column-title {
      padding: 10px 12px;
      font-size: 0.84rem;
    }

    .finals-column {
      margin-top: -6px;
    }

    .playoff-score {
      font-size: 0.8rem;
    }

    .playoff-name {
      padding: 0 10px;
      font-size: 0.84rem;
    }

    .podium-grid {
      grid-template-columns: 1fr;
    }

    .podium-card.is-rank1,
    .podium-card.is-rank2,
    .podium-card.is-rank3,
    .podium-card.is-rank4 {
      min-height: 0;
    }

    .swiss-board-wrap {
      padding: 8px 8px 14px;
    }

    .swiss-round-title {
      font-size: 0.68rem;
    }

    .swiss-round-status {
      font-size: 0.6rem;
      padding: 2px 7px;
    }

    .swiss-group-record {
      font-size: 1rem;
    }

    .swiss-match {
      min-height: 40px;
      padding: 7px 8px;
    }

    .swiss-match-team {
      font-size: 0.78rem;
    }

    .swiss-match-score {
      min-width: 36px;
      font-size: 0.82rem;
    }
  }

  @keyframes refresh-pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.8;
    }

    50% {
      transform: scale(1.08);
      opacity: 1;
    }
  }

  /* ── Double Elimination Bracket ─────────────────────── */

  /* Col-heads wrapper — full board width, relative for GF absolute child */
  .de-board-col-heads {
    margin-bottom: 4px;
    flex-shrink: 0;
  }

  /* Upper bracket header row — CSS grid for consistent column alignment */
  .de-col-heads-upper {
    /* layout applied via inline style: grid-template-columns + column-gap */
  }

  /* Column head color variants — label color only, no background/border override */
  .playoff-stage-card.de-stage-upper .playoff-stage-label {
    color: rgba(0, 123, 255, 0.95);
  }

  .playoff-stage-card.de-stage-upper.is-active .playoff-stage-label {
    color: rgba(0, 229, 255, 0.98);
    text-shadow: 0 0 8px rgba(0, 229, 255, 0.35);
  }

  .playoff-stage-card.de-stage-lower .playoff-stage-label {
    color: rgba(96, 165, 250, 0.95);
  }

  .playoff-stage-card.de-stage-lower.is-active .playoff-stage-label {
    color: rgba(90, 247, 255, 0.98);
    text-shadow: 0 0 8px rgba(90, 247, 255, 0.3);
  }

  .playoff-stage-card.de-stage-gf .playoff-stage-label {
    color: rgba(90, 247, 255, 0.95);
  }

  .playoff-stage-card.de-stage-gf.is-active .playoff-stage-label {
    color: #5af7ff;
    text-shadow: 0 0 10px rgba(90, 247, 255, 0.45);
  }

  /* Inline lower col heads positioned inside the board — removed, now external */

  /* Colored connector lines — now handled via inline stroke attributes */

  /* Section background bands */
  .de-section-band {
    position: absolute;
    left: 0;
    pointer-events: none;
    border-radius: 8px;
  }

  .de-section-band.is-upper {
    background: rgba(0, 123, 255, 0.03);
    border: 1px solid rgba(0, 123, 255, 0.14);
  }

  .de-section-band.is-lower {
    background: rgba(96, 165, 250, 0.04);
    border: 1px solid rgba(96, 165, 250, 0.12);
  }

  /* GF match label accent only */
  .playoff-board-match.de-match-gf .playoff-match-label {
    color: rgba(90, 247, 255, 0.9);
  }

  .gf-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 6px 0 4px;
  }

  .gf-logos {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gf-logo {
    width: 36px;
    height: 36px;
    object-fit: contain;
    border-radius: 4px;
    background: rgba(255,255,255,0.06);
  }

  .gf-vs {
    font-size: 10px;
    font-weight: 700;
    color: rgba(0, 229, 255, 0.7);
    letter-spacing: 0.05em;
  }

  .gf-yt-link {
    font-size: 11px;
    font-weight: 600;
    color: #ff4444;
    text-decoration: none;
    padding: 2px 8px;
    border: 1px solid rgba(255,68,68,0.4);
    border-radius: 4px;
    transition: background 0.15s;
  }

  .gf-yt-link:hover {
    background: rgba(255,68,68,0.12);
  }

  /* Lower col-heads overlay inside the unified board */
  .de-lower-col-heads {
    position: absolute;
    left: 0;
    height: 54px;
  }
</style>

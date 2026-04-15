<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { browser } from "$app/environment";
  import { invalidateAll } from "$app/navigation";
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
  };

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
    if (value === "single_elimination") return "Knockout Single Elimination";
    if (value === "double_elimination") return "Knockout Double Elimination";
    if (value === "swiss_stage") return "Swiss Stage";
    return value.replace(/_/g, " ");
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
    tone: "gold" | "lavender" | "blue";
    bestOfLabel: string;
    result: string;
    winnerTeamId: number | null;
  };

  type SwissDisplayGroup = {
    id: string;
    label: string;
    bestOf: "BO1" | "BO3";
    bestOfLabel: string;
    roundNumber: number;
    status: string;
    tone: "gold" | "lavender" | "blue";
    matches: SwissDisplayMatch[];
  };

  type SwissDisplayColumn = {
    id: string;
    roundNumber: number;
    groups: SwissDisplayGroup[];
  };

  type SwissResultBar = {
    id: string;
    label: string;
    score: string;
    teams: string[];
    type: "qualified" | "eliminated";
    tone: "gold" | "lavender" | "blue";
  };

  const SWISS_GROUP_ORDER = [
    "0-0",
    "1-0",
    "0-1",
    "2-0",
    "1-1",
    "0-2",
    "2-1",
    "1-2",
    "2-2",
    "3-0",
    "3-1",
    "3-2",
    "2-3",
    "1-3",
    "0-3"
  ] as const;

  const SWISS_RESULT_META: Record<string, Omit<SwissResultBar, "id" | "teams">> = {
    "3-0": { label: "Knockout Stage 1-2 Place", score: "3-0", type: "qualified", tone: "gold" },
    "3-1": { label: "Knockout Stage 3-5 Place", score: "3-1", type: "qualified", tone: "lavender" },
    "3-2": { label: "Knockout Stage 6-8 Place", score: "3-2", type: "qualified", tone: "lavender" },
    "2-3": { label: "Eliminated 9-11 Place", score: "2-3", type: "eliminated", tone: "blue" },
    "1-3": { label: "Eliminated 12-14 Place", score: "1-3", type: "eliminated", tone: "blue" },
    "0-3": { label: "Eliminated 15-16 Place", score: "0-3", type: "eliminated", tone: "blue" }
  };

  const PLAYOFF_COLUMN_WIDTH = 280;
  const PLAYOFF_COLUMN_GAP = 92;
  const PLAYOFF_MATCH_LABEL_HEIGHT = 16;
  const PLAYOFF_MATCH_BODY_HEIGHT = 92;
  const PLAYOFF_MATCH_STACK_GAP = 8;
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
  const PLAYOFF_MATCH_GAP = 28;

  function formatPlayoffStageLabel(roundNumber: number, totalRounds: number, matchCount = 1) {
    if (totalRounds <= 1 || roundNumber === totalRounds) {
      return matchCount > 1 ? "Final Day" : "Final";
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

  function swissGroupOrder(label: string) {
    const index = SWISS_GROUP_ORDER.indexOf(label as (typeof SWISS_GROUP_ORDER)[number]);
    return index >= 0 ? index : SWISS_GROUP_ORDER.length;
  }

  function swissGroupTone(label: string): "gold" | "lavender" | "blue" {
    const [winRaw, loseRaw] = label.split("-");
    const win = Number.parseInt(winRaw ?? "", 10);
    const lose = Number.parseInt(loseRaw ?? "", 10);
    if (!Number.isFinite(win) || !Number.isFinite(lose)) return "gold";
    if (win === lose) return "gold";
    return win > lose ? "lavender" : "blue";
  }

  function swissBestOf(matchBestOf: number | null | undefined): "BO1" | "BO3" {
    return (matchBestOf ?? 1) >= 3 ? "BO3" : "BO1";
  }

  function swissBestOfLabel(matchBestOf: number | null | undefined) {
    return `BEST OF ${matchBestOf ?? 1}`;
  }

  function swissScoreValue(match: (typeof data.bracket)[number]["matches"][number]) {
    if (match.scoreA === null || match.scoreB === null) {
      return match.result === "pending" ? "VS" : "-";
    }
    return `${match.scoreA}-${match.scoreB}`;
  }

  function buildSwissStageDisplay(rounds: typeof data.bracket) {
    const swissRounds = rounds
      .filter((round) => round.stage === "swiss")
      .slice()
      .sort((left, right) => left.roundNumber - right.roundNumber);
    const records = new Map<number, { win: number; lose: number; teamName: string }>();
    const resultBuckets = new Map<string, string[]>();
    const columns: SwissDisplayColumn[] = [];

    for (const round of swissRounds) {
      const groupMap = new Map<string, SwissDisplayGroup>();
      const roundMatches = round.matches.slice().sort((left, right) => left.pairingOrder - right.pairingOrder);

      for (const match of roundMatches) {
        const teamAId = match.teamA?.id ?? null;
        const teamBId = match.teamB?.id ?? null;
        const teamAName = match.teamA?.name ?? "TBD";
        const teamBName = match.teamB?.name ?? (teamBId ? "TBD" : "BYE");
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
          matches: []
        };

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
          tone,
          bestOfLabel: swissBestOfLabel(match.matchBestOf),
          result: match.result,
          winnerTeamId: match.winnerTeamId
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
          if (next.win >= 3 || next.lose >= 3) {
            const bucketKey = `${next.win}-${next.lose}`;
            const bucket = resultBuckets.get(bucketKey) ?? [];
            if (!bucket.includes(teamName)) {
              bucket.push(teamName);
            }
            resultBuckets.set(bucketKey, bucket);
          }
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
        groups: Array.from(groupMap.values()).sort((left, right) => swissGroupOrder(left.label) - swissGroupOrder(right.label))
      });
    }

    const resultBars = Object.entries(SWISS_RESULT_META).map(([key, meta]) => ({
      id: key,
      ...meta,
      teams: resultBuckets.get(key) ?? []
    }));

    return { columns, resultBars };
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
  $: showStandingsTable = data.event.eventMode !== "playoffs";
  $: showPlayoffFinalStanding =
    data.event.eventMode === "playoffs"
    && data.event.playoffFormat !== "swiss_stage"
    && data.event.status === "completed";
  $: showAdvancedPodium = data.event.eventMode === "regular_season" && data.event.status === "completed";
  $: showPlayoffBracketBoard = data.event.eventMode === "playoffs" && data.event.playoffFormat === "single_elimination";
  $: showSwissStageBoard = data.event.eventMode === "playoffs" && data.event.playoffFormat === "swiss_stage";
  $: playoffBracketBoard = showPlayoffBracketBoard
    ? buildPlayoffBracketRounds(
      data.bracket,
      data.event.totalRounds,
      data.event.totalTeams,
      data.event.playoffThirdPlaceBestOf
    )
    : { rounds: [] as PlayoffDisplayRound[], boardHeight: 0, boardWidth: 0, connectorLines: [] as PlayoffConnectorLine[] };
  $: swissStageDisplay = showSwissStageBoard
    ? buildSwissStageDisplay(data.bracket)
    : { columns: [] as SwissDisplayColumn[], resultBars: [] as SwissResultBar[] };
  $: swissQualifiedBars = swissStageDisplay.resultBars.filter((bar) => bar.type === "qualified");
  $: swissEliminatedBars = swissStageDisplay.resultBars.filter((bar) => bar.type === "eliminated");
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
    ? (data.event.playoffFormat === "swiss_stage"
      ? data.bracket.filter((round) => round.stage !== "swiss")
      : data.bracket)
      .slice()
      .sort((left, right) => left.roundNumber - right.roundNumber)
      .map((round) => ({
        ...round,
        stageLabel: round.label ?? formatPlayoffStageLabel(round.roundNumber, data.event.totalRounds, round.matches.length),
        matches: round.matches.slice().sort((left, right) => left.pairingOrder - right.pairingOrder)
      }))
    : [];
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
      <p class="viewer-note">{formatTournamentFormat(data.event.format)} · {data.event.totalTeams} teams · {data.event.totalRounds} rounds</p>
      <p class="viewer-note">
        The web app is used to view schedules, brackets, and standings only. All admin actions are handled by Admin.
      </p>
    </div>
  </header>

  {#if showAdvancedPodium}
    <Card title={`Final Standing · ${advanceToPlayoffs} Teams Advanced to Playoffs`}>
      <section class="advanced-podium" aria-label={`Top ${advanceToPlayoffs} teams advanced to playoffs`}>
        <div class="advanced-podium-headline">
          Congratulations to the top {advanceToPlayoffs} teams securing playoff spots.
        </div>

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
      <section class="playoff-champion" aria-label="Playoff Champion">
        <div class="playoff-champion-badge">Champion</div>
        <div class="playoff-champion-name">{playoffChampion?.teamName ?? "TBD"}</div>
      </section>
    </Card>
  {/if}

  {#if showSwissStageBoard}
    <Card title="Swiss Stage">
      <div bind:this={bracketAnchor}></div>
      <div class="swiss-stage-board-wrap">
        <div class="swiss-stage-board">
          <div class="swiss-stage-columns">
            {#each swissStageDisplay.columns as column}
              <section class="swiss-stage-column">
                {#each column.groups as group}
                  <article class={`swiss-group-card is-${group.tone}`}>
                    <header class="swiss-group-head">
                      <span class="swiss-group-bestof">{group.bestOfLabel}</span>
                      <span class={`swiss-group-label is-${group.tone}`}>{group.label}</span>
                    </header>

                    <div class="swiss-group-matches">
                      {#each group.matches as match}
                        <div class:swiss-match-highlight={matchContainsSelectedTeam({ teamA: { id: match.leftTeamId }, teamB: { id: match.rightTeamId } })} class="swiss-match-row">
                          <span class="swiss-team swiss-team-left">{match.left}</span>
                          <span class={`swiss-score-ribbon is-${match.tone}`}>{match.score}</span>
                          <span class="swiss-team swiss-team-right">{match.right}</span>
                        </div>
                      {/each}
                    </div>
                  </article>
                {/each}
              </section>
            {/each}
          </div>

          <aside class="swiss-result-side">
            <section class="swiss-result-stack">
              {#each swissQualifiedBars as bar}
                <article class={`swiss-result-card is-${bar.tone}`}>
                  <div class="swiss-result-label">{bar.label}</div>
                  <div class={`swiss-result-ribbon is-${bar.tone}`}>{bar.score}</div>
                  <div class="swiss-result-teams">
                    {#if bar.teams.length > 0}
                      {#each bar.teams as teamName}
                        <span>{teamName}</span>
                      {/each}
                    {:else}
                      <span>Pending</span>
                    {/if}
                  </div>
                </article>
              {/each}
            </section>

            <section class="swiss-result-stack is-eliminated">
              {#each swissEliminatedBars as bar}
                <article class={`swiss-result-card is-${bar.tone}`}>
                  <div class="swiss-result-label">{bar.label}</div>
                  <div class={`swiss-result-ribbon is-${bar.tone}`}>{bar.score}</div>
                  <div class="swiss-result-teams">
                    {#if bar.teams.length > 0}
                      {#each bar.teams as teamName}
                        <span>{teamName}</span>
                      {/each}
                    {:else}
                      <span>Pending</span>
                    {/if}
                  </div>
                </article>
              {/each}
            </section>
          </aside>
        </div>
      </div>
    </Card>
  {/if}

  {#if data.event.eventMode === "regular_season" || showPlayoffBracketBoard}
    <Card title={data.event.eventMode === "regular_season" ? "Schedule" : "Bracket"}>
      <div bind:this={bracketAnchor}></div>
      {#if showPlayoffBracketBoard}
      <div class="playoff-board-wrap">
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
                class="playoff-board-match"
                style={`left: ${roundIndex * (PLAYOFF_COLUMN_WIDTH + PLAYOFF_COLUMN_GAP)}px; top: ${match.topOffset}px; width: ${PLAYOFF_COLUMN_WIDTH}px;`}
              >
                <div class="playoff-match-label">{match.matchLabel ?? ""}</div>
                <div class="playoff-match-meta">Match #{match.pairingOrder}</div>
                <div class="playoff-match">
                  <div
                    class:selected-team={selectedStandingTeamId === match.teamA?.id}
                    class:winner={match.winnerTeamId === match.teamA?.id}
                    class="playoff-team"
                  >
                    <span class="playoff-seed">{match.teamA?.seed ?? "-"}</span>
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
                    <span class="playoff-seed">{match.teamB?.seed ?? "-"}</span>
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
        {#each data.bracket as round}
          {#key `${selectedStandingTeamId ?? "all"}-${round.id}`}
            <details class="round-panel" open={isRoundOpen(round.roundNumber)}>
              <summary class="round-summary">
                <span class="round-summary-title">Round {round.roundNumber}</span>
                <span class="round-summary-side">
                  <span class="round-summary-meta">{round.status}</span>
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
      </div>
      {/if}
    </Card>
  {/if}

  {#if data.event.eventMode === "playoffs" && (data.event.playoffFormat === "swiss_stage" ? swissScheduleGroups.length > 0 : playoffScheduleRounds.length > 0)}
    <Card title="Schedule">
      <div class="round-stack">
        {#if data.event.playoffFormat === "swiss_stage"}
          {#each swissScheduleGroups as group}
            <details class="round-panel" open>
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
                      <div class="team-line">
                        <span class="team-seed">{match.leftSeed ?? "-"}</span>
                        <span class="team-name">{match.left}</span>
                        <strong class="team-score">{match.scoreA ?? (match.result === "pending" ? "VS" : "-")}</strong>
                      </div>
                      <div class="team-line">
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
          {#each playoffScheduleRounds as round}
            <details class="round-panel" open={isRoundOpen(round.roundNumber)}>
              <summary class="round-summary">
                <span class="round-summary-title">{round.stageLabel} · Round {round.roundNumber}</span>
                <span class="round-summary-side">
                  <span class="round-summary-meta">{round.status}</span>
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
        {/if}
      </div>
    </Card>
  {/if}

</section>

<style>
  .event-page {
    --playoff-team-height: 45px;
    display: grid;
    gap: 16px;
    min-width: 0;
  }

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
    gap: 8px;
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

  .swiss-stage-board-wrap {
    position: relative;
    overflow-x: auto;
    border-radius: 18px;
    border: 1px solid rgba(83, 211, 230, 0.2);
    background:
      radial-gradient(ellipse at 10% 0%, rgba(83, 211, 230, 0.1) 0%, transparent 40%),
      radial-gradient(ellipse at 90% 0%, rgba(200, 183, 245, 0.1) 0%, transparent 40%),
      linear-gradient(180deg, rgba(5, 10, 18, 0.99), rgba(8, 14, 26, 0.99));
    box-shadow:
      inset 0 1px 0 rgba(173, 227, 238, 0.08),
      0 0 60px rgba(0, 0, 0, 0.6);
  }

  .swiss-stage-board-wrap::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      repeating-linear-gradient(
        90deg,
        transparent 0,
        transparent 39px,
        rgba(83, 211, 230, 0.03) 39px,
        rgba(83, 211, 230, 0.03) 40px
      ),
      repeating-linear-gradient(
        0deg,
        transparent 0,
        transparent 39px,
        rgba(83, 211, 230, 0.03) 39px,
        rgba(83, 211, 230, 0.03) 40px
      );
    border-radius: inherit;
  }

  .swiss-stage-board {
    position: relative;
    z-index: 1;
    min-width: 1280px;
    display: grid;
    grid-template-columns: minmax(980px, 1fr) minmax(300px, 340px);
    gap: 22px;
    padding: 20px;
  }

  .swiss-stage-columns {
    display: grid;
    grid-template-columns: repeat(5, minmax(180px, 1fr));
    gap: 22px;
    align-items: start;
  }

  .swiss-stage-column {
    display: grid;
    gap: 16px;
    align-content: start;
    position: relative;
  }

  .swiss-stage-column:not(:last-child)::after {
    content: "";
    position: absolute;
    top: 28px;
    right: -13px;
    width: 26px;
    height: calc(100% - 56px);
    border-top: 1px solid rgba(83, 211, 230, 0.28);
    border-right: 1px solid rgba(83, 211, 230, 0.28);
    border-bottom: 1px solid rgba(83, 211, 230, 0.18);
    opacity: 0.7;
  }

  .swiss-group-card {
    position: relative;
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    background: linear-gradient(160deg, rgba(14, 24, 38, 0.98), rgba(8, 16, 28, 0.99));
    border: 1px solid rgba(42, 79, 102, 0.7);
    clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
    box-shadow:
      inset 0 1px 0 rgba(243, 246, 250, 0.04),
      0 12px 24px rgba(2, 8, 15, 0.4);
    transition: box-shadow 0.2s ease;
  }

  .swiss-group-card::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid rgba(83, 211, 230, 0.08);
    clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
    pointer-events: none;
  }

  .swiss-group-card.is-gold {
    border-color: rgba(217, 197, 142, 0.45);
    background: linear-gradient(160deg, rgba(22, 16, 4, 0.98) 0%, rgba(8, 16, 28, 0.99) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 221, 136, 0.06),
      0 0 0 1px rgba(217, 197, 142, 0.08),
      0 12px 24px rgba(2, 8, 15, 0.4);
  }

  .swiss-group-card.is-lavender {
    border-color: rgba(200, 183, 245, 0.45);
    background: linear-gradient(160deg, rgba(22, 10, 36, 0.98) 0%, rgba(8, 16, 28, 0.99) 100%);
    box-shadow:
      inset 0 1px 0 rgba(200, 183, 245, 0.06),
      0 0 0 1px rgba(200, 183, 245, 0.08),
      0 12px 24px rgba(2, 8, 15, 0.4);
  }

  .swiss-group-card.is-blue {
    border-color: rgba(107, 183, 214, 0.45);
    background: linear-gradient(160deg, rgba(6, 20, 34, 0.98) 0%, rgba(8, 16, 28, 0.99) 100%);
    box-shadow:
      inset 0 1px 0 rgba(107, 183, 214, 0.06),
      0 0 0 1px rgba(107, 183, 214, 0.08),
      0 12px 24px rgba(2, 8, 15, 0.4);
  }

  .swiss-group-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .swiss-group-bestof {
    color: rgba(243, 246, 250, 0.9);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    white-space: nowrap;
  }

  .swiss-group-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 42px;
    padding: 2px 9px;
    border-radius: 999px;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.78rem;
    font-weight: 900;
    letter-spacing: 0.06em;
    color: rgba(5, 10, 18, 0.92);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
    flex-shrink: 0;
  }

  .swiss-group-label.is-gold {
    background: linear-gradient(90deg, #c7b27f, #e0cf96 52%, #c7b27f);
  }

  .swiss-group-label.is-lavender {
    background: linear-gradient(90deg, #b7a3ec, #cebaf7 52%, #b7a3ec);
  }

  .swiss-group-label.is-blue {
    background: linear-gradient(90deg, #5ea7c5, #70c0da 52%, #5ea7c5);
  }

  .swiss-group-matches {
    display: grid;
    gap: 8px;
  }

  .swiss-match-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 38px;
    position: relative;
    padding: 4px 6px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
  }

  .swiss-match-highlight {
    background: rgba(83, 211, 230, 0.07);
    box-shadow: inset 0 0 0 1px rgba(83, 211, 230, 0.14);
  }

  .swiss-team {
    color: rgba(243, 246, 250, 0.92);
    font-size: 0.82rem;
    font-weight: 800;
    line-height: 1.2;
    text-transform: uppercase;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
    white-space: normal;
  }

  .swiss-team-left {
    text-align: right;
  }

  .swiss-team-right {
    text-align: left;
  }

  .swiss-score-ribbon {
    min-width: 52px;
    height: 26px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 0.9rem;
    font-weight: 900;
    letter-spacing: 0.05em;
    color: rgba(5, 10, 18, 0.95);
    border-radius: 999px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
    flex-shrink: 0;
  }

  .swiss-score-ribbon.is-gold {
    background: linear-gradient(90deg, #c7b27f, #e0cf96 52%, #c7b27f);
  }

  .swiss-score-ribbon.is-lavender {
    background: linear-gradient(90deg, #b7a3ec, #cebaf7 52%, #b7a3ec);
  }

  .swiss-score-ribbon.is-blue {
    background: linear-gradient(90deg, #5ea7c5, #70c0da 52%, #5ea7c5);
  }

  .swiss-result-side {
    display: grid;
    gap: 14px;
    align-content: start;
  }

  .swiss-result-stack {
    display: grid;
    gap: 10px;
  }

  .swiss-result-stack.is-eliminated {
    position: relative;
    padding-top: 14px;
  }

  .swiss-result-stack.is-eliminated::before {
    content: "Eliminated";
    position: absolute;
    top: 0;
    left: 0;
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(243, 246, 250, 0.3);
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
  }

  .swiss-result-card {
    display: grid;
    grid-template-rows: auto auto auto;
    gap: 8px;
    padding: 12px 14px;
    background: rgba(8, 16, 28, 0.98);
    border: 1px solid rgba(83, 211, 230, 0.12);
    border-radius: 10px;
    overflow: hidden;
    min-width: 0;
    position: relative;
  }

  .swiss-result-card::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 10px 0 0 10px;
  }

  .swiss-result-card.is-gold {
    border-color: rgba(217, 197, 142, 0.38);
    background: linear-gradient(135deg, rgba(20, 14, 3, 0.99) 0%, rgba(8, 16, 28, 0.99) 60%);
  }

  .swiss-result-card.is-gold::before {
    background: linear-gradient(180deg, #e0cf96, #c7b27f);
  }

  .swiss-result-card.is-lavender {
    border-color: rgba(200, 183, 245, 0.38);
    background: linear-gradient(135deg, rgba(20, 8, 34, 0.99) 0%, rgba(8, 16, 28, 0.99) 60%);
  }

  .swiss-result-card.is-lavender::before {
    background: linear-gradient(180deg, #cebaf7, #b7a3ec);
  }

  .swiss-result-card.is-blue {
    border-color: rgba(107, 183, 214, 0.38);
    background: linear-gradient(135deg, rgba(4, 16, 30, 0.99) 0%, rgba(8, 16, 28, 0.99) 60%);
  }

  .swiss-result-card.is-blue::before {
    background: linear-gradient(180deg, #70c0da, #5ea7c5);
  }

  .swiss-result-label {
    color: rgba(243, 246, 250, 0.45);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    white-space: normal;
    word-break: break-word;
    line-height: 1.3;
  }

  .swiss-result-ribbon {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 18px;
    width: fit-content;
    max-width: 100%;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    font-size: 1.35rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    color: rgba(5, 10, 18, 0.95);
    border-radius: 999px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .swiss-result-ribbon.is-gold {
    background: linear-gradient(90deg, #c7b27f, #e0cf96 52%, #c7b27f);
  }

  .swiss-result-ribbon.is-lavender {
    background: linear-gradient(90deg, #b7a3ec, #cebaf7 52%, #b7a3ec);
  }

  .swiss-result-ribbon.is-blue {
    background: linear-gradient(90deg, #5ea7c5, #70c0da 52%, #5ea7c5);
  }

  .swiss-result-teams {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    min-width: 0;
  }

  .swiss-result-teams span {
    color: rgba(243, 246, 250, 0.78);
    font-size: 0.76rem;
    font-weight: 700;
    line-height: 1.25;
    text-transform: uppercase;
    font-family: "Rajdhani", "Orbitron", "Arial Narrow", sans-serif;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .swiss-result-teams span:not(:last-child)::after {
    content: "·";
    margin-left: 8px;
    color: rgba(243, 246, 250, 0.3);
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

  .advanced-podium-headline {
    color: rgba(224, 238, 255, 0.86);
    font-size: 0.9rem;
    line-height: 1.4;
    padding-top: 4px;
    text-align: center;
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
    grid-template-columns: 48px minmax(0, 1fr) 56px;
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

    .swiss-stage-board {
      min-width: 1100px;
      grid-template-columns: minmax(820px, 1fr) minmax(260px, 300px);
      gap: 18px;
      padding: 16px;
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
      grid-template-columns: 40px minmax(0, 1fr) 42px;
      min-height: 48px;
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

    .playoff-seed,
    .playoff-score {
      font-size: 0.8rem;
    }

    .playoff-name {
      padding: 0 10px;
      font-size: 0.84rem;
    }

    .swiss-stage-board {
      min-width: 980px;
      grid-template-columns: minmax(720px, 1fr) minmax(220px, 260px);
      padding: 14px;
      gap: 14px;
    }

    .swiss-stage-columns {
      gap: 14px;
    }

    .swiss-stage-column {
      gap: 12px;
    }

    .swiss-group-card,
    .swiss-result-card {
      padding: 10px 12px;
    }

    .swiss-group-bestof {
      font-size: 0.7rem;
    }

    .swiss-group-label {
      font-size: 0.72rem;
      min-width: 36px;
      padding: 2px 7px;
    }

    .swiss-team {
      font-size: 0.76rem;
    }

    .swiss-score-ribbon {
      min-width: 46px;
      height: 24px;
      font-size: 0.78rem;
      padding: 0 7px;
    }

    .swiss-result-ribbon {
      min-height: 30px;
      font-size: 1.1rem;
      padding: 3px 14px;
    }

    .swiss-result-label {
      font-size: 0.6rem;
    }

    .swiss-result-teams span {
      font-size: 0.7rem;
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
</style>

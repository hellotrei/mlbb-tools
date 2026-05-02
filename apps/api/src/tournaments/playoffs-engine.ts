import { and, asc, eq } from "drizzle-orm";
import {
  db,
  tournamentEvents,
  tournamentMatches,
  tournamentRounds,
  tournamentTeams
} from "@mlbb/db";

type Slot = "A" | "B";
type Bracket = "upper" | "lower" | "grand_final" | "main";
type SourceType = "seed" | "winner" | "loser" | "bye";
type PlayoffFormat = "single_elimination" | "double_elimination";

export type PlayoffMatchFlow = {
  nextWinnerMatchId?: string;
  nextWinnerSlot?: Slot;
  nextLoserMatchId?: string;
  nextLoserSlot?: Slot;
  sourceA?: { type: SourceType; ref?: string; seed?: number };
  sourceB?: { type: SourceType; ref?: string; seed?: number };
  layout?: {
    bracket: Bracket;
    roundIndex: number;
    matchIndex: number;
    column: number;
    row: number;
    groupKey: string;
  };
};

type EventRecord = typeof tournamentEvents.$inferSelect;
type TeamRecord = typeof tournamentTeams.$inferSelect;
type RoundRecord = typeof tournamentRounds.$inferSelect;
type MatchRecord = typeof tournamentMatches.$inferSelect;

type BracketInputTeam = {
  id: string;
  name: string;
  seed: number;
};

export type GeneratePlayoffBracketInput = {
  eventId: string;
  teams: BracketInputTeam[];
  format: PlayoffFormat;
  grandFinalMode?: "two_games" | "one_game" | "none";
};

export type SubmitPlayoffMatchResultInput = {
  eventId: number;
  matchId: number;
  scoreA: number;
  scoreB: number;
  source: "api" | "telegram" | "admin";
  actorId?: string | null;
};

function nextPowerOfTwo(value: number) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(2, value))));
}

function playoffFormat(event: Pick<EventRecord, "format">): PlayoffFormat {
  return event.format === "double_elimination" ? "double_elimination" : "single_elimination";
}

function getEffectiveBracketSize(teamCount: number) {
  return nextPowerOfTwo(teamCount);
}

function getUpperRoundCount(teamCount: number) {
  return Math.max(1, Math.ceil(Math.log2(getEffectiveBracketSize(teamCount))));
}

function getLowerRoundCount(teamCount: number) {
  return Math.max(0, 2 * (getUpperRoundCount(teamCount) - 1));
}

function readFlow(match: Pick<MatchRecord, "playoffFlow">): PlayoffMatchFlow {
  return (match.playoffFlow ?? {}) as PlayoffMatchFlow;
}

function stableMatchRef(round: Pick<RoundRecord, "stage" | "stageNumber">, match: Pick<MatchRecord, "pairingOrder">) {
  return `${round.stage}:${round.stageNumber}:${match.pairingOrder}`;
}

function getRoundMatches(rounds: RoundRecord[], matches: MatchRecord[], stage: string, stageNumber: number) {
  const round = rounds.find((item) => item.stage === stage && item.stageNumber === stageNumber);
  if (!round) return [] as MatchRecord[];
  return matches
    .filter((match) => match.roundId === round.id)
    .slice()
    .sort((left, right) => left.pairingOrder - right.pairingOrder);
}

function findMatch(
  rounds: RoundRecord[],
  matches: MatchRecord[],
  stage: string,
  stageNumber: number,
  pairingOrder: number
) {
  const round = rounds.find((item) => item.stage === stage && item.stageNumber === stageNumber);
  if (!round) return null;
  return matches.find((match) => match.roundId === round.id && match.pairingOrder === pairingOrder) ?? null;
}

function layoutFor(round: RoundRecord, match: MatchRecord, format: PlayoffFormat): NonNullable<PlayoffMatchFlow["layout"]> {
  const bracket = (round.stage === "upper" || round.stage === "lower" || round.stage === "grand_final")
    ? round.stage
    : "main";
  const stageOffset =
    bracket === "lower" ? 100 :
    bracket === "grand_final" ? 200 :
    0;
  const rowScale = bracket === "lower" ? 2 : Math.pow(2, Math.max(0, round.stageNumber - 1));
  return {
    bracket,
    roundIndex: round.roundNumber,
    matchIndex: match.pairingOrder,
    column: round.roundNumber,
    row: stageOffset + ((match.pairingOrder - 1) * rowScale) + 1,
    groupKey: `${format}:${bracket}:${round.stageNumber}`
  };
}

function inferSingleEliminationFlow(
  event: EventRecord,
  rounds: RoundRecord[],
  matches: MatchRecord[],
  round: RoundRecord,
  match: MatchRecord
): PlayoffMatchFlow {
  const flow: PlayoffMatchFlow = {
    ...readFlow(match),
    layout: layoutFor(round, match, "single_elimination")
  };

  if (round.stage !== "main") return flow;

  const nextMatch = findMatch(rounds, matches, "main", round.stageNumber + 1, Math.ceil(match.pairingOrder / 2));
  if (nextMatch && round.stageNumber < event.totalRounds) {
    flow.nextWinnerMatchId = String(nextMatch.id);
    flow.nextWinnerSlot = match.pairingOrder % 2 === 1 ? "A" : "B";
  }

  if (event.playoffThirdPlaceBestOf && round.stageNumber === event.totalRounds - 1) {
    const thirdPlace = findMatch(rounds, matches, "main", event.totalRounds, 2);
    if (thirdPlace) {
      flow.nextLoserMatchId = String(thirdPlace.id);
      flow.nextLoserSlot = match.pairingOrder % 2 === 1 ? "A" : "B";
    }
  }

  if (!flow.sourceA) {
    flow.sourceA = round.stageNumber === 1
      ? { type: "seed", seed: match.pairingOrder * 2 - 1 }
      : { type: "winner", ref: `main:${round.stageNumber - 1}:${match.pairingOrder * 2 - 1}` };
  }
  if (!flow.sourceB) {
    flow.sourceB = match.teamBId
      ? round.stageNumber === 1
        ? { type: "seed", seed: match.pairingOrder * 2 }
        : { type: "winner", ref: `main:${round.stageNumber - 1}:${match.pairingOrder * 2}` }
      : { type: "bye" };
  }

  return flow;
}

function getDEFinalLowerStage(teamCount: number) {
  return Math.max(1, getLowerRoundCount(teamCount));
}

function getDEUpperSourceStageForLowerEven(lowerStageNumber: number) {
  return Math.floor(lowerStageNumber / 2) + 1;
}

function inferDoubleEliminationFlow(
  event: EventRecord,
  rounds: RoundRecord[],
  matches: MatchRecord[],
  round: RoundRecord,
  match: MatchRecord
): PlayoffMatchFlow {
  const flow: PlayoffMatchFlow = {
    ...readFlow(match),
    layout: layoutFor(round, match, "double_elimination")
  };
  const upperRounds = getUpperRoundCount(event.totalTeams);
  const finalLowerStage = getDEFinalLowerStage(event.totalTeams);

  if (round.stage === "upper") {
    const nextUpper = findMatch(rounds, matches, "upper", round.stageNumber + 1, Math.ceil(match.pairingOrder / 2));
    if (nextUpper && round.stageNumber < upperRounds && !flow.nextWinnerMatchId) {
      flow.nextWinnerMatchId = String(nextUpper.id);
      flow.nextWinnerSlot = match.pairingOrder % 2 === 1 ? "A" : "B";
    }
    const lowerStage = round.stageNumber === 1 ? 1 : (round.stageNumber * 2) - 2;
    const lowerPairing = round.stageNumber === 1 ? Math.ceil(match.pairingOrder / 2) : match.pairingOrder;
    const lower = findMatch(rounds, matches, "lower", lowerStage, lowerPairing);
    if (lower && match.teamBId && !flow.nextLoserMatchId) {
      flow.nextLoserMatchId = String(lower.id);
      flow.nextLoserSlot = round.stageNumber === 1
        ? match.pairingOrder % 2 === 1 ? "A" : "B"
        : "B";
    }
    if (round.stageNumber === upperRounds) {
      const grandFinal = findMatch(rounds, matches, "grand_final", 1, 1);
      if (grandFinal && !flow.nextWinnerMatchId) {
        flow.nextWinnerMatchId = String(grandFinal.id);
        flow.nextWinnerSlot = "A";
      }
    }
  }

  if (round.stage === "lower") {
    const nextStage = round.stageNumber + 1;
    const nextLower = findMatch(
      rounds,
      matches,
      "lower",
      nextStage,
      round.stageNumber % 2 === 1 ? Math.ceil(match.pairingOrder / 2) : match.pairingOrder
    );
    if (nextLower && round.stageNumber < finalLowerStage && !flow.nextWinnerMatchId) {
      flow.nextWinnerMatchId = String(nextLower.id);
      flow.nextWinnerSlot = round.stageNumber % 2 === 1
        ? match.pairingOrder % 2 === 1 ? "A" : "B"
        : "A";
    }
    if (round.stageNumber === finalLowerStage) {
      const grandFinal = findMatch(rounds, matches, "grand_final", 1, 1);
      if (grandFinal && !flow.nextWinnerMatchId) {
        flow.nextWinnerMatchId = String(grandFinal.id);
        flow.nextWinnerSlot = "B";
      }
    }
  }

  if (round.stage === "grand_final" && round.stageNumber === 1) {
    const reset = findMatch(rounds, matches, "grand_final", 2, 1);
    if (reset && !flow.nextWinnerMatchId && !flow.nextLoserMatchId) {
      flow.nextWinnerMatchId = String(reset.id);
      flow.nextWinnerSlot = "A";
      flow.nextLoserMatchId = String(reset.id);
      flow.nextLoserSlot = "B";
    }
  }

  if (!flow.sourceA || !flow.sourceB) {
    const ref = stableMatchRef(round, match);
    if (!flow.sourceA) flow.sourceA = { type: round.stageNumber === 1 && round.stage === "upper" ? "seed" : "winner", ref };
    if (!flow.sourceB) flow.sourceB = match.teamBId ? { type: round.stage === "lower" ? "loser" : "winner", ref } : { type: "bye" };
  }

  return flow;
}

export function inferPlayoffMatchFlow(
  event: EventRecord,
  rounds: RoundRecord[],
  matches: MatchRecord[],
  round: RoundRecord,
  match: MatchRecord
): PlayoffMatchFlow {
  return playoffFormat(event) === "double_elimination"
    ? inferDoubleEliminationFlow(event, rounds, matches, round, match)
    : inferSingleEliminationFlow(event, rounds, matches, round, match);
}

export function generateSingleEliminationBracket(input: GeneratePlayoffBracketInput) {
  const effectiveBracketSize = getEffectiveBracketSize(input.teams.length);
  return {
    eventId: input.eventId,
    format: "single_elimination" as const,
    teamCount: input.teams.length,
    effectiveBracketSize,
    byeCount: effectiveBracketSize - input.teams.length,
    totalRounds: getUpperRoundCount(input.teams.length),
    totalMatches: Math.max(0, input.teams.length - 1)
  };
}

export function generateDoubleEliminationBracket(input: GeneratePlayoffBracketInput) {
  const effectiveBracketSize = getEffectiveBracketSize(input.teams.length);
  const upperRoundCount = getUpperRoundCount(input.teams.length);
  return {
    eventId: input.eventId,
    format: "double_elimination" as const,
    teamCount: input.teams.length,
    effectiveBracketSize,
    byeCount: effectiveBracketSize - input.teams.length,
    upperRoundCount,
    lowerRoundCount: getLowerRoundCount(input.teams.length),
    grandFinalMode: input.grandFinalMode ?? "two_games"
  };
}

function serializeTeam(team: TeamRecord | null) {
  return team ? { id: team.id, name: team.name, seed: team.seed, captainWhatsapp: team.captainWhatsapp } : null;
}

export function buildPlayoffBracketView(input: {
  event: EventRecord;
  rounds: RoundRecord[];
  matches: MatchRecord[];
  teams: TeamRecord[];
}) {
  const format = playoffFormat(input.event);
  const teamById = new Map(input.teams.map((team) => [team.id, team]));
  const matchesByRound = new Map<number, MatchRecord[]>();
  for (const match of input.matches) {
    const bucket = matchesByRound.get(match.roundId) ?? [];
    bucket.push(match);
    matchesByRound.set(match.roundId, bucket);
  }

  const connectors: Array<{ fromMatchId: string; fromSlot: "winner" | "loser"; toMatchId: string; toSlot: Slot }> = [];
  const rounds = input.rounds
    .slice()
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => ({
      id: String(round.id),
      bracket: (round.stage === "upper" || round.stage === "lower" || round.stage === "grand_final" ? round.stage : "main") as Bracket,
      roundNumber: round.roundNumber,
      stageNumber: round.stageNumber,
      label: round.label ?? `Round ${round.roundNumber}`,
      status: round.status,
      matches: (matchesByRound.get(round.id) ?? [])
        .slice()
        .sort((left, right) => left.pairingOrder - right.pairingOrder)
        .map((match) => {
          const flow = inferPlayoffMatchFlow(input.event, input.rounds, input.matches, round, match);
          if (flow.nextWinnerMatchId && flow.nextWinnerSlot) {
            connectors.push({ fromMatchId: String(match.id), fromSlot: "winner", toMatchId: flow.nextWinnerMatchId, toSlot: flow.nextWinnerSlot });
          }
          if (flow.nextLoserMatchId && flow.nextLoserSlot) {
            connectors.push({ fromMatchId: String(match.id), fromSlot: "loser", toMatchId: flow.nextLoserMatchId, toSlot: flow.nextLoserSlot });
          }
          return {
            id: String(match.id),
            pairingOrder: match.pairingOrder,
            teamA: serializeTeam(match.teamAId ? (teamById.get(match.teamAId) ?? null) : null),
            teamB: serializeTeam(match.teamBId ? (teamById.get(match.teamBId) ?? null) : null),
            scoreA: match.scoreA,
            scoreB: match.scoreB,
            winnerTeamId: match.winnerTeamId,
            status: match.result,
            flow,
            layout: flow.layout
          };
        })
    }));

  return { format, rounds, connectors };
}

function resolveResult(scoreA: number, scoreB: number) {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return { error: "Invalid score." } as const;
  }
  if (scoreA === scoreB) return { error: "Playoff match requires one winner." } as const;
  return { result: scoreA > scoreB ? "team_a_win" as const : "team_b_win" as const };
}

async function updateRoundStatuses(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], eventId: number) {
  const [rounds, matches] = await Promise.all([
    tx.select().from(tournamentRounds).where(eq(tournamentRounds.eventId, eventId)),
    tx.select().from(tournamentMatches).where(eq(tournamentMatches.eventId, eventId))
  ]);
  for (const round of rounds) {
    const roundMatches = matches.filter((match) => match.roundId === round.id);
    const allDone = roundMatches.length > 0 && roundMatches.every((match) => match.result !== "pending");
    const allReady = roundMatches.every((match) => (match.teamAId !== null && match.teamBId !== null) || match.result !== "pending");
    await tx
      .update(tournamentRounds)
      .set({ status: allDone ? "finished" : allReady ? "active" : "upcoming" })
      .where(and(eq(tournamentRounds.eventId, eventId), eq(tournamentRounds.id, round.id)));
  }
}

export async function submitPlayoffMatchResult(input: SubmitPlayoffMatchResultInput) {
  const resolved = resolveResult(input.scoreA, input.scoreB);
  if ("error" in resolved) return resolved;

  const updatedAt = new Date();
  const result = await db.transaction(async (tx) => {
    const [event] = await tx.select().from(tournamentEvents).where(eq(tournamentEvents.id, input.eventId)).limit(1);
    if (!event) return { error: "Event not found." } as const;
    if (event.eventMode !== "playoffs") return { error: "Match is not a playoff match." } as const;
    if (event.status === "completed") return { error: "Event is completed. Match results can no longer be edited." } as const;

    const [match] = await tx.select().from(tournamentMatches).where(and(eq(tournamentMatches.eventId, input.eventId), eq(tournamentMatches.id, input.matchId))).limit(1);
    if (!match) return { error: "Match not found." } as const;
    if (!match.teamAId || !match.teamBId) return { error: "Match is not ready." } as const;

    const [round] = await tx.select().from(tournamentRounds).where(and(eq(tournamentRounds.eventId, input.eventId), eq(tournamentRounds.id, match.roundId))).limit(1);
    if (!round) return { error: "Round not found." } as const;

    const [allRounds, allMatches] = await Promise.all([
      tx.select().from(tournamentRounds).where(eq(tournamentRounds.eventId, input.eventId)).orderBy(asc(tournamentRounds.roundNumber)),
      tx.select().from(tournamentMatches).where(eq(tournamentMatches.eventId, input.eventId)).orderBy(asc(tournamentMatches.roundId), asc(tournamentMatches.pairingOrder))
    ]);
    const flow = inferPlayoffMatchFlow(event, allRounds, allMatches, round, match);
    const winnerTeamId = resolved.result === "team_a_win" ? match.teamAId : match.teamBId;
    const loserTeamId = resolved.result === "team_a_win" ? match.teamBId : match.teamAId;
    const affectedMatchIds = new Set<number>([match.id]);

    await tx
      .update(tournamentMatches)
      .set({
        scoreA: input.scoreA,
        scoreB: input.scoreB,
        result: resolved.result,
        winnerTeamId,
        playoffFlow: flow,
        updatedAt
      })
      .where(and(eq(tournamentMatches.eventId, input.eventId), eq(tournamentMatches.id, match.id)));

    if (flow.nextWinnerMatchId && flow.nextWinnerSlot) {
      const targetId = Number(flow.nextWinnerMatchId);
      affectedMatchIds.add(targetId);
      await tx
        .update(tournamentMatches)
        .set({
          [flow.nextWinnerSlot === "A" ? "teamAId" : "teamBId"]: winnerTeamId,
          updatedAt
        })
        .where(and(eq(tournamentMatches.eventId, input.eventId), eq(tournamentMatches.id, targetId)));
    }

    if (flow.nextLoserMatchId && flow.nextLoserSlot && loserTeamId) {
      const targetId = Number(flow.nextLoserMatchId);
      affectedMatchIds.add(targetId);
      await tx
        .update(tournamentMatches)
        .set({
          [flow.nextLoserSlot === "A" ? "teamAId" : "teamBId"]: loserTeamId,
          updatedAt
        })
        .where(and(eq(tournamentMatches.eventId, input.eventId), eq(tournamentMatches.id, targetId)));
    }

    const propagateAutomaticBye = async (matchId: number) => {
      const [target] = await tx
        .select()
        .from(tournamentMatches)
        .where(and(eq(tournamentMatches.eventId, input.eventId), eq(tournamentMatches.id, matchId)))
        .limit(1);
      if (!target || target.result !== "pending") return;
      const targetFlow = readFlow(target);
      const hasByeSourceA = targetFlow.sourceA?.type === "bye";
      const hasByeSourceB = targetFlow.sourceB?.type === "bye";
      const byeWinnerTeamId =
        hasByeSourceB && target.teamAId && !target.teamBId ? target.teamAId :
        hasByeSourceA && target.teamBId && !target.teamAId ? target.teamBId :
        null;
      if (!byeWinnerTeamId) return;

      const targetRound = allRounds.find((item) => item.id === target.roundId);
      if (!targetRound) return;
      const refreshedMatches = await tx
        .select()
        .from(tournamentMatches)
        .where(eq(tournamentMatches.eventId, input.eventId))
        .orderBy(asc(tournamentMatches.roundId), asc(tournamentMatches.pairingOrder));
      const byeFlow = inferPlayoffMatchFlow(event, allRounds, refreshedMatches, targetRound, target);
      affectedMatchIds.add(target.id);
      await tx
        .update(tournamentMatches)
        .set({
          result: "bye",
          winnerTeamId: byeWinnerTeamId,
          playoffFlow: byeFlow,
          updatedAt
        })
        .where(and(eq(tournamentMatches.eventId, input.eventId), eq(tournamentMatches.id, target.id)));

      if (byeFlow.nextWinnerMatchId && byeFlow.nextWinnerSlot) {
        const nextTargetId = Number(byeFlow.nextWinnerMatchId);
        affectedMatchIds.add(nextTargetId);
        await tx
          .update(tournamentMatches)
          .set({
            [byeFlow.nextWinnerSlot === "A" ? "teamAId" : "teamBId"]: byeWinnerTeamId,
            updatedAt
          })
          .where(and(eq(tournamentMatches.eventId, input.eventId), eq(tournamentMatches.id, nextTargetId)));
        await propagateAutomaticBye(nextTargetId);
      }
    };

    if (flow.nextWinnerMatchId) {
      await propagateAutomaticBye(Number(flow.nextWinnerMatchId));
    }
    if (flow.nextLoserMatchId) {
      await propagateAutomaticBye(Number(flow.nextLoserMatchId));
    }

    await updateRoundStatuses(tx, input.eventId);

    const needsGrandFinalReset =
      playoffFormat(event) === "double_elimination" &&
      round.stage === "grand_final" &&
      round.stageNumber === 1 &&
      winnerTeamId === match.teamBId;
    const shouldComplete =
      !needsGrandFinalReset &&
      !flow.nextWinnerMatchId &&
      (round.stage === "grand_final" || (playoffFormat(event) === "single_elimination" && round.stage === "main" && round.stageNumber >= event.totalRounds));
    if (shouldComplete) {
      await tx.update(tournamentEvents).set({ status: "completed", updatedAt }).where(eq(tournamentEvents.id, input.eventId));
    } else {
      await tx.update(tournamentEvents).set({ updatedAt }).where(eq(tournamentEvents.id, input.eventId));
    }

    return {
      result: resolved.result,
      winnerTeamId,
      loserTeamId,
      affectedMatchIds: Array.from(affectedMatchIds)
    } as const;
  });

  return result;
}

export async function repairPlayoffBracketFlow(eventId: number) {
  const [event] = await db.select().from(tournamentEvents).where(eq(tournamentEvents.id, eventId)).limit(1);
  if (!event) return { error: "Event not found." } as const;
  if (event.eventMode !== "playoffs") return { error: "Event is not playoffs." } as const;

  const [rounds, matches] = await Promise.all([
    db.select().from(tournamentRounds).where(eq(tournamentRounds.eventId, eventId)).orderBy(asc(tournamentRounds.roundNumber)),
    db.select().from(tournamentMatches).where(eq(tournamentMatches.eventId, eventId)).orderBy(asc(tournamentMatches.roundId), asc(tournamentMatches.pairingOrder))
  ]);
  const problems: string[] = [];
  const updates: Array<{ id: number; flow: PlayoffMatchFlow }> = [];
  const lowerRows = new Set<string>();

  for (const match of matches) {
    const round = rounds.find((item) => item.id === match.roundId);
    if (!round) {
      problems.push(`match:${match.id}:missing-round`);
      continue;
    }
    const flow = inferPlayoffMatchFlow(event, rounds, matches, round, match);
    if (flow.layout?.bracket === "lower") {
      const key = `${round.stageNumber}:${flow.layout.row}`;
      if (lowerRows.has(key)) problems.push(`lower-round:${round.stageNumber}:duplicate-row:${flow.layout.row}`);
      lowerRows.add(key);
    }
    if (!match.playoffFlow || JSON.stringify(match.playoffFlow) !== JSON.stringify(flow)) {
      updates.push({ id: match.id, flow });
    }
  }

  await db.transaction(async (tx) => {
    for (const update of updates) {
      await tx
        .update(tournamentMatches)
        .set({ playoffFlow: update.flow, updatedAt: new Date() })
        .where(and(eq(tournamentMatches.eventId, eventId), eq(tournamentMatches.id, update.id)));
    }
  });

  return {
    eventId,
    repairedMatches: updates.length,
    problems
  };
}

export async function debugPlayoffBracketFlow(eventId: number) {
  const [event] = await db.select().from(tournamentEvents).where(eq(tournamentEvents.id, eventId)).limit(1);
  if (!event) return { error: "Event not found." } as const;
  const [teams, rounds, matches] = await Promise.all([
    db.select().from(tournamentTeams).where(eq(tournamentTeams.eventId, eventId)).orderBy(asc(tournamentTeams.seed), asc(tournamentTeams.createdAt)),
    db.select().from(tournamentRounds).where(eq(tournamentRounds.eventId, eventId)).orderBy(asc(tournamentRounds.roundNumber)),
    db.select().from(tournamentMatches).where(eq(tournamentMatches.eventId, eventId)).orderBy(asc(tournamentMatches.roundId), asc(tournamentMatches.pairingOrder))
  ]);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const view = buildPlayoffBracketView({ event, teams, rounds, matches });
  const detectedProblems: string[] = [];
  const lowerRows = new Set<string>();
  for (const round of view.rounds) {
    for (const match of round.matches) {
      if (match.layout?.bracket === "lower") {
        const key = `${round.stageNumber}:${match.layout.row}`;
        if (lowerRows.has(key)) detectedProblems.push(`lower-round:${round.stageNumber}:duplicate-row:${match.layout.row}`);
        lowerRows.add(key);
      }
      if (match.flow.nextWinnerMatchId && !matches.some((candidate) => String(candidate.id) === match.flow.nextWinnerMatchId)) {
        detectedProblems.push(`match:${match.id}:missing-next-winner:${match.flow.nextWinnerMatchId}`);
      }
      if (match.flow.nextLoserMatchId && !matches.some((candidate) => String(candidate.id) === match.flow.nextLoserMatchId)) {
        detectedProblems.push(`match:${match.id}:missing-next-loser:${match.flow.nextLoserMatchId}`);
      }
    }
  }
  const effectiveBracketSize = getEffectiveBracketSize(teams.length);
  return {
    eventId,
    format: playoffFormat(event),
    teamCount: teams.length,
    effectiveBracketSize,
    byeCount: effectiveBracketSize - teams.length,
    upperRoundCount: getUpperRoundCount(teams.length),
    lowerRoundCount: playoffFormat(event) === "double_elimination" ? getLowerRoundCount(teams.length) : 0,
    grandFinalMode: "two_games",
    matches: view.rounds.flatMap((round) => round.matches.map((match) => ({
      id: match.id,
      bracket: round.bracket,
      stageNumber: round.stageNumber,
      pairingOrder: match.pairingOrder,
      teamA: match.teamA,
      teamB: match.teamB,
      sourceA: match.flow.sourceA,
      sourceB: match.flow.sourceB,
      nextWinnerMatchId: match.flow.nextWinnerMatchId,
      nextWinnerSlot: match.flow.nextWinnerSlot,
      nextLoserMatchId: match.flow.nextLoserMatchId,
      nextLoserSlot: match.flow.nextLoserSlot,
      layout: match.layout
    }))),
    detectedProblems,
    teams: Array.from(teamById.values()).map((team) => ({ id: team.id, name: team.name, seed: team.seed }))
  };
}

export function assertPlayoffFixture(input: GeneratePlayoffBracketInput) {
  const bracket = input.format === "double_elimination"
    ? generateDoubleEliminationBracket(input)
    : generateSingleEliminationBracket(input);
  if (input.format === "double_elimination" && input.teams.length === 9) {
    const de = bracket as ReturnType<typeof generateDoubleEliminationBracket>;
    if (de.effectiveBracketSize !== 16) throw new Error("9-team DE effective bracket size must be 16");
    if (de.lowerRoundCount !== 6) throw new Error("9-team DE lower round count must be 6");
  }
  return bracket;
}

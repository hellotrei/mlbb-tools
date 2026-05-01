import {
  assertPlayoffFixture,
  buildPlayoffBracketView,
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket
} from "./playoffs-engine";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    name: `Team ${index + 1}`,
    seed: index + 1
  }));
}

function recordTeams(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    eventId: 1,
    name: `Team ${index + 1}`,
    captainWhatsapp: null,
    seed: index + 1,
    createdAt: now
  }));
}

function makeEvent(totalTeams: number) {
  const now = new Date();
  return {
    id: 1,
    code: "EVT-FIXTURE",
    name: "Fixture",
    format: "double_elimination",
    eventMode: "playoffs",
    matchBestOf: 1,
    playoffSemifinalBestOf: 3,
    playoffFinalBestOf: 5,
    playoffThirdPlaceBestOf: null,
    swissDeciderBestOf: null,
    playoffSeedPolicy: null,
    playoffSeedMetadata: null,
    grandFinalTeamALogoUrl: null,
    grandFinalTeamBLogoUrl: null,
    grandFinalYoutubeUrl: null,
    eventBannerImageUrl: null,
    advanceToPlayoffs: totalTeams,
    totalTeams,
    totalRounds: 10,
    eventDate: now,
    status: "ongoing",
    createdByTelegramUserId: "fixture",
    telegramChatId: null,
    adminWhatsapp: null,
    registrationDeadline: null,
    createdAt: now,
    updatedAt: now
  };
}

function makeRound(id: number, roundNumber: number, stage: string, stageNumber: number, label: string) {
  return {
    id,
    eventId: 1,
    roundNumber,
    stage,
    stageNumber,
    label,
    status: "active",
    createdAt: new Date()
  };
}

function makeMatch(id: number, roundId: number, teamAId: number, teamBId: number | null, pairingOrder: number) {
  const result = teamBId ? "pending" : "bye";
  return {
    id,
    eventId: 1,
    roundId,
    teamAId,
    teamBId,
    scoreA: null,
    scoreB: null,
    matchBestOf: null,
    result,
    pairingOrder,
    winnerTeamId: teamBId ? null : teamAId,
    playoffFlow: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

for (const count of [4, 8, 9, 16]) {
  const se = generateSingleEliminationBracket({ eventId: "fixture", teams: teams(count), format: "single_elimination" });
  assert(se.effectiveBracketSize >= count, `SE ${count}: effective bracket smaller than team count`);
  assert((se.effectiveBracketSize & (se.effectiveBracketSize - 1)) === 0, `SE ${count}: effective bracket is not power of two`);
  assert(se.totalMatches === count - 1, `SE ${count}: total matches must be teamCount - 1`);

  const de = generateDoubleEliminationBracket({ eventId: "fixture", teams: teams(count), format: "double_elimination" });
  assert(de.effectiveBracketSize >= count, `DE ${count}: effective bracket smaller than team count`);
  assert(de.lowerRoundCount === 2 * (de.upperRoundCount - 1), `DE ${count}: lower round formula mismatch`);
  assertPlayoffFixture({ eventId: "fixture", teams: teams(count), format: "double_elimination" });
}

const rounds = [
  makeRound(1, 1, "upper", 1, "Upper Bracket Round 1"),
  makeRound(2, 2, "lower", 1, "Lower Bracket Round 1"),
  makeRound(3, 3, "upper", 2, "Upper Bracket Round 2"),
  makeRound(4, 4, "lower", 2, "Lower Bracket Round 2"),
  makeRound(5, 5, "lower", 3, "Lower Bracket Round 3"),
  makeRound(6, 6, "upper", 4, "Upper Bracket Final"),
  makeRound(7, 7, "lower", 6, "Lower Bracket Final"),
  makeRound(8, 8, "grand_final", 1, "Grand Final")
];
const matches = [
  makeMatch(1, 1, 1, 9, 1),
  makeMatch(2, 1, 4, 5, 2),
  makeMatch(3, 3, 1, 4, 1),
  makeMatch(4, 4, 2, 3, 1),
  makeMatch(5, 5, 4, 6, 1),
  makeMatch(6, 6, 1, 7, 1),
  makeMatch(7, 7, 4, 8, 1),
  makeMatch(8, 8, 1, 4, 1)
];
const view = buildPlayoffBracketView({
  event: makeEvent(9) as never,
  teams: recordTeams(9) as never,
  rounds: rounds as never,
  matches: matches as never
});
const lowerRound2Rows = view.rounds.find((round) => round.bracket === "lower" && round.stageNumber === 2)?.matches.map((match) => match.layout?.row) ?? [];
const lowerRound3Rows = view.rounds.find((round) => round.bracket === "lower" && round.stageNumber === 3)?.matches.map((match) => match.layout?.row) ?? [];
assert(lowerRound2Rows.length > 0 && lowerRound3Rows.length > 0, "DE 9: lower round fixture missing");
assert(!lowerRound2Rows.some((row) => lowerRound3Rows.includes(row)), "DE 9: Lower Round 2 and Round 3 share visual row");
assert(new Set(lowerRound2Rows).size === lowerRound2Rows.length, "DE 9: duplicate layout row in Lower Round 2");
assert(view.connectors.some((connector) => connector.fromMatchId === "6" && connector.toMatchId === "8" && connector.toSlot === "A"), "DE 9: Grand Final missing upper champion connector");
assert(view.connectors.some((connector) => connector.fromMatchId === "7" && connector.toMatchId === "8" && connector.toSlot === "B"), "DE 9: Grand Final missing lower champion connector");

console.info("playoffs-engine fixtures passed");

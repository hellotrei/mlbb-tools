<script lang="ts">
  import { Card } from "@mlbb/ui";

  export let data: {
    event: {
      id: number;
      code: string;
      name: string;
      format: string;
      totalTeams: number;
      totalRounds: number;
      eventDate: string;
      status: string;
    };
    bracket: Array<{
      id: number;
      roundNumber: number;
      status: string;
      matches: Array<{
        id: number;
        pairingOrder: number;
        result: string;
        scoreA: number | null;
        scoreB: number | null;
        winnerTeamId: number | null;
        teamA: { id: number; name: string; seed: number | null } | null;
        teamB: { id: number; name: string; seed: number | null } | null;
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

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(date);
  }

  function matchStatusLabel(result: string) {
    if (result === "team_a_win") return "Team A win";
    if (result === "team_b_win") return "Team B win";
    if (result === "draw") return "Draw";
    if (result === "bye") return "Bye";
    return "Pending";
  }

  function isRoundOpen(roundNumber: number) {
    return roundNumber === 1;
  }

  const standingsHeaders = [
    { label: "P", title: "Played. Total matches completed, including byes." },
    { label: "W", title: "Wins. Total matches won." },
    { label: "L", title: "Losses. Total matches lost." },
    { label: "D", title: "Draws. Total matches drawn." },
    { label: "Bye", title: "Bye. Total rounds without an opponent. In this format, a bye counts as a win." },
    { label: "Score", title: "Total points. Formula: win = 1, draw = 0.5, loss = 0, bye = 1." },
    { label: "H2H", title: "Head-to-head. Total points earned against tied teams with the same score." },
    { label: "Buchholz", title: "Buchholz. Formula: the sum of all opponent scores faced by this team." },
    { label: "Pts Diff", title: "Point Difference. Formula: total scoreA minus total scoreB across all matches for this team." }
  ] as const;
</script>

<section class="event-page">
  <header class="event-header">
    <div class="event-copy">
      <a class="back-link" href="/tournaments">Back to Tournament</a>
      <h1 class="page-title">{data.event.name}</h1>
      <p class="page-subtitle">Code {data.event.code} · {formatDate(data.event.eventDate)} · {data.event.totalTeams} teams · {data.event.totalRounds} rounds</p>
      <p class="viewer-note">The web app is used to view brackets and standings only. All admin actions are handled by Admin.</p>
    </div>
    <div class="status-chip">{data.event.status}</div>
  </header>

  <Card title="Bracket">
    <div class="round-stack">
      {#each data.bracket as round}
        <details class="round-panel" open={isRoundOpen(round.roundNumber)}>
          <summary class="round-summary">
            <span class="round-summary-title">Round {round.roundNumber}</span>
            <span class="round-summary-side">
              <span class="round-summary-meta">{round.status}</span>
              <span class="round-summary-icon" aria-hidden="true"></span>
            </span>
          </summary>

          <div class="match-stack">
            {#each round.matches as match}
              <section class="match-row">
                <div class="match-order">#{match.pairingOrder}</div>
                <div class="match-body">
                  <div class:winner={match.winnerTeamId === match.teamA?.id} class="team-line">
                    <span>{match.teamA?.name ?? "TBD"}</span>
                    <strong>{match.scoreA ?? "-"}</strong>
                  </div>
                  <div class:winner={match.winnerTeamId === match.teamB?.id} class="team-line">
                    <span>{match.teamB?.name ?? "BYE"}</span>
                    <strong>{match.scoreB ?? "-"}</strong>
                  </div>
                </div>
                <div class="match-status">{matchStatusLabel(match.result)}</div>
              </section>
            {/each}
          </div>
        </details>
      {/each}
    </div>
  </Card>

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
            <tr>
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
              <td>{row.pointDiff}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>
</section>

<style>
  .event-page {
    display: grid;
    gap: 16px;
  }

  .event-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .event-copy {
    display: grid;
    gap: 6px;
  }

  .event-copy > * {
    margin: 0;
  }

  .back-link {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .viewer-note {
    color: var(--muted);
    font-size: 0.92rem;
  }

  .status-chip {
    border: 1px solid rgba(123, 220, 255, 0.24);
    border-radius: 999px;
    padding: 8px 12px;
    background: rgba(12, 22, 40, 0.72);
    text-transform: capitalize;
  }

  .round-stack,
  .match-stack {
    display: grid;
    gap: 12px;
  }

  .round-panel {
    border: 1px solid rgba(137, 186, 255, 0.14);
    border-radius: 14px;
    background: rgba(12, 22, 40, 0.5);
    overflow: hidden;
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
  }

  .round-summary-meta {
    color: var(--muted);
    text-transform: capitalize;
    font-size: 0.92rem;
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
    border: 1px solid rgba(137, 186, 255, 0.14);
    border-radius: 14px;
    background: rgba(12, 22, 40, 0.66);
    padding: 14px;
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) 120px;
    gap: 12px;
    align-items: center;
  }

  .match-order,
  .match-status {
    color: var(--muted);
    font-size: 0.92rem;
  }

  .match-body {
    display: grid;
    gap: 8px;
  }

  .team-line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .team-line.winner {
    color: #7bdcff;
    font-weight: 700;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
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

  .hint-header span {
    border-bottom: 1px dashed rgba(123, 220, 255, 0.35);
    cursor: help;
  }

  @media (max-width: 900px) {
    .event-header {
      grid-template-columns: 1fr;
      display: grid;
    }

    .match-row {
      grid-template-columns: 1fr;
    }
  }
</style>

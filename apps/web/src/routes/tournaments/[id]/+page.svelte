<script lang="ts">
  import { invalidateAll } from "$app/navigation";
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

  function isRoundOpen(roundNumber: number) {
    return roundNumber === 1;
  }

  let isRefreshing = false;

  async function refreshTournamentView() {
    if (isRefreshing) return;
    isRefreshing = true;

    try {
      await invalidateAll();
    } finally {
      isRefreshing = false;
    }
  }

  function statusTone(status: string) {
    if (status === "ongoing") return "is-ongoing";
    if (status === "completed") return "is-completed";
    return "is-default";
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
      <p class="viewer-note">The web app is used to view brackets and standings only. All admin actions are handled by Admin.</p>
    </div>
    <div class="header-actions">
      <div class={`status-chip ${statusTone(data.event.status)}`}>{data.event.status}</div>
      <button
        class="refresh-button"
        type="button"
        aria-label="Refresh tournament"
        title="Refresh tournament"
        on:click={refreshTournamentView}
        disabled={isRefreshing}
      >
        {#if isRefreshing}
          <span class="refresh-spinner" aria-hidden="true">⏳</span>
        {:else}
          <span aria-hidden="true">🔄</span>
        {/if}
      </button>
    </div>
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
                    <span class="team-seed">{match.teamA?.seed ?? "-"}</span>
                    <span class="team-name">{match.teamA?.name ?? "TBD"}</span>
                    <strong class="team-score">{match.scoreA ?? "-"}</strong>
                  </div>
                  <div class:winner={match.winnerTeamId === match.teamB?.id} class="team-line">
                    <span class="team-seed">{match.teamB?.seed ?? "-"}</span>
                    <span class="team-name">{match.teamB?.name ?? "BYE"}</span>
                    <strong class="team-score">{match.scoreB ?? "-"}</strong>
                  </div>
                </div>
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
    gap: 16px;
    align-items: flex-start;
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

  .viewer-note {
    color: var(--muted);
    font-size: 0.92rem;
    max-width: 640px;
  }

  .page-title {
    word-break: break-word;
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
  }

  .round-panel {
    border: 1px solid rgba(137, 186, 255, 0.14);
    border-radius: 14px;
    background: rgba(9, 18, 34, 0.58);
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
    min-width: 0;
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
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
  }

  .match-order {
    color: rgba(220, 228, 240, 0.58);
    font-size: 0.95rem;
    line-height: 1;
  }

  .match-body {
    display: grid;
    gap: 2px;
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

  .team-line.winner {
    color: #f5f7fb;
  }

  .team-line.winner .team-score {
    background: #ff8a3d;
    color: #fff;
  }

  .table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
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
      display: grid;
      grid-template-columns: 1fr;
    }

    .header-actions {
      justify-content: flex-end;
    }

    .match-row {
      grid-template-columns: 1fr;
    }

    .match-order {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .event-page {
      gap: 12px;
    }

    .event-header {
      gap: 10px;
    }

    .viewer-note {
      font-size: 0.88rem;
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
      grid-template-columns: 34px minmax(0, 1fr) 44px;
      min-height: 38px;
    }

    .team-seed,
    .team-score {
      font-size: 0.84rem;
    }

    .team-name {
      padding: 0 10px;
      font-size: 0.88rem;
    }

    th,
    td {
      padding: 10px 8px;
      font-size: 0.84rem;
    }

    table {
      min-width: 640px;
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

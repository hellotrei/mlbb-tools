<script lang="ts">
  import { tick } from "svelte";
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

  let selectedStandingTeamId: number | null = null;
  let bracketAnchor: HTMLDivElement | null = null;

  function isRoundOpen(roundNumber: number) {
    if (selectedStandingTeamId === null) {
      if (data.event.status === "completed" || data.event.status === "finished") {
        return false;
      }

      return roundNumber === 1;
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

  function matchContainsSelectedTeam(match: (typeof data.bracket)[number]["matches"][number]) {
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
    { label: "P", title: "Played. Total BO2 qualification matches completed, including byes." },
    { label: "W", title: "Wins. Total BO2 match wins with a 2-0 result." },
    { label: "L", title: "Losses. Total BO2 match losses with a 0-2 result." },
    { label: "D", title: "Draws. Total BO2 matches that ended 1-1." },
    { label: "Bye", title: "Bye. Administrative round without an opponent. Counts toward played and awards standing points, but stays separate from Wins and Point Difference." },
    { label: "Pts", title: "Total standing points. Formula: win = 3, draw = 1, loss = 0, bye = 3. Rank is sorted by Pts first." },
    { label: "H2H", title: "Head-to-head. Standing points earned against tied teams with the same Pts value. Used after Pts." },
    { label: "Buchholz", title: "Buchholz. Formula: the sum of all opponent scores faced by this team." },
    { label: "Pts Diff", title: "Point Difference. Formula: total games won minus total games lost across the recorded BO results, excluding byes. Used after Buchholz." }
  ] as const;

  $: playoffSeeds = {
    rank1: data.standings.find((row) => row.rank === 1) ?? null,
    rank2: data.standings.find((row) => row.rank === 2) ?? null,
    rank3: data.standings.find((row) => row.rank === 3) ?? null,
    rank4: data.standings.find((row) => row.rank === 4) ?? null
  };
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
      </div>
      <h1 class="page-title">{data.event.name}</h1>
      <p class="viewer-note">
        The web app is used to view brackets and standings only. All admin actions are handled by Admin.
        <a class="tutorial-link" href="/tournaments/tutorial">View bot tutorial</a>
      </p>
    </div>
  </header>

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
              <td>{row.pointDiff}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>

  <Card title="Bracket">
    <div bind:this={bracketAnchor}></div>
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
                      <strong class="team-score">{match.scoreA ?? "-"}</strong>
                    </div>
                    <div
                      class:selected-team={selectedStandingTeamId === match.teamB?.id}
                      class:winner={match.winnerTeamId === match.teamB?.id}
                      class="team-line"
                    >
                      <span class="team-seed">{match.teamB?.seed ?? "-"}</span>
                      <span class="team-name">{match.teamB?.name ?? "BYE"}</span>
                      <strong class="team-score">{match.scoreB ?? "-"}</strong>
                    </div>
                  </div>
                </section>
              {/each}
            </div>
          </details>
        {/key}
      {/each}
    </div>
  </Card>

  <Card title="Playoffs">
    <div class="playoff-stage">
      <div class="playoff-column">
        <div class="playoff-column-title">Semifinals</div>
        <div class="playoff-round playoff-round--semis">
          <section class="playoff-match">
            <div class="playoff-team">
              <span class="playoff-seed">1</span>
              <span class="playoff-name">{playoffSeeds.rank1?.teamName ?? "TBD"}</span>
              <strong class="playoff-score">-</strong>
            </div>
            <div class="playoff-team">
              <span class="playoff-seed">4</span>
              <span class="playoff-name">{playoffSeeds.rank4?.teamName ?? "TBD"}</span>
              <strong class="playoff-score">-</strong>
            </div>
          </section>

          <section class="playoff-match">
            <div class="playoff-team">
              <span class="playoff-seed">2</span>
              <span class="playoff-name">{playoffSeeds.rank2?.teamName ?? "TBD"}</span>
              <strong class="playoff-score">-</strong>
            </div>
            <div class="playoff-team">
              <span class="playoff-seed">3</span>
              <span class="playoff-name">{playoffSeeds.rank3?.teamName ?? "TBD"}</span>
              <strong class="playoff-score">-</strong>
            </div>
          </section>
        </div>
      </div>

      <div class="playoff-connector" aria-hidden="true">
        <span class="playoff-line playoff-line-top"></span>
        <span class="playoff-line playoff-line-bottom"></span>
        <span class="playoff-line playoff-line-vertical"></span>
        <span class="playoff-line playoff-line-final"></span>
      </div>

      <div class="playoff-column finals-column">
        <div class="playoff-column-title">Finals</div>
        <div class="playoff-round playoff-round--finals">
          <section class="playoff-match final-match">
            <div class="playoff-team">
              <span class="playoff-seed">W1</span>
              <span class="playoff-name">Winner of 1 vs 4</span>
              <strong class="playoff-score">-</strong>
            </div>
            <div class="playoff-team">
              <span class="playoff-seed">W2</span>
              <span class="playoff-name">Winner of 2 vs 3</span>
              <strong class="playoff-score">-</strong>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Card>
</section>

<style>
  .event-page {
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

  .tutorial-link {
    display: inline-flex;
    margin-left: 8px;
    color: #9ee7ff;
    text-decoration: underline;
    text-underline-offset: 3px;
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

    .tutorial-link {
      display: inline;
      margin-left: 0;
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

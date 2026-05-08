<script lang="ts">
  export let data: {
    engine: "mpl-id" | "mpl-ph";
    label: string;
    status: {
      totalMaps?: number;
      generatedAt?: string | null;
      reason?: string | null;
      readiness?: string;
    };
    review: {
      methodologyNote?: string;
      draftLogCoverage?: number;
      items?: Array<{
        matchId: number;
        weekNumber?: number;
        roundNumber?: number | null;
        roundLabel?: string | null;
        scoreline: string;
        winnerTeam: { name: string } | null;
        loserTeam: { name: string } | null;
        winnerAnalysis: string[];
        loserAnalysis: string[];
        loserRecommendations: Array<{
          lane: string;
          heroName: string;
          confidence: string;
          reason: string;
          swapOutHeroName?: string | null;
        }>;
        confidence: string;
        confidenceReason?: string;
        gameDetails?: Array<{
          gameNumber: number;
          mapName?: string | null;
          duration?: string | null;
          mvp?: string | null;
          winnerSide: "blue" | "red";
          winnerTeamName: string;
          blueTeamName: string;
          redTeamName: string;
          bluePicks: Array<{ mlid: number; heroName: string }>;
          redPicks: Array<{ mlid: number; heroName: string }>;
          blueBans: Array<{ mlid: number; heroName: string }>;
          redBans: Array<{ mlid: number; heroName: string }>;
        }>;
      }>;
    };
  };

  type MatchStatus = "scheduled" | "live" | "completed";
  type MatchRow = {
    id: number;
    week: number;
    day: number;
    dayLabel: string;
    timeLabel: string;
    dateLabel: string;
    status: MatchStatus;
    format: "Bo1" | "Bo3" | "Bo5";
    scoreA: number;
    scoreB: number;
    teamA: { name: string; logo: string; isWinner: boolean };
    teamB: { name: string; logo: string; isWinner: boolean };
    winnerName: string;
    mvp: string;
    duration: string;
    mapLabel: string;
    gameByGame: Array<{ label: string; result: string; duration: string; mapName: string }>;
    pickSummary: Array<{
      side: string;
      sideLabel: string;
      gameNumber: number;
      picks: Array<{ mlid: number; heroName: string }>;
      bans: Array<{ mlid: number; heroName: string }>;
    }>;
    quickHeroes: Array<{ mlid: number; heroName: string }>;
    draftSummary: string[];
    confidenceNote: string;
  };

  const FALLBACK_LOGO = "/branding/draft-arena-mark.png";
  const TEAM_LOGOS: Record<string, string> = {
    tlph: "/teams/tlph.png",
    twph: "/teams/twph.png",
    omg: "/teams/omg.png",
    onph: "/teams/onph.png",
    apbr: "/teams/apbr.png",
    flcp: "/teams/flcp.png",
    rora: "/teams/rora.png",
    tnc: "/teams/tnc.png"
  };

  const rawItems = data.review?.items ?? [];

  function norm(value: string) {
    return value.trim().toLowerCase();
  }

  function compactTeamKey(name: string) {
    const clean = norm(name).replace(/[^a-z0-9 ]/g, "");
    if (clean.includes("team liquid")) return "tlph";
    if (clean.includes("twisted")) return "twph";
    if (clean.includes("omega")) return "omg";
    if (clean.includes("onic")) return "onph";
    if (clean.includes("bren")) return "apbr";
    if (clean.includes("falcons")) return "flcp";
    if (clean.includes("rora")) return "rora";
    if (clean.includes("tnc")) return "tnc";
    return "";
  }

  function logoOf(name: string) {
    const key = compactTeamKey(name);
    return TEAM_LOGOS[key] ?? FALLBACK_LOGO;
  }

  function parseScoreline(scoreline: string) {
    const [left, right] = scoreline.split("-").map((v) => Number(v.trim()));
    return {
      left: Number.isFinite(left) ? left : 0,
      right: Number.isFinite(right) ? right : 0
    };
  }

  function deriveStatus(item: { winnerTeam: { name: string } | null; scoreline: string }): MatchStatus {
    if ((item.winnerTeam?.name ?? "").trim()) return "completed";
    const score = parseScoreline(item.scoreline);
    if (score.left > 0 || score.right > 0) return "live";
    return "scheduled";
  }

  function deriveFormat(scoreA: number, scoreB: number): "Bo1" | "Bo3" | "Bo5" {
    const best = Math.max(scoreA, scoreB);
    if (best >= 3) return "Bo5";
    if (best >= 2) return "Bo3";
    return "Bo1";
  }

  function deriveMatchDate(index: number) {
    const base = data.status.generatedAt ? new Date(data.status.generatedAt) : new Date();
    const anchor = Number.isNaN(base.getTime()) ? new Date() : base;
    const dayOffset = Math.floor(index / 3);
    const startOffset = Math.floor(Math.max(0, rawItems.length - 1) / 3);
    const dt = new Date(anchor);
    dt.setDate(dt.getDate() - (startOffset - dayOffset));
    return dt;
  }

  function dayLabel(date: Date) {
    return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }

  function statusLabel(status: MatchStatus) {
    if (status === "completed") return "Completed";
    if (status === "live") return "Live";
    return "Scheduled";
  }

  function buildMapDetailsFromPayload(item: (typeof rawItems)[number], teamAName: string, teamBName: string, scoreA: number, scoreB: number) {
    if (item.gameDetails && item.gameDetails.length > 0) {
      const gameByGame = item.gameDetails.map((detail) => ({
        label: `Game ${detail.gameNumber}`,
        result: `${detail.winnerTeamName || (detail.winnerSide === "blue" ? detail.blueTeamName : detail.redTeamName)} win`,
        duration: detail.duration || "N/A",
        mapName: detail.mapName || "N/A"
      }));

      const pickSummary = item.gameDetails.flatMap((detail) => {
        return [
          { side: detail.blueTeamName, sideLabel: "Blue side", picks: detail.bluePicks, bans: detail.blueBans, gameNumber: detail.gameNumber },
          { side: detail.redTeamName, sideLabel: "Red side", picks: detail.redPicks, bans: detail.redBans, gameNumber: detail.gameNumber }
        ];
      });

      const first = item.gameDetails[0];
      return {
        gameByGame,
        pickSummary,
        quickHeroes: Array.from(
          new Map(
            item.gameDetails
              .flatMap((detail) => [...detail.bluePicks, ...detail.redPicks])
              .map((hero) => [hero.mlid, hero] as const)
          ).values()
        ).slice(0, 8),
        mvp: first?.mvp || "N/A",
        duration: first?.duration || "N/A",
        mapLabel: first?.mapName || `Map #${item.matchId}`
      };
    }

    const total = Math.max(1, scoreA + scoreB);
    const fallbackGames = Array.from({ length: total }).map((_, i) => ({
      label: `Game ${i + 1}`,
      result: `${i % 2 === 0 ? teamAName : teamBName} win`,
      duration: "N/A",
      mapName: "N/A"
    }));

    return {
      gameByGame: fallbackGames,
      pickSummary: [
        { side: teamAName, sideLabel: "Blue side", gameNumber: 1, picks: [], bans: [] },
        { side: teamBName, sideLabel: "Red side", gameNumber: 1, picks: [], bans: [] }
      ],
      quickHeroes: [],
      mvp: "N/A",
      duration: "N/A",
      mapLabel: item.roundLabel ?? `Map #${item.matchId}`
    };
  }

  const matches: MatchRow[] = rawItems.map((item, index) => {
    const when = deriveMatchDate(index);
    const week = item.weekNumber ?? Math.floor(index / 9) + 1;
    const day = Math.floor((index % 9) / 3) + 1;
    const score = parseScoreline(item.scoreline);
    const status = deriveStatus(item);

    const teamAName = item.winnerTeam?.name ?? "TBD Team A";
    const teamBName = item.loserTeam?.name ?? "TBD Team B";
    const winnerName = item.winnerTeam?.name ?? "TBD";

    const mapData = buildMapDetailsFromPayload(item, teamAName, teamBName, score.left, score.right);

    return {
      id: item.matchId,
      week,
      day,
      dayLabel: dayLabel(when),
      timeLabel: when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      dateLabel: when.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      status,
      format: deriveFormat(score.left, score.right),
      scoreA: score.left,
      scoreB: score.right,
      teamA: {
        name: teamAName,
        logo: logoOf(teamAName),
        isWinner: status === "completed" && winnerName === teamAName
      },
      teamB: {
        name: teamBName,
        logo: logoOf(teamBName),
        isWinner: status === "completed" && winnerName === teamBName
      },
      winnerName,
      mvp: mapData.mvp,
      duration: mapData.duration,
      mapLabel: mapData.mapLabel,
      gameByGame: mapData.gameByGame,
      pickSummary: mapData.pickSummary,
      quickHeroes: mapData.quickHeroes,
      draftSummary: [...item.winnerAnalysis, ...item.loserAnalysis].slice(0, 4),
      confidenceNote: item.confidenceReason ?? "No details available."
    };
  });

  const weekGroups = matches.reduce<
    Array<{
      week: number;
      days: Array<{ day: number; dayLabel: string; matches: MatchRow[] }>;
      hidden: boolean;
    }>
  >((acc, match) => {
    let week = acc.find((group) => group.week === match.week);
    if (!week) {
      week = { week: match.week, days: [], hidden: false };
      acc.push(week);
    }

    let day = week.days.find((block) => block.day === match.day);
    if (!day) {
      day = { day: match.day, dayLabel: match.dayLabel, matches: [] };
      week.days.push(day);
    }

    day.matches.push(match);
    return acc;
  }, []);

  let hiddenWeeks: Record<number, boolean> = {};

  function toggleWeek(week: number) {
    hiddenWeeks = { ...hiddenWeeks, [week]: !hiddenWeeks[week] };
  }
</script>

<section class="intel-page">
  <header class="intel-header">
    <a class="back-link" href="/">← Back to Landing</a>
    <h1>{data.label}</h1>
    <p class="meta-line">Maps: {data.status?.totalMaps ?? 0} · Readiness: {data.status?.readiness ?? "unknown"}</p>
  </header>

  <section class="schedule-card">
    <h2>Tournament Schedule / Results</h2>

    {#if weekGroups.length === 0}
      <article class="empty-state"><p>No matches this week.</p></article>
    {:else}
      {#each weekGroups as week}
        <article class="week-block">
          <header class="week-header">
            <h3>Week {week.week}</h3>
            <button type="button" class="week-toggle" on:click={() => toggleWeek(week.week)}>
              {hiddenWeeks[week.week] ? "Show" : "Hide"}
            </button>
          </header>

          {#if !hiddenWeeks[week.week]}
            {#if week.days.length === 0}
              <article class="empty-state"><p>No matches this week.</p></article>
            {:else}
              {#each week.days as day}
                <section class="day-block">
                  <header class="day-header">
                    <h4>Day {day.day} · {day.dayLabel}</h4>
                  </header>

                  {#if day.matches.length === 0}
                    <article class="empty-state"><p>No matches this day.</p></article>
                  {:else}
                    <div class="match-list">
                      {#each day.matches as match}
                        <article class={`match-card status-${match.status}`}>
                          <div class="match-main">
                            <div class={`team-box ${match.teamA.isWinner ? "is-winner" : ""}`}>
                              <img src={match.teamA.logo} alt={match.teamA.name} loading="lazy" decoding="async" />
                              <span>{match.teamA.name}</span>
                            </div>

                            <div class="score-box">
                              <p class="score-time">{match.timeLabel} · {match.dateLabel}</p>
                              <p class="score-value">{match.scoreA} - {match.scoreB}</p>
                              <p class={`score-status ${match.status}`}>{statusLabel(match.status)}</p>
                            </div>

                            <div class={`team-box ${match.teamB.isWinner ? "is-winner" : ""}`}>
                              <img src={match.teamB.logo} alt={match.teamB.name} loading="lazy" decoding="async" />
                              <span>{match.teamB.name}</span>
                            </div>
                          </div>

                          {#if match.quickHeroes.length > 0}
                            <div class="quick-hero-row">
                              <span class="quick-hero-label">Heroes:</span>
                              <div class="hero-chip-wrap">
                                {#each match.quickHeroes as hero}
                                  <a class="hero-chip" href={`/counter-pick?hero=${hero.mlid}`}>{hero.heroName}</a>
                                {/each}
                              </div>
                            </div>
                          {/if}

                          {#if match.status === "completed"}
                            <details class="details-panel">
                              <summary>Match Details</summary>

                              <div class="details-grid">
                                <section class="detail-card">
                                  <h5>Game-by-game Result</h5>
                                  {#each match.gameByGame as game}
                                    <p>{game.label}: {game.result} · {game.duration} · {game.mapName}</p>
                                  {/each}
                                </section>

                                <section class="detail-card">
                                  <h5>Result Insight</h5>
                                  <p>MVP: {match.mvp}</p>
                                  <p>Winning team: {match.winnerName}</p>
                                  <p>Duration: {match.duration}</p>
                                  <p>Map/Game: {match.mapLabel}</p>
                                </section>
                              </div>

                              <section class="detail-card draft-summary">
                                <h5>Draft / Pick & Ban</h5>
                                {#each match.pickSummary as row, rowIdx}
                                  {#if rowIdx === 0 || match.pickSummary[rowIdx - 1]?.gameNumber !== row.gameNumber}
                                    <p class="game-group-label">Game {row.gameNumber}</p>
                                  {/if}
                                  <p><strong>{row.side}</strong> <span class="side-tag">{row.sideLabel}</span></p>
                                  <div class="hero-lines">
                                    <span class="hero-line-label">Picks:</span>
                                    <div class="hero-chip-wrap">
                                      {#if row.picks.length > 0}
                                        {#each row.picks as hero}
                                          <a class="hero-chip" href={`/counter-pick?hero=${hero.mlid}`}>{hero.heroName}</a>
                                        {/each}
                                      {:else}
                                        <span class="hero-empty">N/A</span>
                                      {/if}
                                    </div>
                                  </div>
                                  <div class="hero-lines">
                                    <span class="hero-line-label">Bans:</span>
                                    <div class="hero-chip-wrap">
                                      {#if row.bans.length > 0}
                                        {#each row.bans as hero}
                                          <a class="hero-chip hero-chip-ban" href={`/counter-pick?hero=${hero.mlid}`}>{hero.heroName}</a>
                                        {/each}
                                      {:else}
                                        <span class="hero-empty">N/A</span>
                                      {/if}
                                    </div>
                                  </div>
                                {/each}
                                {#if match.draftSummary.length > 0}
                                  <div class="draft-analysis">
                                    {#each match.draftSummary as line}
                                      <p>{line}</p>
                                    {/each}
                                  </div>
                                {:else}
                                  <p>No details available.</p>
                                {/if}
                              </section>
                            </details>
                          {/if}
                        </article>
                      {/each}
                    </div>
                  {/if}
                </section>
              {/each}
            {/if}
          {/if}
        </article>
      {/each}
    {/if}
  </section>
</section>

<style>
  .intel-page {
    display: grid;
    gap: 12px;
  }

  .intel-header,
  .schedule-card,
  .week-block,
  .empty-state {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 14px;
    background: rgba(9, 18, 34, 0.6);
    padding: 12px;
  }

  .back-link {
    color: var(--muted);
    text-decoration: none;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  p {
    margin: 0;
  }

  .intel-header {
    display: grid;
    gap: 6px;
  }

  .meta-line,
  .method-note {
    color: var(--muted);
    font-size: 0.88rem;
  }

  .schedule-card {
    display: grid;
    gap: 10px;
  }

  .week-block {
    display: grid;
    gap: 8px;
    padding: 10px;
  }

  .week-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .week-toggle {
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.04);
    color: #d7ecff;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    cursor: pointer;
  }

  .day-block {
    display: grid;
    gap: 8px;
  }

  .day-header {
    position: sticky;
    top: 8px;
    z-index: 2;
    border: 1px solid rgba(123, 220, 255, 0.2);
    border-radius: 10px;
    background: rgba(14, 24, 42, 0.9);
    padding: 7px 10px;
  }

  .match-list {
    display: grid;
    gap: 8px;
  }

  .match-card {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    background: rgba(7, 13, 24, 0.88);
    padding: 9px;
    display: grid;
    gap: 8px;
  }

  .match-card.status-completed {
    border-color: rgba(123, 220, 255, 0.24);
  }

  .match-card.status-live {
    border-color: rgba(255, 180, 92, 0.35);
  }

  .match-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 7px;
  }

  .team-box {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 6px 8px;
    min-width: 0;
  }

  .team-box img {
    width: 28px;
    height: 28px;
    object-fit: contain;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .team-box span {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .team-box.is-winner {
    border-color: rgba(83, 190, 255, 0.42);
    background: rgba(9, 38, 62, 0.5);
    box-shadow: inset 0 0 0 1px rgba(83, 190, 255, 0.2), 0 0 10px rgba(83, 190, 255, 0.1);
  }

  .score-box {
    display: grid;
    justify-items: center;
    gap: 2px;
    min-width: 130px;
  }

  .score-time {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .score-value {
    font-size: 1.02rem;
    font-weight: 800;
  }

  .score-status {
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .score-status.scheduled {
    color: #a0adbf;
  }

  .score-status.live {
    color: #ffbc6f;
  }

  .score-status.completed {
    color: #8ad7ff;
  }

  .details-panel {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 8px;
    display: grid;
    gap: 8px;
  }

  .details-panel > summary {
    cursor: pointer;
    list-style: none;
    color: #9fe7ff;
    font-size: 0.84rem;
    font-weight: 700;
  }

  .details-panel > summary::-webkit-details-marker {
    display: none;
  }

  .details-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .detail-card {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 8px;
    padding: 8px;
    display: grid;
    gap: 4px;
  }

  .detail-card h5 {
    font-size: 0.82rem;
    color: #cdeaff;
    margin-bottom: 2px;
  }

  .draft-summary {
    margin-top: 0;
  }

  .confidence-note {
    color: #9fe7ff;
  }

  .quick-hero-row {
    display: grid;
    gap: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 6px;
  }

  .quick-hero-label {
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 700;
  }

  .hero-lines {
    display: grid;
    gap: 4px;
  }

  .hero-line-label {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .hero-chip-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .hero-chip {
    font-size: 0.76rem;
    color: #bde7ff;
    text-decoration: none;
    border: 1px solid rgba(123, 220, 255, 0.3);
    border-radius: 999px;
    padding: 2px 8px;
    background: rgba(13, 44, 72, 0.5);
  }

  .hero-chip:hover {
    border-color: rgba(123, 220, 255, 0.55);
    background: rgba(18, 58, 92, 0.65);
  }

  .hero-chip-ban {
    border-color: rgba(255, 140, 140, 0.35);
    background: rgba(74, 22, 22, 0.45);
    color: #ffd0d0;
  }

  .hero-chip-ban:hover {
    border-color: rgba(255, 140, 140, 0.58);
    background: rgba(94, 26, 26, 0.62);
  }

  .hero-empty {
    color: var(--muted);
    font-size: 0.76rem;
  }

  .game-group-label {
    font-size: 0.78rem;
    font-weight: 700;
    color: #7bdcff;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-top: 1px solid rgba(123, 220, 255, 0.18);
    padding-top: 6px;
    margin-top: 4px;
  }

  .side-tag {
    font-size: 0.72rem;
    color: var(--muted);
    font-weight: 400;
  }

  .draft-analysis {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 6px;
    margin-top: 4px;
    display: grid;
    gap: 3px;
  }

  .draft-analysis p {
    font-size: 0.82rem;
    color: #c4dff5;
  }

  @media (max-width: 820px) {
    .match-main {
      grid-template-columns: 1fr;
      gap: 6px;
    }

    .score-box {
      min-width: 0;
    }

    .details-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

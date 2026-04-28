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
        dataMode?: string;
      }>;
    };
  };

  type MatchStatus = "scheduled" | "live" | "completed";
  type GroupedMatch = {
    id: number;
    week: number;
    day: number;
    dayLabel: string;
    timeLabel: string;
    dateLabel: string;
    status: MatchStatus;
    format: string;
    teamA: { name: string; logo: string; score: number; isWinner: boolean };
    teamB: { name: string; logo: string; score: number; isWinner: boolean };
    winnerName: string;
    duration: string;
    mvp: string;
    gameByGame: Array<{ game: string; result: string; duration: string }>;
    draftSummary: string[];
    insight: string;
  };

  const FALLBACK_LOGO = "/branding/draft-arena-mark.png";
  const TEAM_LOGO_MAP: Record<string, string> = {
    "team liquid ph": "/teams/tlph.png",
    "twisted minds ph": "/teams/twph.png",
    "omega esports": "/teams/omg.png",
    "onic ph": "/teams/onph.png",
    "ap bren": "/teams/apbr.png",
    "falcons ph": "/teams/flcp.png",
    "rora": "/teams/rora.png",
    "tnc": "/teams/tnc.png",
    "blue side": "/branding/draft-arena-mark.png",
    "red side": "/branding/draft-arena-mark.png"
  };

  function normalizeName(name: string) {
    return name.trim().toLowerCase();
  }

  function resolveLogo(name: string) {
    return TEAM_LOGO_MAP[normalizeName(name)] ?? FALLBACK_LOGO;
  }

  function parseScoreline(scoreline: string) {
    const [leftRaw, rightRaw] = scoreline.split("-").map((v) => Number(v.trim()));
    return {
      left: Number.isFinite(leftRaw) ? leftRaw : 0,
      right: Number.isFinite(rightRaw) ? rightRaw : 0
    };
  }

  function resolveFormatFromScore(left: number, right: number) {
    const maxScore = Math.max(left, right);
    if (maxScore >= 3) return "Bo5";
    if (maxScore >= 2) return "Bo3";
    return "Bo1";
  }

  function dayLabelFromDate(date: Date) {
    return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  }

  function deriveMatchDate(index: number) {
    const base = data.status?.generatedAt ? new Date(data.status.generatedAt) : new Date();
    const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
    const daysOffset = Math.floor(index / 3);
    const startOffset = Math.floor(Math.max(0, items.length - 1) / 3);
    const date = new Date(safeBase);
    date.setDate(date.getDate() - (startOffset - daysOffset));
    return date;
  }

  function deriveStatus(item: { scoreline: string; winnerTeam: { name: string } | null }) {
    if ((item.winnerTeam?.name ?? "").trim()) return "completed" as const;
    const scores = parseScoreline(item.scoreline);
    if (scores.left > 0 || scores.right > 0) return "live" as const;
    return "scheduled" as const;
  }

  const items = data.review?.items ?? [];
  const normalizedMatches: GroupedMatch[] = items.map((item, index) => {
    const date = deriveMatchDate(index);
    const week = Math.floor(index / 9) + 1;
    const day = Math.floor((index % 9) / 3) + 1;
    const scores = parseScoreline(item.scoreline);
    const status = deriveStatus(item);
    const winnerName = item.winnerTeam?.name ?? "TBD";
    const loserName = item.loserTeam?.name ?? "TBD";
    const teamAName = winnerName;
    const teamBName = loserName;
    const format = resolveFormatFromScore(scores.left, scores.right);
    const gameLimit = Math.max(1, scores.left + scores.right);
    const gameByGame = Array.from({ length: gameLimit }).map((_, gameIndex) => {
      const winnerTag = gameIndex % 2 === 0 ? teamAName : teamBName;
      return {
        game: `Game ${gameIndex + 1}`,
        result: `${winnerTag} win`,
        duration: "N/A"
      };
    });
    return {
      id: item.matchId,
      week,
      day,
      dayLabel: dayLabelFromDate(date),
      timeLabel: date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      dateLabel: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      status,
      format,
      teamA: {
        name: teamAName,
        logo: resolveLogo(teamAName),
        score: scores.left,
        isWinner: status === "completed" && teamAName === winnerName
      },
      teamB: {
        name: teamBName,
        logo: resolveLogo(teamBName),
        score: scores.right,
        isWinner: status === "completed" && teamBName === winnerName
      },
      winnerName,
      duration: "N/A",
      mvp: "N/A",
      gameByGame,
      draftSummary: [...item.winnerAnalysis, ...item.loserAnalysis].slice(0, 4),
      insight: item.confidenceReason ?? "No additional insight available."
    };
  });

  const weeklyGroups = normalizedMatches.reduce<
    Array<{ week: number; days: Array<{ day: number; dayLabel: string; matches: GroupedMatch[] }> }>
  >((acc, match) => {
    let weekGroup = acc.find((w) => w.week === match.week);
    if (!weekGroup) {
      weekGroup = { week: match.week, days: [] };
      acc.push(weekGroup);
    }
    let dayGroup = weekGroup.days.find((d) => d.day === match.day);
    if (!dayGroup) {
      dayGroup = { day: match.day, dayLabel: match.dayLabel, matches: [] };
      weekGroup.days.push(dayGroup);
    }
    dayGroup.matches.push(match);
    return acc;
  }, []);

  function statusLabel(status: MatchStatus) {
    if (status === "completed") return "Completed";
    if (status === "live") return "Live";
    return "Scheduled";
  }

  function hasCompletedMatch(dayMatches: GroupedMatch[]) {
    return dayMatches.some((match) => match.status === "completed");
  }

  const coveragePercent = Math.round((data.review?.draftLogCoverage ?? 0) * 100);
</script>

<section class="intel-page">
  <header class="intel-header">
    <a class="back-link" href="/">← Back to Landing</a>
    <h1>{data.label}</h1>
    <p>Source: Liquipedia Regular Season week data (week 1 until latest).</p>
    <p class="meta-line">Maps: {data.status?.totalMaps ?? 0} · Readiness: {data.status?.readiness ?? "unknown"}</p>
    {#if data.status?.generatedAt}
      <p class="meta-line">Last generated: {new Date(data.status.generatedAt).toLocaleString("en-GB")}</p>
    {/if}
    {#if data.review?.methodologyNote}
      <p class="method-note">{data.review.methodologyNote}</p>
    {/if}
    <p class="meta-line">Coverage: {coveragePercent}%</p>
  </header>

  <section class="review-list">
    {#if weeklyGroups.length === 0}
      <article class="review-card">
        <p>No matches this week.</p>
      </article>
    {:else}
      {#each weeklyGroups as weekGroup}
        <article class="week-block">
          <header class="week-header">
            <h2>Week {weekGroup.week}</h2>
          </header>
          {#if weekGroup.days.length === 0}
            <div class="review-card"><p>No matches this week.</p></div>
          {:else}
            {#each weekGroup.days as dayGroup}
              <section class="day-block">
                <header class={`day-header ${hasCompletedMatch(dayGroup.matches) ? "is-completed" : ""}`}>
                  <h3>Day {dayGroup.day} · {dayGroup.dayLabel}</h3>
                </header>
                <div class="match-list">
                  {#each dayGroup.matches as match}
                    <article class={`match-card status-${match.status}`}>
                      <div class="match-main">
                        <div class={`team side-a ${match.teamA.isWinner ? "is-winner" : ""}`}>
                          <img src={match.teamA.logo} alt={match.teamA.name} loading="lazy" decoding="async" />
                          <span>{match.teamA.name}</span>
                        </div>
                        <div class="center">
                          <p class="time">{match.timeLabel} · {match.dateLabel}</p>
                          <p class="score">{match.teamA.score} - {match.teamB.score}</p>
                          <p class={`status status-${match.status}`}>{statusLabel(match.status)}</p>
                        </div>
                        <div class={`team side-b ${match.teamB.isWinner ? "is-winner" : ""}`}>
                          <img src={match.teamB.logo} alt={match.teamB.name} loading="lazy" decoding="async" />
                          <span>{match.teamB.name}</span>
                        </div>
                      </div>
                      <div class="match-foot">
                        <span>{match.format}</span>
                        {#if match.status === "completed"}
                          <span>Winner: {match.winnerName}</span>
                        {:else}
                          <span>Upcoming</span>
                        {/if}
                      </div>

                      {#if match.status === "completed"}
                        <details class="details">
                          <summary>Match Details</summary>
                          <div class="details-grid">
                            <div class="detail-box">
                              <h4>Game Result</h4>
                              {#each match.gameByGame as game}
                                <p>{game.game}: {game.result} · {game.duration}</p>
                              {/each}
                            </div>
                            <div class="detail-box">
                              <h4>Tournament Insight</h4>
                              <p>MVP: {match.mvp}</p>
                              <p>Winner: {match.winnerName}</p>
                              <p>Duration: {match.duration}</p>
                              <p>Map: #{match.id}</p>
                            </div>
                          </div>
                          <div class="detail-box">
                            <h4>Draft/Pick Summary</h4>
                            {#if match.draftSummary.length > 0}
                              {#each match.draftSummary as line}
                                <p>{line}</p>
                              {/each}
                            {:else}
                              <p>No details available.</p>
                            {/if}
                            <p class="confidence">{match.insight}</p>
                          </div>
                        </details>
                      {/if}
                    </article>
                  {/each}
                </div>
              </section>
            {/each}
          {/if}
        </article>
      {/each}
    {/if}
  </section>
</section>

<style>
  .intel-page { display: grid; gap: 12px; }
  .intel-header, .review-card, .week-block {
    border: 1px solid rgba(123,220,255,0.14);
    border-radius: 14px;
    background: rgba(9,18,34,0.6);
    padding: 14px;
  }
  .back-link { color: var(--muted); text-decoration: none; }
  h1, h2, h3, p { margin: 0; }
  .intel-header { display: grid; gap: 8px; }
  .meta-line, .method-note { color: var(--muted); font-size: 0.9rem; }
  .review-list { display: grid; gap: 10px; }
  .week-block { display: grid; gap: 10px; }
  .week-header { padding-bottom: 6px; border-bottom: 1px solid rgba(123,220,255,0.14); }
  .day-block { display: grid; gap: 8px; }
  .day-header {
    position: sticky;
    top: 8px;
    z-index: 2;
    background: rgba(11, 20, 38, 0.9);
    border: 1px solid rgba(123,220,255,0.14);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .day-header.is-completed {
    border-color: rgba(88, 191, 255, 0.35);
  }
  .match-list { display: grid; gap: 8px; }
  .match-card {
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    background: rgba(6, 12, 24, 0.85);
    padding: 10px;
    display: grid;
    gap: 8px;
  }
  .match-card.status-live {
    border-color: rgba(255, 183, 77, 0.35);
  }
  .match-card.status-completed {
    border-color: rgba(123,220,255,0.24);
  }
  .match-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .team {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.08);
  }
  .team img {
    width: 28px;
    height: 28px;
    object-fit: contain;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .team span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  .team.is-winner {
    border-color: rgba(88, 191, 255, 0.38);
    box-shadow: inset 0 0 0 1px rgba(88, 191, 255, 0.2), 0 0 12px rgba(58, 160, 235, 0.12);
    background: rgba(10, 40, 68, 0.45);
  }
  .center {
    display: grid;
    justify-items: center;
    gap: 2px;
    min-width: 120px;
  }
  .time {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .score {
    font-size: 1rem;
    font-weight: 800;
  }
  .status {
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .status-scheduled { color: #9ba7bb; }
  .status-live { color: #ffbf66; }
  .status-completed { color: #87d4ff; }
  .match-foot {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--muted);
    font-size: 0.82rem;
  }
  .details {
    border-top: 1px solid rgba(255,255,255,0.08);
    padding-top: 8px;
    display: grid;
    gap: 8px;
  }
  .details > summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: #9ee7ff;
    list-style: none;
  }
  .details > summary::-webkit-details-marker { display: none; }
  .details-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .detail-box {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 8px;
    display: grid;
    gap: 4px;
  }
  .detail-box h4 {
    margin: 0 0 4px 0;
    font-size: 0.82rem;
    color: #c6e7ff;
  }
  .confidence { color: #9ee7ff; }
  @media (max-width: 780px) {
    .match-main {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .center { min-width: 0; }
    .match-foot {
      flex-wrap: wrap;
      gap: 4px 10px;
    }
    .details-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

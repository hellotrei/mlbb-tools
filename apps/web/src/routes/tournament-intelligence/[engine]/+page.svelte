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
      }>;
    };
  };

  const items = data.review?.items ?? [];
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
    {#if items.length === 0}
      <article class="review-card">
        <p>No map review data available yet.</p>
      </article>
    {:else}
      {#each items as item}
        <article class="review-card">
          <div class="head">
            <h2>{item.roundLabel ?? `Map #${item.matchId}`}</h2>
            <span>{item.winnerTeam?.name} vs {item.loserTeam?.name} · {item.scoreline}</span>
          </div>

          <div class="columns">
            <div>
              <h3>Winner Analysis</h3>
              {#each item.winnerAnalysis as line}
                <p>{line}</p>
              {/each}
            </div>
            <div>
              <h3>Loser Analysis</h3>
              {#each item.loserAnalysis as line}
                <p>{line}</p>
              {/each}
            </div>
          </div>

          <div class="rec-box">
            <h3>Winner vs Loser Review</h3>
            <p class="confidence">{item.confidence} · {item.confidenceReason}</p>
            <ul>
              {#each item.loserRecommendations as rec}
                <li>
                  <strong>{rec.lane.toUpperCase()}</strong> {rec.heroName}
                  {#if rec.swapOutHeroName}
                    <span> (swap out: {rec.swapOutHeroName})</span>
                  {/if}
                  <em> · {rec.confidence}</em>
                  <p>{rec.reason}</p>
                </li>
              {/each}
            </ul>
          </div>
        </article>
      {/each}
    {/if}
  </section>
</section>

<style>
  .intel-page { display: grid; gap: 12px; }
  .intel-header, .review-card {
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
  .head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
  .columns > div { display: grid; gap: 6px; }
  .rec-box { margin-top: 10px; display: grid; gap: 8px; }
  .confidence { color: #9ee7ff; }
  ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
  li p { margin-top: 4px; color: var(--muted); }
  @media (max-width: 780px) {
    .columns { grid-template-columns: 1fr; }
  }
</style>

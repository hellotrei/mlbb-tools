<script lang="ts">
  import { fade } from "svelte/transition";
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { HeroAvatar } from "@mlbb/ui";
  import type { HeroInfotipData, InfotipPlacement } from "$lib/infotip";

  export let data: HeroInfotipData;
  export let pos: { top: number; left: number };
  export let placement: InfotipPlacement = { vertical: "bottom", horizontal: "center" };
  export let id: string = "hero-infotip";

  const dispatch = createEventDispatcher<{
    close: void;
    mouseenter: void;
    mouseleave: void;
  }>();

  let captureActive = false;

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") dispatch("close");
  }

  function handleDocPointerDown(e: PointerEvent): void {
    if (!captureActive) return;
    const el = document.getElementById(id);
    if (el && !el.contains(e.target as Node)) dispatch("close");
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    document.addEventListener("pointerdown", handleDocPointerDown, true);
    requestAnimationFrame(() => { captureActive = true; });
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("pointerdown", handleDocPointerDown, true);
  });

  $: hasStatsContent = data.winRate != null || data.pickRate != null || data.banRate != null;
  $: hasContextContent = data.strongVs || data.weakVs || data.synergy;
  $: hasBadges =
    data.tier || data.priority || data.risk || data.spike ||
    data.insightLabel || data.draftUsage;

  function pct(v: number): number {
    return Math.round(Math.min(1, Math.max(0, v)) * 100);
  }
</script>

<div
  {id}
  role="tooltip"
  class="hit hit--v-{placement.vertical} hit--h-{placement.horizontal}"
  style="top:{pos.top}px; left:{pos.left}px;"
  transition:fade={{ duration: 110 }}
  on:mouseenter={() => dispatch("mouseenter")}
  on:mouseleave={() => dispatch("mouseleave")}
>
  <!-- Arrow pointer -->
  <div
    class="hit-arrow hit-arrow--v-{placement.vertical} hit-arrow--h-{placement.horizontal}"
    aria-hidden="true"
  ></div>

  <!-- Head: avatar + name + role/lane -->
  <div class="hit-head">
    <HeroAvatar name={data.name} imageKey={data.imageKey ?? ""} size={40} />
    <div class="hit-copy">
      {#if data.tierHint}<span class="hit-kicker">{data.tierHint}</span>{/if}
      <strong class="hit-name">{data.name}</strong>
      {#if data.roleLabel || data.laneLabel}
        <span class="hit-sub">
          {[data.roleLabel, data.laneLabel].filter(Boolean).join(" · ")}
        </span>
      {/if}
    </div>
  </div>

  <!-- Badges row -->
  {#if hasBadges}
    <div class="hit-badges">
      {#if data.tier}<span class="hit-tier-pill">{data.tier} TIER</span>{/if}
      {#if data.priority}
        <span
          class="hit-badge"
          class:hit-badge--first={data.priority === "First Pick"}
          class:hit-badge--safe={data.priority === "Safe Pick"}
          class:hit-badge--counter={data.priority === "Counter Pick"}
          class:hit-badge--situational={data.priority === "Situational"}
        >{data.priority}</span>
      {/if}
      {#if data.risk}
        <span
          class="hit-badge"
          class:hit-badge--risk-low={data.risk === "Low"}
          class:hit-badge--risk-med={data.risk === "Medium"}
          class:hit-badge--risk-high={data.risk === "High"}
        >Risk: {data.risk}</span>
      {/if}
      {#if data.spike}<span class="hit-badge hit-badge--spike">⚡ {data.spike}</span>{/if}
      {#if data.insightLabel}
        <span
          class="hit-badge"
          class:hit-badge--ins-hidden-op={data.insightKey === "hidden_op"}
          class:hit-badge--ins-safe-pick={data.insightKey === "safe_pick"}
          class:hit-badge--ins-meta-priority={data.insightKey === "meta_priority"}
          class:hit-badge--ins-risky-meta={data.insightKey === "risky_meta"}
          class:hit-badge--ins-niche-pick={data.insightKey === "niche_pick"}
          class:hit-badge--ins-avoid={data.insightKey === "avoid"}
        >
          {#if data.insightEmoji}
            <img src={data.insightEmoji} alt="" class="hit-badge-icon" loading="lazy" decoding="async" />
          {/if}
          <span>{data.insightLabel}</span>
        </span>
      {/if}
      {#if data.draftUsage}
        <span
          class="hit-badge"
          class:hit-badge--du-deny={data.draftUsageKey === "deny_priority"}
          class:hit-badge--du-safe={data.draftUsageKey === "safe_pick"}
          class:hit-badge--du-surprise={data.draftUsageKey === "surprise_pick"}
          class:hit-badge--du-risky={data.draftUsageKey === "risky_pick"}
          class:hit-badge--du-situational={data.draftUsageKey === "situational"}
        >{data.draftUsage}</span>
      {/if}
    </div>
  {/if}

  <!-- Stats rates (stats mode) -->
  {#if hasStatsContent}
    <div class="hit-stats">
      {#if data.winRate != null}
        <span class="hit-stat hit-stat--win">{data.winRate.toFixed(1)}% Win</span>
      {/if}
      {#if data.pickRate != null}
        <span class="hit-stat hit-stat--pick">{data.pickRate.toFixed(1)}% Pick</span>
      {/if}
      {#if data.banRate != null}
        <span class="hit-stat hit-stat--ban">{data.banRate.toFixed(1)}% Ban</span>
      {/if}
    </div>
  {/if}

  <!-- Insight reason text (stats mode) -->
  {#if data.insightReason}
    <p class="hit-reason-text">{data.insightReason}</p>
  {/if}

  <!-- Why this hero (tier mode) -->
  {#if (data.reasons?.length ?? 0) > 0}
    <div class="hit-section">
      <strong class="hit-section-label">Why this hero</strong>
      {#each data.reasons! as reason}
        <p class="hit-section-item">{reason}</p>
      {/each}
    </div>
  {/if}

  <!-- Metric bars (tier mode) -->
  {#if (data.bars?.length ?? 0) > 0}
    <div class="hit-metrics">
      {#each data.bars! as bar}
        <div
          class="hit-metric-card"
          class:hit-metric-card--tier={bar.tone === "tier"}
          class:hit-metric-card--win={bar.tone === "win"}
          class:hit-metric-card--pressure={bar.tone === "pressure"}
          class:hit-metric-card--flex={bar.tone === "flex"}
        >
          <div class="hit-metric-head">
            <span>{bar.label}</span>
            <strong>{pct(bar.value)}%</strong>
          </div>
          <div class="hit-metric-bar">
            <span class="hit-metric-fill" style="width:{pct(bar.value)}%"></span>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Context rows (tier mode) -->
  {#if hasContextContent}
    <div class="hit-context">
      {#if data.strongVs}
        <div class="hit-ctx-row">
          <span class="hit-ctx-label">STRONG VS</span>
          <span class="hit-ctx-val">{data.strongVs}</span>
        </div>
      {/if}
      {#if data.weakVs}
        <div class="hit-ctx-row">
          <span class="hit-ctx-label">WEAK VS</span>
          <span class="hit-ctx-val">{data.weakVs}</span>
        </div>
      {/if}
      {#if data.synergy}
        <div class="hit-ctx-row">
          <span class="hit-ctx-label">SYNERGY</span>
          <span class="hit-ctx-val">{data.synergy}</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- CTA buttons -->
  {#if (data.ctaLinks?.length ?? 0) > 0}
    <div class="hit-cta">
      {#each data.ctaLinks! as cta}
        <a href={cta.href} class="hit-cta-btn" class:hit-cta-btn--accent={cta.accent}>
          {cta.label}
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .hit {
    position: fixed;
    width: min(300px, calc(100vw - 24px));
    border: 1px solid rgba(101, 137, 196, 0.44);
    border-radius: 12px;
    background: rgba(8, 20, 47, 0.97);
    color: #c9ddff;
    padding: 12px;
    display: grid;
    gap: 9px;
    z-index: 1100;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(96, 165, 250, 0.06);
    pointer-events: auto;
  }

  .hit--v-top {
    transform: translateY(-100%) translateY(-10px);
  }

  /* Arrow pointer */
  .hit-arrow {
    position: absolute;
    left: 50%;
    width: 12px;
    height: 12px;
    background: rgba(8, 20, 47, 0.97);
    border-right: 1px solid rgba(101, 137, 196, 0.44);
    border-bottom: 1px solid rgba(101, 137, 196, 0.44);
  }

  .hit-arrow--v-top    { bottom: -6px; transform: translateX(-50%) rotate(45deg);  }
  .hit-arrow--v-bottom { top:    -6px; transform: translateX(-50%) rotate(225deg); }
  .hit-arrow--h-left  { left: 20px; }
  .hit-arrow--v-top.hit-arrow--h-left    { transform: rotate(45deg);  }
  .hit-arrow--v-bottom.hit-arrow--h-left { transform: rotate(225deg); }
  .hit-arrow--h-right { left: auto; right: 20px; }
  .hit-arrow--v-top.hit-arrow--h-right    { transform: rotate(45deg);  }
  .hit-arrow--v-bottom.hit-arrow--h-right { transform: rotate(225deg); }

  /* Head */
  .hit-head { display: flex; align-items: flex-start; gap: 10px; }

  .hit-copy { display: grid; gap: 2px; min-width: 0; }

  .hit-kicker {
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7aa0c8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hit-name {
    font-size: 0.88rem;
    color: #eff6ff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hit-sub { font-size: 0.59rem; color: #9bb7dc; }

  /* Badges */
  .hit-badges { display: flex; flex-wrap: wrap; gap: 5px; }

  .hit-tier-pill {
    border-radius: 999px;
    border: 1px solid rgba(119, 210, 156, 0.45);
    background: rgba(21, 72, 53, 0.52);
    color: #b9f3d6;
    padding: 2px 7px;
    font-size: 0.52rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .hit-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 0.5rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(30, 41, 59, 0.6);
    color: #94a3b8;
  }

  .hit-badge-icon {
    width: 10px;
    height: 10px;
    object-fit: contain;
    flex: 0 0 10px;
    filter: drop-shadow(0 0 4px rgba(90, 247, 255, 0.26));
  }

  /* Priority */
  .hit-badge--first      { border-color: rgba(250, 204, 21, 0.5);   background: rgba(78, 53, 0, 0.6);    color: #fde68a; }
  .hit-badge--safe       { border-color: rgba(74, 222, 128, 0.4);   background: rgba(6, 50, 25, 0.6);    color: #86efac; }
  .hit-badge--counter    { border-color: rgba(251, 146, 60, 0.4);   background: rgba(60, 20, 0, 0.6);    color: #fdba74; }

  /* Risk */
  .hit-badge--risk-low  { border-color: rgba(74, 222, 128, 0.35);  background: rgba(6, 46, 22, 0.55);   color: #86efac; }
  .hit-badge--risk-med  { border-color: rgba(251, 191, 36, 0.35);  background: rgba(55, 38, 0, 0.55);   color: #fcd34d; }
  .hit-badge--risk-high { border-color: rgba(248, 113, 113, 0.35); background: rgba(56, 10, 10, 0.55);  color: #fca5a5; }

  /* Power spike */
  .hit-badge--spike { border-color: rgba(129, 140, 248, 0.35); background: rgba(20, 14, 56, 0.55); color: #a5b4fc; }

  /* Insight variants */
  .hit-badge--ins-hidden-op     { border-color: rgba(139, 92, 246, 0.45);  background: rgba(30, 10, 60, 0.6);   color: #c4b5fd; }
  .hit-badge--ins-safe-pick     { border-color: rgba(74, 222, 128, 0.4);   background: rgba(6, 50, 25, 0.6);    color: #86efac; }
  .hit-badge--ins-meta-priority { border-color: rgba(251, 146, 60, 0.45);  background: rgba(55, 20, 0, 0.6);    color: #fdba74; }
  .hit-badge--ins-risky-meta    { border-color: rgba(248, 113, 113, 0.4);  background: rgba(56, 10, 10, 0.55);  color: #fca5a5; }
  .hit-badge--ins-niche-pick    { border-color: rgba(148, 163, 184, 0.3);  background: rgba(30, 41, 59, 0.55);  color: #94a3b8; }
  .hit-badge--ins-avoid         { border-color: rgba(248, 113, 113, 0.55); background: rgba(70, 10, 10, 0.6);   color: #f87171; }

  /* Draft usage variants */
  .hit-badge--du-deny       { border-color: rgba(248, 113, 113, 0.4);  background: rgba(56, 10, 10, 0.55);  color: #fca5a5; }
  .hit-badge--du-safe       { border-color: rgba(74, 222, 128, 0.4);   background: rgba(6, 50, 25, 0.6);    color: #86efac; }
  .hit-badge--du-surprise   { border-color: rgba(139, 92, 246, 0.4);   background: rgba(30, 10, 60, 0.55);  color: #c4b5fd; }
  .hit-badge--du-risky      { border-color: rgba(251, 191, 36, 0.35);  background: rgba(55, 38, 0, 0.55);   color: #fcd34d; }
  .hit-badge--du-situational{ border-color: rgba(148, 163, 184, 0.25); background: rgba(30, 41, 59, 0.5);   color: #94a3b8; }

  /* Stats rate pills */
  .hit-stats { display: flex; gap: 6px; flex-wrap: wrap; }

  .hit-stat {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 8px;
  }

  .hit-stat--win  { background: rgba(88, 207, 174, 0.14);  color: #58cfae; }
  .hit-stat--pick { background: rgba(130, 176, 245, 0.14); color: #82b0f5; }
  .hit-stat--ban  { background: rgba(194, 155, 232, 0.14); color: #c29be8; }

  /* Insight reason */
  .hit-reason-text {
    font-size: 0.72rem;
    color: #8fa5c2;
    line-height: 1.45;
    margin: 0;
    border-top: 1px solid rgba(80, 120, 180, 0.16);
    padding-top: 7px;
  }

  /* Why this hero section */
  .hit-section {
    display: grid;
    gap: 5px;
    padding: 9px 10px;
    border-radius: 10px;
    background: rgba(14, 29, 56, 0.58);
    border: 1px solid rgba(132, 176, 244, 0.1);
  }

  .hit-section-label {
    font-size: 0.62rem;
    color: #eaf2ff;
    font-weight: 700;
  }

  .hit-section-item {
    margin: 0;
    font-size: 0.59rem;
    line-height: 1.45;
    color: #a9c2e6;
  }

  /* Metric bars */
  .hit-metrics { display: grid; gap: 6px; }

  .hit-metric-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 10px;
    border-radius: 10px;
    background: rgba(10, 22, 46, 0.72);
    border: 1px solid rgba(132, 176, 244, 0.1);
  }

  .hit-metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .hit-metric-head span {
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #9bb7dc;
  }

  .hit-metric-head strong { font-size: 0.62rem; color: #eff6ff; }

  .hit-metric-bar {
    position: relative;
    height: 7px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.16);
    overflow: hidden;
  }

  .hit-metric-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    transition: width 300ms ease-out;
    background: linear-gradient(90deg, #7aa0c8, #93c5fd);
  }

  .hit-metric-card--tier     .hit-metric-fill { background: linear-gradient(90deg, #f59e0b, #fcd34d); }
  .hit-metric-card--win      .hit-metric-fill { background: linear-gradient(90deg, #ef4444, #fb7185); }
  .hit-metric-card--pressure .hit-metric-fill { background: linear-gradient(90deg, #f97316, #fb923c); }
  .hit-metric-card--flex     .hit-metric-fill { background: linear-gradient(90deg, #38bdf8, #60a5fa); }

  /* Context rows */
  .hit-context {
    display: grid;
    gap: 5px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(14, 29, 56, 0.44);
    border: 1px solid rgba(132, 176, 244, 0.08);
  }

  .hit-ctx-row { display: flex; align-items: baseline; gap: 6px; min-width: 0; }

  .hit-ctx-label {
    font-size: 0.48rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #7aa0c8;
    flex-shrink: 0;
    width: 58px;
  }

  .hit-ctx-val { font-size: 0.58rem; color: #c2d8f4; line-height: 1.35; min-width: 0; }

  /* CTA */
  .hit-cta { display: flex; gap: 6px; }

  .hit-cta-btn {
    flex: 1;
    border: 1px solid rgba(129, 172, 239, 0.25);
    background: rgba(20, 37, 62, 0.72);
    color: #c2d8f4;
    border-radius: 8px;
    padding: 5px 8px;
    font-size: 0.58rem;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    transition: border-color 140ms ease, background 140ms ease;
  }

  .hit-cta-btn:hover {
    border-color: rgba(96, 165, 250, 0.5);
    background: rgba(30, 56, 96, 0.72);
    color: #dbeafe;
  }

  .hit-cta-btn--accent {
    border-color: rgba(48, 221, 255, 0.38);
    background: rgba(10, 52, 80, 0.72);
    color: #7dd3fc;
  }

  .hit-cta-btn--accent:hover {
    border-color: rgba(48, 221, 255, 0.62);
    background: rgba(10, 65, 100, 0.82);
  }

  @media (max-width: 600px) {
    .hit {
      width: min(288px, calc(100vw - 24px));
      font-size: 0.66rem;
    }
  }
</style>

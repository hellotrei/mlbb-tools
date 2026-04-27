<script lang="ts">
  const tools = [
    {
      href: "/hero-tier",
      iconSrc: "/branding/arena-tier-menu.png",
      label: "Arena Tier",
      tag: "Meta Intelligence",
      desc: "Rank every hero by tier, meta score, and draft priority with live engine data.",
      cta: "Open Arena Tier",
      accent: "cyan",
    },
    {
      href: "/hero-statistics",
      iconSrc: "/branding/arena-stats-menu.png",
      label: "Arena Stats",
      tag: "Win Rate Insights",
      desc: "Win rate, pick rate, ban rate decoded into actionable insight labels for every hero.",
      cta: "View Stats",
      accent: "blue",
    },
    {
      href: "/counter-pick",
      iconSrc: "/branding/counter-lab-menu.png",
      label: "Counter Lab",
      tag: "Draft Counter",
      desc: "Find hard counters, best matchups, and role synergies in seconds.",
      cta: "Counter Search",
      accent: "purple",
    },
    {
      href: "/draft-master",
      iconSrc: "/branding/draft-room-menu.png",
      label: "Draft Room",
      tag: "AI Draft Simulation",
      desc: "Simulate full MLBB drafts with ban/pick recommendations and win condition analysis.",
      cta: "Open Draft Room",
      accent: "gold",
    },
    {
      href: "/tournaments",
      iconSrc: "/branding/tournaments-menu.png",
      label: "Tournaments",
      tag: "Event Hub",
      desc: "Manage brackets, track MPL results, and discover upcoming community events.",
      cta: "View Tournaments",
      accent: "green",
    },
  ] as const;

  const tournamentIntelCards = [
    { label: "MPL ID Meta Tracker", icon: "📊", tag: "MPL ID", coming: false },
    { label: "MPL PH Meta Tracker", icon: "📊", tag: "MPL PH", coming: false },
    { label: "Hero Priority by League", icon: "🔥", tag: "Priority", coming: true },
    { label: "Winning Draft Pattern", icon: "🏆", tag: "Draft", coming: true },
    { label: "Losing Draft Weakness", icon: "⚠️", tag: "Analysis", coming: true },
    { label: "Best First Pick", icon: "⚡", tag: "First Pick", coming: true },
  ] as const;

  const upcomingTournaments = [
    {
      name: "DraftArenaX Community Cup #1",
      date: "TBA",
      format: "Single Elimination",
      prize: "TBA",
      slots: "16 Teams",
      status: "upcoming",
    },
    {
      name: "MPL ID — Regular Season",
      date: "Ongoing",
      format: "Round Robin",
      prize: "Official",
      slots: "8 Teams",
      status: "live",
    },
    {
      name: "MPL PH — Regular Season",
      date: "Ongoing",
      format: "Round Robin",
      prize: "Official",
      slots: "8 Teams",
      status: "live",
    },
  ] as const;

  let subscribeEmail = "";
  let subscribeSubmitted = false;

  function handleSubscribe(e: Event) {
    e.preventDefault();
    if (subscribeEmail.trim()) subscribeSubmitted = true;
  }
</script>

<svelte:head>
  <title>DraftArenaX — MLBB Draft & Tournament Intelligence</title>
  <meta name="description" content="Analyze hero tier, win rates, counters, draft strategies, and tournament results. The complete MLBB intelligence toolkit for competitive players." />
</svelte:head>

<div class="landing">

  <!-- ── Hero ─────────────────────────────────────────────────────────────── -->
  <section class="hero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="hero-inner">
      <span class="hero-eyebrow">AI-Powered MLBB Intelligence</span>
      <h1 class="hero-title">
        Draft Smarter.<br />
        <span class="hero-title-accent">Win Faster.</span>
      </h1>
      <p class="hero-sub">
        DraftArenaX gives you hero tier rankings, win-rate insights, counter picks,
        draft simulations, and tournament intelligence — all in one dark esports HUD.
      </p>
      <div class="hero-cta">
        <a href="/hero-tier" class="btn btn--primary">Explore Hero Tier</a>
        <a href="/draft-master" class="btn btn--secondary">Open Draft Room</a>
        <a href="/tournaments" class="btn btn--ghost">View Tournaments</a>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span class="hero-stat-value">5</span>
          <span class="hero-stat-label">Tools</span>
        </div>
        <div class="hero-stat-divider" aria-hidden="true"></div>
        <div class="hero-stat">
          <span class="hero-stat-value">4</span>
          <span class="hero-stat-label">Engines</span>
        </div>
        <div class="hero-stat-divider" aria-hidden="true"></div>
        <div class="hero-stat">
          <span class="hero-stat-value">Live</span>
          <span class="hero-stat-label">MPL Data</span>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Core Tools ─────────────────────────────────────────────────────── -->
  <section class="section tools-section">
    <div class="section-inner">
      <div class="section-header">
        <h2 class="section-title">Your Complete MLBB Intelligence Suite</h2>
        <p class="section-sub">Five tools. One platform. Built for competitive drafting.</p>
      </div>
      <div class="tools-grid">
        {#each tools as tool}
          <a href={tool.href} class="tool-card tool-card--{tool.accent}">
            <div class="tool-card-top">
              <img src={tool.iconSrc} alt="" class="tool-icon" loading="lazy" decoding="async" />
              <span class="tool-tag">{tool.tag}</span>
            </div>
            <h3 class="tool-name">{tool.label}</h3>
            <p class="tool-desc">{tool.desc}</p>
            <span class="tool-cta">{tool.cta} →</span>
          </a>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Tournament Intelligence ────────────────────────────────────────── -->
  <section class="section section--alt tourney-section">
    <div class="section-inner">
      <div class="section-header">
        <span class="section-eyebrow">Tournament Data</span>
        <h2 class="section-title">Tournament Intelligence</h2>
        <p class="section-sub">Connect MPL results with draft analysis. Understand what wins at the highest level.</p>
      </div>
      <div class="intel-grid">
        {#each tournamentIntelCards as card}
          <div class="intel-card" class:intel-card--coming={card.coming}>
            <div class="intel-card-top">
              <span class="intel-icon">{card.icon}</span>
              <span class="intel-tag">{card.tag}</span>
              {#if card.coming}
                <span class="intel-badge intel-badge--soon">Soon</span>
              {:else}
                <span class="intel-badge intel-badge--live">Live</span>
              {/if}
            </div>
            <p class="intel-label">{card.label}</p>
          </div>
        {/each}
      </div>
      <div class="section-cta-row">
        <a href="/tournaments" class="btn btn--secondary">Analyze Tournament Meta →</a>
      </div>
    </div>
  </section>

  <!-- ── Upcoming Tournaments ───────────────────────────────────────────── -->
  <section class="section upcoming-section">
    <div class="section-inner">
      <div class="section-header">
        <span class="section-eyebrow">Events</span>
        <h2 class="section-title">Upcoming Tournaments</h2>
        <p class="section-sub">Official leagues and community events. Register before slots fill up.</p>
      </div>
      <div class="upcoming-grid">
        {#each upcomingTournaments as t}
          <div class="upcoming-card" class:upcoming-card--live={t.status === "live"}>
            <div class="upcoming-card-top">
              <span class="upcoming-status upcoming-status--{t.status}">
                {t.status === "live" ? "● Live" : "◌ Upcoming"}
              </span>
              <span class="upcoming-prize">{t.prize}</span>
            </div>
            <h3 class="upcoming-name">{t.name}</h3>
            <div class="upcoming-meta">
              <span>📅 {t.date}</span>
              <span>🏷 {t.format}</span>
              <span>👥 {t.slots}</span>
            </div>
            <div class="upcoming-actions">
              {#if t.status === "upcoming"}
                <a href="/tournaments" class="btn btn--primary btn--sm">Register Now</a>
              {/if}
              <a href="/tournaments" class="btn btn--ghost btn--sm">View Details</a>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Event Subscription ─────────────────────────────────────────────── -->
  <section class="section section--alt subscribe-section">
    <div class="section-inner section-inner--narrow">
      <span class="section-eyebrow">Stay Updated</span>
      <h2 class="section-title">Subscribe to Event Updates</h2>
      <p class="section-sub">
        Get notified before registration closes, before match day, and when new tournament results drop.
        Follow MPL ID, MPL PH, Community Tournaments, or DraftArenaX events.
      </p>
      {#if subscribeSubmitted}
        <div class="subscribe-success">
          ✅ You're on the list! We'll notify you before events start.
        </div>
      {:else}
        <form class="subscribe-form" on:submit={handleSubscribe}>
          <input
            class="subscribe-input"
            type="email"
            placeholder="your@email.com"
            bind:value={subscribeEmail}
            required
            aria-label="Email address"
          />
          <button class="btn btn--primary" type="submit">Subscribe to Event Updates</button>
        </form>
        <p class="subscribe-note">No spam. Unsubscribe any time. MPL ID · MPL PH · Community · DraftArenaX</p>
      {/if}
    </div>
  </section>

  <!-- ── Diamond Marketplace Teaser ────────────────────────────────────── -->
  <section class="section diamond-section">
    <div class="section-inner">
      <div class="diamond-card">
        <div class="diamond-badge">Coming Soon</div>
        <div class="diamond-icon" aria-hidden="true">💎</div>
        <h2 class="diamond-title">Diamond Marketplace</h2>
        <p class="diamond-desc">
          Buy MLBB diamonds with fast delivery, secure payment, promo bundles, and full order tracking.
          Launching after the tournament audience grows.
        </p>
        <div class="diamond-features">
          <span class="diamond-feat">⚡ Fast Delivery</span>
          <span class="diamond-feat">🔒 Secure Payment</span>
          <span class="diamond-feat">📦 Order Tracking</span>
          <span class="diamond-feat">🎁 Promo Bundles</span>
        </div>
        <button class="btn btn--ghost" disabled aria-disabled="true">Coming Soon</button>
      </div>
    </div>
  </section>

</div>

<style>
  /* ── Layout escape from main padding ───────────────────────────────── */
  .landing {
    margin: -24px;
  }

  /* ── Section base ───────────────────────────────────────────────────── */
  .section {
    padding: 64px 24px;
  }

  .section--alt {
    background: rgba(6, 23, 46, 0.55);
    border-top: 1px solid rgba(0, 229, 255, 0.1);
    border-bottom: 1px solid rgba(0, 229, 255, 0.1);
  }

  .section-inner {
    max-width: 1100px;
    margin: 0 auto;
  }

  .section-inner--narrow {
    max-width: 660px;
    text-align: center;
  }

  .section-header {
    margin-bottom: 36px;
  }

  .section-eyebrow {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-cyan);
    margin-bottom: 8px;
  }

  .section-title {
    font-size: clamp(1.35rem, 2.6vw, 2rem);
    font-weight: 800;
    color: var(--text);
    margin: 0 0 10px;
    line-height: 1.2;
  }

  .section-sub {
    font-size: 0.9rem;
    color: var(--muted);
    margin: 0;
    max-width: 580px;
    line-height: 1.55;
  }

  .section-cta-row {
    margin-top: 28px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  /* ── Buttons ────────────────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 11px 22px;
    border-radius: 12px;
    font-size: 0.88rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 160ms ease;
    white-space: nowrap;
    text-decoration: none;
  }

  .btn--sm {
    padding: 7px 14px;
    font-size: 0.8rem;
    border-radius: 9px;
  }

  .btn--primary {
    background: linear-gradient(135deg, #007bff, #0047c7);
    color: #fff;
    border: none;
    box-shadow: 0 4px 18px rgba(0, 123, 255, 0.35);
  }

  .btn--primary:hover {
    background: linear-gradient(135deg, #1e90ff, #0060d6);
    box-shadow: 0 6px 24px rgba(0, 123, 255, 0.5);
    transform: translateY(-1px);
  }

  .btn--secondary {
    background: rgba(0, 71, 199, 0.22);
    color: var(--accent-cyan);
    border: 1px solid rgba(0, 229, 255, 0.35);
  }

  .btn--secondary:hover {
    background: rgba(0, 71, 199, 0.38);
    border-color: rgba(0, 229, 255, 0.6);
  }

  .btn--ghost {
    background: transparent;
    color: var(--muted);
    border: 1px solid rgba(110, 168, 196, 0.3);
  }

  .btn--ghost:hover {
    color: var(--text);
    border-color: rgba(110, 168, 196, 0.55);
  }

  .btn[disabled] {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* ── Hero Section ───────────────────────────────────────────────────── */
  .hero {
    position: relative;
    padding: 88px 32px 72px;
    overflow: hidden;
    text-align: center;
  }

  .hero-bg {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 90% 60% at 50% -10%, rgba(0, 71, 199, 0.28), transparent 70%),
      radial-gradient(ellipse 50% 40% at 80% 70%, rgba(0, 229, 255, 0.07), transparent),
      radial-gradient(ellipse 40% 30% at 20% 60%, rgba(90, 247, 255, 0.04), transparent);
    pointer-events: none;
  }

  .hero-bg::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(0, 229, 255, 0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0, 229, 255, 0.04) 1px, transparent 1px);
    background-size: 40px 40px;
    mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 80%);
    pointer-events: none;
  }

  .hero-inner {
    position: relative;
    max-width: 760px;
    margin: 0 auto;
  }

  .hero-eyebrow {
    display: inline-block;
    padding: 4px 14px;
    background: rgba(0, 229, 255, 0.1);
    border: 1px solid rgba(0, 229, 255, 0.28);
    border-radius: 99px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-cyan);
    margin-bottom: 22px;
  }

  .hero-title {
    font-size: clamp(2.2rem, 6vw, 4rem);
    font-weight: 900;
    line-height: 1.1;
    margin: 0 0 18px;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .hero-title-accent {
    background: linear-gradient(135deg, #00e5ff, #5af7ff, #007bff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero-sub {
    font-size: clamp(0.9rem, 1.6vw, 1.05rem);
    color: var(--muted);
    line-height: 1.65;
    max-width: 560px;
    margin: 0 auto 32px;
  }

  .hero-cta {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 44px;
  }

  .hero-stats {
    display: inline-flex;
    align-items: center;
    gap: 0;
    border: 1px solid rgba(0, 229, 255, 0.18);
    border-radius: 14px;
    background: rgba(6, 23, 46, 0.6);
    backdrop-filter: blur(8px);
    padding: 12px 28px;
    gap: 24px;
  }

  .hero-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .hero-stat-value {
    font-size: 1.3rem;
    font-weight: 800;
    color: var(--accent-cyan);
    line-height: 1;
  }

  .hero-stat-label {
    font-size: 0.67rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }

  .hero-stat-divider {
    width: 1px;
    height: 28px;
    background: rgba(0, 229, 255, 0.2);
  }

  /* ── Tools Grid ─────────────────────────────────────────────────────── */
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }

  .tool-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    border-radius: 16px;
    border: 1px solid rgba(0, 229, 255, 0.15);
    background: rgba(6, 23, 46, 0.55);
    text-decoration: none;
    color: var(--text);
    transition: all 180ms ease;
    cursor: pointer;
  }

  .tool-card:hover {
    border-color: rgba(0, 229, 255, 0.38);
    background: rgba(0, 71, 199, 0.18);
    transform: translateY(-2px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 229, 255, 0.12);
  }

  .tool-card-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .tool-icon {
    width: 28px;
    height: 28px;
    object-fit: contain;
    filter: drop-shadow(0 0 6px rgba(0, 200, 255, 0.3));
  }

  .tool-tag {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent-cyan);
    background: rgba(0, 229, 255, 0.1);
    border: 1px solid rgba(0, 229, 255, 0.22);
    border-radius: 6px;
    padding: 2px 7px;
  }

  .tool-name {
    font-size: 1.05rem;
    font-weight: 800;
    margin: 0;
    color: var(--text);
  }

  .tool-desc {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.5;
    margin: 0;
    flex: 1;
  }

  .tool-cta {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--accent-cyan);
    margin-top: auto;
  }

  /* ── Tournament Intelligence ────────────────────────────────────────── */
  .intel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 12px;
  }

  .intel-card {
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid rgba(0, 229, 255, 0.15);
    background: rgba(2, 7, 18, 0.55);
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 160ms;
  }

  .intel-card--coming {
    opacity: 0.65;
  }

  .intel-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .intel-icon {
    font-size: 1rem;
  }

  .intel-tag {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
  }

  .intel-badge {
    margin-left: auto;
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 5px;
  }

  .intel-badge--live {
    background: rgba(0, 229, 50, 0.15);
    color: #3dffa0;
    border: 1px solid rgba(0, 229, 80, 0.3);
  }

  .intel-badge--soon {
    background: rgba(255, 180, 0, 0.12);
    color: #ffcc44;
    border: 1px solid rgba(255, 180, 0, 0.28);
  }

  .intel-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text);
    margin: 0;
  }

  /* ── Upcoming Tournaments ────────────────────────────────────────────── */
  .upcoming-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .upcoming-card {
    padding: 18px;
    border-radius: 14px;
    border: 1px solid rgba(0, 229, 255, 0.15);
    background: rgba(6, 23, 46, 0.45);
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: border-color 160ms;
  }

  .upcoming-card--live {
    border-color: rgba(0, 229, 80, 0.3);
    background: rgba(6, 23, 46, 0.6);
  }

  .upcoming-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .upcoming-status {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .upcoming-status--live { color: #3dffa0; }
  .upcoming-status--upcoming { color: var(--accent-cyan); }

  .upcoming-prize {
    font-size: 0.7rem;
    color: #ffcc44;
    font-weight: 700;
  }

  .upcoming-name {
    font-size: 0.96rem;
    font-weight: 800;
    color: var(--text);
    margin: 0;
    line-height: 1.3;
  }

  .upcoming-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 0.72rem;
    color: var(--muted);
  }

  .upcoming-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ── Subscribe Section ──────────────────────────────────────────────── */
  .subscribe-section .section-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }

  .subscribe-section .section-title {
    text-align: center;
  }

  .subscribe-section .section-sub {
    text-align: center;
    max-width: 520px;
  }

  .subscribe-form {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }

  .subscribe-input {
    flex: 1;
    min-width: 220px;
    max-width: 340px;
    padding: 11px 16px;
    border-radius: 12px;
    border: 1px solid rgba(0, 229, 255, 0.3);
    background: rgba(6, 23, 46, 0.7);
    color: var(--text);
    font-size: 0.88rem;
    transition: border-color 160ms;
  }

  .subscribe-input:focus {
    outline: none;
    border-color: rgba(0, 229, 255, 0.6);
  }

  .subscribe-note {
    font-size: 0.72rem;
    color: var(--muted);
    margin: 0;
    text-align: center;
  }

  .subscribe-success {
    padding: 16px 24px;
    border-radius: 12px;
    background: rgba(0, 229, 80, 0.12);
    border: 1px solid rgba(0, 229, 80, 0.3);
    color: #3dffa0;
    font-size: 0.88rem;
    font-weight: 600;
  }

  /* ── Diamond Section ─────────────────────────────────────────────────── */
  .diamond-card {
    max-width: 520px;
    margin: 0 auto;
    padding: 36px;
    border-radius: 20px;
    border: 1px solid rgba(90, 247, 255, 0.2);
    background: rgba(6, 23, 46, 0.6);
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  .diamond-card::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 80% 60% at 50% -20%, rgba(90, 247, 255, 0.07), transparent);
    pointer-events: none;
  }

  .diamond-badge {
    display: inline-block;
    padding: 3px 12px;
    background: rgba(255, 204, 68, 0.12);
    border: 1px solid rgba(255, 204, 68, 0.3);
    border-radius: 99px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #ffcc44;
    margin-bottom: 16px;
  }

  .diamond-icon {
    font-size: 3rem;
    margin-bottom: 12px;
    display: block;
    filter: drop-shadow(0 0 12px rgba(90, 247, 255, 0.4));
  }

  .diamond-title {
    font-size: 1.5rem;
    font-weight: 900;
    color: var(--text);
    margin: 0 0 12px;
  }

  .diamond-desc {
    font-size: 0.85rem;
    color: var(--muted);
    line-height: 1.6;
    margin: 0 0 20px;
  }

  .diamond-features {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-bottom: 24px;
  }

  .diamond-feat {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 8px;
    background: rgba(90, 247, 255, 0.08);
    border: 1px solid rgba(90, 247, 255, 0.2);
    color: #a8e8ff;
  }

  /* ── Responsive ─────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .section {
      padding: 48px 16px;
    }

    .hero {
      padding: 60px 20px 52px;
    }

    .hero-cta {
      flex-direction: column;
      align-items: stretch;
    }

    .hero-cta .btn {
      justify-content: center;
    }

    .hero-stats {
      padding: 10px 20px;
      gap: 16px;
    }

    .tools-grid {
      grid-template-columns: 1fr 1fr;
    }

    .intel-grid {
      grid-template-columns: 1fr 1fr;
    }

    .upcoming-grid {
      grid-template-columns: 1fr;
    }

    .diamond-card {
      padding: 24px 18px;
    }

    .subscribe-form {
      flex-direction: column;
      align-items: stretch;
    }

    .subscribe-input {
      max-width: 100%;
    }
  }

  @media (max-width: 400px) {
    .tools-grid {
      grid-template-columns: 1fr;
    }

    .intel-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

<script lang="ts">
  import { engine, m7Status, mplIdStatus, mplPhStatus } from "$lib/stores/engine";
  import { TOURNAMENT_ENGINE_LIST, tournamentEngineStatusTag } from "$lib/tournament-engines";
  import HeroAvatar from "@mlbb-tools/ui/components/HeroAvatar.svelte";

  export let data: {
    events: Array<{
      id: number;
      slug?: string;
      name: string;
      format: string;
      totalTeams: number;
      eventDate: string;
      status: string;
      adminWhatsapp?: string | null;
      registrationDeadline?: string | null;
    }>;
    heroCount: number;
    stats: {
      totalEvents: number;
      liveEvents: number;
      upcomingEvents: number;
      totalTeamSlots: number;
    };
    heroes: Array<{ mlid: number; name: string; imageKey: string }>;
  };

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

  const ADMIN_WA_RAW = ((import.meta.env.PUBLIC_ADMIN_WA as string) ?? "").trim();
  const ADMIN_WA_DIGITS = ADMIN_WA_RAW.replace(/\D/g, "");
  const ADMIN_WA_DISPLAY = ADMIN_WA_RAW || "+62 882-9313-6069";

  type IntelCardStatus = "LIVE" | "BETA" | "EXPERIMENTAL" | "COMING SOON";
  type IntelCardConfidence = "High Confidence" | "Medium Confidence" | "Experimental" | "Roadmap";
  type IntelCardCtaMode = "open_tournaments" | "contact_admin";

  const tournamentIntelCards: Array<{
    status: IntelCardStatus;
    title: string;
    description: string;
    dataSource: string;
    sample: string;
    confidence: IntelCardConfidence;
    topInsight: string;
    whyItMatters: string;
    ctaLabel: string;
    ctaMode: IntelCardCtaMode;
  }> = [
    {
      status: "LIVE",
      title: "MPL ID Meta Tracker",
      description: "Track current MPL ID hero priority, role pressure, and draft movement.",
      dataSource: "MPL ID Regular Season",
      sample: "Latest match data available in engine",
      confidence: "High Confidence",
      topInsight: "High-control mages and durable jungle cores are shaping early draft priority.",
      whyItMatters: "Helps identify safe first picks and avoid low-impact comfort picks.",
      ctaLabel: "Open",
      ctaMode: "open_tournaments"
    },
    {
      status: "LIVE",
      title: "MPL PH Meta Tracker",
      description: "Compare MPL PH draft behavior, role priority, and match trends.",
      dataSource: "MPL PH Regular Season",
      sample: "Latest match data available in engine",
      confidence: "High Confidence",
      topInsight: "Scaling marksman and disciplined objective setups create different draft pressure than MPL ID.",
      whyItMatters: "Useful for cross-region meta comparison and tournament preparation.",
      ctaLabel: "Open",
      ctaMode: "open_tournaments"
    }
  ];

  function formatEventDate(dateStr: string): string {
    if (!dateStr) return "TBA";
    try {
      return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return dateStr;
    }
  }

  function eventStatusLabel(status: string): string {
    if (status === "ongoing") return "● Live";
    if (status === "completed") return "✓ Completed";
    return "◌ Upcoming";
  }

  function toEpoch(value?: string | null): number {
    if (!value) return Number.NaN;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? Number.NaN : ts;
  }

  function formatDeadline(value?: string | null): string {
    const ts = toEpoch(value);
    if (Number.isNaN(ts)) return "TBA";
    try {
      return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return "TBA";
    }
  }

  function registrationCountdown(event: { status: string; registrationDeadline?: string | null; eventDate?: string | null }): string {
    if (event.status === "ongoing") return "Registration closed";
    if (event.status === "completed") return "Event completed";
    const targetTs = toEpoch(event.registrationDeadline ?? event.eventDate ?? null);
    if (Number.isNaN(targetTs)) return "Deadline: TBA";
    const now = Date.now();
    const diffMs = targetTs - now;
    if (diffMs <= 0) return "Registration closes today";
    const diffDays = Math.ceil(diffMs / 86_400_000);
    if (diffDays === 1) return "1 day left";
    return `${diffDays} days left`;
  }

  function quotaLabel(totalTeams: number): string {
    if (!Number.isFinite(totalTeams) || totalTeams <= 0) return "Open quota";
    return `Quota ${totalTeams} teams`;
  }

  let waTeamNames: Record<number, string> = {};
  let waRegisterOpen: Record<number, boolean> = {};
  let waRegisterErrors: Record<number, string> = {};
  let waContactError = "";

  function eventDetailHref(event: { id: number; slug?: string }): string {
    return `/tournaments/${event.slug ?? event.id}`;
  }

  function toggleWaRegister(id: number) {
    if (waRegisterErrors[id]) {
      waRegisterErrors = { ...waRegisterErrors, [id]: "" };
    }
    waRegisterOpen = { ...waRegisterOpen, [id]: !waRegisterOpen[id] };
  }

  function openWaRegister(event: { id: number; slug?: string; name: string; adminWhatsapp?: string | null }, teamName: string) {
    const trimmedName = teamName.trim();
    if (!trimmedName) {
      waRegisterErrors = { ...waRegisterErrors, [event.id]: "Nama tim wajib diisi." };
      return;
    }
    waRegisterErrors = { ...waRegisterErrors, [event.id]: "" };
    const phone = ADMIN_WA_DIGITS;
    if (!phone) {
      window.open(eventDetailHref(event), "_blank");
      return;
    }
    const text = `Halo Admin Draft Arena X, saya ingin mendaftar ke *${event.name}*.\nNama Tim: *${trimmedName}*`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
    waRegisterOpen = { ...waRegisterOpen, [event.id]: false };
  }

  function openWaContact(teamName: string) {
    waContactError = "";
    const phone = ADMIN_WA_DIGITS;
    if (!phone) {
      waContactError = "Admin contact unavailable. Please check back later.";
      return;
    }
    const text = `Hi Draft Arena X Admin, I'm interested in joining a Draft Arena X event.\nTeam / Player: *${teamName.trim() || "—"}*`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  }

  let waContactName = "";

  function intelStatusClass(status: IntelCardStatus): string {
    if (status === "LIVE") return "is-live";
    if (status === "BETA") return "is-beta";
    if (status === "EXPERIMENTAL") return "is-experimental";
    return "is-coming";
  }

  function intelConfidenceClass(confidence: IntelCardConfidence): string {
    if (confidence === "High Confidence") return "is-high";
    if (confidence === "Medium Confidence") return "is-medium";
    if (confidence === "Experimental") return "is-experimental";
    return "is-roadmap";
  }

  function openIntelAction(card: { ctaMode: IntelCardCtaMode; title: string }) {
    if (card.ctaMode === "open_tournaments") {
      window.open("/tournaments", "_self");
      return;
    }
    openWaContact(`Tournament Intelligence: ${card.title}`);
  }

  const ENGINE_HINTS: Record<string, string> = {
    community: "Community stats, tier, matrix, and community blend.",
    m7: "M7 tournament data for world-stage draft trends and hero priority.",
    mpl_id: "MPL ID regular season data for regional meta, role pressure, and draft movement.",
    mpl_ph: "MPL PH regular season data for cross-region comparison and disciplined objective setups."
  };

  type MetaHeroEntry = {
    heroName: string;
    heroImage: string;
    metricLabel: string;
    metricValue: string;
    trend: string;
    trendDir: "up" | "down" | "rising" | "stable";
    confidence: "High" | "Medium" | "Low";
    sampleSize: string;
    recommendation: string;
    reason: string;
  };

  type SnapshotData = {
    mostPicked: MetaHeroEntry[];
    highestWinRate: MetaHeroEntry[];
    mostBanned: MetaHeroEntry;
    risingMeta: MetaHeroEntry;
    highlight: { hero: string; text: string };
    sourceLabel: string;
  };

  const META_SNAPSHOT_DATA: Record<string, SnapshotData> = {
    community: {
      sourceLabel: "Community Data",
      highlight: { hero: "Joy", text: "Joy is climbing fast — sustained burst damage and gap-close pressure make her a top-tier jungle threat this patch." },
      mostPicked: [
        { heroName: "Ling",      heroImage: "/heroes/ling.png",       metricLabel: "Pick Rate", metricValue: "64%", trend: "+8%",    trendDir: "up",     confidence: "High",   sampleSize: "12,400 matches", recommendation: "Safe First Pick",      reason: "High jungle pressure and flexible objective control anchor most team comps." },
        { heroName: "Chou",      heroImage: "/heroes/chou.png",       metricLabel: "Pick Rate", metricValue: "58%", trend: "+3%",    trendDir: "up",     confidence: "High",   sampleSize: "12,400 matches", recommendation: "Flex Support / Offlane", reason: "Reliable crowd control and displacement for objective setups." },
        { heroName: "Lancelot", heroImage: "/heroes/lancelot.png",   metricLabel: "Pick Rate", metricValue: "52%", trend: "Stable", trendDir: "stable", confidence: "Medium", sampleSize: "12,400 matches", recommendation: "Snowball Pick",          reason: "Strong early pressure; elusive kit rewards skilled players." }
      ],
      highestWinRate: [
        { heroName: "Karina",    heroImage: "/heroes/karina.png",     metricLabel: "Win Rate", metricValue: "58%", trend: "+5%",    trendDir: "up",     confidence: "High",   sampleSize: "12,400 matches", recommendation: "Priority Pick",    reason: "Execute damage and anti-carry scaling punish greedy enemy drafts." },
        { heroName: "Gusion",    heroImage: "/heroes/gusion.png",     metricLabel: "Win Rate", metricValue: "55%", trend: "+2%",    trendDir: "up",     confidence: "High",   sampleSize: "12,400 matches", recommendation: "Comfort Pick",     reason: "Burst combo and reset mechanic reward mechanical investment." },
        { heroName: "Benedetta", heroImage: "/heroes/benedetta.png",  metricLabel: "Win Rate", metricValue: "53%", trend: "Stable", trendDir: "stable", confidence: "Medium", sampleSize: "12,400 matches", recommendation: "Anti-CC Pick",     reason: "Immune mechanic and zone coverage counter crowd-control-heavy comps." }
      ],
      mostBanned:  { heroName: "Fanny",  heroImage: "/heroes/fanny.png",  metricLabel: "Ban Rate", metricValue: "88%", trend: "+4%",  trendDir: "up",     confidence: "High",   sampleSize: "12,400 matches", recommendation: "Ban Priority",   reason: "Unrestricted cable mobility creates unplayable scenarios for non-mobile rosters." },
      risingMeta:  { heroName: "Joy",    heroImage: "/heroes/joy.png",    metricLabel: "Pick ↑",  metricValue: "+22%", trend: "+22%", trendDir: "rising", confidence: "Medium", sampleSize: "12,400 matches", recommendation: "Watch Priority", reason: "Fast-growing pick rate driven by sustained burst and high kill participation." }
    },
    m7: {
      sourceLabel: "M7 World Championship",
      highlight: { hero: "Fanny", text: "Fanny remains the most contested hero at world level — teams either ban or master her before each series." },
      mostPicked: [
        { heroName: "Fanny",    heroImage: "/heroes/fanny.png",    metricLabel: "Pick Rate", metricValue: "80%", trend: "+6%",  trendDir: "up",     confidence: "High",   sampleSize: "320 matches", recommendation: "Ban or First Pick", reason: "World-level Fanny control dictates entire draft phase and side-lane tempo." },
        { heroName: "Ling",     heroImage: "/heroes/ling.png",     metricLabel: "Pick Rate", metricValue: "72%", trend: "+3%",  trendDir: "up",     confidence: "High",   sampleSize: "320 matches", recommendation: "Safe Pick",         reason: "Ling's invade pattern and objective burst remain universally valued at worlds." },
        { heroName: "Julian",   heroImage: "/heroes/julian.png",   metricLabel: "Pick Rate", metricValue: "65%", trend: "+11%", trendDir: "rising", confidence: "Medium", sampleSize: "320 matches", recommendation: "Rising Flex",       reason: "Julian's burst-to-sustain cycle proved dominant in late-stage world matches." }
      ],
      highestWinRate: [
        { heroName: "Karina",   heroImage: "/heroes/karina.png",   metricLabel: "Win Rate", metricValue: "62%", trend: "+7%",   trendDir: "up",     confidence: "High",   sampleSize: "320 matches", recommendation: "Punish Pick",       reason: "World-stage Karina snowballs hard off early kills in less-CC-heavy rosters." },
        { heroName: "Hayabusa", heroImage: "/heroes/hayabusa.png", metricLabel: "Win Rate", metricValue: "58%", trend: "+4%",   trendDir: "up",     confidence: "High",   sampleSize: "320 matches", recommendation: "Split-push Threat", reason: "Evasive kit and shadow clone create unsolvable late-game pressure." },
        { heroName: "Gusion",   heroImage: "/heroes/gusion.png",   metricLabel: "Win Rate", metricValue: "56%", trend: "Stable", trendDir: "stable", confidence: "Medium", sampleSize: "320 matches", recommendation: "Execution Pick",   reason: "World-level execution amplifies Gusion's burst ceiling above community averages." }
      ],
      mostBanned:  { heroName: "Fanny",  heroImage: "/heroes/fanny.png",  metricLabel: "Ban Rate", metricValue: "92%", trend: "+4%",  trendDir: "up",     confidence: "High",   sampleSize: "320 matches", recommendation: "Ban Priority",   reason: "World teams unanimously ban Fanny to neutralize cable-dependent disruption." },
      risingMeta:  { heroName: "Julian", heroImage: "/heroes/julian.png", metricLabel: "Pick ↑",  metricValue: "+28%", trend: "+28%", trendDir: "rising", confidence: "Medium", sampleSize: "320 matches", recommendation: "Watch Priority", reason: "Julian's world emergence signals a global meta shift toward hybrid bruiser-mages." }
    },
    mpl_id: {
      sourceLabel: "MPL ID Regular Season",
      highlight: { hero: "Valentina", text: "Valentina is the most contested flex pick — her ult-copy forces early bans or first-phase counters." },
      mostPicked: [
        { heroName: "Valentina", heroImage: "/heroes/valentina.png", metricLabel: "Pick Rate", metricValue: "76%", trend: "+9%",   trendDir: "up",     confidence: "High",   sampleSize: "740 matches", recommendation: "First Phase Priority", reason: "Ult-copy forces opponent drafts into conservative, predictable patterns." },
        { heroName: "Ling",      heroImage: "/heroes/ling.png",       metricLabel: "Pick Rate", metricValue: "68%", trend: "+2%",   trendDir: "up",     confidence: "High",   sampleSize: "740 matches", recommendation: "Safe Pick",            reason: "ID teams favor Ling for jungle lead and objective-trade efficiency." },
        { heroName: "Chou",      heroImage: "/heroes/chou.png",       metricLabel: "Pick Rate", metricValue: "62%", trend: "Stable", trendDir: "stable", confidence: "Medium", sampleSize: "740 matches", recommendation: "Flex Support",         reason: "Chou kick displacement is essential in MPL ID's teamfight compositions." }
      ],
      highestWinRate: [
        { heroName: "Benedetta", heroImage: "/heroes/benedetta.png",  metricLabel: "Win Rate", metricValue: "61%", trend: "+6%",   trendDir: "up",     confidence: "High",   sampleSize: "740 matches", recommendation: "Anti-Poke Pick",  reason: "Immune mechanic and burst deny MPL ID's poke-heavy push strategies." },
        { heroName: "Karina",    heroImage: "/heroes/karina.png",     metricLabel: "Win Rate", metricValue: "59%", trend: "+3%",   trendDir: "up",     confidence: "High",   sampleSize: "740 matches", recommendation: "Anti-Carry",      reason: "High kill participation and execute consistency win close games." },
        { heroName: "Hayabusa",  heroImage: "/heroes/hayabusa.png",   metricLabel: "Win Rate", metricValue: "57%", trend: "Stable", trendDir: "stable", confidence: "Medium", sampleSize: "740 matches", recommendation: "Split Pressure",  reason: "ID side-lane routing maximizes Hayabusa's solo carry upside." }
      ],
      mostBanned:  { heroName: "Valentina", heroImage: "/heroes/valentina.png", metricLabel: "Ban Rate", metricValue: "84%", trend: "+9%",  trendDir: "up",     confidence: "High",   sampleSize: "740 matches", recommendation: "Ban Priority",   reason: "Valentina's ult-copy creates unsolvable draft dilemmas in MPL ID's structured play." },
      risingMeta:  { heroName: "Lylia",     heroImage: "/heroes/lylia.png",     metricLabel: "Pick ↑",  metricValue: "+19%", trend: "+19%", trendDir: "rising", confidence: "Medium", sampleSize: "740 matches", recommendation: "Watch Priority", reason: "Lylia's burst-recall cycle is gaining traction as ID teams trial new mid-lane threats." }
    },
    mpl_ph: {
      sourceLabel: "MPL PH Regular Season",
      highlight: { hero: "Claude", text: "Claude dominates gold lane picks in MPL PH — his scaling and team mobility anchor objective-focused drafts." },
      mostPicked: [
        { heroName: "Claude",   heroImage: "/heroes/claude.png",   metricLabel: "Pick Rate", metricValue: "71%", trend: "+7%",   trendDir: "up",     confidence: "High",   sampleSize: "680 matches", recommendation: "Gold Lane Core",   reason: "Late-game scaling and team-wide phase shift define MPL PH objective setups." },
        { heroName: "Beatrix",  heroImage: "/heroes/beatrix.png",  metricLabel: "Pick Rate", metricValue: "65%", trend: "+5%",   trendDir: "up",     confidence: "High",   sampleSize: "680 matches", recommendation: "Flex MM",          reason: "Multi-weapon adaptability makes Beatrix PH's most versatile marksman choice." },
        { heroName: "Chou",     heroImage: "/heroes/chou.png",     metricLabel: "Pick Rate", metricValue: "58%", trend: "Stable", trendDir: "stable", confidence: "Medium", sampleSize: "680 matches", recommendation: "Support Anchor",   reason: "PH teams rely on Chou displacement to enable Claude's aggressive positioning." }
      ],
      highestWinRate: [
        { heroName: "Karrie",   heroImage: "/heroes/karrie.png",   metricLabel: "Win Rate", metricValue: "63%", trend: "+8%",   trendDir: "up",     confidence: "High",   sampleSize: "680 matches", recommendation: "Anti-Tank",        reason: "True damage throughput dismantles MPL PH's prevalent tank-frontline metas." },
        { heroName: "Beatrix",  heroImage: "/heroes/beatrix.png",  metricLabel: "Win Rate", metricValue: "60%", trend: "+4%",   trendDir: "up",     confidence: "High",   sampleSize: "680 matches", recommendation: "Consistent Threat", reason: "Beatrix weapon versatility adapts to any lane situation in PH playstyles." },
        { heroName: "Claude",   heroImage: "/heroes/claude.png",   metricLabel: "Win Rate", metricValue: "57%", trend: "+3%",   trendDir: "up",     confidence: "Medium", sampleSize: "680 matches", recommendation: "Late-Game Carry",  reason: "Phase-shift ult turns teamfight outcomes and secures decisive Lord trades." }
      ],
      mostBanned:  { heroName: "Fanny", heroImage: "/heroes/fanny.png", metricLabel: "Ban Rate", metricValue: "89%", trend: "+5%",  trendDir: "up",     confidence: "High",   sampleSize: "680 matches", recommendation: "Ban Priority",   reason: "PH teams consistently ban Fanny to prevent jungle invades disrupting gold-lane priority." },
      risingMeta:  { heroName: "Brody", heroImage: "/heroes/brody.png", metricLabel: "Pick ↑",  metricValue: "+17%", trend: "+17%", trendDir: "rising", confidence: "Medium", sampleSize: "680 matches", recommendation: "Watch Priority", reason: "Brody's long-range poke is emerging as a late-game alternative to Claude in PH meta." }
    }
  };

  $: currentSnapshot = META_SNAPSHOT_DATA[$engine] ?? META_SNAPSHOT_DATA.community;

  $: heroImageMap = new Map(data.heroes.map((h) => [h.name.toLowerCase(), h.imageKey]));

  function resolveHeroImage(heroName: string): string {
    return heroImageMap.get(heroName.toLowerCase()) ?? "";
  }

  function trendIcon(dir: string): string {
    if (dir === "up") return "↑";
    if (dir === "down") return "↓";
    if (dir === "rising") return "🔥";
    return "→";
  }

  $: homeEngineOptions = (() => {
    const statusMap = { m7: $m7Status, mpl_id: $mplIdStatus, mpl_ph: $mplPhStatus };
    return [
      { value: "community", longLabel: "Community", selectable: true },
      ...TOURNAMENT_ENGINE_LIST.map((config) => {
        const status = statusMap[config.id];
        const tag = status ? tournamentEngineStatusTag(status) : "Loading";
        return {
          value: config.id,
          longLabel: `${config.label} (${tag})`,
          selectable: status ? (status.state === "available" || status.state === "limited") : false
        };
      })
    ];
  })();

  $: homeEngineSummary = ENGINE_HINTS[$engine] ?? ENGINE_HINTS.community;

  function handleHomeEngineChange(newEngine: string) {
    if (newEngine === $engine) return;
    if (newEngine !== "community") {
      const statusMap = { m7: $m7Status, mpl_id: $mplIdStatus, mpl_ph: $mplPhStatus };
      const status = statusMap[newEngine as keyof typeof statusMap];
      if (!status || (status.state !== "available" && status.state !== "limited")) return;
    }
    engine.set(newEngine as "community" | "m7" | "mpl_ph" | "mpl_id");
  }
</script>

<svelte:head>
  <title>Draft Arena X — MLBB Draft & Tournament Intelligence</title>
  <meta name="description" content="Analyze hero tier, win rates, counters, draft strategies, and tournament results. The complete MLBB intelligence toolkit for competitive players." />
  <link rel="preload" as="image" href="/branding/draft-bg.png" />
  <link rel="preload" as="image" href="/branding/draft-arena-title.png" />
</svelte:head>

<div class="landing">

  <!-- ── Hero ─────────────────────────────────────────────────────────────── -->
  <section class="hero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="hero-inner hero-inner--split">
      <div class="hero-content">
        <span class="hero-eyebrow">AI-Powered MLBB Intelligence</span>
        <h1 class="hero-title">
          Draft Smarter.<br />
          <span class="hero-title-accent">Win Faster.</span>
        </h1>
        <p class="hero-sub">
          Draft Arena X provides hero tier rankings, win-rate insights, counter picks,
          draft simulations, and tournament intelligence — all in one competitive analytics platform.
        </p>
        <p class="hero-platform-note">Designed for players, teams, and tournament organizers.</p>
        <div class="engine-picker">
          <p class="engine-picker-title">Choose Your Meta Source</p>
          <p class="engine-picker-sub">Start with Community data by default, or switch to MPL and M-Series sources when you want tournament-grade draft insight.</p>
          <div class="engine-picker-row">
            <label class="engine-picker-label" for="hp-engine">Data Source</label>
            <select
              id="hp-engine"
              class="engine-picker-select"
              value={$engine}
              on:change={(e) => handleHomeEngineChange((e.target as HTMLSelectElement).value)}
            >
              {#each homeEngineOptions as opt}
                <option value={opt.value} disabled={!opt.selectable}>{opt.longLabel}</option>
              {/each}
            </select>
          </div>
          <p class="engine-picker-hint">{homeEngineSummary}</p>
        </div>
        <div class="persona-cta" aria-label="Choose your path">
          <a href="/draft-master" class="persona-card persona-card--player">
            <span class="persona-label">For Players</span>
            <strong>Arena Tools</strong>
            <small>Tier, stats, counter, draft simulator</small>
          </a>
          <a href="/tournaments" class="persona-card persona-card--org">
            <span class="persona-label">For Organizers</span>
            <strong>Tournament Hub</strong>
            <small>Upcoming events, registration, bracket flow</small>
          </a>
        </div>
        <div class="hero-stats">
          <div class="hero-stat">
            <span class="hero-stat-value">{data.heroCount > 0 ? data.heroCount : "132"}+</span>
            <span class="hero-stat-label">Heroes</span>
            <span class="hero-stat-sub">Full MLBB hero pool analyzed</span>
          </div>
          <div class="hero-stat-divider" aria-hidden="true"></div>
          <div class="hero-stat">
            <span class="hero-stat-value">4</span>
            <span class="hero-stat-label">Engines</span>
            <span class="hero-stat-sub">AI models powered by regional tournament data</span>
          </div>
          <div class="hero-stat-divider" aria-hidden="true"></div>
          <div class="hero-stat">
            <span class="hero-stat-value"><span class="live-pulse-dot" aria-hidden="true"></span>Live</span>
            <span class="hero-stat-label">MPL Data</span>
            <span class="hero-stat-sub">Updated recently</span>
          </div>
          <div class="hero-stat-divider" aria-hidden="true"></div>
          <div class="hero-stat">
            <!-- TODO: wire to data.patchVersion when API provides it -->
            <span class="hero-stat-value">v1.8</span>
            <span class="hero-stat-label">Patch Info</span>
            <span class="hero-stat-sub">Latest patch tracked</span>
          </div>
        </div>
      </div>
      <div class="hero-preview" aria-hidden="true">
        <div class="hero-preview-frame">
          <img
            src="/branding/draft-bg.png"
            alt="Draft Arena X Draft Room preview"
            class="hero-preview-img"
            loading="eager"
            decoding="async"
            fetchpriority="high"
            width="1280"
            height="720"
          />
          <div class="hero-preview-overlay">
            <img
              src="/branding/draft-arena-title.png"
              alt=""
              class="hero-preview-logo"
              loading="eager"
              decoding="async"
              width="280"
              height="45"
            />
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Trust Metrics ─────────────────────────────────────────────────── -->
  <section class="section trust-section">
    <div class="section-inner">
      <div class="trust-social-proof">
        <p class="trust-proof-title">We've already hosted competitive events and crowned champions.</p>
        <p class="trust-proof-sub">Teams have battled. Winners have risen. Are you next?</p>
      </div>
      <div class="trust-grid">
        <div class="trust-item">
          <span class="trust-value">{data.stats.totalEvents}</span>
          <span class="trust-label">Tracked Events</span>
        </div>
        <div class="trust-item">
          <span class="trust-value">{data.stats.liveEvents}</span>
          <span class="trust-label">Live Right Now</span>
        </div>
        <div class="trust-item">
          <span class="trust-value">{data.stats.upcomingEvents}</span>
          <span class="trust-label">Upcoming Queue</span>
        </div>
        <div class="trust-item">
          <span class="trust-value">{data.stats.totalTeamSlots}</span>
          <span class="trust-label">Team Slots Published</span>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Meta Snapshot ──────────────────────────────────────────────────── -->
  <section class="section meta-snapshot-section">
    <div class="section-inner">
      <div class="section-header">
        <span class="section-eyebrow">Current Patch</span>
        <h2 class="section-title">Meta Snapshot</h2>
        <p class="section-sub">Based on {currentSnapshot.sourceLabel} · Patch v1.8 · Updated recently</p>
      </div>

      <!-- Meta Highlight Strip -->
      <div class="meta-highlight">
        <span class="meta-highlight-badge">Rising Signal</span>
        <p class="meta-highlight-text">
          <strong>{currentSnapshot.highlight.hero}</strong> — {currentSnapshot.highlight.text}
        </p>
      </div>

      <!-- 4 Cards Grid -->
      <div class="meta-snap-grid">

        <!-- Card 1: Top 3 Most Picked -->
        <div class="meta-snap-card">
          <img src={currentSnapshot.mostPicked[0].heroImage} alt="" class="meta-snap-figure" aria-hidden="true" on:error={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div class="meta-snap-card-head">
            <span class="meta-snap-card-label">Top 3 Most Picked</span>
            <span class="meta-snap-confidence meta-snap-confidence--{currentSnapshot.mostPicked[0].confidence.toLowerCase()}">{currentSnapshot.mostPicked[0].confidence} Confidence</span>
          </div>
          <ol class="meta-snap-list">
            {#each currentSnapshot.mostPicked as hero, i}
              <li class="meta-snap-row">
                <span class="meta-snap-rank">#{i + 1}</span>
                <img
                  src={hero.heroImage}
                  alt={hero.heroName}
                  class="meta-snap-avatar"
                  on:error={(e) => { if (e.target) (e.target as HTMLImageElement).src = '/branding/draft-arena-mark.png'; }}
                />
                <span class="meta-snap-name">{hero.heroName}</span>
                <span class="meta-snap-metric-wrap">
                  <span class="meta-snap-metric">{hero.metricValue}</span>
                  <span class="meta-snap-trend meta-snap-trend--{hero.trendDir}">{trendIcon(hero.trendDir)} {hero.trend}</span>
                </span>
              </li>
            {/each}
          </ol>
          <div class="meta-snap-card-footer">
            <span class="meta-snap-rec">{currentSnapshot.mostPicked[0].recommendation}</span>
            <p class="meta-snap-reason">{currentSnapshot.mostPicked[0].reason}</p>
          </div>
        </div>

        <!-- Card 2: Top 3 Highest Win Rate -->
        <div class="meta-snap-card">
          <img src={currentSnapshot.highestWinRate[0].heroImage} alt="" class="meta-snap-figure" aria-hidden="true" on:error={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div class="meta-snap-card-head">
            <span class="meta-snap-card-label">Top 3 Win Rate</span>
            <span class="meta-snap-confidence meta-snap-confidence--{currentSnapshot.highestWinRate[0].confidence.toLowerCase()}">{currentSnapshot.highestWinRate[0].confidence} Confidence</span>
          </div>
          <ol class="meta-snap-list">
            {#each currentSnapshot.highestWinRate as hero, i}
              <li class="meta-snap-row">
                <span class="meta-snap-rank">#{i + 1}</span>
                <img
                  src={hero.heroImage}
                  alt={hero.heroName}
                  class="meta-snap-avatar"
                  on:error={(e) => { if (e.target) (e.target as HTMLImageElement).src = '/branding/draft-arena-mark.png'; }}
                />
                <span class="meta-snap-name">{hero.heroName}</span>
                <span class="meta-snap-metric-wrap">
                  <span class="meta-snap-metric">{hero.metricValue}</span>
                  <span class="meta-snap-trend meta-snap-trend--{hero.trendDir}">{trendIcon(hero.trendDir)} {hero.trend}</span>
                </span>
              </li>
            {/each}
          </ol>
          <div class="meta-snap-card-footer">
            <span class="meta-snap-rec">{currentSnapshot.highestWinRate[0].recommendation}</span>
            <p class="meta-snap-reason">{currentSnapshot.highestWinRate[0].reason}</p>
          </div>
        </div>

        <!-- Card 3: Most Banned -->
        <div class="meta-snap-card">
          <div class="meta-snap-card-head">
            <span class="meta-snap-card-label">Most Banned</span>
            <span class="meta-snap-confidence meta-snap-confidence--{currentSnapshot.mostBanned.confidence.toLowerCase()}">{currentSnapshot.mostBanned.confidence} Confidence</span>
          </div>
          <div class="meta-snap-solo">
            <img
              src={currentSnapshot.mostBanned.heroImage}
              alt="{currentSnapshot.mostBanned.heroName} hero artwork"
              class="meta-snap-featured-art"
              on:error={(e) => { if (e.target) (e.target as HTMLImageElement).src = '/branding/draft-arena-mark.png'; }}
            />
            <div class="meta-snap-solo-info">
              <span class="meta-snap-name">{currentSnapshot.mostBanned.heroName}</span>
              <span class="meta-snap-metric">{currentSnapshot.mostBanned.metricLabel} {currentSnapshot.mostBanned.metricValue}</span>
              <span class="meta-snap-trend meta-snap-trend--up">↑ {currentSnapshot.mostBanned.trend}</span>
            </div>
          </div>
          <div class="meta-snap-card-footer">
            <span class="meta-snap-rec">{currentSnapshot.mostBanned.recommendation}</span>
            <p class="meta-snap-reason">{currentSnapshot.mostBanned.reason}</p>
          </div>
        </div>

        <!-- Card 4: Rising Meta -->
        <div class="meta-snap-card meta-snap-card--rising">
          <div class="meta-snap-card-head">
            <span class="meta-snap-card-label">Rising Meta</span>
            <span class="meta-snap-confidence meta-snap-confidence--{currentSnapshot.risingMeta.confidence.toLowerCase()}">{currentSnapshot.risingMeta.confidence} Confidence</span>
          </div>
          <div class="meta-snap-solo">
            <img
              src={currentSnapshot.risingMeta.heroImage}
              alt="{currentSnapshot.risingMeta.heroName} hero artwork"
              class="meta-snap-featured-art"
              on:error={(e) => { if (e.target) (e.target as HTMLImageElement).src = '/branding/draft-arena-mark.png'; }}
            />
            <div class="meta-snap-solo-info">
              <span class="meta-snap-name">{currentSnapshot.risingMeta.heroName}</span>
              <span class="meta-snap-metric">{currentSnapshot.risingMeta.metricLabel} {currentSnapshot.risingMeta.metricValue}</span>
              <span class="meta-snap-trend meta-snap-trend--rising">🔥 {currentSnapshot.risingMeta.trend}</span>
            </div>
          </div>
          <div class="meta-snap-card-footer">
            <span class="meta-snap-rec">{currentSnapshot.risingMeta.recommendation}</span>
            <p class="meta-snap-reason">{currentSnapshot.risingMeta.reason}</p>
          </div>
        </div>

      </div>
      <p class="meta-snap-disclaimer">Meta signals are indicative, not definitive. Sample: {currentSnapshot.mostPicked[0].sampleSize}.</p>
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
          <a
            href={tool.href}
            class="tool-card tool-card--{tool.accent}"
          >
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
      <!-- Diamond teaser strip -->
      <div class="diamond-strip">
        <span class="diamond-strip-icon">💎</span>
        <div class="diamond-strip-text">
          <strong>Diamond Marketplace</strong>
          <span>Buy MLBB diamonds · Fast delivery · Secure payment</span>
        </div>
        <span class="diamond-strip-badge">Coming Soon</span>
      </div>
    </div>
  </section>

  <!-- ── Tournament Intelligence ────────────────────────────────────────── -->
  <section class="section section--alt tourney-section">
    <div class="section-inner">
      <div class="section-header">
        <span class="section-eyebrow">Tournament Data</span>
        <h2 class="section-title">Tournament Intelligence Engine</h2>
        <p class="section-sub">Pro-level tournament analytics for draft decisions, meta tracking, and match outcome analysis.</p>
        <p class="engine-trust-note">
          Built from match results, draft patterns, hero priority, and regional meta signals.
        </p>
      </div>
      <div class="intel-grid">
        {#each tournamentIntelCards as card}
          <article class="intel-card">
            <div class="intel-card-head">
              <span class={`intel-status ${intelStatusClass(card.status)}`}>{card.status}</span>
              <span class={`intel-confidence ${intelConfidenceClass(card.confidence)}`}>{card.confidence}</span>
            </div>
            <h3 class="intel-title">{card.title}</h3>
            <p class="intel-desc">{card.description}</p>
            <p class="intel-line"><strong>Data source:</strong> {card.dataSource}</p>
            <p class="intel-line"><strong>Readiness:</strong> {card.sample}</p>
            <div class="intel-insight-block">
              <span class="intel-block-label">Top Insight</span>
              <p>{card.topInsight}</p>
            </div>
            <div class="intel-insight-block">
              <span class="intel-block-label">Why it matters</span>
              <p>{card.whyItMatters}</p>
            </div>
            <button class="btn btn--secondary btn--sm intel-cta-btn" type="button" on:click={() => openIntelAction(card)}>
              {card.ctaLabel}
            </button>
          </article>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Upcoming Tournaments ───────────────────────────────────────────── -->
  <section class="section upcoming-section">
    <div class="section-inner">
      <div class="section-header">
        <span class="section-eyebrow">Events</span>
        <h2 class="section-title">Upcoming Tournaments</h2>
        <p class="section-sub">Official leagues and community events that are open for registration.</p>
      </div>
      <div class="upcoming-grid">
        {#if data.events.length > 0}
          {#each data.events as t}
            <div class="upcoming-card" class:upcoming-card--live={t.status === "ongoing"}>
              <div class="upcoming-card-top">
                <span class="upcoming-status upcoming-status--{t.status === 'ongoing' ? 'live' : 'upcoming'}">
                  {eventStatusLabel(t.status)}
                </span>
                <span class="upcoming-teams">👥 {quotaLabel(t.totalTeams)}</span>
              </div>
              <h3 class="upcoming-name">{t.name}</h3>
              <div class="upcoming-meta">
                <span>📅 {formatEventDate(t.eventDate)}</span>
                <span>🏷 {t.format}</span>
              </div>
              <div class="upcoming-deadline-row">
                <span class="upcoming-deadline-badge">⏳ {registrationCountdown(t)}</span>
                <span class="upcoming-deadline-date">
                  Deadline: {formatDeadline(t.registrationDeadline ?? t.eventDate)}
                </span>
              </div>
              <div class="upcoming-actions">
                {#if t.status !== "ongoing" && t.status !== "completed"}
                  {#if waRegisterOpen[t.id]}
                    <div class="wa-register-form">
                      <input
                        class="wa-input"
                        type="text"
                        placeholder="Nama Tim kamu"
                        bind:value={waTeamNames[t.id]}
                        aria-label="Nama Tim"
                        maxlength="60"
                      />
                      <button
                        class="btn btn--primary btn--sm"
                        type="button"
                        disabled={!waTeamNames[t.id]?.trim()}
                        on:click={() => openWaRegister(t, waTeamNames[t.id] ?? "")}
                      >💬 Kirim via WhatsApp</button>
                      <button
                        class="btn btn--ghost btn--sm"
                        type="button"
                        on:click={() => toggleWaRegister(t.id)}
                      >Batal</button>
                      {#if waRegisterErrors[t.id]}
                        <p class="wa-error">{waRegisterErrors[t.id]}</p>
                      {/if}
                    </div>
                  {:else}
                    <button
                      class="btn btn--primary btn--sm"
                      type="button"
                      on:click={() => toggleWaRegister(t.id)}
                    >Register Now</button>
                  {/if}
                {/if}
                <a href={eventDetailHref(t)} class="btn btn--ghost btn--sm">View Details</a>
              </div>
            </div>
          {/each}
        {:else}
          <div class="upcoming-empty">
            <img src="/branding/tournaments-menu.png" alt="Tournaments" class="upcoming-empty-icon" />
            <p class="upcoming-empty-title">No tournaments right now</p>
            <p class="upcoming-empty-desc">New community events are being prepared. You can create one, join the next queue, or contact admin for registration updates.</p>
            <p class="upcoming-empty-proof">14 tracked events · 208 team slots published</p>
            <div class="upcoming-empty-actions">
              <a href="/tournaments" class="btn btn--primary btn--sm">Create an Event</a>
              <a href="#contact" class="btn btn--ghost btn--sm">Contact Admin</a>
            </div>
          </div>
        {/if}
      </div>
      <div class="section-cta-row">
        <a href="/tournaments" class="btn btn--ghost">See All Tournaments →</a>
      </div>
    </div>
  </section>

  <!-- ── WhatsApp Contact ───────────────────────────────────────────────── -->
  <section id="contact" class="section section--alt subscribe-section">
    <div class="section-inner section-inner--narrow">
      <span class="section-eyebrow">Registration & Information</span>
      <h2 class="section-title">Talk to Tournament Admin</h2>
      <p class="section-sub">
        Register your team, ask tournament questions, or get the latest Draft Arena X updates directly on WhatsApp.
      </p>
      <ul class="wa-trust-points">
        <li>Already 208 team slots published</li>
        <li>Fast response under 1 hour</li>
        <li>Direct support for event registration</li>
      </ul>
      <div class="wa-contact-form">
        <input
          class="subscribe-input"
          type="text"
          placeholder="Your team name or username"
          bind:value={waContactName}
          on:input={() => { waContactError = ""; }}
          maxlength="60"
          aria-label="Team name or username"
        />
        <button
          class="btn btn--primary wa-contact-btn"
          type="button"
          on:click={() => openWaContact(waContactName)}
          disabled={!waContactName.trim()}
        >
          💬 Chat Admin on WhatsApp
        </button>
      </div>
      {#if waContactError}
        <p class="wa-error">{waContactError}</p>
      {/if}
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
    padding: 48px 24px;
    content-visibility: auto;
    contain-intrinsic-size: 700px;
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
    min-height: 44px;
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
    max-width: 1100px;
    margin: 0 auto;
  }

  .hero-inner--split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    align-items: center;
    text-align: left;
  }

  .hero-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .hero-preview {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .hero-preview-frame {
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid rgba(0, 229, 255, 0.22);
    box-shadow: 0 0 40px rgba(0, 123, 255, 0.18), 0 0 80px rgba(0, 229, 255, 0.06);
    width: 100%;
    max-width: 440px;
  }

  .hero-preview-img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: cover;
    border-radius: 18px;
  }

  .hero-preview-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    padding: 16px;
    background: linear-gradient(to top, rgba(2, 7, 18, 0.7) 0%, transparent 50%);
  }

  .hero-preview-logo {
    height: 28px;
    width: auto;
    opacity: 0.85;
    filter: drop-shadow(0 0 6px rgba(0, 229, 255, 0.5));
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
    margin: 0 0 8px;
  }

  .hero-platform-note {
    font-size: 0.76rem;
    color: var(--muted);
    opacity: 0.8;
    margin: 0 0 16px;
    line-height: 1.45;
  }

  .engine-picker {
    background: rgba(6, 23, 46, 0.55);
    border: 1px solid rgba(0, 229, 255, 0.14);
    border-radius: 14px;
    padding: 14px 16px;
    margin: 0 0 24px;
    max-width: 480px;
  }

  .engine-picker-title {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 0 0 4px;
  }

  .engine-picker-sub {
    font-size: 0.72rem;
    color: var(--muted);
    margin: 0 0 12px;
    line-height: 1.5;
  }

  .engine-picker-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .engine-picker-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }

  .engine-picker-select {
    flex: 1;
    background: rgba(2, 7, 18, 0.7);
    border: 1px solid rgba(0, 229, 255, 0.22);
    color: var(--text);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 140ms ease;
    min-width: 0;
  }

  .engine-picker-select:focus {
    outline: none;
    border-color: rgba(0, 229, 255, 0.6);
  }

  .engine-picker-hint {
    font-size: 0.72rem;
    color: rgba(0, 229, 255, 0.65);
    margin: 0;
    line-height: 1.4;
  }

  /* ── Live pulse dot ─────────────────────────────────────────────────── */
  .live-pulse-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #3dffa0;
    margin-right: 5px;
    vertical-align: middle;
    position: relative;
    top: -1px;
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(61, 255, 160, 0.45); }
    50% { opacity: 0.7; box-shadow: 0 0 0 5px rgba(61, 255, 160, 0); }
  }

  /* ── Meta Snapshot section ──────────────────────────────────────────── */

  .meta-highlight {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: rgba(251, 191, 36, 0.07);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 16px;
  }

  .meta-highlight-badge {
    flex-shrink: 0;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.25);
    border-radius: 4px;
    padding: 2px 6px;
    margin-top: 2px;
  }

  .meta-highlight-text {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.8);
    margin: 0;
    line-height: 1.45;
  }

  .meta-highlight-text strong {
    color: #fbbf24;
  }

  .meta-snap-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 12px;
  }

  .meta-snap-card {
    background: rgba(6, 23, 46, 0.55);
    border: 1px solid rgba(0, 229, 255, 0.12);
    border-radius: 12px;
    padding: 14px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;
    overflow: hidden;
  }

  .meta-snap-card--rising {
    border-color: rgba(52, 211, 153, 0.22);
  }

  .meta-snap-figure {
    position: absolute;
    right: -6px;
    bottom: 0;
    height: 130px;
    width: auto;
    object-fit: contain;
    opacity: 0.16;
    pointer-events: none;
    user-select: none;
  }

  .meta-snap-featured-art {
    height: 90px;
    width: auto;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: 8px;
    background: rgba(6, 23, 46, 0.4);
    border: 1px solid rgba(0, 229, 255, 0.12);
  }

  .meta-snap-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 10px;
  }

  .meta-snap-card-label {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-cyan);
  }

  .meta-snap-confidence {
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 4px;
    padding: 2px 5px;
  }

  .meta-snap-confidence--high {
    color: #3dffa0;
    background: rgba(61, 255, 160, 0.1);
    border: 1px solid rgba(61, 255, 160, 0.2);
  }

  .meta-snap-confidence--medium {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.18);
  }

  .meta-snap-confidence--low {
    color: #f87171;
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.18);
  }

  .meta-snap-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .meta-snap-row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .meta-snap-rank {
    font-size: 0.58rem;
    font-weight: 800;
    color: var(--muted);
    width: 16px;
    flex-shrink: 0;
    text-align: right;
  }

  .meta-snap-avatar {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    object-fit: cover;
    border: 1px solid rgba(0, 229, 255, 0.15);
    flex-shrink: 0;
    background: rgba(6, 23, 46, 0.8);
  }

  .meta-snap-avatar--lg {
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }

  .meta-snap-name {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta-snap-metric-wrap {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
    gap: 1px;
  }

  .meta-snap-metric {
    font-size: 0.74rem;
    font-weight: 800;
    color: var(--text);
    line-height: 1;
  }

  .meta-snap-trend {
    font-size: 0.64rem;
    font-weight: 700;
    line-height: 1;
  }

  .meta-snap-trend--up      { color: #3dffa0; }
  .meta-snap-trend--down    { color: #f87171; }
  .meta-snap-trend--rising  { color: #fbbf24; }
  .meta-snap-trend--stable  { color: var(--muted); }

  .meta-snap-solo {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    padding: 6px 0 4px;
  }

  .meta-snap-solo-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .meta-snap-card-footer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid rgba(0, 229, 255, 0.08);
  }

  .meta-snap-rec {
    display: block;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-cyan);
    margin-bottom: 3px;
  }

  .meta-snap-reason {
    font-size: 0.69rem;
    color: var(--muted);
    margin: 0;
    line-height: 1.4;
  }

  .meta-snap-disclaimer {
    font-size: 0.68rem;
    color: var(--muted);
    opacity: 0.7;
    margin: 0;
    text-align: center;
  }

  .persona-cta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    width: 100%;
    max-width: 620px;
    margin-bottom: 20px;
  }

  .persona-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-decoration: none;
    border: 1px solid rgba(0, 229, 255, 0.2);
    border-radius: 14px;
    padding: 20px 18px;
    background: rgba(6, 23, 46, 0.45);
    transition: border-color 160ms ease, transform 160ms ease, background 160ms ease;
  }

  .persona-card strong {
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.2;
  }

  .persona-card small {
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.35;
  }

  .persona-label {
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
  }

  .persona-card--player .persona-label { color: #00e5ff; }
  .persona-card--org .persona-label { color: #34d399; }

  .persona-card--player:hover {
    border-color: rgba(0, 229, 255, 0.45);
    background: rgba(0, 71, 199, 0.18);
    transform: translateY(-1px);
  }

  .persona-card--org:hover {
    border-color: rgba(52, 211, 153, 0.45);
    background: rgba(10, 80, 50, 0.2);
    transform: translateY(-1px);
  }

  .hero-stats {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
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

  .hero-stat-sub {
    font-size: 0.58rem;
    color: var(--muted);
    opacity: 0.72;
    text-align: center;
    line-height: 1.3;
    max-width: 96px;
  }

  .hero-stat-divider {
    width: 1px;
    height: 28px;
    background: rgba(0, 229, 255, 0.2);
  }

  .trust-section {
    padding-top: 16px;
    padding-bottom: 28px;
  }

  .meta-snapshot-section {
    padding-top: 36px;
    padding-bottom: 36px;
  }

  .meta-snapshot-section .section-header {
    margin-bottom: 20px;
  }

  .trust-social-proof {
    text-align: center;
    margin-bottom: 14px;
  }

  .trust-proof-title {
    font-size: clamp(0.88rem, 1.8vw, 1rem);
    font-weight: 600;
    color: var(--text);
    margin: 0 0 4px;
    line-height: 1.4;
  }

  .trust-proof-sub {
    font-size: 0.78rem;
    color: var(--muted);
    margin: 0;
    font-style: italic;
  }

  .trust-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .trust-item {
    border: 1px solid rgba(0, 229, 255, 0.16);
    background: rgba(6, 23, 46, 0.42);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 72px;
  }

  .trust-value {
    color: var(--accent-cyan);
    font-size: 1.05rem;
    line-height: 1;
    font-weight: 800;
  }

  .trust-label {
    color: var(--muted);
    font-size: 0.69rem;
    line-height: 1.3;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  /* ── Tools Grid ─────────────────────────────────────────────────────── */
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    align-items: stretch;
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
    min-height: 220px;
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

  /* Featured tool card (Draft Room) */
  /* Diamond strip */
  .diamond-strip {
    margin-top: 24px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 20px;
    border-radius: 14px;
    border: 1px dashed rgba(251, 191, 36, 0.22);
    background: rgba(80, 50, 0, 0.1);
    color: var(--text);
  }

  .diamond-strip-icon { font-size: 1.4rem; flex-shrink: 0; }

  .diamond-strip-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .diamond-strip-text strong { font-size: 0.88rem; color: #fbbf24; font-weight: 700; }
  .diamond-strip-text span  { font-size: 0.75rem; color: var(--muted); }

  .diamond-strip-badge {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 7px;
    background: rgba(251, 191, 36, 0.12);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.28);
    white-space: nowrap;
  }


  .engine-trust-note {
    margin: 10px 0 0;
    font-size: 0.74rem;
    color: #97b8d1;
    line-height: 1.45;
    max-width: 760px;
  }

  .intel-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .intel-card {
    padding: 12px;
    border-radius: 12px;
    border: 1px solid rgba(0, 229, 255, 0.14);
    background:
      linear-gradient(180deg, rgba(7, 20, 41, 0.84), rgba(4, 12, 24, 0.94));
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
  }

  .intel-card:hover {
    border-color: rgba(0, 229, 255, 0.38);
    transform: translateY(-2px);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 229, 255, 0.08);
  }

  .intel-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .intel-status,
  .intel-confidence {
    font-size: 0.56rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 7px;
    border-radius: 999px;
    border: 1px solid transparent;
  }

  .intel-status.is-live {
    color: #3dffa0;
    background: rgba(0, 229, 80, 0.12);
    border-color: rgba(0, 229, 80, 0.3);
  }

  .intel-status.is-beta {
    color: #66c9ff;
    background: rgba(0, 123, 255, 0.16);
    border-color: rgba(102, 201, 255, 0.32);
  }

  .intel-status.is-experimental {
    color: #c084fc;
    background: rgba(168, 85, 247, 0.16);
    border-color: rgba(192, 132, 252, 0.32);
  }

  .intel-status.is-coming {
    color: #ffcc44;
    background: rgba(255, 180, 0, 0.12);
    border-color: rgba(255, 180, 0, 0.28);
  }

  .intel-confidence.is-high {
    color: #9ff0ff;
    background: rgba(0, 229, 255, 0.1);
    border-color: rgba(0, 229, 255, 0.3);
  }

  .intel-confidence.is-medium {
    color: #9bc6ff;
    background: rgba(96, 165, 250, 0.12);
    border-color: rgba(96, 165, 250, 0.28);
  }

  .intel-confidence.is-experimental {
    color: #d8b4fe;
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(192, 132, 252, 0.26);
  }

  .intel-confidence.is-roadmap {
    color: #ffdf85;
    background: rgba(251, 191, 36, 0.12);
    border-color: rgba(251, 191, 36, 0.24);
  }

  .intel-title {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.25;
    font-weight: 800;
  }

  .intel-desc {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.5;
    color: #a8c2d6;
  }

  .intel-line {
    margin: 0;
    font-size: 0.68rem;
    line-height: 1.45;
    color: #8fb0c7;
  }

  .intel-line strong {
    color: #d3ebff;
    font-weight: 700;
  }

  .intel-insight-block {
    border: 1px solid rgba(0, 229, 255, 0.14);
    background: rgba(2, 9, 20, 0.62);
    border-radius: 9px;
    padding: 8px;
    display: grid;
    gap: 4px;
  }

  .intel-block-label {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #73ceee;
  }

  .intel-insight-block p {
    margin: 0;
    color: #c8d9e6;
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .intel-cta-btn {
    margin-top: auto;
    width: 100%;
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

  .upcoming-deadline-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .upcoming-deadline-badge {
    font-size: 0.68rem;
    font-weight: 700;
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 999px;
    padding: 4px 8px;
  }

  .upcoming-deadline-date {
    font-size: 0.67rem;
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

  .wa-trust-points {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
  }

  .wa-trust-points li {
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
    padding-left: 16px;
    position: relative;
  }

  .wa-trust-points li::before {
    content: "✓";
    position: absolute;
    left: 0;
    color: #3dffa0;
    font-weight: 700;
  }

  .wa-contact-form {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
    margin-top: 8px;
  }

  .wa-contact-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .wa-register-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin-top: 6px;
  }

  .wa-input {
    padding: 9px 14px;
    border-radius: 10px;
    border: 1px solid rgba(0, 229, 255, 0.3);
    background: rgba(6, 23, 46, 0.8);
    color: var(--text);
    font-size: 0.82rem;
    width: 100%;
    transition: border-color 160ms;
  }

  .wa-input:focus {
    outline: none;
    border-color: rgba(0, 229, 255, 0.6);
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

  .wa-error {
    margin: 0;
    font-size: 0.75rem;
    color: #ff8a8a;
    text-align: left;
    width: 100%;
  }

  /* ── Tool card accent variants ─────────────────────────────────────── */
  .tool-card--cyan:hover  { border-color: rgba(0, 229, 255, 0.5);  box-shadow: 0 8px 28px rgba(0,0,0,0.3), 0 0 16px rgba(0,229,255,0.12); }
  .tool-card--blue:hover  { border-color: rgba(0, 123, 255, 0.5);  box-shadow: 0 8px 28px rgba(0,0,0,0.3), 0 0 16px rgba(0,123,255,0.14); background: rgba(0,50,180,0.18); }
  .tool-card--purple:hover{ border-color: rgba(168, 85, 247, 0.5); box-shadow: 0 8px 28px rgba(0,0,0,0.3), 0 0 16px rgba(168,85,247,0.14); background: rgba(80,20,160,0.18); }
  .tool-card--gold:hover  { border-color: rgba(251, 191, 36, 0.5); box-shadow: 0 8px 28px rgba(0,0,0,0.3), 0 0 16px rgba(251,191,36,0.12); background: rgba(120,80,0,0.18); }
  .tool-card--green:hover { border-color: rgba(52, 211, 153, 0.5); box-shadow: 0 8px 28px rgba(0,0,0,0.3), 0 0 16px rgba(52,211,153,0.12); background: rgba(10,80,50,0.18); }

  .tool-card--cyan  .tool-cta { color: #00e5ff; }
  .tool-card--blue  .tool-cta { color: #60a5fa; }
  .tool-card--purple .tool-cta{ color: #c084fc; }
  .tool-card--gold  .tool-cta { color: #fbbf24; }
  .tool-card--green .tool-cta { color: #34d399; }

  .tool-card--cyan  .tool-tag { color: #00e5ff; background: rgba(0,229,255,0.08); border-color: rgba(0,229,255,0.2); }
  .tool-card--blue  .tool-tag { color: #60a5fa; background: rgba(96,165,250,0.1); border-color: rgba(96,165,250,0.22); }
  .tool-card--purple .tool-tag{ color: #c084fc; background: rgba(192,132,252,0.1); border-color: rgba(192,132,252,0.22); }
  .tool-card--gold  .tool-tag { color: #fbbf24; background: rgba(251,191,36,0.1); border-color: rgba(251,191,36,0.22); }
  .tool-card--green .tool-tag { color: #34d399; background: rgba(52,211,153,0.1); border-color: rgba(52,211,153,0.22); }

  /* ── Intel card actions ─────────────────────────────────────────────── */
  /* ── Upcoming: teams count + empty state ────────────────────────────── */
  .upcoming-teams {
    font-size: 0.7rem;
    color: var(--muted);
    font-weight: 600;
  }

  .upcoming-empty {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 20px;
    border-radius: 14px;
    border: 1px dashed rgba(0, 229, 255, 0.15);
    color: var(--muted);
    font-size: 0.88rem;
    text-align: center;
  }

  .upcoming-empty-icon {
    width: 32px;
    height: auto;
    object-fit: contain;
    opacity: 0.75;
  }

  .upcoming-empty-title {
    font-size: 0.96rem;
    font-weight: 800;
    color: var(--text);
    margin: 0;
  }

  .upcoming-empty-desc {
    font-size: 0.82rem;
    color: var(--muted);
    margin: 0;
    max-width: 380px;
    line-height: 1.55;
  }

  .upcoming-empty-proof {
    font-size: 0.68rem;
    color: rgba(0, 229, 255, 0.5);
    margin: 0;
    letter-spacing: 0.04em;
  }

  .upcoming-empty-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .upcoming-empty span { font-size: 2rem; }

  @media (max-width: 640px) {
    .section {
      padding: 32px 16px;
    }

    .hero {
      padding: 60px 20px 52px;
      text-align: center;
    }

    .hero-inner--split {
      grid-template-columns: 1fr;
    }

    .hero-preview {
      display: none;
    }

    .hero-content {
      align-items: center;
    }

    .persona-cta {
      grid-template-columns: 1fr;
      max-width: 360px;
    }

    .persona-card {
      padding: 16px 14px;
    }

    .engine-picker {
      max-width: 100%;
      margin: 0 0 16px;
    }

    .engine-picker-row {
      flex-direction: column;
      align-items: stretch;
      gap: 4px;
    }

    .engine-picker-select {
      width: 100%;
    }

    .hero-stats {
      padding: 10px 16px;
      gap: 12px;
    }

    .hero-stat-divider {
      display: none;
    }

    .trust-grid {
      grid-template-columns: 1fr 1fr;
    }

    .meta-snap-grid {
      grid-template-columns: 1fr 1fr;
    }

    .meta-highlight {
      flex-direction: column;
      gap: 6px;
    }

    .meta-snap-avatar--lg {
      width: 36px;
      height: 36px;
    }

    .meta-snap-figure {
      height: 88px;
      opacity: 0.12;
    }

    .meta-snap-featured-art {
      height: 72px;
    }

    .tools-grid {
      grid-template-columns: 1fr 1fr;
    }

    .intel-grid { grid-template-columns: 1fr 1fr; }

    .upcoming-grid {
      grid-template-columns: 1fr;
    }

    .upcoming-actions {
      width: 100%;
    }

    .upcoming-actions .btn {
      width: 100%;
    }

    .wa-contact-form {
      flex-direction: column;
      align-items: stretch;
    }

    .wa-contact-btn {
      width: 100%;
    }

    .subscribe-input {
      max-width: 100%;
    }
  }

  @media (max-width: 400px) {
    .tools-grid {
      grid-template-columns: 1fr;
    }

    .intel-grid { grid-template-columns: 1fr; }

    .trust-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

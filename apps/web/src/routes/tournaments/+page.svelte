<script lang="ts">
  import { browser } from "$app/environment";
  import { goto, preloadData } from "$app/navigation";

  export let data: {
    events: Array<{
      id: number;
      slug?: string;
      code: string;
      name: string;
      format: string;
      eventMode?: string;
      playoffFormat?: string;
      regularSeasonFormat?: string;
      totalTeams: number;
      totalRounds: number;
      eventDate: string;
      status: string;
      createdByTelegramUserId: string;
    }>;
  };

  let searchQuery = "";
  let statusFilter = "all";
  let modeFilter = "all";
  let openingEventId: number | null = null;
  const prefetchedTournamentUrls = new Set<string>();

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(date);
  }

  function statusTone(status: string) {
    if (status === "ongoing") return "is-ongoing";
    if (status === "completed") return "is-completed";
    return "is-default";
  }

  function formatTournamentFormat(value: string) {
    if (value === "regular_season") return "Regular Season";
    if (value === "double_round_robin") return "Double Round Robin";
    if (value === "round_robin") return "Round Robin";
    if (value === "five_round") return "5 Round";
    if (value === "custom_round") return "Custom Round";
    if (value === "playoffs") return "Playoffs";
    if (value === "single_elimination") return "Single Elimination";
    if (value === "double_elimination") return "Double Elimination";
    if (value === "swiss_stage") return "Swiss Stage";
    return value.replace(/_/g, " ");
  }

  function formatEventLabel(event: { eventMode?: string; playoffFormat?: string; regularSeasonFormat?: string; format: string }) {
    const mode = event.eventMode ?? event.format;
    if (mode === "playoffs" && event.playoffFormat) {
      return `Playoffs ${formatTournamentFormat(event.playoffFormat)}`;
    }
    if (mode === "regular_season" && event.regularSeasonFormat) {
      return `Regular Season ${formatTournamentFormat(event.regularSeasonFormat)}`;
    }
    return formatTournamentFormat(mode);
  }

  function formatShortLabel(event: { eventMode?: string; playoffFormat?: string; regularSeasonFormat?: string; format: string }) {
    const mode = event.eventMode ?? event.format;
    if (mode === "playoffs") {
      if (event.playoffFormat === "single_elimination") return "SE";
      if (event.playoffFormat === "double_elimination") return "DE";
      return "PO";
    }
    if (mode === "regular_season") {
      if (event.regularSeasonFormat === "double_round_robin") return "DRR";
      if (event.regularSeasonFormat === "round_robin") return "RR";
      if (event.regularSeasonFormat === "five_round") return "5R";
      if (event.regularSeasonFormat === "custom_round") return "CR";
      if (event.regularSeasonFormat === "swiss_stage") return "SW";
      return "RS";
    }
    if (mode === "swiss_stage") return "SW";
    if (mode === "single_elimination") return "SE";
    if (mode === "double_elimination") return "DE";
    if (mode === "round_robin") return "RR";
    if (mode === "double_round_robin") return "DRR";
    return mode.replace(/_/g, " ").slice(0, 3).toUpperCase();
  }

  $: normalizedQuery = searchQuery.trim().toLowerCase();
  $: filteredEvents = data.events.filter((event) => {
    const matchesStatus = statusFilter === "all" || event.status === statusFilter;
    const matchesMode = modeFilter === "all" || (event.eventMode ?? event.format) === modeFilter;
    const haystack = `${event.name} ${event.code}`.toLowerCase();
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    return matchesStatus && matchesMode && matchesQuery;
  });
  $: groupedEvents = filteredEvents.reduce<
    Array<{
      managedBy: string;
      events: typeof filteredEvents;
    }>
  >((groups, event) => {
    const existingGroup = groups.find((group) => group.managedBy === event.createdByTelegramUserId);

    if (existingGroup) {
      existingGroup.events.push(event);
      return groups;
    }

    groups.push({
      managedBy: event.createdByTelegramUserId,
      events: [event]
    });

    return groups;
  }, []);

  async function openTournament(event: { id: number; slug?: string }) {
    if (openingEventId !== null) return;
    openingEventId = event.id;

    try {
      await goto(`/tournaments/${event.slug || event.id}`);
    } catch {
      openingEventId = null;
    }
  }

  function prefetchOnVisible(node: HTMLAnchorElement) {
    if (!browser || typeof IntersectionObserver === "undefined") {
      return {};
    }

    const href = node.getAttribute("href");
    if (!href || prefetchedTournamentUrls.has(href)) {
      return {};
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || prefetchedTournamentUrls.has(href)) {
          return;
        }

        prefetchedTournamentUrls.add(href);
        void preloadData(href);
        observer.disconnect();
      },
      {
        rootMargin: "220px 0px"
      }
    );

    observer.observe(node);

    return {
      destroy() {
        observer.disconnect();
      }
    };
  }
</script>

<section class="tournament-page">
  <header class="hero">
    <h1 class="page-title">Tournament</h1>
    <p class="page-subtitle">Tournament schedules, brackets, and standings. <a class="tutorial-link" href="/tournaments/tutorial">View bot tutorial</a></p>
  </header>

  {#if data.events.length === 0}
    <section class="empty-panel">
      <p class="empty-copy">No events are available yet.</p>
    </section>
  {:else}
    <section class="toolbar-panel toolbar-sticky">
      <div class="toolbar">
        <label class="field">
          <span>Search Event</span>
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Search by name or code"
          />
        </label>

        <label class="field">
          <span>Status</span>
          <select bind:value={statusFilter}>
            <option value="all">All</option>
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
          </select>
        </label>

        <label class="field">
          <span>Mode</span>
          <select bind:value={modeFilter}>
            <option value="all">All</option>
            <option value="regular_season">Regular Season</option>
            <option value="playoffs">Playoffs</option>
          </select>
        </label>
      </div>
    </section>

    {#if filteredEvents.length === 0}
      <section class="empty-panel">
        <p class="empty-copy">No tournaments found.</p>
        <p class="empty-hint">Try adjusting the search or filters.</p>
      </section>
    {:else}
      <div class="event-list">
        {#each groupedEvents as group}
          <section class="event-group">
              <header class="event-group-header">
                <h2 class="event-group-title">Managed by {group.managedBy}</h2>
                <span class="event-group-count">{group.events.length}</span>
              </header>

            <div class="event-group-list">
              {#each group.events as event}
                <a
                  class:event-row-loading={openingEventId === event.id}
                  class="event-row"
                  href={`/tournaments/${event.slug || event.id}`}
                  data-sveltekit-preload-data="tap"
                  use:prefetchOnVisible
                  aria-busy={openingEventId === event.id}
                  on:click|preventDefault={() => openTournament(event)}
                >
                  <div class="event-row-main">
                    <h2 class="event-name">{event.name}</h2>
                  <p class="event-meta">
                      {formatDate(event.eventDate)} · {event.totalTeams}T · {event.totalRounds}R · {formatShortLabel(event)}
                    </p>
                  </div>
                  <div class="event-row-side">
                    {#if openingEventId === event.id}
                      <span class="opening-label">Opening…</span>
                    {:else}
                      <span class={`status-pill ${statusTone(event.status)}`}>{event.status}</span>
                    {/if}
                  </div>
                </a>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .tournament-page {
    display: grid;
    gap: 12px;
  }

  .format-guide-panel {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 16px;
    background: rgba(9, 18, 34, 0.6);
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .format-guide-title {
    margin: 0;
    font-size: 0.95rem;
    color: var(--muted);
    font-weight: 600;
  }

  .format-guide-list {
    display: grid;
    gap: 8px;
  }

  .format-guide-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(123, 220, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
    text-decoration: none;
    color: var(--text);
    transition: border-color 160ms ease-out, background 160ms ease-out;
  }

  .format-guide-item:hover {
    border-color: rgba(123, 220, 255, 0.24);
    background: rgba(12, 24, 46, 0.7);
  }

  .format-guide-name {
    font-size: 0.9rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .format-guide-desc {
    color: var(--muted);
    font-size: 0.82rem;
    text-align: right;
  }

  @media (max-width: 540px) {
    .format-guide-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    .format-guide-desc {
      text-align: left;
    }
  }

  .hero {
    display: grid;
    gap: 8px;
  }

  .hero > * {
    margin: 0;
  }

  .toolbar-panel,
  .empty-panel {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 16px;
    background: rgba(9, 18, 34, 0.6);
    padding: 16px;
  }

  .toolbar-sticky {
    position: sticky;
    top: 8px;
    z-index: 20;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }

  .toolbar {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(150px, 1fr) minmax(150px, 1fr);
    gap: 12px;
  }

  .field {
    display: grid;
    gap: 8px;
  }

  .field span {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .field input,
  .field select {
    min-height: 44px;
    border-radius: 12px;
    border: 1px solid rgba(123, 220, 255, 0.16);
    background: rgba(8, 17, 31, 0.72);
    color: var(--text);
    padding: 0 14px;
  }

  .event-list {
    display: grid;
    gap: 12px;
  }

  .event-group {
    display: grid;
    gap: 8px;
  }

  .event-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 4px;
  }

  .event-group-title,
  .event-group-count {
    margin: 0;
  }

  .event-group-title {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(180, 200, 230, 0.6);
  }

  .event-group-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(123, 220, 255, 0.1);
    border: 1px solid rgba(123, 220, 255, 0.18);
    color: rgba(180, 215, 255, 0.7);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .event-group-list {
    display: grid;
    gap: 6px;
  }

  .event-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 12px;
    align-items: start;
    padding: 9px 14px 9px 16px;
    border-radius: 12px;
    border: 1px solid rgba(123, 220, 255, 0.12);
    background: rgba(9, 18, 34, 0.48);
    box-shadow: inset 3px 0 0 rgba(74, 158, 255, 0.18);
    text-decoration: none;
    color: var(--text);
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease,
                transform 160ms ease, box-shadow 160ms ease;
  }

  .event-row:hover {
    border-color: rgba(123, 220, 255, 0.3);
    background: rgba(12, 24, 46, 0.78);
    transform: translateY(-1px) scale(1.005);
    box-shadow: inset 3px 0 0 rgba(48, 221, 255, 0.45),
                0 4px 18px rgba(48, 221, 255, 0.07),
                0 0 0 1px rgba(123, 220, 255, 0.16);
  }

  .event-row:active {
    transform: scale(0.99);
    box-shadow: inset 3px 0 0 rgba(48, 221, 255, 0.3);
  }

  .event-row-loading {
    pointer-events: none;
    opacity: 0.78;
  }

  .event-row-main {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .event-name,
  .event-meta {
    margin: 0;
  }

  .event-name {
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .event-meta,
  .empty-copy {
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.3;
  }

  .empty-hint {
    color: rgba(160, 180, 210, 0.45);
    font-size: 0.78rem;
    margin: 4px 0 0;
  }

  .event-row-side {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
  }

  .status-pill {
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: capitalize;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .status-pill.is-ongoing {
    color: #30ddff;
    background: rgba(18, 78, 118, 0.38);
    border-color: rgba(48, 221, 255, 0.38);
    box-shadow: 0 0 6px rgba(48, 221, 255, 0.12);
  }

  .status-pill.is-ongoing::before {
    content: "●";
    font-size: 0.55em;
    margin-right: 4px;
    vertical-align: middle;
    animation: pulse-dot 1.6s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .status-pill.is-completed {
    color: rgba(138, 194, 255, 0.88);
    background: rgba(22, 52, 96, 0.42);
    border-color: rgba(100, 165, 255, 0.22);
  }

  .status-pill.is-default {
    color: rgba(172, 190, 215, 0.72);
    background: rgba(22, 32, 52, 0.52);
    border-color: rgba(140, 165, 200, 0.18);
  }

  .opening-label {
    color: #9ee7ff;
    font-size: 0.82rem;
    font-weight: 700;
  }

  @media (max-width: 720px) {
    .tutorial-link {
      display: inline;
      margin-left: 0;
    }

    .toolbar {
      grid-template-columns: 1fr;
    }
  }
</style>

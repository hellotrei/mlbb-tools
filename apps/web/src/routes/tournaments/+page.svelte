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
    <section class="toolbar-panel">
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
            <option value="draft">Draft</option>
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
        <p class="empty-copy">No events match the current filters.</p>
      </section>
    {:else}
      <div class="event-list">
        {#each groupedEvents as group}
          <section class="event-group">
            <header class="event-group-header">
              <h2 class="event-group-title">Managed by {group.managedBy}</h2>
              <p class="event-group-count">{group.events.length} events</p>
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
                      {formatDate(event.eventDate)} · {event.totalTeams} teams · {event.totalRounds} rounds · {formatEventLabel(event)}
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
    gap: 16px;
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
    gap: 16px;
  }

  .event-group {
    display: grid;
    gap: 10px;
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
    font-size: 1rem;
  }

  .event-group-count {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .event-group-list {
    display: grid;
    gap: 10px;
  }

  .event-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 16px;
    border: 1px solid rgba(123, 220, 255, 0.12);
    background: rgba(9, 18, 34, 0.48);
    text-decoration: none;
    color: var(--text);
  }

  .event-row:hover {
    border-color: rgba(123, 220, 255, 0.24);
    background: rgba(12, 24, 46, 0.72);
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
    font-size: 1rem;
    line-height: 1.25;
  }

  .event-meta,
  .empty-copy {
    color: var(--muted);
    font-size: 0.92rem;
  }

  .event-row-side {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-width: 0;
  }

  .status-pill {
    padding: 7px 10px;
    border-radius: 999px;
    font-size: 0.82rem;
    font-weight: 700;
    text-transform: capitalize;
    border: 1px solid transparent;
  }

  .status-pill.is-ongoing {
    color: #9ee7ff;
    background: rgba(23, 93, 129, 0.32);
    border-color: rgba(102, 213, 255, 0.32);
  }

  .status-pill.is-completed {
    color: #9cffbf;
    background: rgba(20, 110, 74, 0.24);
    border-color: rgba(103, 222, 160, 0.3);
  }

  .status-pill.is-default {
    color: #ffd58c;
    background: rgba(147, 103, 20, 0.22);
    border-color: rgba(255, 191, 89, 0.26);
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

    .event-row {
      align-items: start;
    }

    .event-row-side {
      justify-content: space-between;
      flex-wrap: wrap;
    }
  }
</style>

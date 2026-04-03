<script lang="ts">
  import { goto } from "$app/navigation";

  export let data: {
    events: Array<{
      id: number;
      code: string;
      name: string;
      format: string;
      eventMode?: string;
      totalTeams: number;
      totalRounds: number;
      eventDate: string;
      status: string;
      createdByTelegramUserId: string;
    }>;
  };

  let searchQuery = "";
  let statusFilter = "all";
  let openingEventId: number | null = null;

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
    return value.replace(/_/g, " ");
  }

  $: normalizedQuery = searchQuery.trim().toLowerCase();
  $: filteredEvents = data.events.filter((event) => {
    const matchesStatus = statusFilter === "all" || event.status === statusFilter;
    const haystack = `${event.name} ${event.code}`.toLowerCase();
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    return matchesStatus && matchesQuery;
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

  async function openTournament(eventId: number) {
    if (openingEventId !== null) return;
    openingEventId = eventId;

    try {
      await goto(`/tournaments/${eventId}`);
    } catch {
      openingEventId = null;
    }
  }
</script>

<section class="tournament-page">
  <header class="hero">
    <h1 class="page-title">Tournament</h1>
    <p class="page-subtitle">
      The web app is used to view schedules, brackets, and standings only. All event creation and match result input are managed by Admin.
    </p>
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
                  href={`/tournaments/${event.id}`}
                  aria-busy={openingEventId === event.id}
                  on:click|preventDefault={() => openTournament(event.id)}
                >
                  <div class="event-row-main">
                    <h2 class="event-name">{event.name}</h2>
                    <p class="event-meta">
                      {formatDate(event.eventDate)} · {event.totalTeams} teams · {event.totalRounds} rounds · {formatTournamentFormat(event.eventMode ?? event.format)}
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
    grid-template-columns: minmax(0, 2fr) minmax(180px, 1fr);
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

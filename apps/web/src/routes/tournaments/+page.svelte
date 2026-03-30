<script lang="ts">
  import { Card } from "@mlbb/ui";

  export let data: {
    events: Array<{
      id: number;
      code: string;
      name: string;
      format: string;
      totalTeams: number;
      totalRounds: number;
      eventDate: string;
      status: string;
    }>;
  };

  let searchQuery = "";
  let statusFilter = "all";

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(date);
  }

  $: normalizedQuery = searchQuery.trim().toLowerCase();
  $: filteredEvents = data.events.filter((event) => {
    const matchesStatus = statusFilter === "all" || event.status === statusFilter;
    const haystack = `${event.name} ${event.code}`.toLowerCase();
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    return matchesStatus && matchesQuery;
  });
</script>

<section class="tournament-page">
  <header class="hero">
    <h1 class="page-title">Tournament</h1>
    <p class="page-subtitle">
      The web app is used to view brackets and standings only. All event creation and match result input are managed by Admin.
    </p>
  </header>

  {#if data.events.length === 0}
    <Card title="No Events">
      <p class="empty-copy">No events are available yet.</p>
    </Card>
  {:else}
    <Card title="Event List">
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
    </Card>

    {#if filteredEvents.length === 0}
      <Card title="No Matching Events">
        <p class="empty-copy">No events match the current filters.</p>
      </Card>
    {:else}
      <div class="event-grid">
        {#each filteredEvents as event}
          <Card title={event.name}>
            <div class="event-card">
              <p class="event-meta">
                Code {event.code} · {formatDate(event.eventDate)} · {event.totalTeams} teams · {event.totalRounds} rounds
              </p>
              <div class="meta-row">
                <span class="label">Format</span>
                <strong>{event.format.toUpperCase()}</strong>
              </div>
              <div class="meta-row">
                <span class="label">Status</span>
                <strong class="status">{event.status}</strong>
              </div>
              <div class="action-row">
                <a href={`/tournaments/${event.id}`}>View Tournament</a>
              </div>
            </div>
          </Card>
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
    gap: 6px;
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

  .event-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }

  .event-card {
    display: grid;
    gap: 14px;
  }

  .event-meta,
  .empty-copy,
  .label {
    color: var(--muted);
  }

  .meta-row,
  .action-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .status {
    text-transform: capitalize;
  }

  .action-row a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid rgba(123, 220, 255, 0.22);
    background: rgba(8, 17, 31, 0.72);
    color: var(--text);
    text-decoration: none;
  }

  @media (max-width: 720px) {
    .toolbar {
      grid-template-columns: 1fr;
    }

    .action-row a {
      width: 100%;
    }
  }
</style>

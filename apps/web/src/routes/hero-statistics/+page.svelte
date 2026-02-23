<script lang="ts">
  import { goto } from "$app/navigation";
  import { Card, Chip, HeroAvatar } from "@mlbb/ui";
  import { LANES, ROLES, TIMEFRAMES, heroRoles, laneLabel, roleLabel, timeframeLabel, type HeroLite } from "$lib/options";

  type StatRow = {
    mlid: number;
    name: string;
    imageKey: string;
    rolePrimary: string;
    roleSecondary?: string | null;
    lanes: string[];
    specialities?: string[];
    winRate: number;
    pickRate: number;
    banRate: number;
    appearance: number | null;
  };

  type SortKey = "win_rate" | "pick_rate" | "ban_rate" | "appearance";

  export let data: {
    filters: {
      timeframe: string;
      role: string;
      lane: string;
      speciality: string;
      sort: string;
      order: string;
      page: string;
      limit: string;
      search: string;
    };
    stats: {
      items: StatRow[];
      page: number;
      limit: number;
      total: number;
      lastUpdated: string | null;
    };
    heroes: HeroLite[];
  };

  let rows: StatRow[] = [];
  let heroNameOptions: string[] = [];
  let specialityOptions: string[] = [];
  let totalPages = 1;
  let startIndex = 0;

  $: rows = data.stats?.items ?? [];
  $: heroNameOptions = data.heroes.map((hero) => hero.name).sort((a, b) => a.localeCompare(b));
  $: specialityOptions = Array.from(
    new Set(data.heroes.flatMap((hero) => hero.specialities ?? []).map((item) => item.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  $: totalPages = Math.max(1, Math.ceil((data.stats?.total ?? 0) / (data.stats?.limit ?? 1)));
  $: startIndex = ((data.stats?.page ?? 1) - 1) * (data.stats?.limit ?? 1);

  function setFilter(patch: Record<string, string>, resetPage = true) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }

    if (resetPage) {
      params.set("page", "1");
    }

    void goto(`/hero-statistics?${params.toString()}`, {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true
    });
  }

  function resetFilters() {
    void goto("/hero-statistics?timeframe=7d&sort=win_rate&order=desc&page=1&limit=50", {
      keepFocus: true,
      noScroll: true,
      invalidateAll: true
    });
  }

  function pageShift(delta: number) {
    const current = data.stats?.page ?? 1;
    const next = Math.min(totalPages, Math.max(1, current + delta));
    setFilter({ page: String(next) }, false);
  }

  function setSort(sort: SortKey) {
    const nextOrder = data.filters.sort === sort && data.filters.order === "desc" ? "asc" : "desc";
    setFilter({ sort, order: nextOrder });
  }

  function sortArrow(sort: SortKey) {
    if (data.filters.sort !== sort) return "<>";
    return data.filters.order === "desc" ? "v" : "^";
  }

  function metricHint(type: "win" | "pick" | "ban", value: number) {
    if (type === "win") return value >= 53 ? "High" : value >= 49 ? "Stable" : "Low";
    if (type === "pick") return value >= 9 ? "Popular" : value >= 3 ? "Steady" : "Rare";
    return value >= 8 ? "Most Banned" : value >= 3 ? "Often Banned" : "Low Ban";
  }

  function roleBadges(row: StatRow) {
    return heroRoles({
      mlid: row.mlid,
      name: row.name,
      rolePrimary: row.rolePrimary,
      roleSecondary: row.roleSecondary,
      lanes: row.lanes,
      specialities: row.specialities,
      imageKey: row.imageKey
    });
  }
</script>

<h1 class="page-title">Hero Statistics</h1>
<p class="page-subtitle">Overview statistik hero terbaru dengan filter aktif di semua kontrol.</p>

<div class="top-grid">
  <Card>
    <p class="field-label"><span class="label-icon">RG</span> Rank</p>
    <select disabled>
      <option>ALL</option>
    </select>
  </Card>
  <Card>
    <p class="field-label"><span class="label-icon">TF</span> Timeframe</p>
    <select value={data.filters.timeframe} on:change={(e) => setFilter({ timeframe: (e.currentTarget as HTMLSelectElement).value })}>
      {#each TIMEFRAMES as timeframe}
        <option value={timeframe}>{timeframeLabel(timeframe)}</option>
      {/each}
    </select>
  </Card>
</div>

<Card>
  <div class="filter-strip">
    <select class="hero-select" value={data.filters.search} on:change={(e) => setFilter({ search: (e.currentTarget as HTMLSelectElement).value })}>
      <option value="">Hero: All</option>
      {#each heroNameOptions as heroName}
        <option value={heroName}>{heroName}</option>
      {/each}
    </select>

    <select value={data.filters.role} on:change={(e) => setFilter({ role: (e.currentTarget as HTMLSelectElement).value })}>
      <option value="">Role</option>
      {#each ROLES as role}
        <option value={role}>{roleLabel(role)}</option>
      {/each}
    </select>

    <select value={data.filters.lane} on:change={(e) => setFilter({ lane: (e.currentTarget as HTMLSelectElement).value })}>
      <option value="">Lane</option>
      {#each LANES as lane}
        <option value={lane}>{laneLabel(lane)}</option>
      {/each}
    </select>

    <select value={data.filters.speciality} on:change={(e) => setFilter({ speciality: (e.currentTarget as HTMLSelectElement).value })}>
      <option value="">Speciality</option>
      {#each specialityOptions as speciality}
        <option value={speciality}>{speciality}</option>
      {/each}
    </select>

    <button class="reset" on:click={resetFilters}>Reset Filters</button>
  </div>

  {#if rows.length === 0}
    <div class="empty">Tidak ada data untuk kombinasi filter ini.</div>
  {:else}
    <div class="table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Hero Name</th>
            <th>
              <button class:active={data.filters.sort === "win_rate"} class="th-sort" on:click={() => setSort("win_rate")}>
                Win Rate <span>{sortArrow("win_rate")}</span>
              </button>
            </th>
            <th>
              <button class:active={data.filters.sort === "pick_rate"} class="th-sort" on:click={() => setSort("pick_rate")}>
                Pick Rate <span>{sortArrow("pick_rate")}</span>
              </button>
            </th>
            <th>
              <button class:active={data.filters.sort === "ban_rate"} class="th-sort" on:click={() => setSort("ban_rate")}>
                Ban Rate <span>{sortArrow("ban_rate")}</span>
              </button>
            </th>
            <th>Role</th>
            <th>Lane</th>
            <th>Speciality</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, index}
            <tr>
              <td>{startIndex + index + 1}</td>
              <td>
                <div class="hero-cell">
                  <HeroAvatar name={row.name} imageKey={row.imageKey} size={44} />
                  <strong>{row.name}</strong>
                </div>
              </td>
              <td>
                <div class="metric win">{row.winRate.toFixed(2)}%</div>
                <small>{metricHint("win", row.winRate)}</small>
              </td>
              <td>
                <div class="metric pick">{row.pickRate.toFixed(2)}%</div>
                <small>{metricHint("pick", row.pickRate)}</small>
              </td>
              <td>
                <div class="metric ban">{row.banRate.toFixed(2)}%</div>
                <small>{metricHint("ban", row.banRate)}</small>
              </td>
              <td>
                <div class="chip-list role-chips">
                  {#each roleBadges(row) as role}
                    <Chip label={roleLabel(role)} />
                  {/each}
                </div>
              </td>
              <td>
                <div class="chip-list lane-chips">
                  {#each row.lanes as lane}
                    <Chip label={laneLabel(lane)} />
                  {/each}
                </div>
              </td>
              <td>
                <div class="chip-list spec-chips">
                  {#if (row.specialities?.length ?? 0) === 0}
                    <span class="muted">-</span>
                  {:else}
                    {#each row.specialities ?? [] as speciality}
                      <Chip label={speciality} />
                    {/each}
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <span>
        {data.stats.total} rows | page {data.stats.page} / {totalPages}
        {#if data.stats.lastUpdated}
          | updated {new Date(data.stats.lastUpdated).toLocaleString()}
        {/if}
      </span>
      <div class="pager">
        <button disabled={data.stats.page <= 1} on:click={() => pageShift(-1)}>Previous</button>
        <button disabled={data.stats.page >= totalPages} on:click={() => pageShift(1)}>Next</button>
      </div>
    </div>
  {/if}
</Card>

<style>
  .top-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .field-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e9f2ff;
    font-size: 0.95rem;
    margin-bottom: 8px;
    margin-top: 0;
  }

  .label-icon {
    opacity: 0.85;
    font-size: 0.95rem;
  }

  .filter-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding-bottom: 14px;
    margin-bottom: 14px;
    border-bottom: 1px solid rgba(116, 166, 255, 0.24);
  }

  .hero-select {
    min-width: 260px;
    flex: 1 1 290px;
  }

  .reset {
    background: rgba(67, 80, 103, 0.9);
    color: #dce8ff;
    font-weight: 600;
  }

  .table-wrap {
    border: 1px solid rgba(68, 214, 255, 0.22);
    border-radius: 14px;
    overflow: auto;
  }

  .stats-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 1170px;
    background: rgba(5, 10, 20, 0.95);
  }

  th,
  td {
    padding: 13px 12px;
    border-bottom: 1px solid rgba(132, 180, 255, 0.14);
    text-align: left;
    vertical-align: middle;
  }

  th {
    color: #d7ebff;
    font-size: 0.88rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: rgba(30, 34, 46, 0.95);
    white-space: nowrap;
  }

  .th-sort {
    background: transparent;
    border: 0;
    padding: 0;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    font-size: inherit;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 700;
  }

  .th-sort span {
    color: #8ea3bf;
    font-size: 0.8rem;
  }

  .th-sort.active span {
    color: #2fe0ff;
  }

  tbody tr {
    background: rgba(4, 8, 17, 0.9);
  }

  tbody tr:hover {
    background: rgba(26, 53, 102, 0.18);
  }

  .hero-cell {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .hero-cell strong {
    font-size: 1.05rem;
  }

  .metric {
    font-size: 2.05rem;
    font-weight: 650;
    line-height: 1.05;
  }

  .metric.win {
    color: #29d4a1;
  }

  .metric.pick {
    color: #57a2ff;
  }

  .metric.ban {
    color: #bb80ff;
  }

  .chip-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .role-chips :global(.chip) {
    background: rgba(22, 46, 84, 0.9);
    border-color: rgba(113, 159, 255, 0.45);
    color: #c8ddff;
  }

  .lane-chips :global(.chip) {
    background: rgba(66, 31, 94, 0.9);
    border-color: rgba(176, 131, 255, 0.4);
    color: #e2c9ff;
  }

  .spec-chips :global(.chip) {
    background: rgba(19, 77, 57, 0.9);
    border-color: rgba(74, 191, 154, 0.36);
    color: #b5f5df;
  }

  small,
  .muted {
    color: #99abc4;
  }

  .empty {
    padding: 24px;
    border: 1px dashed var(--border);
    border-radius: 12px;
    color: var(--muted);
    text-align: center;
  }

  .footer {
    margin-top: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
    font-size: 0.88rem;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pager {
    display: flex;
    gap: 8px;
  }

  @media (max-width: 960px) {
    .top-grid {
      grid-template-columns: 1fr;
    }

    .metric {
      font-size: 1.4rem;
    }

    .filter-strip select,
    .filter-strip button {
      flex: 1 1 180px;
    }

    .hero-select {
      min-width: 0;
      flex-basis: 100%;
    }
  }
</style>

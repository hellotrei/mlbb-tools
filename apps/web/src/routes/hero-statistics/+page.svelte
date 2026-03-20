<script lang="ts">
  import { goto } from "$app/navigation";
  import { navigating } from "$app/stores";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { Card, Chip, HeroAvatar } from "@mlbb/ui";
  import { LANES, ROLES, heroRoles, laneLabel, roleLabel, type HeroLite } from "$lib/options";
  import { engine } from "$lib/stores/engine";
  import { apiUrl } from "$lib/api";

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

  type StatsPayload = {
    items: StatRow[];
    page: number;
    limit: number;
    total: number;
    lastUpdated: string | null;
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
    stats: StatsPayload;
    heroes: HeroLite[];
  };

  let statsData: StatsPayload = data.stats;
  let statsLoading = false;
  let didMount = false;

  function statsEndpointForEngine(eng: string) {
    if (eng === "m7") return "/stats/m7";
    if (eng === "mpl_ph") return "/stats/mpl-ph";
    return null;
  }

  let filterSearch = data.filters.search;
  let filterRole = data.filters.role;
  let filterLane = data.filters.lane;
  let filterSort = data.filters.sort;
  let filterOrder = data.filters.order;

  function isTournamentEngine(eng: string) {
    return eng === "m7" || eng === "mpl_ph";
  }

  $: if (!isTournamentEngine($engine)) filterSearch = data.filters.search;
  $: if (!isTournamentEngine($engine)) filterRole = data.filters.role;
  $: if (!isTournamentEngine($engine)) filterLane = data.filters.lane;
  $: if (!isTournamentEngine($engine)) filterSort = data.filters.sort;
  $: if (!isTournamentEngine($engine)) filterOrder = data.filters.order;

  onMount(() => {
    didMount = true;
  });

  async function refetchStatsForEngine(eng: string) {
    const tournamentEndpoint = statsEndpointForEngine(eng);
    if (tournamentEndpoint) {
      statsLoading = true;
      try {
        const res = await fetch(apiUrl(tournamentEndpoint));
        if (!res.ok) throw new Error("Failed to load tournament stats data.");
        const payload = (await res.json()) as { items: Array<{ mlid: number; winRate: number; banRate: number; pickRate: number; matchCount: number }> };
        const heroLookup = new Map(data.heroes.map((h) => [h.mlid, h]));
        const enriched: StatRow[] = payload.items.map((item) => {
          const hero = heroLookup.get(item.mlid);
          return {
            mlid: item.mlid,
            name: hero?.name ?? String(item.mlid),
            imageKey: hero?.imageKey ?? "",
            rolePrimary: hero?.rolePrimary ?? "",
            roleSecondary: hero?.roleSecondary ?? null,
            lanes: hero?.lanes ?? [],
            specialities: hero?.specialities ?? [],
            winRate: item.winRate,
            pickRate: item.pickRate,
            banRate: item.banRate,
            appearance: item.matchCount
          };
        });
        statsData = {
          items: enriched,
          page: 1,
          limit: enriched.length,
          total: enriched.length,
          lastUpdated: null
        };
      } catch (_err) {
      } finally {
        statsLoading = false;
      }
    } else {
      statsData = data.stats;
    }
  }

  $: if (browser && didMount) void refetchStatsForEngine($engine);

  let rows: StatRow[] = [];
  let heroNameOptions: string[] = [];
  let specialityOptions: string[] = [];
  let totalPages = 1;
  let startIndex = 0;
  let isUpdating = false;

  function applyClientFilters(items: StatRow[], search: string, role: string, lane: string, sort: string, order: string): StatRow[] {
    let result = items;
    if (search) result = result.filter((r) => r.name.toLowerCase() === search.toLowerCase());
    if (role) result = result.filter((r) => r.rolePrimary === role || r.roleSecondary === role);
    if (lane) result = result.filter((r) => r.lanes.includes(lane));
    const dir = order === "asc" ? 1 : -1;
    return [...result].sort((a, b) => {
      if (sort === "win_rate") return dir * (a.winRate - b.winRate);
      if (sort === "pick_rate") return dir * (a.pickRate - b.pickRate);
      if (sort === "ban_rate") return dir * (a.banRate - b.banRate);
      return dir * ((a.appearance ?? 0) - (b.appearance ?? 0));
    });
  }

  $: rows = isTournamentEngine($engine)
    ? applyClientFilters(statsData?.items ?? [], filterSearch, filterRole, filterLane, filterSort, filterOrder)
    : statsData?.items ?? [];
  $: heroNameOptions = data.heroes.map((hero) => hero.name).sort((a, b) => a.localeCompare(b));
  $: totalPages = Math.max(1, Math.ceil((statsData?.total ?? 0) / (statsData?.limit ?? 1)));
  $: startIndex = ((statsData?.page ?? 1) - 1) * (statsData?.limit ?? 1);
  $: isUpdating = Boolean($navigating?.to?.url.pathname === "/hero-statistics") || statsLoading;
  const isCompact = true;

  function setFilter(patch: Record<string, string>, resetPage = true) {
    if ("search" in patch) filterSearch = patch.search ?? "";
    if ("role" in patch) filterRole = patch.role ?? "";
    if ("lane" in patch) filterLane = patch.lane ?? "";
    if ("sort" in patch) filterSort = patch.sort ?? filterSort;
    if ("order" in patch) filterOrder = patch.order ?? filterOrder;

    const isPageOnly = Object.keys(patch).every((k) => k === "page");
    if (!isTournamentEngine($engine) || isPageOnly) {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (!value) params.delete(key);
        else params.set(key, value);
      }
      if (resetPage && !isPageOnly) params.set("page", "1");
      void goto(`/hero-statistics?${params.toString()}`, { keepFocus: true, noScroll: true });
    }
  }

  function pageShift(delta: number) {
    const current = statsData?.page ?? 1;
    const next = Math.min(totalPages, Math.max(1, current + delta));
    setFilter({ page: String(next) }, false);
  }

  function setSort(sort: SortKey) {
    const nextOrder = filterSort === sort && filterOrder === "desc" ? "asc" : "desc";
    setFilter({ sort, order: nextOrder });
  }

  function sortArrow(sort: SortKey) {
    if (filterSort === sort) return filterOrder === "desc" ? "▾" : "▴";
    return "▾";
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

<section class="stats-root">
  <header class="stats-head">
    <h1 class="page-title stats-title">Hero Statistics</h1>
    <p class="page-subtitle">Overview statistik hero terbaru dengan filter aktif di semua kontrol.</p>
  </header>

  <Card>
    <div class="filter-grid">
      <label class="field field-wide">
        <span class="field-label"><span class="label-icon">H</span> Hero</span>
        <select value={filterSearch} on:change={(e) => setFilter({ search: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="">All heroes</option>
          {#each heroNameOptions as heroName}
            <option value={heroName}>{heroName}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="field-label"><span class="label-icon">R</span> Role</span>
        <select value={filterRole} on:change={(e) => setFilter({ role: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="">All roles</option>
          {#each ROLES as role}
            <option value={role}>{roleLabel(role)}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="field-label"><span class="label-icon">L</span> Lane</span>
        <select value={filterLane} on:change={(e) => setFilter({ lane: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="">All lanes</option>
          {#each LANES as lane}
            <option value={lane}>{laneLabel(lane)}</option>
          {/each}
        </select>
      </label>

    </div>

    {#if rows.length === 0}
      <div class="empty">Tidak ada data untuk kombinasi filter ini.</div>
    {:else}
      <div class="table-wrap" class:loading={isUpdating}>
        <table class="stats-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Hero Name</th>
              <th>
                <button class:active={filterSort === "win_rate"} class="th-sort" on:click={() => setSort("win_rate")}>
                  Win Rate <span>{sortArrow("win_rate")}</span>
                </button>
              </th>
              <th>
                <button class:active={filterSort === "pick_rate"} class="th-sort" on:click={() => setSort("pick_rate")}>
                  Pick Rate <span>{sortArrow("pick_rate")}</span>
                </button>
              </th>
              <th>
                <button class:active={filterSort === "ban_rate"} class="th-sort" on:click={() => setSort("ban_rate")}>
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
                    <HeroAvatar name={row.name} imageKey={row.imageKey} size={isCompact ? 36 : 42} />
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
        <span>Navigasi halaman</span>
        <div class="pager">
          <button disabled={(statsData?.page ?? 1) <= 1} on:click={() => pageShift(-1)}>Previous</button>
          <button disabled={(statsData?.page ?? 1) >= totalPages} on:click={() => pageShift(1)}>Next</button>
        </div>
      </div>
    {/if}
  </Card>
</section>

<style>
  .stats-root {
    border: 1px solid rgba(136, 184, 255, 0.15);
    border-radius: 28px;
    padding: clamp(14px, 2.2vw, 24px);
    background: rgba(16, 29, 53, 0.62);
    box-shadow: inset 0 1px 0 rgba(206, 230, 255, 0.04), 0 18px 44px rgba(0, 0, 0, 0.26);
    backdrop-filter: blur(8px);
  }

  .stats-head {
    display: grid;
    gap: 9px;
    margin-bottom: 16px;
  }

  .stats-title {
    margin-bottom: 0;
    line-height: 1.04;
    text-shadow: 0 0 16px rgba(72, 238, 255, 0.24);
  }

  .page-subtitle {
    margin-bottom: 0;
    max-width: 70ch;
    color: #9db1cb;
    line-height: 1.35;
  }

  .filter-grid {
    display: grid;
    grid-template-columns: minmax(190px, 1.1fr) repeat(2, minmax(150px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }

  .field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .field-wide {
    min-width: 190px;
  }

  .field-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #9bb3d3;
    font-size: 0.72rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    font-weight: 700;
  }

  .label-icon {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 1px solid rgba(145, 184, 245, 0.3);
    background: rgba(38, 61, 96, 0.52);
    color: #c4d8f5;
    font-size: 0.62rem;
    font-weight: 700;
    display: grid;
    place-items: center;
    line-height: 1;
  }

  .field select {
    border-radius: 13px;
    border: 1px solid rgba(132, 177, 245, 0.2);
    background: rgba(22, 38, 62, 0.76);
    color: #cfddf2;
    font-size: 0.94rem;
    font-weight: 550;
    padding: 10px 12px;
    min-width: 0;
  }

  .field select:hover {
    border-color: rgba(120, 191, 242, 0.34);
  }

  .table-wrap {
    border: 1px solid rgba(116, 165, 235, 0.18);
    border-radius: 18px;
    overflow-y: auto;
    overflow-x: hidden;
    max-height: min(68vh, 810px);
    scroll-behavior: smooth;
    overscroll-behavior: contain;
    transition: opacity 180ms ease-out, filter 180ms ease-out;
  }

  .table-wrap.loading {
    opacity: 0.8;
    filter: saturate(0.86);
  }

  .stats-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 0;
    table-layout: fixed;
    background: rgba(7, 12, 23, 0.94);
  }

  .stats-table th:nth-child(1),
  .stats-table td:nth-child(1) {
    width: 4%;
  }

  .stats-table th:nth-child(2),
  .stats-table td:nth-child(2) {
    width: 18%;
  }

  .stats-table th:nth-child(3),
  .stats-table td:nth-child(3),
  .stats-table th:nth-child(4),
  .stats-table td:nth-child(4),
  .stats-table th:nth-child(5),
  .stats-table td:nth-child(5) {
    width: 11%;
  }

  .stats-table th:nth-child(6),
  .stats-table td:nth-child(6),
  .stats-table th:nth-child(7),
  .stats-table td:nth-child(7),
  .stats-table th:nth-child(8),
  .stats-table td:nth-child(8) {
    width: 15%;
  }

  th,
  td {
    padding: 8px 10px;
    border-bottom: 1px solid rgba(132, 180, 255, 0.11);
    text-align: left;
    vertical-align: middle;
  }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    color: #bfd1ea;
    font-size: 0.8rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: rgba(23, 29, 44, 0.96);
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
    color: #8196b5;
    font-size: 0.86rem;
    font-weight: 700;
    line-height: 1;
  }

  .th-sort.active span {
    color: #66d7ff;
  }

  tbody tr {
    background: rgba(5, 10, 20, 0.88);
  }

  tbody tr:hover {
    background: rgba(24, 45, 82, 0.2);
  }

  .hero-cell {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hero-cell strong {
    font-size: 0.9rem;
    color: #d7e6fb;
  }

  .metric {
    font-size: 0.98rem;
    font-weight: 620;
    line-height: 1.05;
  }

  .metric.win {
    color: #58cfae;
  }

  .metric.pick {
    color: #82b0f5;
  }

  .metric.ban {
    color: #c29be8;
  }

  .chip-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .role-chips :global(.chip) {
    background: rgba(23, 46, 83, 0.68);
    border-color: rgba(113, 159, 255, 0.32);
    color: #bdd1ee;
  }

  .lane-chips :global(.chip) {
    background: rgba(61, 35, 87, 0.62);
    border-color: rgba(176, 131, 255, 0.3);
    color: #d8c5ef;
  }

  .spec-chips :global(.chip) {
    background: rgba(21, 73, 57, 0.62);
    border-color: rgba(74, 191, 154, 0.3);
    color: #b5e5d8;
  }

  small,
  .muted {
    color: #8ea1bc;
    font-size: 0.72rem;
  }

  .empty {
    padding: 24px;
    border: 1px dashed rgba(132, 177, 245, 0.22);
    border-radius: 14px;
    color: #97abc7;
    text-align: center;
  }

  .footer {
    margin-top: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #91a7c6;
    font-size: 0.82rem;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pager {
    display: flex;
    gap: 8px;
  }

  .pager button {
    border-radius: 12px;
    border: 1px solid rgba(129, 172, 239, 0.2);
    background: rgba(33, 55, 88, 0.65);
    color: #ccdbef;
    font-size: 0.84rem;
    font-weight: 600;
    padding: 8px 12px;
  }

  .pager button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  :global(.chip) {
    font-size: 0.7rem;
    padding: 3px 8px;
  }

  @media (max-width: 960px) {
    .filter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .table-wrap {
      overflow-x: auto;
    }

    .stats-table {
      min-width: 980px;
      table-layout: auto;
    }
  }

  @media (max-width: 640px) {
    .stats-root {
      border-radius: 22px;
    }

    .filter-grid {
      grid-template-columns: 1fr;
    }
  }

</style>

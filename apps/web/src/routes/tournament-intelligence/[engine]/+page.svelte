<script lang="ts">
  import { fade } from "svelte/transition";
  import { HeroAvatar } from "@mlbb/ui";
  export let data: {
    engine: "mpl-id" | "mpl-ph";
    label: string;
    heroes: Array<{ mlid: number; name: string; imageKey: string }>;
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
        weekNumber?: number;
        roundNumber?: number | null;
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
        matchDate?: string | null;
        gameDetails?: Array<{
          gameNumber: number;
          mapName?: string | null;
          duration?: string | null;
          mvp?: string | null;
          winnerSide: "blue" | "red";
          winnerTeamName: string;
          blueTeamName: string;
          redTeamName: string;
          bluePicks: Array<{ mlid: number; heroName: string }>;
          redPicks: Array<{ mlid: number; heroName: string }>;
          blueBans: Array<{ mlid: number; heroName: string }>;
          redBans: Array<{ mlid: number; heroName: string }>;
        }>;
      }>;
    };
  };

  type MatchStatus = "scheduled" | "live" | "completed";
  type MatchRow = {
    id: number;
    week: number;
    day: number;
    dayLabel: string;
    timeLabel: string;
    dateLabel: string;
    status: MatchStatus;
    format: "Bo1" | "Bo3" | "Bo5";
    scoreA: number;
    scoreB: number;
    teamA: { name: string; logo: string; isWinner: boolean };
    teamB: { name: string; logo: string; isWinner: boolean };
    winnerName: string;
    mvp: string;
    duration: string;
    mapLabel: string;
    gameByGame: Array<{ label: string; result: string; duration: string; mapName: string }>;
    pickSummary: Array<{
      side: string;
      sideLabel: string;
      gameNumber: number;
      picks: Array<{ mlid: number; heroName: string }>;
      bans: Array<{ mlid: number; heroName: string }>;
    }>;
    quickHeroes: Array<{ mlid: number; heroName: string }>;
    draftSummary: string[];
    confidenceNote: string;
    blueRows: Array<{ side: string; sideLabel: string; gameNumber: number; picks: Array<{ mlid: number; heroName: string }>; bans: Array<{ mlid: number; heroName: string }>; winnerSide?: string }>;
    redRows: Array<{ side: string; sideLabel: string; gameNumber: number; picks: Array<{ mlid: number; heroName: string }>; bans: Array<{ mlid: number; heroName: string }>; winnerSide?: string }>;
    gameNumbers: number[];
  };

  const FALLBACK_LOGO = "/branding/draft-arena-mark.png";

  const rawItems = data.review?.items ?? [];

  const heroImageMap = new Map(data.heroes.map((h) => [h.name.toLowerCase(), h.imageKey]));
  function imageKeyOf(heroName: string): string {
    return heroImageMap.get(heroName.toLowerCase()) ?? "";
  }

  function norm(value: string) {
    return value.trim().toLowerCase();
  }

  // Maps normalized team name → local filename key (static/teams/<key>.png)
  const TEAM_LOCAL_KEY: Record<string, string> = {
    // MPL Indonesia S17
    "onic": "onic_esports",
    "onic esports": "onic_esports",
    "team liquid id": "team_liquid_id",
    "team liquid indonesia": "team_liquid_id",
    "dewa united": "dewa_united",
    "dewa united esports": "dewa_united",
    "bigetron": "bigetron",
    "bigetron esports": "bigetron",
    "bigetron by vitality": "bigetron",
    "alter ego": "alter_ego",
    "evos": "evos",
    "evos legends": "evos",
    "geek fam id": "geek_fam",
    "geek fam": "geek_fam",
    "natus vincere": "natus_vincere",
    "navi": "natus_vincere",
    "rrq": "rex_regum_qeon",
    "rrq hoshi": "rex_regum_qeon",
    "rex regum qeon": "rex_regum_qeon",
    // MPL Philippines S17
    "onic ph": "onic_esports",
    "onic philippines": "onic_esports",
    "team liquid ph": "team_liquid_ph",
    "team liquid philippines": "team_liquid_ph",
    "team falcons ph": "team_falcons_ph",
    "team falcons": "team_falcons_ph",
    "falcons": "team_falcons_ph",
    "twisted minds ph": "twisted_minds",
    "twisted minds": "twisted_minds",
    "aurora gaming ph": "aurora_gaming",
    "aurora gaming": "aurora_gaming",
    "ap bren": "ap_bren",
    "ap.bren": "ap_bren",
    "omega esports": "omega_esports_ph",
    "tnc pro team": "tnc_pro_team",
    "tnc": "tnc_pro_team",
  };

  function logoOf(name: string) {
    const localKey = TEAM_LOCAL_KEY[norm(name)];
    if (localKey) return `/teams/${localKey}.png`;
    return FALLBACK_LOGO;
  }

  function onLogoError(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (!img.src.includes(FALLBACK_LOGO)) img.src = FALLBACK_LOGO;
  }

  function parseScoreline(scoreline: string) {
    const [left, right] = scoreline.split("-").map((v) => Number(v.trim()));
    return {
      left: Number.isFinite(left) ? left : 0,
      right: Number.isFinite(right) ? right : 0
    };
  }

  type StandingRow = {
    teamName: string;
    wins: number;
    losses: number;
    mapsWon: number;
    mapsLost: number;
    logo: string;
  };

  const standings: StandingRow[] = (() => {
    const map = new Map<string, StandingRow>();

    for (const item of rawItems) {
      if (!item.winnerTeam || !item.loserTeam) continue;
      const score = parseScoreline(item.scoreline);

      const w = item.winnerTeam.name;
      const l = item.loserTeam.name;

      if (!map.has(w)) map.set(w, { teamName: w, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, logo: logoOf(w) });
      if (!map.has(l)) map.set(l, { teamName: l, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, logo: logoOf(l) });

      map.get(w)!.wins++;
      map.get(w)!.mapsWon += score.left;
      map.get(w)!.mapsLost += score.right;

      map.get(l)!.losses++;
      map.get(l)!.mapsWon += score.right;
      map.get(l)!.mapsLost += score.left;
    }

    return Array.from(map.values()).sort((a, b) =>
      b.wins - a.wins || (b.mapsWon - b.mapsLost) - (a.mapsWon - a.mapsLost)
    );
  })();

  function deriveStatus(item: { winnerTeam: { name: string } | null; scoreline: string }): MatchStatus {
    if ((item.winnerTeam?.name ?? "").trim()) return "completed";
    const score = parseScoreline(item.scoreline);
    if (score.left > 0 || score.right > 0) return "live";
    return "scheduled";
  }

  function deriveFormat(scoreA: number, scoreB: number): "Bo1" | "Bo3" | "Bo5" {
    const best = Math.max(scoreA, scoreB);
    if (best >= 3) return "Bo5";
    if (best >= 2) return "Bo3";
    return "Bo1";
  }

  function deriveMatchDate(index: number) {
    const base = data.status.generatedAt ? new Date(data.status.generatedAt) : new Date();
    const anchor = Number.isNaN(base.getTime()) ? new Date() : base;
    const dayOffset = Math.floor(index / 3);
    const startOffset = Math.floor(Math.max(0, rawItems.length - 1) / 3);
    const dt = new Date(anchor);
    dt.setDate(dt.getDate() - (startOffset - dayOffset));
    return dt;
  }

  function dayLabel(date: Date) {
    return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }

  function statusLabel(status: MatchStatus) {
    if (status === "completed") return "Completed";
    if (status === "live") return "Live";
    return "Scheduled";
  }

  function buildMapDetailsFromPayload(item: (typeof rawItems)[number], teamAName: string, teamBName: string, scoreA: number, scoreB: number) {
    if (item.gameDetails && item.gameDetails.length > 0) {
      const gameByGame = item.gameDetails.map((detail) => ({
        label: `Game ${detail.gameNumber}`,
        result: `${detail.winnerTeamName || (detail.winnerSide === "blue" ? detail.blueTeamName : detail.redTeamName)} win`,
        duration: detail.duration || "N/A",
        mapName: detail.mapName || "N/A"
      }));

      const pickSummary = item.gameDetails.flatMap((detail) => {
        return [
          { side: detail.blueTeamName, sideLabel: "Blue side", picks: detail.bluePicks, bans: detail.blueBans, gameNumber: detail.gameNumber, winnerSide: detail.winnerSide },
          { side: detail.redTeamName, sideLabel: "Red side", picks: detail.redPicks, bans: detail.redBans, gameNumber: detail.gameNumber, winnerSide: detail.winnerSide }
        ];
      });

      const first = item.gameDetails[0];
      return {
        gameByGame,
        pickSummary,
        quickHeroes: Array.from(
          new Map(
            item.gameDetails
              .flatMap((detail) => [...detail.bluePicks, ...detail.redPicks])
              .map((hero) => [hero.mlid, hero] as const)
          ).values()
        ).slice(0, 8),
        mvp: first?.mvp || "N/A",
        duration: first?.duration || "N/A",
        mapLabel: first?.mapName || `Map #${item.matchId}`
      };
    }

    const total = Math.max(1, scoreA + scoreB);
    const fallbackGames = Array.from({ length: total }).map((_, i) => ({
      label: `Game ${i + 1}`,
      result: `${i % 2 === 0 ? teamAName : teamBName} win`,
      duration: "N/A",
      mapName: "N/A"
    }));

    return {
      gameByGame: fallbackGames,
      pickSummary: [
        { side: teamAName, sideLabel: "Blue side", gameNumber: 1, picks: [], bans: [] },
        { side: teamBName, sideLabel: "Red side", gameNumber: 1, picks: [], bans: [] }
      ],
      quickHeroes: [],
      mvp: "N/A",
      duration: "N/A",
      mapLabel: item.roundLabel ?? `Map #${item.matchId}`
    };
  }

  const matches: MatchRow[] = rawItems.map((item, index) => {
    const when = item.matchDate
      ? new Date(item.matchDate)
      : deriveMatchDate(index);
    const week = item.weekNumber ?? Math.floor(index / 9) + 1;
    const day = Math.floor((index % 9) / 3) + 1;
    const score = parseScoreline(item.scoreline);
    const status = deriveStatus(item);

    const teamAName = item.winnerTeam?.name ?? "TBD Team A";
    const teamBName = item.loserTeam?.name ?? "TBD Team B";
    const winnerName = item.winnerTeam?.name ?? "TBD";

    const mapData = buildMapDetailsFromPayload(item, teamAName, teamBName, score.left, score.right);

    return {
      id: item.matchId,
      week,
      day,
      dayLabel: dayLabel(when),
      timeLabel: isNaN(when.getTime()) ? "—" : when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      dateLabel: isNaN(when.getTime()) ? "—" : when.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      status,
      format: deriveFormat(score.left, score.right),
      scoreA: score.left,
      scoreB: score.right,
      teamA: {
        name: teamAName,
        logo: logoOf(teamAName),
        isWinner: status === "completed" && winnerName === teamAName
      },
      teamB: {
        name: teamBName,
        logo: logoOf(teamBName),
        isWinner: status === "completed" && winnerName === teamBName
      },
      winnerName,
      mvp: mapData.mvp,
      duration: mapData.duration,
      mapLabel: mapData.mapLabel,
      gameByGame: mapData.gameByGame,
      pickSummary: mapData.pickSummary,
      blueRows: mapData.pickSummary?.filter((r: any) => r.sideLabel === "Blue side") ?? [],
      redRows: mapData.pickSummary?.filter((r: any) => r.sideLabel === "Red side") ?? [],
      gameNumbers: [...new Set(mapData.pickSummary?.map((r: any) => r.gameNumber) ?? [])].sort((a: number, b: number) => a - b),
      quickHeroes: mapData.quickHeroes,
      draftSummary: [...item.winnerAnalysis, ...item.loserAnalysis].slice(0, 4),
      confidenceNote: item.confidenceReason ?? "No details available."
    };
  });

  const weekGroups = matches.reduce<
    Array<{
      week: number;
      days: Array<{ day: number; dayLabel: string; matches: MatchRow[] }>;
      hidden: boolean;
    }>
  >((acc, match) => {
    let week = acc.find((group) => group.week === match.week);
    if (!week) {
      week = { week: match.week, days: [], hidden: false };
      acc.push(week);
    }

    let day = week.days.find((block) => block.day === match.day);
    if (!day) {
      day = { day: match.day, dayLabel: match.dayLabel, matches: [] };
      week.days.push(day);
    }

    day.matches.push(match);
    return acc;
  }, []);

  let hiddenWeeks: Record<number, boolean> = {};

  function toggleWeek(week: number) {
    hiddenWeeks = { ...hiddenWeeks, [week]: !hiddenWeeks[week] };
  }

  // Enhancement 4: Team Filter
  const allTeamNames: string[] = Array.from(
    new Set(
      rawItems.flatMap((item) =>
        [item.winnerTeam?.name, item.loserTeam?.name].filter((n): n is string => !!n)
      )
    )
  ).sort();

  let selectedTeam: string = "";
  let activeMatch: MatchRow | null = null;

  
  function openMatchDetails(m: MatchRow) {
    activeMatch = m;
  }
  function closeMatchDetails() {
    activeMatch = null;
  }
  $: filteredMatches = selectedTeam
    ? matches.filter((m) => m.teamA.name === selectedTeam || m.teamB.name === selectedTeam)
    : matches;

  $: headToHead = (() => {
    if (!selectedTeam) return [] as Array<{ opponent: string; wins: number; losses: number }>;
    const opponentMap = new Map<string, { wins: number; losses: number }>();
    for (const m of filteredMatches) {
      const opponent = m.teamA.name === selectedTeam ? m.teamB.name : m.teamA.name;
      if (!opponentMap.has(opponent)) opponentMap.set(opponent, { wins: 0, losses: 0 });
      const rec = opponentMap.get(opponent)!;
      if (m.status === "completed") {
        if (m.winnerName === selectedTeam) rec.wins++;
        else rec.losses++;
      }
    }
    return Array.from(opponentMap.entries())
      .map(([opponent, rec]) => ({ opponent, ...rec }))
      .sort((a, b) => b.wins - a.wins);
  })();

  $: filteredWeekGroups = filteredMatches.reduce<
    Array<{
      week: number;
      days: Array<{ day: number; dayLabel: string; matches: MatchRow[] }>;
      hidden: boolean;
    }>
  >((acc, match) => {
    let week = acc.find((group) => group.week === match.week);
    if (!week) {
      week = { week: match.week, days: [], hidden: false };
      acc.push(week);
    }
    let day = week.days.find((block) => block.day === match.day);
    if (!day) {
      day = { day: match.day, dayLabel: match.dayLabel, matches: [] };
      week.days.push(day);
    }
    day.matches.push(match);
    return acc;
  }, []);

  // Enhancement 5: Hero Win Rate
  type HeroStat = { heroName: string; mlid: number; picks: number; wins: number };

  const heroWinRateData: HeroStat[] = (() => {
    const map = new Map<string, HeroStat>();
    for (const item of rawItems) {
      if (!item.gameDetails) continue;
      for (const game of item.gameDetails) {
        const teamPicks = [
          ...game.bluePicks.map((h) => ({ hero: h, teamName: game.blueTeamName })),
          ...game.redPicks.map((h) => ({ hero: h, teamName: game.redTeamName }))
        ];
        for (const { hero, teamName } of teamPicks) {
          if (!map.has(hero.heroName)) map.set(hero.heroName, { heroName: hero.heroName, mlid: hero.mlid, picks: 0, wins: 0 });
          const stat = map.get(hero.heroName)!;
          stat.picks++;
          if (game.winnerTeamName === teamName) stat.wins++;
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.picks - a.picks)
      .slice(0, 20);
  })();

  // Enhancement 6: Team Stats
  type TeamStat = {
    teamName: string;
    logo: string;
    wins: number;
    losses: number;
    winRate: number;
    mostPickedHero: { heroName: string; mlid: number } | null;
    mostBannedHero: { heroName: string; mlid: number } | null;
  };

  const teamStatsData: TeamStat[] = (() => {
    const map = new Map<string, {
      wins: number;
      losses: number;
      pickedHeroes: Map<string, { mlid: number; count: number }>;
      bannedHeroes: Map<string, { mlid: number; count: number }>;
    }>();

    function ensureTeam(name: string) {
      if (!map.has(name)) map.set(name, { wins: 0, losses: 0, pickedHeroes: new Map(), bannedHeroes: new Map() });
      return map.get(name)!;
    }

    for (const item of rawItems) {
      if (!item.winnerTeam || !item.loserTeam) continue;
      ensureTeam(item.winnerTeam.name).wins++;
      ensureTeam(item.loserTeam.name).losses++;

      if (!item.gameDetails) continue;
      for (const game of item.gameDetails) {
        for (const hero of game.bluePicks) {
          const t = ensureTeam(game.blueTeamName);
          const prev = t.pickedHeroes.get(hero.heroName);
          t.pickedHeroes.set(hero.heroName, { mlid: hero.mlid, count: (prev?.count ?? 0) + 1 });
        }
        for (const hero of game.redPicks) {
          const t = ensureTeam(game.redTeamName);
          const prev = t.pickedHeroes.get(hero.heroName);
          t.pickedHeroes.set(hero.heroName, { mlid: hero.mlid, count: (prev?.count ?? 0) + 1 });
        }
        // bans against blue = red team bans
        for (const hero of game.redBans) {
          const t = ensureTeam(game.blueTeamName);
          const prev = t.bannedHeroes.get(hero.heroName);
          t.bannedHeroes.set(hero.heroName, { mlid: hero.mlid, count: (prev?.count ?? 0) + 1 });
        }
        // bans against red = blue team bans
        for (const hero of game.blueBans) {
          const t = ensureTeam(game.redTeamName);
          const prev = t.bannedHeroes.get(hero.heroName);
          t.bannedHeroes.set(hero.heroName, { mlid: hero.mlid, count: (prev?.count ?? 0) + 1 });
        }
      }
    }

    return Array.from(map.entries()).map(([teamName, d]) => {
      const total = d.wins + d.losses;
      const winRate = total > 0 ? Math.round((d.wins / total) * 100) : 0;

      let mostPickedHero: { heroName: string; mlid: number } | null = null;
      let maxPicked = 0;
      for (const [heroName, { mlid, count }] of d.pickedHeroes) {
        if (count > maxPicked) { maxPicked = count; mostPickedHero = { heroName, mlid }; }
      }

      let mostBannedHero: { heroName: string; mlid: number } | null = null;
      let maxBanned = 0;
      for (const [heroName, { mlid, count }] of d.bannedHeroes) {
        if (count > maxBanned) { maxBanned = count; mostBannedHero = { heroName, mlid }; }
      }

      return { teamName, logo: logoOf(teamName), wins: d.wins, losses: d.losses, winRate, mostPickedHero, mostBannedHero };
    }).sort((a, b) => b.wins - a.wins);
  })();
</script>
<!-- Match Details Modal -->
{#if activeMatch}
<div class="modal-overlay" on:click={closeMatchDetails} transition:fade={{ duration: 150 }}>
  <div class="modal-card" on:click|stopPropagation>
    <div class="modal-header">
      <h4>Match Details</h4>
      <button class="modal-close" type="button" aria-label="Close" on:click={closeMatchDetails}>&times;</button>
    </div>
    <div class="modal-body">
      <section class="modal-section">
        <h5>Draft / Pick &amp; Ban</h5>
        {#each activeMatch.gameNumbers as gameNum}
          <h6 class="game-group-label">Game {gameNum}</h6>
          <div class="draft-grid">
            {#each activeMatch.blueRows as row}
              {#if row.gameNumber === gameNum}
                <div class="draft-col draft-col--blue draft-col--{row.winnerSide === 'blue' ? 'winner' : 'loser'}" style="grid-column: 1">
                  <div class="draft-col-header">
                    <p class="draft-team-label">{row.side.toUpperCase()}</p>
                    {#if row.winnerSide === 'blue'}<span class="winner-badge">Winner</span>{/if}
                  </div>
                  <div class="hero-lines">
                    <span class="hero-line-label">Picks:</span>
                    <div class="hero-chip-wrap">
                      {#if row.picks.length > 0}
                        {#each row.picks as hero}
                          <a class="hero-pick" href={`/counter-pick?hero=${hero.mlid}`} title={hero.heroName}>
                            <div class="pick-portrait">
                              <HeroAvatar name={hero.heroName} imageKey={imageKeyOf(hero.heroName)} size={32} />
                            </div>
                            <span class="pick-name">{hero.heroName}</span>
                          </a>
                        {/each}
                      {:else}
                        <span class="hero-empty">N/A</span>
                      {/if}
                    </div>
                  </div>
                  <div class="hero-lines">
                    <span class="hero-line-label">Bans:</span>
                    <div class="hero-chip-wrap hero-chip-wrap--ban">
                      {#if row.bans.length > 0}
                        {#each row.bans as hero}
                          <a class="hero-avatar-ban" href={`/counter-pick?hero=${hero.mlid}`} title={hero.heroName}>
                            <div class="ban-portrait">
                              <HeroAvatar name={hero.heroName} imageKey={imageKeyOf(hero.heroName)} size={32} />
                              <span class="ban-x">X</span>
                            </div>
                            <span class="ban-name">{hero.heroName}</span>
                          </a>
                        {/each}
                      {:else}
                        <span class="hero-empty">N/A</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/each}
            {#each activeMatch.redRows as row}
              {#if row.gameNumber === gameNum}
                <div class="draft-col draft-col--red draft-col--{row.winnerSide === 'red' ? 'winner' : 'loser'}" style="grid-column: 2">
                  <div class="draft-col-header">
                    <p class="draft-team-label">{row.side.toUpperCase()}</p>
                    {#if row.winnerSide === 'red'}<span class="winner-badge">Winner</span>{/if}
                  </div>
                  <div class="hero-lines">
                    <span class="hero-line-label">Picks:</span>
                    <div class="hero-chip-wrap">
                      {#if row.picks.length > 0}
                        {#each row.picks as hero}
                          <a class="hero-pick" href={`/counter-pick?hero=${hero.mlid}`} title={hero.heroName}>
                            <div class="pick-portrait">
                              <HeroAvatar name={hero.heroName} imageKey={imageKeyOf(hero.heroName)} size={32} />
                            </div>
                            <span class="pick-name">{hero.heroName}</span>
                          </a>
                        {/each}
                      {:else}
                        <span class="hero-empty">N/A</span>
                      {/if}
                    </div>
                  </div>
                  <div class="hero-lines">
                    <span class="hero-line-label">Bans:</span>
                    <div class="hero-chip-wrap hero-chip-wrap--ban">
                      {#if row.bans.length > 0}
                        {#each row.bans as hero}
                          <a class="hero-avatar-ban" href={`/counter-pick?hero=${hero.mlid}`} title={hero.heroName}>
                            <div class="ban-portrait">
                              <HeroAvatar name={hero.heroName} imageKey={imageKeyOf(hero.heroName)} size={32} />
                              <span class="ban-x">X</span>
                            </div>
                            <span class="ban-name">{hero.heroName}</span>
                          </a>
                        {/each}
                      {:else}
                        <span class="hero-empty">N/A</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/each}
      </section>
    </div>
  </div>
</div>
{/if}


<section class="intel-page">
  <header class="intel-header">
    <a class="back-link" href="/">← Back to Landing</a>
    <h1>{data.label}</h1>
    <p class="meta-line">Maps: {data.status?.totalMaps ?? 0} · Readiness: {data.status?.readiness ?? "unknown"}</p>
  </header>

  {#if standings.length > 0}
    <section class="standings-card">
      <h2>Standings</h2>
      <table class="standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>W</th>
            <th>L</th>
          </tr>
        </thead>
        <tbody>
          {#each standings as row, i}
            <tr>
              <td class="rank">{i + 1}</td>
              <td class="team-cell">
                <img src={row.logo} alt={row.teamName} on:error={onLogoError} />
                <span>{row.teamName.toUpperCase()}</span>
              </td>
              <td class="wins">{row.wins}</td>
              <td class="losses">{row.losses}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <section class="schedule-card">
    <h2>Tournament Schedule / Results</h2>

    <!-- Enhancement 4: Team Filter -->
    {#if allTeamNames.length > 0}
      <div class="team-filter-row">
        <label class="team-filter-label" for="team-select">Filter by team:</label>
        <select id="team-select" class="team-filter-select" bind:value={selectedTeam}>
        <option value="">All Teams</option>
        {#each allTeamNames as name}
          <option value={name}>{name.toUpperCase()}</option>
        {/each}
        </select>
        {#if selectedTeam}
          <button type="button" class="week-toggle" on:click={() => (selectedTeam = "")}>Clear</button>
        {/if}
      </div>

      {#if selectedTeam && headToHead.length > 0}
        <div class="h2h-card">
          <p class="h2h-title">Head-to-Head · {selectedTeam.toUpperCase()}</p>
          <table class="standings-table">
            <thead>
              <tr><th>Opponent</th><th>W</th><th>L</th></tr>
            </thead>
            <tbody>
              {#each headToHead as row}
                <tr>
                  <td class="team-cell">
                    <img src={logoOf(row.opponent)} alt={row.opponent} width="20" height="20" on:error={onLogoError} />
                    <span>{row.opponent.toUpperCase()}</span>
                  </td>
                  <td class="wins">{row.wins}</td>
                  <td class="losses">{row.losses}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

    {#if filteredWeekGroups.length === 0}
      <article class="empty-state"><p>No matches this week.</p></article>
    {:else}
      {#each filteredWeekGroups as week}
        <article class="week-block">
          <header class="week-header">
            <h3>Week {week.week}</h3>
            <button type="button" class="week-toggle" on:click={() => toggleWeek(week.week)}>
              {hiddenWeeks[week.week] ? "Show" : "Hide"}
            </button>
          </header>

          {#if !hiddenWeeks[week.week]}
            {#if week.days.length === 0}
              <article class="empty-state"><p>No matches this week.</p></article>
            {:else}
              {#each week.days as day}
                <section class="day-block">
                  <header class="day-header">
                    <h4>Day {day.day}{#if day.dayLabel && day.dayLabel !== 'Invalid Date'} · {day.dayLabel}{/if}</h4>
                  </header>

                  {#if day.matches.length === 0}
                    <article class="empty-state"><p>No matches this day.</p></article>
                  {:else}
                    <div class="match-list">
                      {#each day.matches as match}
                        <article class={`match-card status-${match.status}`} class:clickable={match.status === "completed"} on:click={() => match.status === "completed" && openMatchDetails(match)}>
                          <div class="match-main">
                            <div class="team-box">
                              <img src={match.teamA.logo} alt={match.teamA.name} loading="lazy" decoding="async" on:error={onLogoError} />
                              <span>{match.teamA.name.toUpperCase()}</span>
                            </div>
                            <div class="score-box">
                              <span class="score-value">{match.scoreA} - {match.scoreB}</span>
                            </div>
                            <div class="team-box team-box--right">
                              <span>{match.teamB.name.toUpperCase()}</span>
                              <img src={match.teamB.logo} alt={match.teamB.name} loading="lazy" decoding="async" on:error={onLogoError} />
                            </div>
                          </div>
                        </article>
                      {/each}
                    </div>
                  {/if}
                </section>
              {/each}
            {/if}
          {/if}
        </article>
      {/each}
    {/if}
  </section>
</section>

<style>
  .intel-page {
    display: grid;
    gap: 12px;
    max-width: 100%;
    overflow-x: hidden;
  }

  .intel-header,
  .schedule-card,
  .week-block,
  .empty-state {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 14px;
    background: rgba(9, 18, 34, 0.6);
    padding: 12px;
    overflow: hidden;
  }

  .back-link {
    color: var(--muted);
    text-decoration: none;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  p {
    margin: 0;
  }

  .intel-header {
    display: grid;
    gap: 6px;
  }

  .meta-line,
  .method-note {
    color: var(--muted);
    font-size: 0.88rem;
  }

  .schedule-card {
    display: grid;
    gap: 10px;
  }

  .week-block {
    display: grid;
    gap: 8px;
    padding: 10px;
  }

  .week-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .week-toggle {
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.04);
    color: #d7ecff;
    border-radius: 8px;
    padding: 4px 10px;
    font-weight: 700;
    cursor: pointer;
  }

  .day-block {
    display: grid;
    gap: 8px;
  }

  .day-header {
    position: sticky;
    top: 8px;
    z-index: 2;
    border: 1px solid rgba(123, 220, 255, 0.2);
    border-radius: 10px;
    background: rgba(14, 24, 42, 0.9);
    padding: 7px 10px;
  }

  .match-list {
    display: grid;
    gap: 8px;
  }

  .match-card {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    background: rgba(7, 13, 24, 0.88);
    padding: 9px;
    max-width: 100%;
    overflow: hidden;
  }

  .match-card.clickable {
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .match-card.clickable:hover {
    border-color: rgba(123, 220, 255, 0.35);
    background: rgba(15, 22, 38, 0.95);
    box-shadow: 0 0 12px rgba(123, 220, 255, 0.08);
  }

  .match-card.status-completed {
    border-color: rgba(123, 220, 255, 0.24);
  }

  .match-card.status-live {
    border-color: rgba(255, 180, 92, 0.35);
  }

  .match-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .team-box {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 6px 8px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .team-box--right {
    flex-direction: row-reverse;
    text-align: right;
  }

  .team-box img {
    width: 28px;
    height: 28px;
    object-fit: contain;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .team-box span {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .score-box {
    flex-shrink: 0;
    text-align: center;
    min-width: 52px;
  }

  .score-value {
    font-size: 1.02rem;
    font-weight: 800;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .modal-card {
    background: #0f1729;
    border: 1px solid rgba(101, 137, 196, 0.35);
    border-radius: 14px;
    width: min(600px, 100%);
    max-height: 85vh;
    overflow-y: auto;
    display: grid;
    gap: 0;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    position: sticky;
    top: 0;
    background: #0f1729;
    z-index: 1;
  }
  .modal-header h4 {
    font-size: 0.95rem;
    color: #cdeaff;
    margin: 0;
  }
  .modal-close {
    background: none;
    border: none;
    color: rgba(148, 163, 184, 0.8);
    font-size: 1.3rem;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
  }
  .modal-close:hover {
    color: #fff;
  }
  .modal-body {
    padding: 12px 16px 16px;
    display: grid;
    gap: 12px;
  }
  .modal-section {
    display: grid;
    gap: 4px;
  }
  .modal-section h5 {
    font-size: 0.85rem;
    color: #9fe7ff;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .modal-section p {
    font-size: 0.8rem;
    color: rgba(203, 213, 225, 0.85);
    margin: 0;
  }

  @media (max-width: 820px) {
    .modal-card {
      max-height: 92vh;
      width: 100%;
    }
    .modal-overlay {
      padding: 8px;
    }
  }


  .details-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .detail-card {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 8px;
    padding: 8px;
    display: grid;
    gap: 4px;
  }

  .detail-card h5 {
    font-size: 0.82rem;
    color: #cdeaff;
    margin-bottom: 2px;
  }

  .draft-summary {
    margin-top: 0;
  }

  .confidence-note {
    color: #9fe7ff;
  }

  .quick-hero-row {
    display: grid;
    gap: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 6px;
  }

  .quick-hero-label {
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 700;
  }

  .hero-lines {
    display: grid;
    gap: 4px;
  }

  .hero-line-label {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .hero-chip {
    font-size: 0.76rem;
    color: #bde7ff;
    text-decoration: none;
    border: 1px solid rgba(123, 220, 255, 0.3);
    border-radius: 999px;
    padding: 2px 8px;
    background: rgba(13, 44, 72, 0.5);
  }

  .hero-chip:hover {
    border-color: rgba(123, 220, 255, 0.55);
    background: rgba(18, 58, 92, 0.65);
  }

  .hero-chip-ban {
    border-color: rgba(255, 140, 140, 0.35);
    background: rgba(74, 22, 22, 0.45);
    color: #ffd0d0;
  }

  .hero-chip-ban:hover {
    border-color: rgba(255, 140, 140, 0.58);
    background: rgba(94, 26, 26, 0.62);
  }

  .hero-empty {
    color: var(--muted);
    font-size: 0.76rem;
  }


  .game-group-label {
    font-size: 0.72rem;
    font-weight: 700;
    color: rgba(123, 220, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 10px 0 4px 0;
    padding: 0;
  }
  .game-group-label:first-of-type {
    margin-top: 0;
  }

  .draft-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 4px;
  }
  .draft-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-radius: 8px;
    padding: 8px;
  }
  .draft-col--blue {
    background: rgba(59, 130, 246, 0.06);
    border: 1px solid rgba(59, 130, 246, 0.15);
  }
  .draft-col--red {
    background: rgba(239, 68, 68, 0.06);
    border: 1px solid rgba(239, 68, 68, 0.15);
  }
  .draft-team-label {
    font-size: 0.78rem;
    font-weight: 700;
    color: #e0f2ff;
    margin: 0;
    padding: 2px 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .draft-col--blue .draft-team-label {
    color: #93c5fd;
  }
  .draft-col--red .draft-team-label {
    color: #fca5a5;
  }
  .draft-col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .winner-badge {
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #1a1a2e;
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    border-radius: 6px;
    padding: 2px 8px;
    box-shadow: 0 0 8px rgba(251, 191, 36, 0.3);
  }
  .draft-col--winner {
    border-color: rgba(251, 191, 36, 0.35) !important;
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.08);
  }
  .draft-col--loser {
    opacity: 0.7;
  }
  .draft-vs {
    display: none;
  }
  .hero-lines {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .hero-line-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: rgba(148, 163, 184, 0.8);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .hero-chip-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .hero-chip-wrap--ban {
    gap: 4px;
  }
  .hero-avatar-ban {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    text-decoration: none;
    color: inherit;
    font-size: 0.6rem;
    width: 40px;
    text-align: center;
    position: relative;
  }
  .ban-portrait {
    position: relative;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    border: 1.5px solid rgba(239, 68, 68, 0.35);
  }
  .ban-portrait img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    opacity: 0.35;
    filter: grayscale(0.6);
  }
  .ban-x {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(127, 29, 29, 0.6);
    border-radius: 50%;
    font-size: 10px;
    color: #fff;
    font-weight: 900;
    z-index: 2;
    pointer-events: none;
  }
  .ban-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40px;
    display: block;
    color: rgba(252, 165, 165, 0.8);
    font-size: 0.55rem;
    line-height: 1.2;
  }

  .hero-pick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    text-decoration: none;
    color: inherit;
    font-size: 0.6rem;
    width: 40px;
    text-align: center;
    position: relative;
  }
  .pick-portrait {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    border: 1.5px solid rgba(148, 163, 184, 0.25);
  }
  .pick-portrait img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
  }
  .pick-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40px;
    display: block;
    color: rgba(203, 213, 225, 0.9);
    font-size: 0.55rem;
    line-height: 1.2;
  }

  @media (max-width: 820px) {
    .draft-grid {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .draft-col {
      padding: 10px;
      grid-column: 1 !important;
    }
  }

  .standings-card {
    background: var(--surface, #1a1a2e);
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 0;
  }

  .standings-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    margin-top: 0.75rem;
  }

  .standings-table th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    color: var(--muted, #aaa);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-weight: 600;
  }

  .standings-table td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .standings-table .team-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .standings-table .team-cell img {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }

  .standings-table .wins {
    color: #4ade80;
    font-weight: 700;
  }

  .standings-table .losses {
    color: #f87171;
  }

  .standings-table .rank {
    color: var(--muted, #aaa);
    width: 2rem;
  }

  @media (max-width: 820px) {
    .intel-header,
    .schedule-card,
    .week-block,
    .empty-state {
      padding: 8px;
      border-radius: 10px;
    }
    .match-card {
      padding: 6px;
      border-radius: 8px;
    }
    .match-main {
      gap: 5px;
    }
    .team-box {
      padding: 3px 5px;
      gap: 4px;
      border-radius: 6px;
    }
    .team-box img {
      width: 20px;
      height: 20px;
    }
    .team-box span {
      font-size: 0.68rem;
    }
    .score-box {
      min-width: 36px;
    }
    .score-value {
      font-size: 0.82rem;
    }

    .details-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Enhancement 4: Team Filter */
  .team-filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .team-filter-label {
    color: var(--muted);
    font-size: 0.84rem;
    font-weight: 600;
  }

  .team-filter-select {
    background: rgba(9, 18, 34, 0.8);
    border: 1px solid rgba(123, 220, 255, 0.28);
    color: #d7ecff;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 0.84rem;
    cursor: pointer;
  }

  .h2h-card {
    border: 1px solid rgba(123, 220, 255, 0.14);
    border-radius: 10px;
    background: rgba(9, 18, 34, 0.6);
    padding: 10px;
  }

  .h2h-title {
    font-size: 0.84rem;
    font-weight: 700;
    color: #9fe7ff;
    margin-bottom: 6px;
  }

</style>

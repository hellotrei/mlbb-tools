const { Client } = require('pg');

function randCode() {
  const s = Math.random().toString(16).slice(2, 10).toUpperCase();
  return 'EVT-' + s;
}

(async () => {
  const c = new Client({ connectionString: 'postgresql://postgres:25972fe88e4f9c870508f0c1b177d60f9cbbf29524ef093b@82.153.226.178:5432/mlbb_tools' });
  await c.connect();
  await c.query('BEGIN');

  const eventCode = randCode();
  const eventName = 'Dummy DE UI Bracket Full';
  const eventSql = "insert into tournament_events (code, name, format, event_mode, match_best_of, playoff_semifinal_best_of, playoff_final_best_of, advance_to_playoffs, total_teams, total_rounds, event_date, status, created_by_telegram_user_id, telegram_chat_id, created_at, updated_at) values ($1, $2, 'double_elimination', 'playoffs', 1, 3, 5, 4, 8, 8, now(), 'completed', 'dummy-seeder', 'dummy-seeder', now(), now()) returning id, code, name";
  const eventRes = await c.query(eventSql, [eventCode, eventName]);
  const event = eventRes.rows[0];

  const teamNames = ['Jakarta Titans', 'Bandung Aces', 'Surabaya Phoenix', 'Depok Vortex', 'Bekasi Nova', 'Tangerang Blaze', 'Bogor Lynx', 'Cikarang Wolves'];
  const teamBySeed = {};
  for (let i = 0; i < teamNames.length; i += 1) {
    const seed = i + 1;
    const t = await c.query("insert into tournament_teams (event_id, name, captain_whatsapp, seed, created_at) values ($1, $2, null, $3, now()) returning id, seed, name", [event.id, teamNames[i], seed]);
    teamBySeed[seed] = t.rows[0];
  }

  const rounds = [];
  const defs = [
    [1, 'upper', 1, 'Upper Bracket Round 1'],
    [2, 'lower', 1, 'Lower Bracket Round 1'],
    [3, 'upper', 2, 'Upper Bracket Round 2'],
    [4, 'lower', 2, 'Lower Bracket Round 2'],
    [5, 'lower', 3, 'Lower Bracket Round 3'],
    [6, 'upper', 3, 'Upper Bracket Final'],
    [7, 'lower', 4, 'Lower Bracket Final'],
    [8, 'grand_final', 1, 'Grand Final']
  ];
  for (const d of defs) {
    const r = await c.query("insert into tournament_rounds (event_id, round_number, stage, stage_number, label, status, created_at) values ($1, $2, $3, $4, $5, 'completed', now()) returning id, round_number, stage", [event.id, d[0], d[1], d[2], d[3]]);
    rounds.push(r.rows[0]);
  }

  function team(seed) { return teamBySeed[seed]; }
  function round(num) { return rounds.find((r) => r.round_number === num); }

  async function addMatch(roundNumber, order, teamASeed, teamBSeed, scoreA, scoreB, bo) {
    const teamA = team(teamASeed);
    const teamB = team(teamBSeed);
    const result = scoreA > scoreB ? 'team_a_win' : 'team_b_win';
    const winner = scoreA > scoreB ? teamA.id : teamB.id;
    await c.query("insert into tournament_matches (event_id, round_id, team_a_id, team_b_id, score_a, score_b, match_best_of, result, pairing_order, winner_team_id, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())", [event.id, round(roundNumber).id, teamA.id, teamB.id, scoreA, scoreB, bo, result, order, winner]);
  }

  await addMatch(1,1,1,8,1,0,1);
  await addMatch(1,2,4,5,1,0,1);
  await addMatch(1,3,3,6,1,0,1);
  await addMatch(1,4,2,7,1,0,1);
  await addMatch(2,1,8,5,0,1,1);
  await addMatch(2,2,6,7,1,0,1);
  await addMatch(3,1,1,4,1,0,1);
  await addMatch(3,2,3,2,0,1,1);
  await addMatch(4,1,5,4,0,1,1);
  await addMatch(4,2,6,3,0,1,1);
  await addMatch(5,1,4,3,1,2,3);
  await addMatch(6,1,1,2,2,1,3);
  await addMatch(7,1,3,2,0,2,3);
  await addMatch(8,1,1,2,3,1,5);

  await c.query('COMMIT');
  const verify = await c.query("select e.id, e.code, e.name, e.status, e.total_teams, e.total_rounds, count(distinct r.id)::int as rounds_count, count(m.id)::int as matches_count from tournament_events e left join tournament_rounds r on r.event_id=e.id left join tournament_matches m on m.event_id=e.id where e.id=$1 group by e.id", [event.id]);
  console.log(JSON.stringify({ created: verify.rows[0] }, null, 2));
  await c.end();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

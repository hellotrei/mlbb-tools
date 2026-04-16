UPDATE tournament_events
SET event_mode = 'regular_season'
WHERE format = 'swiss_stage'
  AND event_mode = 'playoffs';

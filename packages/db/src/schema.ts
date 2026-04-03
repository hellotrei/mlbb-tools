import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";

export const heroes = pgTable(
  "heroes",
  {
    id: serial("id").primaryKey(),
    mlid: integer("mlid").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    rolePrimary: varchar("role_primary", { length: 40 }).notNull(),
    roleSecondary: varchar("role_secondary", { length: 40 }),
    lanes: jsonb("lanes").$type<string[]>().notNull().default([]),
    specialities: jsonb("specialities").$type<string[]>().notNull().default([]),
    imageKey: varchar("image_key", { length: 255 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    heroesMlidUnique: uniqueIndex("heroes_mlid_unique").on(table.mlid),
    heroesSlugUnique: uniqueIndex("heroes_slug_unique").on(table.slug)
  })
);

export const heroStatsSnapshots = pgTable("hero_stats_snapshots", {
  id: serial("id").primaryKey(),
  timeframe: varchar("timeframe", { length: 8 }).notNull(),
  rankScope: varchar("rank_scope", { length: 40 }).notNull().default("all"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({})
});

export const heroStatsLatest = pgTable(
  "hero_stats_latest",
  {
    id: serial("id").primaryKey(),
    mlid: integer("mlid").notNull(),
    timeframe: varchar("timeframe", { length: 8 }).notNull(),
    winRate: numeric("win_rate", { precision: 6, scale: 3 }).notNull(),
    pickRate: numeric("pick_rate", { precision: 6, scale: 3 }).notNull(),
    banRate: numeric("ban_rate", { precision: 6, scale: 3 }).notNull(),
    appearance: integer("appearance"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    heroStatsLatestUnique: uniqueIndex("hero_stats_latest_mlid_timeframe_unique").on(
      table.mlid,
      table.timeframe
    ),
    heroStatsLatestWinRateIdx: index("hero_stats_latest_timeframe_win_rate_idx").on(
      table.timeframe,
      table.winRate
    ),
    heroStatsLatestPickRateIdx: index("hero_stats_latest_timeframe_pick_rate_idx").on(
      table.timeframe,
      table.pickRate
    ),
    heroStatsLatestBanRateIdx: index("hero_stats_latest_timeframe_ban_rate_idx").on(
      table.timeframe,
      table.banRate
    )
  })
);

export const tierResults = pgTable("tier_results", {
  id: serial("id").primaryKey(),
  timeframe: varchar("timeframe", { length: 8 }).notNull(),
  segment: varchar("segment", { length: 120 }).notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  rows: jsonb("rows").$type<Array<Record<string, unknown>>>().notNull().default([])
});

export const counterMatrix = pgTable(
  "counter_matrix",
  {
    id: serial("id").primaryKey(),
    timeframe: varchar("timeframe", { length: 8 }).notNull(),
    enemyMlid: integer("enemy_mlid").notNull(),
    counterMlid: integer("counter_mlid").notNull(),
    score: numeric("score", { precision: 6, scale: 4 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    counterMatrixIdx: index("counter_matrix_timeframe_enemy_score_idx").on(
      table.timeframe,
      table.enemyMlid,
      table.score
    ),
    counterMatrixUnique: uniqueIndex("counter_matrix_unique").on(
      table.timeframe,
      table.enemyMlid,
      table.counterMlid
    )
  })
);

export const heroRolePool = pgTable(
  "hero_role_pool",
  {
    id: serial("id").primaryKey(),
    mlid: integer("mlid").notNull(),
    lane: varchar("lane", { length: 16 }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    source: varchar("source", { length: 24 }).notNull().default("derived"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    heroRolePoolUnique: uniqueIndex("hero_role_pool_unique").on(table.mlid, table.lane),
    heroRolePoolLaneConfidenceIdx: index("hero_role_pool_lane_confidence_idx").on(
      table.lane,
      table.confidence
    )
  })
);

export const synergyMatrix = pgTable(
  "synergy_matrix",
  {
    id: serial("id").primaryKey(),
    timeframe: varchar("timeframe", { length: 8 }).notNull(),
    heroMlid: integer("hero_mlid").notNull(),
    synergyMlid: integer("synergy_mlid").notNull(),
    score: numeric("score", { precision: 6, scale: 4 }).notNull(),
    source: varchar("source", { length: 16 }).notNull().default("meta"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    synergyMatrixUnique: uniqueIndex("synergy_matrix_unique").on(
      table.timeframe,
      table.heroMlid,
      table.synergyMlid
    ),
    synergyMatrixHeroScoreIdx: index("synergy_matrix_hero_score_idx").on(
      table.timeframe,
      table.heroMlid,
      table.score
    )
  })
);

export const counterPickHistory = pgTable(
  "counter_pick_history",
  {
    id: serial("id").primaryKey(),
    timeframe: varchar("timeframe", { length: 8 }).notNull(),
    rankScope: varchar("rank_scope", { length: 40 }).notNull().default("mythic_glory"),
    enemyMlids: jsonb("enemy_mlids").$type<number[]>().notNull().default([]),
    recommendedMlids: jsonb("recommended_mlids").$type<number[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    counterPickHistoryTimeframeRankIdx: index("counter_pick_history_timeframe_rank_idx").on(
      table.timeframe,
      table.rankScope,
      table.createdAt
    )
  })
);

export const tournamentEvents = pgTable(
  "tournament_events",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 24 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    format: varchar("format", { length: 24 }).notNull().default("swiss"),
    eventMode: varchar("event_mode", { length: 24 }).notNull().default("regular_season"),
    matchBestOf: integer("match_best_of").notNull().default(2),
    totalTeams: integer("total_teams").notNull(),
    totalRounds: integer("total_rounds").notNull(),
    eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("ongoing"),
    createdByTelegramUserId: varchar("created_by_telegram_user_id", { length: 64 }).notNull(),
    telegramChatId: varchar("telegram_chat_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tournamentEventsCodeUnique: uniqueIndex("tournament_events_code_unique").on(table.code),
    tournamentEventsTelegramUserIdx: index("tournament_events_telegram_user_idx").on(
      table.createdByTelegramUserId,
      table.createdAt
    ),
    tournamentEventsTelegramChatIdx: index("tournament_events_telegram_chat_idx").on(
      table.telegramChatId,
      table.createdAt
    ),
    tournamentEventsStatusIdx: index("tournament_events_status_idx").on(table.status, table.createdAt)
  })
);

export const tournamentTeams = pgTable(
  "tournament_teams",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    seed: integer("seed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tournamentTeamsEventSeedUnique: uniqueIndex("tournament_teams_event_seed_unique").on(
      table.eventId,
      table.seed
    ),
    tournamentTeamsEventNameUnique: uniqueIndex("tournament_teams_event_name_unique").on(
      table.eventId,
      table.name
    ),
    tournamentTeamsEventIdx: index("tournament_teams_event_idx").on(table.eventId, table.createdAt)
  })
);

export const tournamentRounds = pgTable(
  "tournament_rounds",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tournamentRoundsEventRoundUnique: uniqueIndex("tournament_rounds_event_round_unique").on(
      table.eventId,
      table.roundNumber
    ),
    tournamentRoundsEventIdx: index("tournament_rounds_event_idx").on(table.eventId, table.roundNumber)
  })
);

export const tournamentMatches = pgTable(
  "tournament_matches",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => tournamentEvents.id, { onDelete: "cascade" }),
    roundId: integer("round_id").notNull().references(() => tournamentRounds.id, { onDelete: "cascade" }),
    teamAId: integer("team_a_id").notNull().references(() => tournamentTeams.id, { onDelete: "cascade" }),
    teamBId: integer("team_b_id").references(() => tournamentTeams.id, { onDelete: "cascade" }),
    scoreA: integer("score_a"),
    scoreB: integer("score_b"),
    result: varchar("result", { length: 24 }).notNull().default("pending"),
    pairingOrder: integer("pairing_order").notNull(),
    winnerTeamId: integer("winner_team_id").references(() => tournamentTeams.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tournamentMatchesRoundOrderUnique: uniqueIndex("tournament_matches_round_order_unique").on(
      table.roundId,
      table.pairingOrder
    ),
    tournamentMatchesEventRoundIdx: index("tournament_matches_event_round_idx").on(
      table.eventId,
      table.roundId,
      table.pairingOrder
    ),
    tournamentMatchesEventResultIdx: index("tournament_matches_event_result_idx").on(
      table.eventId,
      table.result
    )
  })
);

export const telegramSessions = pgTable(
  "telegram_sessions",
  {
    id: serial("id").primaryKey(),
    telegramUserId: varchar("telegram_user_id", { length: 64 }).notNull(),
    currentCommand: varchar("current_command", { length: 64 }).notNull(),
    step: varchar("step", { length: 64 }).notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
    expiredAt: timestamp("expired_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    telegramSessionsUserCommandIdx: index("telegram_sessions_user_command_idx").on(
      table.telegramUserId,
      table.currentCommand,
      table.updatedAt
    ),
    telegramSessionsExpiryIdx: index("telegram_sessions_expiry_idx").on(table.expiredAt)
  })
);

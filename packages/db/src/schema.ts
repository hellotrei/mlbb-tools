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

import { z } from "zod";

export const roleSchema = z.enum(["tank", "fighter", "assassin", "mage", "marksman", "support"]);
export const laneSchema = z.enum(["gold", "exp", "mid", "roam", "jungle"]);
export const timeframeSchema = z.enum(["1d", "3d", "7d", "15d", "30d"]);
export const tierSchema = z.enum(["SS", "S", "A", "B", "C", "D"]);
export const rankScopeSchema = z.enum([
  "all_rank",
  "epic",
  "legend",
  "mythic",
  "mythic_honor",
  "mythic_glory",
  "grandmaster",
  "master",
  "elite",
  "warrior"
]);

const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(200).default(50);

export const statsQuerySchema = z.object({
  timeframe: timeframeSchema.default("7d"),
  role: roleSchema.optional(),
  lane: laneSchema.optional(),
  speciality: z.string().trim().min(1).optional(),
  sort: z.enum(["win_rate", "pick_rate", "ban_rate", "appearance"]).default("win_rate"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: pageSchema,
  limit: limitSchema,
  search: z.string().trim().optional()
});

export const tierQuerySchema = z.object({
  timeframe: timeframeSchema.default("7d"),
  role: roleSchema.optional(),
  lane: laneSchema.optional(),
  rankScope: rankScopeSchema.optional()
});

export const countersBodySchema = z.object({
  timeframe: timeframeSchema.default("7d"),
  enemyMlids: z.array(z.number().int().positive()).min(1).max(5),
  preferredRole: roleSchema.optional(),
  preferredLane: laneSchema.optional()
});

export const draftAnalyzeBodySchema = z.object({
  timeframe: timeframeSchema.default("7d"),
  allyMlids: z.array(z.number().int().positive()).max(5),
  enemyMlids: z.array(z.number().int().positive()).max(5)
});

export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type TierQuery = z.infer<typeof tierQuerySchema>;
export type CountersBody = z.infer<typeof countersBodySchema>;
export type DraftAnalyzeBody = z.infer<typeof draftAnalyzeBodySchema>;

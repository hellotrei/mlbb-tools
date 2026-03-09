import { sql } from "drizzle-orm";
import { db, heroStatsLatest, heroStatsSnapshots } from "@mlbb/db";
import type { Timeframe } from "@mlbb/shared";
import { fetchGmsStats } from "../services/gms.js";

export async function runIngest(timeframe: Timeframe) {
  const { allRows, rowsByScope } = await fetchGmsStats(timeframe);
  const fetchedAt = new Date();

  for (const [rankScope, scopedRows] of Object.entries(rowsByScope)) {
    const snapshotData = Object.fromEntries(
      scopedRows.map((row) => [
        row.mlid,
        {
          winRate: row.winRate,
          pickRate: row.pickRate,
          banRate: row.banRate,
          appearance: row.appearance ?? null
        }
      ])
    );

    await db.insert(heroStatsSnapshots).values({
      timeframe,
      rankScope,
      fetchedAt,
      data: snapshotData
    });
  }

  const values = allRows.map((row) => ({
    mlid: row.mlid,
    timeframe,
    winRate: String(row.winRate),
    pickRate: String(row.pickRate),
    banRate: String(row.banRate),
    appearance: row.appearance,
    updatedAt: fetchedAt
  }));

  if (values.length > 0) {
    await db
      .insert(heroStatsLatest)
      .values(values)
      .onConflictDoUpdate({
        target: [heroStatsLatest.mlid, heroStatsLatest.timeframe],
        set: {
          winRate: sql`excluded.win_rate`,
          pickRate: sql`excluded.pick_rate`,
          banRate: sql`excluded.ban_rate`,
          appearance: sql`excluded.appearance`,
          updatedAt: fetchedAt
        }
      });
  }
}

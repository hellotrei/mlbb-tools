import { db, heroStatsLatest, heroStatsSnapshots } from "@mlbb/db";
import type { Timeframe } from "@mlbb/shared";
import { fetchGmsStats } from "../services/gms";

export async function runIngest(timeframe: Timeframe) {
  const { allRows, rowsByScope } = await fetchGmsStats(timeframe);

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
      fetchedAt: new Date(),
      data: snapshotData
    });
  }

  for (const row of allRows) {
    await db
      .insert(heroStatsLatest)
      .values({
        mlid: row.mlid,
        timeframe,
        winRate: String(row.winRate),
        pickRate: String(row.pickRate),
        banRate: String(row.banRate),
        appearance: row.appearance,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [heroStatsLatest.mlid, heroStatsLatest.timeframe],
        set: {
          winRate: String(row.winRate),
          pickRate: String(row.pickRate),
          banRate: String(row.banRate),
          appearance: row.appearance,
          updatedAt: new Date()
        }
      });
  }
}

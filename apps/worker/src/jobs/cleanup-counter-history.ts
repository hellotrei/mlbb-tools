import { lt } from "drizzle-orm";
import { counterPickHistory, db } from "@mlbb/db";

const RETENTION_DAYS = 30;

export async function runCleanupCounterPickHistory() {
  await db
    .delete(counterPickHistory)
    .where(lt(counterPickHistory.createdAt, new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)));
}

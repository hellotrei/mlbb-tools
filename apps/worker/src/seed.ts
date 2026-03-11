import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), "../../.env") });

import { importHeroMeta } from "./services/meta.js";
import { syncHeroRolePool } from "./services/role-pool.js";
import { runIngest } from "./jobs/ingest.js";
import { runComputeTier } from "./jobs/compute-tier.js";
import { runComputeCounters } from "./jobs/compute-counters.js";
import { runComputeSynergies } from "./jobs/compute-synergies.js";

const TIMEFRAMES = ["7d", "15d", "30d"] as const;

async function seed() {
  console.log("[seed] importing hero meta...");
  await importHeroMeta();
  console.log("[seed] hero meta done");

  console.log("[seed] syncing hero role pool...");
  await syncHeroRolePool();
  console.log("[seed] role pool done");

  for (const tf of TIMEFRAMES) {
    console.log(`[seed] ingesting stats for ${tf}...`);
    await runIngest(tf);
    console.log(`[seed] ingest ${tf} done`);

    console.log(`[seed] computing tier for ${tf}...`);
    await runComputeTier(tf);
    console.log(`[seed] tier ${tf} done`);

    console.log(`[seed] computing counters for ${tf}...`);
    await runComputeCounters(tf);
    console.log(`[seed] counters ${tf} done`);

    console.log(`[seed] computing synergies for ${tf}...`);
    await runComputeSynergies(tf);
    console.log(`[seed] synergies ${tf} done`);
  }

  console.log("[seed] all done!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});

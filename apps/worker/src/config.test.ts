import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkerRuntimeConfig } from "./config";

test("parseWorkerRuntimeConfig applies worker defaults", () => {
  const config = parseWorkerRuntimeConfig({});

  assert.equal(config.redisUrl, "redis://localhost:6379");
  assert.deepEqual(config.activeTimeframes, ["7d", "15d", "30d"]);
  assert.equal(config.ingestCron, "*/30 * * * *");
});

test("parseWorkerRuntimeConfig trims and validates configured timeframes", () => {
  const config = parseWorkerRuntimeConfig({
    ACTIVE_TIMEFRAMES: " 1d, 7d ,30d "
  });

  assert.deepEqual(config.activeTimeframes, ["1d", "7d", "30d"]);
});

test("parseWorkerRuntimeConfig rejects unsupported timeframes", () => {
  assert.throws(
    () => parseWorkerRuntimeConfig({ ACTIVE_TIMEFRAMES: "7d,90d" }),
    /ACTIVE_TIMEFRAMES/
  );
});

test("parseWorkerRuntimeConfig rejects invalid cron expressions", () => {
  assert.throws(
    () => parseWorkerRuntimeConfig({ INGEST_CRON: "not-a-cron" }),
    /INGEST_CRON/
  );
});

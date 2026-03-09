import assert from "node:assert/strict";
import test from "node:test";
import type { HeroMetaLike } from "./meta.js";
import { resolveHeroMetaDataset } from "./meta.js";

const fallbackDataset: HeroMetaLike[] = [{ mlid: 1, name: "Akai" }];

test("resolveHeroMetaDataset prefers the primary dataset when it is populated", async () => {
  const primaryDataset: HeroMetaLike[] = [{ mlid: 2, name: "Faramis" }];

  const dataset = await resolveHeroMetaDataset({
    loadPrimary: async () => primaryDataset,
    loadFallback: async () => fallbackDataset
  });

  assert.deepEqual(dataset, primaryDataset);
});

test("resolveHeroMetaDataset falls back when the primary dataset is empty", async () => {
  const dataset = await resolveHeroMetaDataset({
    loadPrimary: async () => [],
    loadFallback: async () => fallbackDataset
  });

  assert.deepEqual(dataset, fallbackDataset);
});

test("resolveHeroMetaDataset falls back when the primary loader throws", async () => {
  const dataset = await resolveHeroMetaDataset({
    loadPrimary: async () => {
      throw new Error("upstream unavailable");
    },
    loadFallback: async () => fallbackDataset
  });

  assert.deepEqual(dataset, fallbackDataset);
});

test("resolveHeroMetaDataset throws when both sources are empty", async () => {
  await assert.rejects(
    () =>
      resolveHeroMetaDataset({
        loadPrimary: async () => [],
        loadFallback: async () => []
      }),
    /hero meta dataset is empty/
  );
});

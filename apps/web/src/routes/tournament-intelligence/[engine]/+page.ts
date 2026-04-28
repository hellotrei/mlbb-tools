import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { apiUrl } from "$lib/api";

const ENGINE_MAP = {
  "mpl-id": { label: "MPL ID Meta Tracker" },
  "mpl-ph": { label: "MPL PH Meta Tracker" }
} as const;

export const load: PageLoad = async ({ fetch, params }) => {
  const engine = params.engine as keyof typeof ENGINE_MAP;
  if (!(engine in ENGINE_MAP)) {
    throw error(404, "Tournament intelligence engine not found.");
  }

  const [statusRes, reviewRes] = await Promise.all([
    fetch(apiUrl(`/draft/${engine}/status`), { cache: "no-store" }),
    fetch(apiUrl(`/draft/${engine}/postmatch-intelligence`), { cache: "no-store" })
  ]);

  if (!statusRes.ok && statusRes.status !== 503) {
    throw error(503, "Failed to load tournament intelligence status.");
  }

  if (!reviewRes.ok) {
    throw error(503, "Failed to load tournament intelligence review.");
  }

  return {
    engine,
    label: ENGINE_MAP[engine].label,
    status: await statusRes.json(),
    review: await reviewRes.json()
  };
};

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

  const statusPayload = await statusRes.json().catch(() => ({
    available: false,
    totalMaps: 0,
    generatedAt: null,
    reason: "Failed to load status.",
    readiness: "empty"
  }));
  const reviewPayload = await reviewRes.json().catch(() => null);
  const fallbackReason =
    statusPayload?.reason ??
    (reviewPayload && typeof reviewPayload === "object" && "reason" in reviewPayload
      ? String((reviewPayload as { reason?: unknown }).reason ?? "")
      : "") ??
    "";

  return {
    engine,
    label: ENGINE_MAP[engine].label,
    status: statusPayload,
    review:
      reviewRes.ok && reviewPayload
        ? reviewPayload
        : {
            methodologyNote: fallbackReason || `${ENGINE_MAP[engine].label} data is temporarily unavailable.`,
            draftLogCoverage: 0,
            items: []
          }
  };
};

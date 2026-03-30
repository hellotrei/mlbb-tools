import { writable } from "svelte/store";

export type RecommendationEngine = "community" | "m7" | "mpl_ph" | "mpl_id";
export type TournamentEngineUiState = "loading" | "available" | "limited" | "empty" | "error";

export type TournamentEngineStatus = {
  state: TournamentEngineUiState;
  available: boolean;
  readiness: "empty" | "limited" | "ready" | null;
  reason: string;
  upstreamHealthy: boolean | null;
};

const initialTournamentEngineStatus: TournamentEngineStatus = {
  state: "loading",
  available: false,
  readiness: null,
  reason: "",
  upstreamHealthy: null
};

export function resolveTournamentEngineStatus(payload: unknown, fallbackReason = ""): TournamentEngineStatus {
  const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const available = Boolean(source.available);
  const readinessValue = source.readiness;
  const readiness =
    readinessValue === "empty" || readinessValue === "limited" || readinessValue === "ready"
      ? readinessValue
      : null;
  const reason = String(source.reason ?? fallbackReason ?? "");
  const upstreamHealthy = typeof source.upstreamHealthy === "boolean" ? source.upstreamHealthy : null;

  let state: TournamentEngineUiState = "error";
  if (available && readiness === "limited") state = "limited";
  else if (available) state = "available";
  else if (readiness === "empty") state = "empty";
  else if (!reason && upstreamHealthy !== false) state = "loading";

  return { state, available, readiness, reason, upstreamHealthy };
}

export const engine = writable<RecommendationEngine>("community");
export const m7Status = writable<TournamentEngineStatus>(initialTournamentEngineStatus);
export const mplPhStatus = writable<TournamentEngineStatus>(initialTournamentEngineStatus);
export const mplIdStatus = writable<TournamentEngineStatus>(initialTournamentEngineStatus);

import { writable } from "svelte/store";

export type RecommendationEngine = "community" | "m7";

export const engine = writable<RecommendationEngine>("community");
export const m7Available = writable<boolean>(false);
export const m7StatusLoaded = writable<boolean>(false);
export const m7StatusReason = writable<string>("");

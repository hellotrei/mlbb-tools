import { writable } from "svelte/store";

export type RecommendationEngine = "community" | "m7" | "mpl_ph" | "mpl_id";

export const engine = writable<RecommendationEngine>("community");
export const m7Available = writable<boolean>(false);
export const m7StatusLoaded = writable<boolean>(false);
export const m7StatusReason = writable<string>("");
export const mplPhAvailable = writable<boolean>(false);
export const mplPhStatusLoaded = writable<boolean>(false);
export const mplPhStatusReason = writable<string>("");
export const mplIdAvailable = writable<boolean>(false);
export const mplIdStatusLoaded = writable<boolean>(false);
export const mplIdStatusReason = writable<string>("");

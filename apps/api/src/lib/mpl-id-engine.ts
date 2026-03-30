import { createTournamentEngine } from "./tournament-engine.js";

const MPL_ID_PAGES = [
  "MPL/Indonesia/Season_17/Regular_Season"
] as const;

const engine = createTournamentEngine({ pages: MPL_ID_PAGES, engineId: "mpl_id" });

export const getMplIdStatus = engine.getStatus;
export const getMplIdHeroList = engine.getHeroList;
export const getMplIdHeroCounters = engine.getHeroCounters;
export const getMplIdHeroProfile = engine.getHeroProfile;
export const analyzeMplIdDraft = engine.analyzeDraft;
export const matchupMplIdDraft = engine.matchupDraft;

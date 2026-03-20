import { createTournamentEngine } from "./tournament-engine.js";

const MPL_PH_PAGES = [
  "MPL/Philippines/Season_17/Regular_Season"
] as const;

const engine = createTournamentEngine({ pages: MPL_PH_PAGES, engineId: "mpl_ph" });

export const getMplPhStatus = engine.getStatus;
export const getMplPhHeroList = engine.getHeroList;
export const getMplPhHeroCounters = engine.getHeroCounters;
export const getMplPhHeroProfile = engine.getHeroProfile;
export const analyzeMplPhDraft = engine.analyzeDraft;
export const matchupMplPhDraft = engine.matchupDraft;

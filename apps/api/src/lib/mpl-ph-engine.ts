import { createTournamentEngine } from "./tournament-engine.js";
import { TOURNAMENT_ENGINE_CONFIG } from "./tournament-engine-config.js";

const config = TOURNAMENT_ENGINE_CONFIG.mpl_ph;
const engine = createTournamentEngine({ pages: config.pages, engineId: config.engineId });

export const getMplPhStatus = engine.getStatus;
export const getMplPhHeroList = engine.getHeroList;
export const getMplPhHeroCounters = engine.getHeroCounters;
export const getMplPhHeroProfile = engine.getHeroProfile;
export const analyzeMplPhDraft = engine.analyzeDraft;
export const matchupMplPhDraft = engine.matchupDraft;

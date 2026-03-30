import { createTournamentEngine } from "./tournament-engine.js";
import { TOURNAMENT_ENGINE_CONFIG } from "./tournament-engine-config.js";

const config = TOURNAMENT_ENGINE_CONFIG.mpl_id;
const engine = createTournamentEngine({ pages: config.pages, engineId: config.engineId });

export const getMplIdStatus = engine.getStatus;
export const getMplIdHeroList = engine.getHeroList;
export const getMplIdHeroCounters = engine.getHeroCounters;
export const getMplIdHeroProfile = engine.getHeroProfile;
export const analyzeMplIdDraft = engine.analyzeDraft;
export const matchupMplIdDraft = engine.matchupDraft;

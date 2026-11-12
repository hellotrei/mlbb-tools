import { createTournamentEngine } from "./tournament-engine.js";
import { TOURNAMENT_ENGINE_CONFIG } from "./tournament-engine-config.js";

const config = TOURNAMENT_ENGINE_CONFIG.mpl_id_s18;
const engine = createTournamentEngine({ pages: config.pages, engineId: config.engineId });

export const getMplIdS18Status = engine.getStatus;
export const getMplIdS18HeroList = engine.getHeroList;
export const getMplIdS18HeroCounters = engine.getHeroCounters;
export const getMplIdS18HeroProfile = engine.getHeroProfile;
export const analyzeMplIdS18Draft = engine.analyzeDraft;
export const matchupMplIdS18Draft = engine.matchupDraft;
export const getMplIdS18PostmatchIntelligence = engine.getPostmatchIntelligence;

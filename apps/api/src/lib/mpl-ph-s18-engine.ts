import { createTournamentEngine } from "./tournament-engine.js";
import { TOURNAMENT_ENGINE_CONFIG } from "./tournament-engine-config.js";

const config = TOURNAMENT_ENGINE_CONFIG.mpl_ph_s18;
const engine = createTournamentEngine({ pages: config.pages, engineId: config.engineId });

export const getMplPhS18Status = engine.getStatus;
export const getMplPhS18HeroList = engine.getHeroList;
export const getMplPhS18HeroCounters = engine.getHeroCounters;
export const getMplPhS18HeroProfile = engine.getHeroProfile;
export const analyzeMplPhS18Draft = engine.analyzeDraft;
export const matchupMplPhS18Draft = engine.matchupDraft;
export const getMplPhS18PostmatchIntelligence = engine.getPostmatchIntelligence;

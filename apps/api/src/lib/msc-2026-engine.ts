import { createTournamentEngine } from "./tournament-engine.js";
import { TOURNAMENT_ENGINE_CONFIG } from "./tournament-engine-config.js";

const config = TOURNAMENT_ENGINE_CONFIG.msc_2026;
const engine = createTournamentEngine({ pages: config.pages, engineId: config.engineId });

export const getMsc2026Status = engine.getStatus;
export const getMsc2026HeroList = engine.getHeroList;
export const getMsc2026HeroCounters = engine.getHeroCounters;
export const getMsc2026HeroProfile = engine.getHeroProfile;
export const analyzeMsc2026Draft = engine.analyzeDraft;
export const matchupMsc2026Draft = engine.matchupDraft;
export const getMsc2026PostmatchIntelligence = engine.getPostmatchIntelligence;

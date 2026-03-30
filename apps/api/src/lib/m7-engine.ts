import { createTournamentEngine } from "./tournament-engine.js";
import { TOURNAMENT_ENGINE_CONFIG } from "./tournament-engine-config.js";

const config = TOURNAMENT_ENGINE_CONFIG.m7;
const engine = createTournamentEngine({ pages: config.pages, engineId: config.engineId });

export const getM7Status = engine.getStatus;
export const getM7HeroList = engine.getHeroList;
export const getM7HeroCounters = engine.getHeroCounters;
export const getM7HeroProfile = engine.getHeroProfile;
export const analyzeM7Draft = engine.analyzeDraft;
export const matchupM7Draft = engine.matchupDraft;

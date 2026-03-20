import { createTournamentEngine } from "./tournament-engine.js";

const M7_PAGES = [
  "M7_World_Championship/Swiss_Stage",
  "M7_World_Championship/Knockout_Stage"
] as const;

const engine = createTournamentEngine({ pages: M7_PAGES, engineId: "m7" });

export const getM7Status = engine.getStatus;
export const getM7HeroList = engine.getHeroList;
export const getM7HeroCounters = engine.getHeroCounters;
export const getM7HeroProfile = engine.getHeroProfile;
export const analyzeM7Draft = engine.analyzeDraft;
export const matchupM7Draft = engine.matchupDraft;

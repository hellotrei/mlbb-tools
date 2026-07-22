import { createCommunityEngine } from "./community-engine.js";

const engine = createCommunityEngine();

export const getCommunityStatus = engine.getStatus;
export const getCommunityHeroList = engine.getHeroList;
export const getCommunityHeroCounters = engine.getHeroCounters;
export const getCommunityHeroProfile = engine.getHeroProfile;
export const analyzeCommunityDraft = engine.analyzeDraft;
export const matchupCommunityDraft = engine.matchupDraft;
export const getCommunityPostmatchIntelligence = engine.getPostmatchIntelligence;

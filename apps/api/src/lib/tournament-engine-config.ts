export const TOURNAMENT_ENGINE_CONFIG = {
  m7: {
    engineId: "m7",
    pages: [
      "M7_World_Championship/Swiss_Stage",
      "M7_World_Championship/Knockout_Stage"
    ] as const
  },
  mpl_ph: {
    engineId: "mpl_ph",
    pages: [
      "MPL/Philippines/Season_17/Regular_Season"
    ] as const
  },
  mpl_id: {
    engineId: "mpl_id",
    pages: [
      "MPL/Indonesia/Season_17/Regular_Season"
    ] as const
  }
} as const;

export type TournamentEngineKey = keyof typeof TOURNAMENT_ENGINE_CONFIG;

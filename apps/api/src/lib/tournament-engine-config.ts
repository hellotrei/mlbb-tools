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
      "MPL/Philippines/Season_17/Regular_Season",
      "MPL/Philippines/Season_17/Playoffs"
    ] as const
  },
  mpl_id: {
    engineId: "mpl_id",
    pages: [
      "MPL/Indonesia/Season_17/Regular_Season",
      "MPL/Indonesia/Season_17/Playoffs"
    ] as const
  },
  msc_2026: {
    engineId: "msc_2026",
    pages: [
      "MSC/2026/Group_Stage",
      "MSC/2026/Knockout_Stage"
    ] as const
  },
  mpl_id_s18: {
    engineId: "mpl_id_s18",
    pages: [
      "MPL/Indonesia/Season_18/Regular_Season",
      "MPL/Indonesia/Season_18/Playoffs"
    ] as const
  },
  mpl_ph_s18: {
    engineId: "mpl_ph_s18",
    pages: [
      "MPL/Philippines/Season_18/Regular_Season",
      "MPL/Philippines/Season_18/Playoffs"
    ] as const
  }
} as const;

export type TournamentEngineKey = keyof typeof TOURNAMENT_ENGINE_CONFIG;

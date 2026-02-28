export type Archetype = "dive" | "poke" | "sustain" | "splitpush" | "teamfight" | "burst" | "balanced";

export interface ArchetypeProfile {
  archetype: Archetype;
  confidence: number;
}

const TAG_ARCHETYPE_MAP: Record<string, Archetype[]> = {
  Finisher: ["dive", "burst"],
  Damage: ["teamfight", "burst"],
  Burst: ["burst", "dive"],
  Charge: ["dive", "teamfight"],
  Chase: ["dive", "splitpush"],
  Control: ["teamfight", "poke"],
  "Crowd Control": ["teamfight", "dive"],
  Initiator: ["teamfight", "dive"],
  Poke: ["poke"],
  Push: ["splitpush"],
  Regen: ["sustain"],
  Guard: ["sustain", "teamfight"],
  Support: ["sustain", "poke"],
  "Magic Damage": ["teamfight", "burst"],
  "Mixed Damage": ["teamfight", "sustain"]
};

const ROLE_ARCHETYPE_AFFINITY: Record<string, Archetype[]> = {
  assassin: ["dive", "burst", "splitpush"],
  fighter: ["sustain", "splitpush", "dive"],
  mage: ["poke", "teamfight", "burst"],
  marksman: ["teamfight", "poke"],
  tank: ["teamfight", "dive", "sustain"],
  support: ["sustain", "teamfight", "poke"]
};

export function detectArchetypes(
  heroes: Array<{ rolePrimary: string; specialities: string[] }>
): ArchetypeProfile[] {
  const scores = new Map<Archetype, number>();

  for (const hero of heroes) {
    for (const spec of hero.specialities) {
      for (const arch of TAG_ARCHETYPE_MAP[spec] ?? []) {
        scores.set(arch, (scores.get(arch) ?? 0) + 1);
      }
    }
    for (const arch of ROLE_ARCHETYPE_AFFINITY[hero.rolePrimary] ?? []) {
      scores.set(arch, (scores.get(arch) ?? 0) + 0.5);
    }
  }

  const total = Array.from(scores.values()).reduce((s, v) => s + v, 0);
  if (total === 0) return [{ archetype: "balanced", confidence: 1 }];

  return Array.from(scores.entries())
    .map(([archetype, score]) => ({
      archetype,
      confidence: Number((score / total).toFixed(4))
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function archetypeBoost(
  candidateSpecialities: string[],
  candidateRole: string,
  detectedArchetypes: ArchetypeProfile[]
): number {
  const top = detectedArchetypes[0];
  if (!top || top.confidence < 0.25) return 0;

  let boost = 0;
  for (const spec of candidateSpecialities) {
    const archs = TAG_ARCHETYPE_MAP[spec] ?? [];
    if (archs.includes(top.archetype)) boost += 0.15;
  }
  const roleArchs = ROLE_ARCHETYPE_AFFINITY[candidateRole] ?? [];
  if (roleArchs.includes(top.archetype)) boost += 0.1;

  return Math.min(0.3, boost * top.confidence);
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, heroes } from "@mlbb/db";

const KNOWN_ROLES = ["tank", "fighter", "assassin", "mage", "marksman", "support"] as const;

function normalizeSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export interface HeroMetaLike {
  mlid?: number;
  id?: number | string;
  uid?: string;
  name?: string;
  hero_name?: string;
  rolePrimary?: string;
  role_primary?: string;
  class?: string;
  roleSecondary?: string | null;
  role_secondary?: string | null;
  lanes?: string[];
  laning?: string[];
  speciality?: string[] | string;
  specialty?: string[] | string;
  specialities?: string[];
  specialties?: string[];
  slug?: string;
  imageKey?: string;
  image_key?: string;
  hero_icon?: string;
  portrait?: string;
  counters?: Array<number | { heroid?: number | string }>;
}

function normalizeLane(lane: string): string {
  const value = lane.toLowerCase().trim();
  if (value.includes("gold")) return "gold";
  if (value.includes("exp")) return "exp";
  if (value.includes("mid")) return "mid";
  if (value.includes("roam")) return "roam";
  if (value.includes("jung")) return "jungle";
  return value;
}

function parseLanes(input: string[]) {
  return Array.from(
    new Set(
      input
        .flatMap((lane) => lane.split(/[,&/|]+/g))
        .map((lane) => normalizeLane(lane))
        .filter(Boolean)
    )
  );
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,&/|]+/g).map((item) => item.trim()).filter(Boolean);
  return [];
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeRoleToken(input: string): (typeof KNOWN_ROLES)[number] | null {
  const value = input.toLowerCase().trim();
  if (value.includes("marksman")) return "marksman";
  if (value.includes("assassin")) return "assassin";
  if (value.includes("fighter")) return "fighter";
  if (value.includes("support")) return "support";
  if (value.includes("tank")) return "tank";
  if (value.includes("mage")) return "mage";
  return null;
}

function parseRoles(item: HeroMetaLike) {
  const explicitPrimary = item.rolePrimary ?? item.role_primary;
  const explicitSecondary = item.roleSecondary ?? item.role_secondary ?? null;
  if (explicitPrimary) {
    const primary = normalizeRoleToken(explicitPrimary) ?? "fighter";
    const secondary = explicitSecondary ? normalizeRoleToken(explicitSecondary) : null;
    return { rolePrimary: primary, roleSecondary: secondary };
  }

  const classRaw = item.class ?? "";
  const parts = classRaw
    .split(/[,&/|]+/g)
    .map((part) => normalizeRoleToken(part))
    .filter((role): role is NonNullable<typeof role> => Boolean(role));

  return {
    rolePrimary: parts[0] ?? "fighter",
    roleSecondary: parts[1] ?? null
  };
}

export async function loadHeroMetaFile() {
  const file = resolve(process.cwd(), "../../data/hero-meta-final.json");

  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as HeroMetaLike[];
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown[] }).data)) {
      return (parsed as { data: HeroMetaLike[] }).data;
    }
    return [];
  } catch (error) {
    console.warn("[worker] hero-meta-final.json missing or invalid", error);
    return [];
  }
}

export async function importHeroMeta() {
  const items = await loadHeroMetaFile();
  if (items.length === 0) {
    console.warn("[worker] hero meta dataset is empty; /heroes will remain empty until data file is provided.");
    return;
  }

  const values = items
    .map((item) => {
      const mlidRaw = item.mlid ?? item.id;
      const mlid = Number(mlidRaw);
      const name = (item.name ?? item.hero_name)?.trim();
      if (!mlid || !name) return null;

      const { rolePrimary, roleSecondary } = parseRoles(item);
      const lanesInput = Array.isArray(item.lanes)
        ? item.lanes
        : Array.isArray(item.laning)
          ? item.laning
          : [];
      const lanes = parseLanes(lanesInput);
      const specialities = Array.from(
        new Set(
          [
            ...toStringList(item.speciality),
            ...toStringList(item.specialty),
            ...toStringList(item.specialities),
            ...toStringList(item.specialties)
          ]
        )
      );
      const slug = (item.slug?.toLowerCase() ?? item.uid?.toLowerCase() ?? normalizeSlug(name)).slice(0, 120);
      const imageCandidate = String(item.imageKey ?? item.image_key ?? item.hero_icon ?? "").trim();
      const portrait = String(item.portrait ?? "").trim();
      const imageKey = isHttpUrl(imageCandidate)
        ? imageCandidate
        : isHttpUrl(portrait)
          ? portrait
          : imageCandidate || slug;

      return {
        mlid,
        name,
        rolePrimary,
        roleSecondary,
        lanes,
        specialities,
        slug,
        imageKey
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  for (const value of values) {
    await db
      .insert(heroes)
      .values(value)
      .onConflictDoUpdate({
        target: heroes.mlid,
        set: {
          name: value.name,
          slug: value.slug,
          rolePrimary: value.rolePrimary,
          roleSecondary: value.roleSecondary,
          lanes: value.lanes,
          specialities: value.specialities,
          imageKey: value.imageKey,
          updatedAt: new Date()
        }
      });
  }

  console.log(`[worker] imported ${values.length} heroes`);
}

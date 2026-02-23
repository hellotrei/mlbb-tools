import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, heroes } from "@mlbb/db";

const KNOWN_ROLES = ["tank", "fighter", "assassin", "mage", "marksman", "support"] as const;
const HERO_META_SOURCE_CHOICES = ["auto", "gms", "file"] as const;
const DEFAULT_GMS_SOURCE_BASE_URL = "https://api.gms.moontontech.com/api/gms/source";
const DEFAULT_GMS_SOURCE_ID = "2669606";
const DEFAULT_GMS_META_ENDPOINT = "2756564";
const DEFAULT_GMS_LANG = "en";

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

interface GmsMetaResponse {
  code?: number;
  data?: {
    total?: number;
    records?: Array<{
      data?: {
        hero_id?: number | string;
        head?: string;
        hero?: {
          data?: {
            heroid?: number | string;
            name?: string;
            head?: string;
            sortlabel?: string[];
            roadsortlabel?: string[];
            speciality?: string[];
          };
        };
      };
    }>;
  };
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

function normalizeHeroMetaSource() {
  const value = process.env.HERO_META_SOURCE?.trim().toLowerCase() ?? "auto";
  if (HERO_META_SOURCE_CHOICES.includes(value as (typeof HERO_META_SOURCE_CHOICES)[number])) {
    return value as (typeof HERO_META_SOURCE_CHOICES)[number];
  }
  return "auto";
}

function gmsMetaEndpointUrl() {
  const base = (process.env.GMS_SOURCE_BASE_URL?.trim() || DEFAULT_GMS_SOURCE_BASE_URL).replace(/\/+$/, "");
  const sourceId = process.env.GMS_SOURCE_ID?.trim() || DEFAULT_GMS_SOURCE_ID;
  const endpoint = process.env.GMS_META_ENDPOINT?.trim() || DEFAULT_GMS_META_ENDPOINT;
  return `${base}/${sourceId}/${endpoint}`;
}

export async function loadHeroMetaFromGms() {
  const pageSize = Number(process.env.GMS_META_PAGE_SIZE ?? 100);
  const lang = process.env.GMS_LANG?.trim() || DEFAULT_GMS_LANG;
  const url = gmsMetaEndpointUrl();
  const deduped = new Map<number, HeroMetaLike>();

  let pageIndex = 1;
  let total = Number.POSITIVE_INFINITY;

  while ((pageIndex - 1) * pageSize < total) {
    const payloadBody = {
      pageSize,
      pageIndex,
      filters: [],
      sorts: [{ data: { field: "hero_id", order: "asc" }, type: "sequence" }],
      object: []
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "x-lang": lang,
        Accept: "application/json"
      },
      body: JSON.stringify(payloadBody)
    });

    if (!response.ok) {
      throw new Error(`GMS meta response ${response.status}`);
    }

    const payload = (await response.json()) as GmsMetaResponse;
    const records = payload.data?.records ?? [];
    total = Number(payload.data?.total ?? records.length);

    for (const record of records) {
      const data = record.data;
      const hero = data?.hero?.data;
      const mlid = Number(data?.hero_id ?? hero?.heroid);
      const name = String(hero?.name ?? "").trim();
      if (!mlid || !name) continue;

      const roles = toStringList(hero?.sortlabel).filter(Boolean);
      const lanes = toStringList(hero?.roadsortlabel).filter(Boolean);
      const specialities = toStringList(hero?.speciality).filter(Boolean);
      const portrait = String(hero?.head ?? data?.head ?? "").trim();

      deduped.set(mlid, {
        mlid,
        name,
        uid: normalizeSlug(name),
        rolePrimary: roles[0],
        roleSecondary: roles[1] || null,
        lanes,
        speciality: specialities,
        portrait,
        imageKey: portrait
      });
    }

    if (records.length === 0) break;
    pageIndex += 1;
  }

  return Array.from(deduped.values()).sort((a, b) => Number(a.mlid ?? 0) - Number(b.mlid ?? 0));
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

async function loadHeroMeta() {
  const source = normalizeHeroMetaSource();

  if (source === "file") {
    const items = await loadHeroMetaFile();
    console.log(`[worker] hero meta source=file rows=${items.length}`);
    return items;
  }

  if (source === "gms") {
    const items = await loadHeroMetaFromGms();
    console.log(`[worker] hero meta source=gms rows=${items.length}`);
    return items;
  }

  try {
    const fromGms = await loadHeroMetaFromGms();
    if (fromGms.length > 0) {
      console.log(`[worker] hero meta source=auto(gms) rows=${fromGms.length}`);
      return fromGms;
    }
  } catch (error) {
    console.warn("[worker] GMS hero meta fetch failed; falling back to file", error);
  }

  const fromFile = await loadHeroMetaFile();
  console.log(`[worker] hero meta source=auto(file) rows=${fromFile.length}`);
  return fromFile;
}

export async function importHeroMeta() {
  const items = await loadHeroMeta();
  if (items.length === 0) {
    console.warn("[worker] hero meta dataset is empty; /heroes will remain empty until data source is configured.");
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

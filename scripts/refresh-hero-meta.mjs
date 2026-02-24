import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const rootDir = process.cwd();
loadEnv({ path: resolve(rootDir, ".env") });

const DEFAULT_GMS_SOURCE_BASE_URL = "https://api.gms.moontontech.com/api/gms/source";
const DEFAULT_GMS_SOURCE_ID = "2669606";
const DEFAULT_GMS_META_ENDPOINT = "2756564";
const DEFAULT_GMS_LANG = "en";
const DEFAULT_PAGE_SIZE = 100;
const targetFile = resolve(rootDir, "data/hero-meta-final.json");

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,&/|]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function readConfig() {
  const base = (process.env.GMS_SOURCE_BASE_URL?.trim() || DEFAULT_GMS_SOURCE_BASE_URL).replace(/\/+$/, "");
  const sourceId = process.env.GMS_SOURCE_ID?.trim() || DEFAULT_GMS_SOURCE_ID;
  const endpoint = process.env.GMS_META_ENDPOINT?.trim() || DEFAULT_GMS_META_ENDPOINT;
  const lang = process.env.GMS_LANG?.trim() || DEFAULT_GMS_LANG;
  const apiKey = process.env.GMS_API_KEY?.trim();
  const pageSize = Math.min(200, Math.max(1, Number(process.env.GMS_META_PAGE_SIZE ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));
  return {
    url: `${base}/${sourceId}/${endpoint}`,
    lang,
    apiKey,
    pageSize
  };
}

async function readExistingData() {
  try {
    const raw = await readFile(targetFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.data)) return parsed.data;
    return [];
  } catch {
    return [];
  }
}

function normalizeExistingByMlid(existingRows) {
  const map = new Map();
  for (const row of existingRows) {
    const mlid = Number(row?.mlid ?? row?.id);
    if (!mlid) continue;
    map.set(mlid, row);
  }
  return map;
}

async function fetchMetaRows() {
  const { url, lang, apiKey, pageSize } = readConfig();
  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "x-lang": lang,
    Accept: "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const rows = new Map();
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
      headers,
      body: JSON.stringify(payloadBody)
    });

    if (!response.ok) {
      throw new Error(`GMS meta response ${response.status}`);
    }

    const payload = await response.json();
    const records = payload?.data?.records ?? [];
    total = Number(payload?.data?.total ?? records.length);

    for (const record of records) {
      const data = record?.data;
      const hero = data?.hero?.data;
      const mlid = Number(data?.hero_id ?? hero?.heroid);
      const heroName = String(hero?.name ?? "").trim();
      if (!mlid || !heroName) continue;

      const roles = toStringList(hero?.sortlabel);
      const lanes = toStringList(hero?.roadsortlabel);
      const speciality = toStringList(hero?.speciality);
      const portrait = String(hero?.head ?? data?.head ?? "").trim();
      const slug = slugify(heroName);

      rows.set(mlid, {
        hero_name: heroName,
        mlid: String(mlid),
        uid: slug,
        id: `h${String(mlid).padStart(3, "0")}`,
        hero_icon: `${slug}.png`,
        portrait,
        laning: lanes,
        class: roles.join(", "),
        speciality
      });
    }

    if (records.length === 0) break;
    pageIndex += 1;
  }

  return Array.from(rows.values()).sort((a, b) => Number(a.mlid) - Number(b.mlid));
}

function formatRevdate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function mergeRows(freshRows, existingByMlid) {
  return freshRows.map((row) => {
    const existing = existingByMlid.get(Number(row.mlid)) ?? {};
    return {
      hero_name: row.hero_name,
      mlid: row.mlid,
      uid: row.uid,
      id: row.id,
      hero_icon: existing.hero_icon || row.hero_icon,
      discordmoji: existing.discordmoji || "",
      portrait: row.portrait || existing.portrait || "",
      release_year: existing.release_year || "",
      laning: row.laning.length > 0 ? row.laning : existing.laning || [],
      class: row.class || existing.class || "",
      skills: Array.isArray(existing.skills) ? existing.skills : [],
      speciality: row.speciality.length > 0 ? row.speciality : existing.speciality || [],
      counters: Array.isArray(existing.counters) ? existing.counters : [],
      synergies: Array.isArray(existing.synergies) ? existing.synergies : []
    };
  });
}

async function main() {
  const existingRows = await readExistingData();
  const existingByMlid = normalizeExistingByMlid(existingRows);
  const freshRows = await fetchMetaRows();
  const mergedRows = mergeRows(freshRows, existingByMlid);

  const next = {
    title: "hero-schema",
    revdate: formatRevdate(new Date()),
    author: "mlbb-tools",
    source: "gms-api",
    data: mergedRows
  };

  await writeFile(targetFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`[meta-refresh] updated ${targetFile} rows=${mergedRows.length}`);
}

main().catch((error) => {
  console.error("[meta-refresh] failed", error);
  process.exit(1);
});

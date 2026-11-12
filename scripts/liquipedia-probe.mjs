#!/usr/bin/env node
// Pre-flight check for a Liquipedia-backed tournament dataset.
// Fetches the wikitext through the Cloudflare Worker proxy and reports exactly
// what the API engine would ingest, so a new season is validated BEFORE wiring
// an engine for it.
//
// Usage:
//   node scripts/liquipedia-probe.mjs "MPL/Indonesia/Season_18/Regular_Season" \
//        "MPL/Indonesia/Season_18/Playoffs" [--dump /tmp/s18] [--token-file /tmp/proxy_token.txt]
//
// Exit code 0 = every usable map would resolve; 1 = maps would be silently dropped.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const dumpDir = flag("--dump", null);
const tokenFile = flag("--token-file", "/tmp/proxy_token.txt");
const proxy = process.env.PROXY_URL || "https://liquipedia-proxy.mlbb-draft.workers.dev";
const pages = args.filter((a) => !a.startsWith("--") && a !== dumpDir && a !== tokenFile);

if (pages.length === 0) {
  console.error("no pages given");
  process.exit(2);
}

const token = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8").trim() : "";

// Mirrors normalizeHeroToken() in apps/api/src/lib/tournament-engine.ts
const HERO_ALIASES = {};
function normalizeHeroToken(input) {
  const key = input.toLowerCase().trim();
  return (HERO_ALIASES[key] ?? key)
    .replace(/x\.borg/g, "x-borg")
    .replace(/yi sun shin/g, "yi-sun-shin")
    .replace(/\byss\b/g, "yi-sun-shin")
    .replace(/\bphove\b/g, "phoveus")
    .replace(/\bvalen\b/g, "valentina")
    .replace(/\bleo\b/g, "leomord")
    .replace(/\bfred\b/g, "fredrinn")
    .replace(/\bgatot\b/g, "gatotkaca")
    .replace(/\bluo yi\b/g, "luo-yi")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadHeroTokens() {
  try {
    const out = execFileSync(
      "docker",
      ["exec", "mlbb-postgres", "psql", "-U", "postgres", "-d", "mlbb_tools", "-t", "-A", "-c",
       "SELECT slug FROM heroes UNION SELECT name FROM heroes;"],
      { encoding: "utf8" }
    );
    return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean).map(normalizeHeroToken));
  } catch {
    console.warn("!! could not read heroes table, skipping hero-resolution check");
    return null;
  }
}

const KNOWN_HEROES = loadHeroTokens();

const pick = (body, key) =>
  body.match(new RegExp(`\\|${key}=([^\\n\\r|}]*)`, "i"))?.[1]?.trim() ?? "";
const opponent = (body, key) =>
  body.match(new RegExp(`\\|${key}=\\{\\{TeamOpponent\\|([^|}\\n]+)`, "i"))?.[1]?.trim() ?? "";
const heroSeq = (body, prefix) => {
  const out = [];
  for (let i = 1; i <= 5; i += 1) {
    const value = pick(body, `${prefix}${i}`);
    if (value) out.push(value);
  }
  return out;
};

const MAP_BLOCK = /\|map\d+=\{\{Map\|([\s\S]*?)(?:\n\s*}}|}})/g;
const WEEK_HDR = /==+\s*(?:\{\{HiddenSort\|[^}]*?Week\s+(\d+)[^}]*\}\}|Week\s+(\d+))\s*==+/gi;
const PO_ROUND = /<!--\s*(Upper Bracket Quarterfinals|Upper Bracket Semifinals|Upper Bracket Final|Lower Bracket Semifinal|Lower Bracket Final|Grand Final)\s*-->/gi;

let failures = 0;

for (const page of pages) {
  const url = new URL(proxy);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", page);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("format", "json");

  let wikitext = "";
  try {
    const res = await fetch(url, {
      headers: { "x-proxy-token": token, "user-agent": "DraftArenaBot/1.0" }
    });
    const payload = await res.json().catch(() => null);
    wikitext = payload?.parse?.wikitext?.["*"] ?? "";
    if (!wikitext) {
      console.log(`\n${page}\n  FAIL status=${res.status} ${payload?.error?.info ?? "no wikitext"}`);
      failures += 1;
      continue;
    }
  } catch (error) {
    console.log(`\n${page}\n  FAIL fetch: ${error.message}`);
    failures += 1;
    continue;
  }

  if (dumpDir) {
    fs.mkdirSync(dumpDir, { recursive: true });
    fs.writeFileSync(path.join(dumpDir, `${page.replace(/[^A-Za-z0-9]+/g, "_")}.txt`), wikitext);
  }

  const blocks = [...wikitext.matchAll(MAP_BLOCK)].map((m) => m[1]);
  const usable = blocks.filter((b) => !/finished=skip/i.test(b));
  const weeks = [...wikitext.matchAll(WEEK_HDR)].map((m) => Number(m[1] ?? m[2]));
  const rounds = [...wikitext.matchAll(PO_ROUND)].map((m) => m[1]);

  const unresolved = new Map();
  let dropped = 0;
  let noDuration = 0;
  let noMapName = 0;
  let noMvp = 0;

  for (const block of usable) {
    if (!pick(block, "length") && !pick(block, "duration")) noDuration += 1;
    if (!pick(block, "map") && !pick(block, "mapmode") && !pick(block, "decider")) noMapName += 1;
    if (!pick(block, "mvp") && !pick(block, "playerofthegame")) noMvp += 1;

    let ok = true;
    for (const prefix of ["t1h", "t2h"]) {
      const tokens = heroSeq(block, prefix);
      if (tokens.length !== 5) ok = false;
      for (const raw of tokens) {
        const resolved = normalizeHeroToken(raw);
        if (KNOWN_HEROES && !KNOWN_HEROES.has(resolved)) {
          unresolved.set(raw, (unresolved.get(raw) ?? 0) + 1);
          ok = false;
        }
      }
    }
    if (!ok) dropped += 1;
  }

  const matchBlocks = [...wikitext.matchAll(/\{\{Match\s+\|/g)].length;
  // The engine stores `rawDate.split(" ")[0]` → check it still holds a real date.
  const matchInners = [];
  {
    const re = /\{\{Match\s+\|/g;
    let m;
    while ((m = re.exec(wikitext)) !== null) {
      let depth = 0;
      let j = m.index;
      while (j < wikitext.length) {
        if (wikitext[j] === "{" && wikitext[j + 1] === "{") { depth += 1; j += 2; }
        else if (wikitext[j] === "}" && wikitext[j + 1] === "}") { depth -= 1; j += 2; if (depth === 0) break; }
        else j += 1;
      }
      matchInners.push(wikitext.slice(m.index + m[0].length, j - 2));
    }
  }
  const dateTokens = matchInners.map((inner) => pick(inner, "date").split(" ")[0]).filter(Boolean);
  const dateOk = dateTokens.filter((token) => !Number.isNaN(Date.parse(token))).length;

  console.log(`\n${page}`);
  console.log(`  chars=${wikitext.length} matchBlocks=${matchBlocks} mapSlots=${blocks.length} skipped=${blocks.length - usable.length} usable=${usable.length}`);
  console.log(`  weekHeaders=${weeks.length}${weeks.length ? ` (${weeks.join(",")})` : ""} playoffRounds=${rounds.length}${rounds.length ? ` (${rounds.join(" | ")})` : ""}`);
  console.log(`  mapsWritableToDataset=${usable.length - dropped} mapsDropped=${dropped}`);
  if (dropped > 0) {
    console.log(`  UNRESOLVED HERO TOKENS (each one drops every map it appears in):`);
    for (const [token, count] of [...unresolved.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    - "${token}" x${count}`);
    }
    failures += dropped > 0 ? 1 : 0;
  }
  console.log(`  optionalFieldGaps: duration=${noDuration} mapName=${noMapName} mvp=${noMvp} (of ${usable.length} usable maps)`);
  console.log(`  matchDateParseable=${dateOk}/${dateTokens.length}${dateOk < dateTokens.length ? "  → frontend date column will render \"—\" (bug: rawDate.split(' ')[0])" : ""}`);
  console.log(`  matchDates=${JSON.stringify([...new Set(dateTokens)])}`);
}

console.log(failures === 0 ? "\nOK — dataset can be built without losing maps." : "\nATTENTION — maps would be dropped or pages failed; fix before wiring an engine.");
process.exit(failures === 0 ? 0 : 1);

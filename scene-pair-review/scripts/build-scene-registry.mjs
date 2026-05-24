#!/usr/bin/env node
/**
 * Build scene registry from data/scene_*_metadata.csv and scene_playable_pairs.csv.
 * One row per background image (multiple backgrounds may share location_key).
 *
 * Playable pairs: when scene_playable_pairs.csv lists rows for a background_id,
 * only those pairs are used; otherwise all ready foregrounds on disk for that id.
 *
 * Output: src/generated/sceneRegistry.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BG_CSV = path.join(ROOT, "data/scene_background_metadata.csv");
const FG_CSV = path.join(ROOT, "data/scene_foreground_metadata.csv");
const PAIRS_CSV = path.join(ROOT, "data/scene_playable_pairs.csv");
const BG_DIR = path.join(ROOT, "public/images/background");
const FG_DIR = path.join(ROOT, "public/images/foreground");
const OUT = path.join(ROOT, "src/generated/sceneRegistry.js");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field.length || row.length) {
        row.push(field);
        if (row.some((cell) => cell.length)) rows.push(row);
        row = [];
        field = "";
      }
      continue;
    }
    field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.length)) rows.push(row);
  }
  return rows;
}

function rowsToObjects(parsed) {
  const [header, ...data] = parsed;
  return data.map((cells) => {
    const row = {};
    header.forEach((key, i) => {
      row[key.trim()] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

function fileExists(dir, name) {
  return name && fs.existsSync(path.join(dir, name));
}

function normalizeForegroundFile(spec) {
  if (!spec) return "";
  return path.basename(spec.replace(/^\/images\/foreground\//, ""));
}

function inferMarvinSide(foregroundFile, override, fgMetaSide) {
  const o = (override || fgMetaSide || "").toLowerCase();
  if (o === "left" || o === "right") return o;
  return foregroundFile.toLowerCase().includes("_l") ? "left" : "right";
}

function main() {
  const backgrounds = rowsToObjects(parseCsv(fs.readFileSync(BG_CSV, "utf8")));
  const foregrounds = rowsToObjects(parseCsv(fs.readFileSync(FG_CSV, "utf8")));

  const fgMetaByFile = new Map();
  for (const fg of foregrounds) {
    if (fg.file) fgMetaByFile.set(fg.file, fg);
  }

  const foregroundsByBackgroundId = new Map();
  for (const fg of foregrounds) {
    const { background_id: backgroundId, file, status } = fg;
    if (!backgroundId || !file) continue;
    if (status && status !== "ready" && status !== "draft") continue;
    if (!fileExists(FG_DIR, file)) continue;
    const list = foregroundsByBackgroundId.get(backgroundId) ?? [];
    list.push(file);
    foregroundsByBackgroundId.set(backgroundId, list);
  }

  const csvPairsByBackgroundId = new Map();
  if (fs.existsSync(PAIRS_CSV)) {
    const pairRows = rowsToObjects(parseCsv(fs.readFileSync(PAIRS_CSV, "utf8")));
    for (const row of pairRows) {
      const backgroundId = row.background_id;
      const foregroundFile = normalizeForegroundFile(row.foreground_file);
      if (!backgroundId || !foregroundFile) continue;
      const list = csvPairsByBackgroundId.get(backgroundId) ?? [];
      list.push({
        foregroundFile,
        marvinSide: row.marvin_side || "",
        notes: row.notes || "",
      });
      csvPairsByBackgroundId.set(backgroundId, list);
    }
  }

  const placeNames = {};
  const placeBriefs = {};
  const backgroundMeta = {};
  const sceneBackgrounds = [];
  const scenePlayablePairs = [];
  const skipped = [];

  for (const row of backgrounds) {
    const {
      background_id: id,
      file,
      status,
      place_name: placeName,
      location_key: locationKey,
      region,
      elevation_m: elevationM,
      climate_notes: climateNotes,
      where_we_are: whereWeAre,
      notable_features: notableFeatures,
      lat,
      long: lon,
    } = row;
    if (!id || !file) continue;
    if (status !== "ready") {
      skipped.push(`${id}: status=${status || "?"}`);
      continue;
    }
    if (!fileExists(BG_DIR, file)) {
      skipped.push(`${id}: missing ${file}`);
      continue;
    }

    const backgroundPath = `/images/background/${file}`;
    const csvPairs = csvPairsByBackgroundId.get(id);
    const fallbackFiles = foregroundsByBackgroundId.get(id) ?? [];

    let pairSpecs;
    if (csvPairs?.length) {
      pairSpecs = csvPairs;
    } else if (fallbackFiles.length) {
      pairSpecs = fallbackFiles.map((foregroundFile) => ({
        foregroundFile,
        marvinSide: "",
        notes: "",
      }));
    } else {
      skipped.push(`${id}: no foreground on disk`);
      continue;
    }

    const fgPaths = [];
    const fgMarvinSide = {};

    for (const spec of pairSpecs) {
      const { foregroundFile, marvinSide: sideOverride, notes } = spec;
      const fgMeta = fgMetaByFile.get(foregroundFile);
      const marvinSide = inferMarvinSide(
        foregroundFile,
        sideOverride,
        fgMeta?.marvin_side
      );
      const foregroundPath = `/images/foreground/${foregroundFile}`;
      const exists = fileExists(FG_DIR, foregroundFile);

      scenePlayablePairs.push({
        id: `${id}|${foregroundFile}`,
        backgroundId: id,
        background: backgroundPath,
        foreground: foregroundPath,
        foregroundFile,
        marvinSide,
        notes,
        missingFile: !exists,
        pairSource: csvPairs?.length ? "csv" : "metadata",
        locationKey: locationKey || `${lat},${lon}`,
      });

      if (exists) {
        if (!fgPaths.includes(foregroundPath)) {
          fgPaths.push(foregroundPath);
          fgMarvinSide[foregroundPath] = marvinSide;
        }
      }
    }

    if (fgPaths.length === 0) {
      skipped.push(`${id}: playable pairs listed but no foreground files on disk`);
      continue;
    }

    placeNames[id] = placeName || id.replace(/_/g, " ");
    placeBriefs[id] = {
      place_name: placeNames[id],
      where_we_are: whereWeAre || "",
      region: region || "",
      elevation_m: elevationM || "",
      climate_notes: climateNotes || "",
      notable_features: notableFeatures || "",
    };
    backgroundMeta[id] = {
      locationKey: locationKey || `${lat},${lon}`,
      lat,
      lon,
      file,
    };

    sceneBackgrounds.push({
      id,
      background: backgroundPath,
      foregrounds: [...fgPaths],
      marvinSideByForeground: fgMarvinSide,
      locationKey: backgroundMeta[id].locationKey,
    });
  }

  const scenePairs = sceneBackgrounds.map((entry) => {
    const base = {
      id: entry.id,
      label: placeNames[entry.id] ?? entry.id,
      background: entry.background,
    };
    const paths = entry.foregrounds;
    if (paths.length === 1) {
      return { ...base, foreground: paths[0] };
    }
    const left = paths.filter((p) => /_L\.webp$/i.test(p));
    const right = paths.filter((p) => /_R\.webp$/i.test(p));
    if (left.length === 1 && right.length === 1 && paths.length === 2) {
      return {
        ...base,
        foregroundLeft: left[0],
        foregroundRight: right[0],
      };
    }
    return {
      ...base,
      foregroundVariants: paths.map((p, i) => ({
        id: path.basename(p, ".webp").toLowerCase(),
        path: p,
      })),
    };
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const pairSource = fs.existsSync(PAIRS_CSV)
    ? "data/scene_playable_pairs.csv (per-background override), data/scene_*_metadata.csv"
    : "data/scene_background_metadata.csv, data/scene_foreground_metadata.csv";

  const out = `// AUTO-GENERATED by scripts/build-scene-registry.mjs — do not edit
// Source: ${pairSource}

/** One playable scene variant: one background image + one or more foreground images. */
export const SCENE_BACKGROUNDS = ${JSON.stringify(sceneBackgrounds, null, 2)};

/** Explicit background×foreground pairs for review and tooling (includes missing-file rows). */
export const SCENE_PLAYABLE_PAIRS = ${JSON.stringify(scenePlayablePairs, null, 2)};

/** place_name by background_id (each background image has its own id). */
export const PLACE_NAME_BY_BACKGROUND_ID = ${JSON.stringify(placeNames, null, 2)};

/** Location brief from scene_background_metadata.csv (for "we have been told" replies). */
export const SCENE_PLACE_BRIEF_BY_BACKGROUND_ID = ${JSON.stringify(placeBriefs, null, 2)};

/** GPS / site grouping — multiple background_id values may share a location_key. */
export const LOCATION_KEY_BY_BACKGROUND_ID = Object.fromEntries(
  SCENE_BACKGROUNDS.map((e) => [e.id, e.locationKey])
);

/** Metadata for tooling; not required at runtime. */
export const BACKGROUND_META_BY_ID = ${JSON.stringify(backgroundMeta, null, 2)};

/** Animation Primer / asset validation shape (derived from SCENE_BACKGROUNDS). */
export const SCENE_PAIRS = ${JSON.stringify(scenePairs, null, 2)};
`;

  fs.writeFileSync(OUT, out);

  const missingPairFiles = scenePlayablePairs.filter((p) => p.missingFile).length;
  console.log(
    `sceneRegistry: ${sceneBackgrounds.length} background(s), ${scenePlayablePairs.length} playable pair(s)` +
      (missingPairFiles ? ` (${missingPairFiles} missing foreground file)` : "") +
      ` (${skipped.length} skipped)`
  );
  if (skipped.length) {
    console.log("Skipped (add art or set status=ready):");
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
}

main();

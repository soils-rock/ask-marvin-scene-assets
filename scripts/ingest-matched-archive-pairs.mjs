#!/usr/bin/env node
/**
 * Copy matched Marvin archive folder pairs (BG+FG) into ask-marvin public/images as PNG.
 * Only folders present in both Backgrounds_Raw and Foregrounds_Raw are processed.
 * Skips IsITS1, IsITS3, and x* working folders.
 *
 * Updates scene_background_metadata.csv (file, status=ready, location_key, scene_set_id).
 * Appends provisional draft rows to scene_foreground_metadata.csv when missing.
 *
 * Then run: npm run apply:scene-png-edits && npm run review:scenes
 */
import fs from "node:fs";
import path from "node:path";
import {
  archiveFolderForBackgroundId,
  backgroundIdForArchiveFolder,
  BG_ARCHIVE,
  FG_ARCHIVE,
  matchedActiveArchiveFolders,
} from "./lib/archive-pairs.mjs";
import {
  ASK_MARVIN_ROOT,
  BG_DIR,
  FG_DIR,
} from "./lib/paths.mjs";

const BG_CSV = path.join(ASK_MARVIN_ROOT, "data/scene_background_metadata.csv");
const FG_CSV = path.join(ASK_MARVIN_ROOT, "data/scene_foreground_metadata.csv");

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
  return {
    header,
    rows: data.map((cells) => {
      const row = {};
      header.forEach((key, i) => {
        row[key.trim()] = (cells[i] ?? "").trim();
      });
      return row;
    }),
  };
}

function objectsToCsv(header, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".png") && !n.startsWith("."))
    .sort();
}

function slugKey(bgId) {
  return bgId.toLowerCase().replace(/\s+/g, "_");
}

function inferMarvinSide(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes("_l.")) return "left";
  if (lower.includes("_r.")) return "right";
  return "right";
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  if (!fs.existsSync(BG_ARCHIVE) || !fs.existsSync(FG_ARCHIVE)) {
    console.error(`Archive not found: ${BG_ARCHIVE}`);
    process.exit(1);
  }

  const folders = matchedActiveArchiveFolders();
  console.log(`Active matched archive folders (${folders.length}): ${folders.join(", ") || "(none)"}`);

  const bgParsed = parseCsv(fs.readFileSync(BG_CSV, "utf8"));
  const { header: bgHeader, rows: bgRows } = rowsToObjects(bgParsed);
  const bgById = new Map(bgRows.map((r) => [r.background_id, r]));

  const fgParsed = parseCsv(fs.readFileSync(FG_CSV, "utf8"));
  const { header: fgHeader, rows: fgRows } = rowsToObjects(fgParsed);
  const fgIds = new Set(fgRows.map((r) => r.foreground_id));

  const csvBgIds = new Set(bgById.keys());

  function shouldIngestFolder(folder) {
    const id = backgroundIdForArchiveFolder(folder);
    if (csvBgIds.has(id)) return true;
    return [...csvBgIds].some(
      (bid) => archiveFolderForBackgroundId(bid) === folder
    );
  }

  const log = [];
  const extraBgRows = [];

  for (const folder of folders) {
    if (!shouldIngestFolder(folder)) {
      log.push(`SKIP ${folder}: no scene_background_metadata row`);
      continue;
    }
    const bgDir = path.join(BG_ARCHIVE, folder);
    const fgDir = path.join(FG_ARCHIVE, folder);
    const bgPngs = listPngs(bgDir);
    const fgPngs = listPngs(fgDir);

    if (!bgPngs.length || !fgPngs.length) {
      log.push(`SKIP ${folder}: missing BG or FG png`);
      continue;
    }

    const primaryBgId = backgroundIdForArchiveFolder(folder);

    for (const png of bgPngs) {
      const stem = path.basename(png, ".png");
      const bgId = bgPngs.length === 1 ? primaryBgId : stem;
      const webp = `${stem}.webp`;
      const src = path.join(bgDir, png);
      const dest = path.join(BG_DIR, png);
      copyFile(src, dest);
      log.push(`BG ${folder}/${png} → public/images/background/${png}`);

      let row = bgById.get(bgId);
      if (!row) {
        const template = bgById.get(backgroundIdForArchiveFolder(folder)) || {};
        row = {
          background_id: bgId,
          file: webp,
          lat: template.lat || "",
          long: template.long || "",
          location_key: template.location_key || `${slugKey(bgId)}_site`,
          scene_set_id: template.scene_set_id || slugKey(bgId),
          place_name: template.place_name || stem.replace(/_/g, " "),
          region: template.region || "",
          state_or_country: template.state_or_country || "",
          habitat: template.habitat || "",
          elevation_m: template.elevation_m || "",
          climate_notes: template.climate_notes || "",
          where_we_are: template.where_we_are || "",
          notable_features: template.notable_features || "",
          status: "ready",
          notes: template.notes || "Ingested from Marvin archive.",
        };
        extraBgRows.push(row);
        bgById.set(bgId, row);
      } else {
        row.file = webp;
        row.status = "ready";
        if (!row.location_key) row.location_key = `${slugKey(bgId)}_site`;
        if (!row.scene_set_id) row.scene_set_id = slugKey(bgId);
        if (!row.place_name) row.place_name = stem.replace(/_/g, " ");
      }
    }

    for (const png of fgPngs) {
      const stem = path.basename(png, ".png");
      const webp = `${stem}.webp`;
      const src = path.join(fgDir, png);
      const dest = path.join(FG_DIR, png);
      copyFile(src, dest);
      log.push(`FG ${folder}/${png} → public/images/foreground/${png}`);

      const fgId = `${slugKey(stem)}_ingest`;
      if (fgIds.has(fgId)) continue;

      let bgIdForFg = primaryBgId;
      if (bgPngs.length > 1) {
        const candidates = bgPngs.map((p) => path.basename(p, ".png"));
        const match = candidates.find(
          (c) => stem.startsWith(c) || stem.replace(/_L$|_R$/, "") === c
        );
        if (match) bgIdForFg = match;
      }

      fgRows.push({
        foreground_id: fgId,
        file: webp,
        background_id: bgIdForFg,
        scene_set_id: slugKey(bgIdForFg),
        marvin_side: inferMarvinSide(png),
        foreground_subject: "",
        organisms_present: "",
        soil_crust_type: "",
        guest_characters: "",
        what_we_see: "",
        interaction_notes: "",
        status: "draft",
        notes: "Provisional ingest row — refine in scene_foreground_metadata.csv.",
      });
      fgIds.add(fgId);
    }
  }

  const cleanedBgRows = bgRows
    .filter((r) => {
      const lat = (r.lat || "").trim();
      const id = (r.background_id || "").trim();
      return id && lat !== "_";
    })
    .concat(extraBgRows.filter((r) => !bgRows.some((x) => x.background_id === r.background_id)));

  fs.writeFileSync(BG_CSV, objectsToCsv(bgHeader, cleanedBgRows));
  fs.writeFileSync(FG_CSV, objectsToCsv(fgHeader, fgRows));

  console.log("\n--- Ingest log ---");
  log.forEach((l) => console.log(l));
  console.log(`\nUpdated ${BG_CSV}`);
  console.log(`Updated ${FG_CSV}`);
  console.log("\nNext: npm run apply:scene-png-edits && npm run review:scenes");
}

main();

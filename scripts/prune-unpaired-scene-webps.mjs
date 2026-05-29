#!/usr/bin/env node
/**
 * Keep only scene WebPs (and stray PNGs) referenced by scene_playable_pairs.csv
 * plus background WebPs for each paired background_id (from scene_background_metadata).
 */
import fs from "node:fs";
import path from "node:path";
import {
  archiveFolderForBackgroundId,
  backgroundIdForArchiveFolder,
  matchedActiveArchiveFolders,
} from "./lib/archive-pairs.mjs";
import { BG_DIR, FG_DIR, ASK_MARVIN_ROOT } from "./lib/paths.mjs";
import { readPairRows } from "./lib/scene-playable-pairs.mjs";

const BG_CSV = path.join(ASK_MARVIN_ROOT, "data/scene_background_metadata.csv");
const BG_ARCHIVE = path.join(
  process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files",
  "Backgrounds_Raw"
);
const FG_ARCHIVE = path.join(
  process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files",
  "Foregrounds_Raw"
);

function listArchivePngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".png"));
}

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

function loadBackgroundFiles() {
  const parsed = parseCsv(fs.readFileSync(BG_CSV, "utf8"));
  const [header, ...data] = parsed;
  const byId = new Map();
  for (const cells of data) {
    const row = {};
    header.forEach((key, i) => {
      row[key.trim()] = (cells[i] ?? "").trim();
    });
    if (row.background_id) byId.set(row.background_id, row);
  }
  return byId;
}

function collectAllowed() {
  const pairs = readPairRows();
  const allowedFg = new Set(
    pairs.map((r) => r.foreground_file).filter(Boolean)
  );
  const bgMeta = loadBackgroundFiles();
  const allowedBg = new Set();

  for (const id of new Set(pairs.map((r) => r.background_id).filter(Boolean))) {
    const meta = bgMeta.get(id);
    if (meta?.file) {
      allowedBg.add(meta.file);
    } else {
      const folder = archiveFolderForBackgroundId(id);
      allowedBg.add(`${folder}.webp`);
    }
  }

  for (const folder of matchedActiveArchiveFolders()) {
    for (const png of listArchivePngs(path.join(BG_ARCHIVE, folder))) {
      allowedBg.add(png.replace(/\.png$/i, ".webp"));
    }
    for (const png of listArchivePngs(path.join(FG_ARCHIVE, folder))) {
      allowedFg.add(png.replace(/\.png$/i, ".webp"));
    }
    const bgId = backgroundIdForArchiveFolder(folder);
    const meta = bgMeta.get(bgId);
    if (meta?.file) allowedBg.add(meta.file);
  }

  return {
    allowedFg,
    allowedBg,
    pairCount: pairs.length,
    activeFolders: matchedActiveArchiveFolders().length,
  };
}

function pruneDir(dir, allowed, label) {
  if (!fs.existsSync(dir)) return { removed: [] };
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith(".webp") && !lower.endsWith(".png")) continue;
    if (allowed.has(name)) continue;
    const full = path.join(dir, name);
    fs.unlinkSync(full);
    removed.push(name);
    console.log(`  removed ${label}/${name}`);
  }
  return { removed };
}

function main() {
  const { allowedFg, allowedBg, pairCount, activeFolders } = collectAllowed();

  console.log(
    `Pruning ask-marvin scene images (${pairCount} paired rows, ${activeFolders} active archive folder(s), keeping ${allowedBg.size} BG + ${allowedFg.size} FG webp names)…\n`
  );

  const bg = pruneDir(BG_DIR, allowedBg, "background");
  const fg = pruneDir(FG_DIR, allowedFg, "foreground");

  console.log(
    `\nDone: removed ${bg.removed.length} background, ${fg.removed.length} foreground file(s).`
  );
}

main();

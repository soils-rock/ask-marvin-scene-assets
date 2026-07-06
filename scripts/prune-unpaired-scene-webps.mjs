#!/usr/bin/env node
/**
 * Keep only scene WebPs (and stray PNGs) referenced by scene_playable_pairs.csv
 * plus metadata CSV rows and pending flat archive pairs.
 */
import fs from "node:fs";
import path from "node:path";
import { scanFlatArchive } from "./lib/flat-archive-pairs.mjs";
import { BG_DIR, FG_DIR, ASK_MARVIN_ROOT } from "./lib/paths.mjs";
import { readPairRows } from "./lib/scene-playable-pairs.mjs";

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

function loadMetadataFiles(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const parsed = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const [header, ...data] = parsed;
  return data.map((cells) => {
    const row = {};
    header.forEach((key, i) => {
      row[key.trim()] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

function collectAllowed() {
  const pairs = readPairRows();
  const allowedFg = new Set(
    pairs.map((r) => r.foreground_file).filter(Boolean)
  );
  const bgMetaRows = loadMetadataFiles(BG_CSV);
  const fgMetaRows = loadMetadataFiles(FG_CSV);
  const allowedBg = new Set();

  for (const row of bgMetaRows) {
    if (row.file) allowedBg.add(row.file);
  }
  for (const row of fgMetaRows) {
    if (row.file) allowedFg.add(row.file);
  }

  for (const id of new Set(pairs.map((r) => r.background_id).filter(Boolean))) {
    const meta = bgMetaRows.find((r) => r.background_id === id);
    if (meta?.file) {
      allowedBg.add(meta.file);
    }
  }

  const { matched } = scanFlatArchive();
  for (const { webpFile } of matched) {
    allowedBg.add(webpFile);
    allowedFg.add(webpFile);
  }

  return {
    allowedFg,
    allowedBg,
    pairCount: pairs.length,
    pendingFlatPairs: matched.length,
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
  const { allowedFg, allowedBg, pairCount, pendingFlatPairs } = collectAllowed();

  console.log(
    `Pruning ask-marvin scene images (${pairCount} paired rows, ${pendingFlatPairs} pending flat pair(s), keeping ${allowedBg.size} BG + ${allowedFg.size} FG webp names)…\n`
  );

  const bg = pruneDir(BG_DIR, allowedBg, "background");
  const fg = pruneDir(FG_DIR, allowedFg, "foreground");

  console.log(
    `\nDone: removed ${bg.removed.length} background, ${fg.removed.length} foreground file(s).`
  );
}

main();

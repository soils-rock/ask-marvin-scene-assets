/**
 * Ingest flat matched archive pairs: PNG → WebP, CSV rows, move to Processed_images.
 */
import fs from "node:fs";
import path from "node:path";
import { ASK_MARVIN_ROOT, BG_DIR, FG_DIR } from "./paths.mjs";
import {
  inferMarvinSide,
  processedDestinations,
  processedDir,
  stemToBackgroundId,
  stemToPlaceName,
} from "./flat-archive-pairs.mjs";
import { convertArchivePngToWebp, loadSharp } from "./scene-png-to-webp.mjs";

function askMarvinRoot() {
  return process.env.ASK_MARVIN_ROOT || ASK_MARVIN_ROOT;
}

function bgCsvPath() {
  return path.join(askMarvinRoot(), "data/scene_background_metadata.csv");
}

function fgCsvPath() {
  return path.join(askMarvinRoot(), "data/scene_foreground_metadata.csv");
}

function publicBgDir() {
  return process.env.ASK_MARVIN_ROOT
    ? path.join(askMarvinRoot(), "public/images/background")
    : BG_DIR;
}

function publicFgDir() {
  return process.env.ASK_MARVIN_ROOT
    ? path.join(askMarvinRoot(), "public/images/foreground")
    : FG_DIR;
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

function rowsToObjects(parsed) {
  const [header, ...data] = parsed;
  return {
    header: header.map((h) => h.trim()),
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

function loadMetadataCsv(csvPath) {
  const parsed = parseCsv(fs.readFileSync(csvPath, "utf8"));
  return rowsToObjects(parsed);
}

function writeMetadataCsv(csvPath, header, rows) {
  fs.writeFileSync(csvPath, objectsToCsv(header, rows));
}

function upsertBackgroundRow({ rows, header, backgroundId, webpFile, stem }) {
  const id = stemToBackgroundId(stem);
  let row = rows.find((r) => r.background_id === id);
  if (row) {
    row.file = webpFile;
    row.status = row.status || "ready";
    if (!row.location_key) row.location_key = `${id}_site`;
    if (!row.scene_set_id) row.scene_set_id = id;
    if (!row.place_name) row.place_name = stemToPlaceName(stem);
    return { row, created: false };
  }

  row = Object.fromEntries(header.map((h) => [h, ""]));
  row.background_id = id;
  row.file = webpFile;
  row.lat = "";
  row.long = "";
  row.location_key = `${id}_site`;
  row.scene_set_id = id;
  row.place_name = stemToPlaceName(stem);
  row.status = "ready";
  row.notes = "Ingested from flat archive.";
  rows.push(row);
  return { row, created: true };
}

function upsertForegroundRow({ rows, header, fgIds, backgroundId, webpFile, basename }) {
  const existing = rows.find(
    (r) => r.file === webpFile && r.background_id === backgroundId
  );
  if (existing) {
    return { row: existing, created: false };
  }

  const fgId = `${backgroundId}_ingest`;
  if (fgIds.has(fgId)) {
    const byId = rows.find((r) => r.foreground_id === fgId);
    if (byId) {
      byId.file = webpFile;
      byId.background_id = backgroundId;
      byId.scene_set_id = backgroundId;
      return { row: byId, created: false };
    }
  }

  const row = Object.fromEntries(header.map((h) => [h, ""]));
  row.foreground_id = fgId;
  row.file = webpFile;
  row.background_id = backgroundId;
  row.scene_set_id = backgroundId;
  row.marvin_side = inferMarvinSide(basename);
  row.status = "draft";
  row.notes = "Provisional ingest row — refine in scene_foreground_metadata.csv.";
  rows.push(row);
  fgIds.add(fgId);
  return { row, created: true };
}

/**
 * @param {string} srcPath
 * @param {string} destPath
 */
function moveFileAtomicPair(firstSrc, firstDest, secondSrc, secondDest) {
  if (!fs.existsSync(firstSrc) || !fs.existsSync(secondSrc)) {
    throw new Error("Source PNG missing before move.");
  }
  if (fs.existsSync(firstDest) || fs.existsSync(secondDest)) {
    return { ok: false, reason: "destination already exists" };
  }

  fs.mkdirSync(path.dirname(firstDest), { recursive: true });
  fs.renameSync(firstSrc, firstDest);
  try {
    fs.renameSync(secondSrc, secondDest);
    return { ok: true };
  } catch (err) {
    try {
      fs.renameSync(firstDest, firstSrc);
    } catch (rollbackErr) {
      throw new Error(
        `Move failed and rollback failed: ${err.message}; rollback: ${rollbackErr.message}`
      );
    }
    throw err;
  }
}

/**
 * @param {Array<{ basename: string, stem: string, webpFile: string, bgPath: string, fgPath: string }>} matched
 */
export async function ingestMatchedPairs(matched) {
  fs.mkdirSync(processedDir(), { recursive: true });
  const bgDir = publicBgDir();
  const fgDir = publicFgDir();
  fs.mkdirSync(bgDir, { recursive: true });
  fs.mkdirSync(fgDir, { recursive: true });

  const bgCsv = bgCsvPath();
  const fgCsv = fgCsvPath();

  const { header: bgHeader, rows: bgRows } = loadMetadataCsv(bgCsv);
  const { header: fgHeader, rows: fgRows } = loadMetadataCsv(fgCsv);
  const fgIds = new Set(fgRows.map((r) => r.foreground_id).filter(Boolean));

  const sharp = await loadSharp();
  const log = [];
  const results = {
    succeeded: 0,
    skipped: 0,
    failed: 0,
    log,
  };

  for (const pair of matched) {
    const { basename, stem, webpFile, bgPath, fgPath } = pair;
    const destWebpBg = path.join(bgDir, webpFile);
    const destWebpFg = path.join(fgDir, webpFile);
    const { bg: destProcessedBg, fg: destProcessedFg } = processedDestinations(stem);
    const backgroundId = stemToBackgroundId(stem);

    if (fs.existsSync(destProcessedBg) || fs.existsSync(destProcessedFg)) {
      log.push(
        `SKIP ${basename}: Processed_images target exists (${path.basename(destProcessedBg)} or ${path.basename(destProcessedFg)})`
      );
      results.skipped += 1;
      continue;
    }

    try {
      const bgConvert = await convertArchivePngToWebp({
        srcPng: bgPath,
        destWebp: destWebpBg,
        kind: "background",
        sharp,
      });
      log.push(
        `  BG ${basename} → ${webpFile} q=${bgConvert.quality} (${bgConvert.sizeKb} KB)`
      );

      const fgConvert = await convertArchivePngToWebp({
        srcPng: fgPath,
        destWebp: destWebpFg,
        kind: "foreground",
        sharp,
      });
      log.push(
        `  FG ${basename} → ${webpFile} q=${fgConvert.quality} (${fgConvert.sizeKb} KB)`
      );
    } catch (err) {
      if (fs.existsSync(destWebpBg)) fs.unlinkSync(destWebpBg);
      if (fs.existsSync(destWebpFg)) fs.unlinkSync(destWebpFg);
      log.push(`FAIL ${basename}: conversion — ${err.message || String(err)}`);
      results.failed += 1;
      continue;
    }

    try {
      upsertBackgroundRow({
        rows: bgRows,
        header: bgHeader,
        backgroundId,
        webpFile,
        stem,
      });
      upsertForegroundRow({
        rows: fgRows,
        header: fgHeader,
        fgIds,
        backgroundId,
        webpFile,
        basename,
      });
      writeMetadataCsv(bgCsv, bgHeader, bgRows);
      writeMetadataCsv(fgCsv, fgHeader, fgRows);
    } catch (err) {
      if (fs.existsSync(destWebpBg)) fs.unlinkSync(destWebpBg);
      if (fs.existsSync(destWebpFg)) fs.unlinkSync(destWebpFg);
      log.push(`FAIL ${basename}: CSV — ${err.message || String(err)}`);
      results.failed += 1;
      continue;
    }

    try {
      const moveResult = moveFileAtomicPair(
        bgPath,
        destProcessedBg,
        fgPath,
        destProcessedFg
      );
      if (!moveResult.ok) {
        log.push(
          `FAIL ${basename}: move — ${moveResult.reason}; raw PNGs left in place (WebP + CSV kept)`
        );
        results.failed += 1;
        continue;
      }
      log.push(
        `  moved → Processed_images/${path.basename(destProcessedBg)}, ${path.basename(destProcessedFg)}`
      );
      results.succeeded += 1;
    } catch (err) {
      log.push(`FAIL ${basename}: move — ${err.message || String(err)}`);
      results.failed += 1;
    }
  }

  return results;
}

export function ingestCsvPaths() {
  return { bgCsv: bgCsvPath(), fgCsv: fgCsvPath() };
}

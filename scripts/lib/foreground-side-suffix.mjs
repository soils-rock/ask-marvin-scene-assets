/**
 * Foreground WebP side suffix (_L / _R) — required for guest-side inference,
 * flip/mirror, and bake anchor. Flat-archive ingest and pair Complete apply this.
 */
import fs from "node:fs";
import path from "node:path";
import { inferMarvinSide } from "./flat-archive-pairs.mjs";
import { ASK_MARVIN_ROOT } from "./paths.mjs";
import { readPairRows, writePairRows } from "./scene-playable-pairs.mjs";

const FG_META_CSV = path.join(ASK_MARVIN_ROOT, "data/scene_foreground_metadata.csv");

/** @param {string} stem */
export function hasForegroundSideSuffix(stem) {
  return /_L$/i.test(stem) || /_R$/i.test(stem);
}

/**
 * Parse foreground basename into stem + optional pair suffix (__background_id).
 * @param {string} foregroundFile
 */
export function parseForegroundSideParts(foregroundFile) {
  const file = path.basename(String(foregroundFile || ""));
  const base = file.replace(/\.webp$/i, "");
  const uniqueMatch = base.match(/^(.+)__(.+)$/);
  const pairSuffix = uniqueMatch ? uniqueMatch[2] : null;
  const stem = uniqueMatch ? uniqueMatch[1] : base;
  return { file, base, stem, pairSuffix, isL: /_L$/i.test(stem), isR: /_R$/i.test(stem) };
}

/** @param {"left"|"right"|""|undefined|null} marvinSide */
export function sideSuffixLetterForMarvinSide(marvinSide) {
  return String(marvinSide || "").toLowerCase() === "left" ? "_L" : "_R";
}

/**
 * Target foreground WebP name. Adds _L/_R when missing (before any __pair suffix).
 * @param {string} stemOrBasename
 * @param {"left"|"right"|""|undefined|null} [marvinSide]
 */
export function foregroundWebpFileName(stemOrBasename, marvinSide) {
  const parsed = parseForegroundSideParts(
    String(stemOrBasename || "").replace(/\.png$/i, ".webp")
  );
  if (parsed.isL || parsed.isR) {
    return parsed.file.endsWith(".webp") ? parsed.file : `${parsed.base}.webp`;
  }
  const side =
    marvinSide !== undefined && marvinSide !== null && marvinSide !== ""
      ? marvinSide
      : inferMarvinSide(`${parsed.stem}.png`);
  const letter = sideSuffixLetterForMarvinSide(side);
  const pairPart = parsed.pairSuffix ? `__${parsed.pairSuffix}` : "";
  return `${parsed.stem}${letter}${pairPart}.webp`;
}

/**
 * Rename foreground WebP on disk when side suffix is missing.
 * @param {{ foregroundFile: string, marvinSide?: string, fgDir: string }} opts
 */
export function renameForegroundWithSideSuffix({ foregroundFile, marvinSide, fgDir }) {
  const from = path.basename(String(foregroundFile || ""));
  const to = foregroundWebpFileName(from, marvinSide);
  if (to === from) {
    return { from, to, renamed: false };
  }

  const fromPath = path.join(fgDir, from);
  const toPath = path.join(fgDir, to);
  if (!fs.existsSync(fromPath)) {
    const err = new Error(`Foreground not found: ${from}`);
    err.code = "ENOENT";
    throw err;
  }
  if (fs.existsSync(toPath)) {
    const err = new Error(`Cannot add side suffix: ${to} already exists.`);
    err.code = "EEXIST";
    throw err;
  }

  fs.renameSync(fromPath, toPath);
  return { from, to, renamed: true };
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

function writeCsvRows(csvPath, header, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((h) => esc(row[h] ?? "")).join(","));
  }
  fs.writeFileSync(csvPath, lines.join("\n") + "\n");
}

/** @param {string} from @param {string} to */
export function patchForegroundMetadataFile(from, to) {
  if (!fs.existsSync(FG_META_CSV)) return 0;
  const parsed = parseCsv(fs.readFileSync(FG_META_CSV, "utf8"));
  const [header, ...data] = parsed;
  const keys = header.map((h) => h.trim());
  let count = 0;
  const rows = data.map((cells) => {
    const row = {};
    keys.forEach((key, i) => {
      row[key] = (cells[i] ?? "").trim();
    });
    if (row.file === from) {
      row.file = to;
      count += 1;
    }
    return row;
  });
  if (count > 0) {
    writeCsvRows(FG_META_CSV, keys, rows);
  }
  return count;
}

/** @param {string} from @param {string} to */
export function patchPlayablePairsForegroundFile(from, to) {
  const rows = readPairRows();
  let count = 0;
  for (const row of rows) {
    if (row.foreground_file === from) {
      row.foreground_file = to;
      count += 1;
    }
  }
  if (count > 0) {
    writePairRows(rows);
  }
  return count;
}

/**
 * Ensure side suffix on disk and patch CSV references.
 * @param {{ foregroundFile: string, marvinSide?: string, fgDir: string }} opts
 */
export function ensureForegroundSideSuffix({ foregroundFile, marvinSide, fgDir }) {
  const from = path.basename(String(foregroundFile || ""));
  const { isL, isR } = parseForegroundSideParts(from);
  if (isL || isR) {
    return { from, to: from, renamed: false, metadataRows: 0, pairRows: 0 };
  }

  const renameResult = renameForegroundWithSideSuffix({
    foregroundFile: from,
    marvinSide,
    fgDir,
  });
  if (!renameResult.renamed) {
    return { ...renameResult, metadataRows: 0, pairRows: 0 };
  }

  const metadataRows = patchForegroundMetadataFile(renameResult.from, renameResult.to);
  const pairRows = patchPlayablePairsForegroundFile(renameResult.from, renameResult.to);
  return { ...renameResult, metadataRows, pairRows };
}

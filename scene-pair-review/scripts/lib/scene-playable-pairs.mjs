import fs from "node:fs";
import path from "node:path";
import { PAIRS_CSV } from "../../lib/paths.mjs";

export { PAIRS_CSV };

const HEADER = ["background_id", "foreground_file", "marvin_side", "notes"];

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

function escapeCsvField(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function serializeCsv(rows) {
  return rows
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\n")
    .concat("\n");
}

export function foregroundAnchorSide(foregroundFile) {
  const fg = (foregroundFile || "").toLowerCase();
  return fg.includes("_l") ? "left" : "right";
}

export function oppositeSide(side) {
  return side === "left" ? "right" : "left";
}

export function readPairRows() {
  if (!fs.existsSync(PAIRS_CSV)) return [];
  const parsed = parseCsv(fs.readFileSync(PAIRS_CSV, "utf8"));
  const [header, ...data] = parsed;
  return data.map((cells) => {
    const row = {};
    header.forEach((key, i) => {
      row[key.trim()] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

export function writePairRows(rows) {
  const csvRows = [HEADER, ...rows.map((row) => HEADER.map((key) => row[key] ?? ""))];
  fs.writeFileSync(PAIRS_CSV, serializeCsv(csvRows));
}

export function findPairRow(rows, backgroundId, foregroundFile) {
  return rows.find(
    (row) =>
      row.background_id === backgroundId &&
      (!foregroundFile || row.foreground_file === foregroundFile)
  );
}

export function updatePairRow({ backgroundId, foregroundFile, marvinSide, notes, newForegroundFile }) {
  const rows = readPairRows();
  const row = findPairRow(rows, backgroundId, foregroundFile);
  if (!row) {
    const err = new Error(`No pairing row for ${backgroundId} + ${foregroundFile || "(any)"}.`);
    err.code = "PAIR_NOT_FOUND";
    throw err;
  }
  if (marvinSide !== undefined) row.marvin_side = marvinSide;
  if (notes !== undefined) row.notes = notes;
  if (newForegroundFile !== undefined) row.foreground_file = newForegroundFile;
  writePairRows(rows);
  return row;
}

export function setOppositeSides({ backgroundId, foregroundFile }) {
  const rows = readPairRows();
  const row = findPairRow(rows, backgroundId, foregroundFile);
  if (!row) {
    const err = new Error(`No pairing row for ${backgroundId} + ${foregroundFile || "(any)"}.`);
    err.code = "PAIR_NOT_FOUND";
    throw err;
  }
  const anchor = foregroundAnchorSide(row.foreground_file);
  row.marvin_side = oppositeSide(anchor);
  writePairRows(rows);
  return row;
}

/**
 * Insert or update a playable-pair row (used when review marks a pair Complete).
 * @param {{ backgroundId: string, foregroundFile: string, marvinSide?: string, notes?: string, previousForegroundFile?: string }} opts
 */
export function commitPairRow({
  backgroundId,
  foregroundFile,
  marvinSide,
  notes,
  previousForegroundFile,
}) {
  const rows = readPairRows();
  const lookupFile = previousForegroundFile || foregroundFile;
  let row = findPairRow(rows, backgroundId, lookupFile);
  if (!row && !previousForegroundFile) {
    row = findPairRow(rows, backgroundId);
  }
  if (row) {
    row.foreground_file = foregroundFile;
    if (marvinSide !== undefined) row.marvin_side = marvinSide;
    if (notes !== undefined) row.notes = notes;
  } else {
    row = {
      background_id: backgroundId,
      foreground_file: foregroundFile,
      marvin_side: marvinSide ?? "",
      notes: notes ?? "",
    };
    rows.push(row);
  }
  writePairRows(rows);
  return row;
}

export function isPairCommitted({ backgroundId, foregroundFile }) {
  return Boolean(findPairRow(readPairRows(), backgroundId, foregroundFile));
}

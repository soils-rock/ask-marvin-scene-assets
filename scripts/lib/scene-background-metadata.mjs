import fs from "node:fs";
import path from "node:path";
import { ASK_MARVIN_ROOT } from "./paths.mjs";

export function bgCsvPath() {
  return (
    process.env.SCENE_BG_CSV ||
    path.join(ASK_MARVIN_ROOT, "data/scene_background_metadata.csv")
  );
}

export const BG_CSV = bgCsvPath();

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

function serializeCsv(header, rows) {
  const lines = [
    header.join(","),
    ...rows.map((row) => header.map((key) => escapeCsvField(row[key] ?? "")).join(",")),
  ];
  return lines.join("\n").concat("\n");
}

export function readBackgroundRows() {
  const csvPath = bgCsvPath();
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing background metadata CSV: ${csvPath}`);
  }
  const parsed = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const [header, ...data] = parsed;
  const rows = data.map((cells) => {
    const row = {};
    header.forEach((key, i) => {
      row[key.trim()] = (cells[i] ?? "").trim();
    });
    return row;
  });
  return { header: header.map((h) => h.trim()), rows };
}

export function writeBackgroundRows({ header, rows }) {
  fs.writeFileSync(bgCsvPath(), serializeCsv(header, rows));
}

export function findBackgroundRow(rows, backgroundId) {
  const id = String(backgroundId || "").trim();
  return rows.find((row) => row.background_id === id);
}

/**
 * @param {string} value
 * @param {"lat"|"long"} axis
 */
export function parseCoordinate(value, axis) {
  const s = String(value ?? "").trim();
  if (!s) {
    return { ok: false, error: `${axis} is required.` };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${axis} must be a finite decimal number.` };
  }
  if (axis === "lat" && (n < -90 || n > 90)) {
    return { ok: false, error: "lat must be between -90 and 90." };
  }
  if (axis === "long" && (n < -180 || n > 180)) {
    return { ok: false, error: "long must be between -180 and 180." };
  }
  return { ok: true, value: s };
}

export function coordinatesAreValid(lat, long) {
  return parseCoordinate(lat, "lat").ok && parseCoordinate(long, "long").ok;
}

export function validateCoordinateFields(lat, long) {
  const latResult = parseCoordinate(lat, "lat");
  if (!latResult.ok) return { ok: false, error: latResult.error };
  const longResult = parseCoordinate(long, "long");
  if (!longResult.ok) return { ok: false, error: longResult.error };
  return { ok: true, lat: latResult.value, long: longResult.value };
}

/**
 * Resolve lat/long patch for Complete from stored row + request body.
 * @returns {{ ok: true, patch: Record<string, string>|null } | { ok: false, error: string }}
 */
export function resolveBackgroundCoordinatePatch({
  existingRow,
  backgroundId,
  bodyLat,
  bodyLong,
}) {
  const hasStored = coordinatesAreValid(existingRow?.lat, existingRow?.long);
  const bodyLatProvided = bodyLat !== undefined && bodyLat !== null;
  const bodyLongProvided = bodyLong !== undefined && bodyLong !== null;
  const label = backgroundId || existingRow?.background_id || "background";

  if (!hasStored) {
    const validated = validateCoordinateFields(bodyLat, bodyLong);
    if (!validated.ok) {
      return {
        ok: false,
        error: `Background ${label} has no coordinates stored. ${validated.error}`,
      };
    }
    return { ok: true, patch: { lat: validated.lat, long: validated.long } };
  }

  if (!bodyLatProvided && !bodyLongProvided) {
    return { ok: true, patch: null };
  }

  const effectiveLat = bodyLatProvided ? bodyLat : existingRow.lat;
  const effectiveLong = bodyLongProvided ? bodyLong : existingRow.long;
  const validated = validateCoordinateFields(effectiveLat, effectiveLong);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const patch = {};
  if (bodyLatProvided) patch.lat = validated.lat;
  if (bodyLongProvided) patch.long = validated.long;
  return { ok: true, patch };
}

/**
 * Upsert one background metadata row by background_id.
 * Existing row: shallow-merge patch keys only.
 * Missing row: append full-width row (all header columns present).
 * @returns {{ row: object, created: boolean }}
 */
export function upsertBackgroundRow({ backgroundId, patch, insertDefaults }) {
  const id = String(backgroundId || "").trim();
  if (!id) throw new Error("backgroundId is required.");
  if (!patch || !Object.keys(patch).length) {
    throw new Error("patch must include at least one field.");
  }

  const { header, rows } = readBackgroundRows();
  const idx = rows.findIndex((row) => row.background_id === id);

  if (idx >= 0) {
    const row = rows[idx];
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) row[key] = value;
    }
    writeBackgroundRows({ header, rows });
    return { row, created: false };
  }

  const row = Object.fromEntries(header.map((h) => [h, ""]));
  row.background_id = id;
  if (insertDefaults) {
    for (const [key, value] of Object.entries(insertDefaults)) {
      if (value !== undefined) row[key] = value;
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) row[key] = value;
  }
  rows.push(row);
  writeBackgroundRows({ header, rows });
  return { row, created: true };
}

export function backgroundInsertDefaults({ backgroundId, backgroundPath }) {
  const slug = String(backgroundId || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const file = backgroundPath
    ? path.basename(String(backgroundPath).replace(/^\/images\/background\//, ""))
    : "";
  return {
    file,
    status: "ready",
    location_key: `${slug}_site`,
    scene_set_id: slug,
    place_name: String(backgroundId || "").replace(/_/g, " "),
  };
}

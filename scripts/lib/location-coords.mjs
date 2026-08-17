/**
 * GPS coordinates for a location slug: read from source JPEGs or Location_Raw.
 * A missing Location_Raw folder is not an error.
 */
import fs from "node:fs";
import path from "node:path";
import exifr from "exifr";
import { archiveRoot } from "./flat-archive-pairs.mjs";

function locationRawDir() {
  return process.env.LOCATION_RAW_DIR || path.join(archiveRoot(), "Location_Raw");
}

export const LOCATION_RAW_DIR = locationRawDir();

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

function coordsFromUnknown(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat ?? value.latitude);
  const lon = Number(value.long ?? value.longitude ?? value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: round6(lat), long: round6(lon) };
}

export function locationSlugFromStem(stem) {
  const s = String(stem || "").trim();
  const withoutFg = s.replace(/-[A-Za-z]-\d+$/, "");
  if (withoutFg !== s) return withoutFg;
  return s.replace(/-\d+$/, "");
}

export async function readGps(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return null;
    }
    const gps = await exifr.gps(filePath);
    return coordsFromUnknown(gps);
  } catch {
    return null;
  }
}

const LOCATION_RAW_EXTS = [".jpg", ".jpeg", ".heic", ".heif", ".png", ".dng"];

function findLocationRawImage(slug) {
  if (!slug || !fs.existsSync(locationRawDir())) return null;
  let names;
  try {
    names = fs.readdirSync(locationRawDir());
  } catch {
    return null;
  }
  const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const ext of LOCATION_RAW_EXTS) {
    const match = byLower.get(`${slug}${ext}`.toLowerCase());
    if (match) return path.join(locationRawDir(), match);
  }
  return null;
}

export async function findCoordsForSlug(slug, candidateFiles) {
  const files = Array.isArray(candidateFiles) ? candidateFiles : [];
  for (const filePath of files) {
    const coords = await readGps(filePath);
    if (coords) return coords;
  }
  const rawImage = findLocationRawImage(slug);
  if (rawImage) {
    const coords = await readGps(rawImage);
    if (coords) return coords;
  }
  return null;
}

function sidecarPath(slug) {
  return path.join(locationRawDir(), `${slug}.json`);
}

function findSidecarPath(slug) {
  const exact = sidecarPath(slug);
  if (fs.existsSync(exact)) return exact;
  if (!fs.existsSync(locationRawDir())) return null;
  let names;
  try {
    names = fs.readdirSync(locationRawDir());
  } catch {
    return null;
  }
  const want = `${slug}.json`.toLowerCase();
  const match = names.find((name) => name.toLowerCase() === want);
  return match ? path.join(locationRawDir(), match) : null;
}

export function writeSidecar(slug, { lat, long }) {
  const coords = coordsFromUnknown({ lat, long });
  if (!slug || !coords) return;
  fs.mkdirSync(locationRawDir(), { recursive: true });
  fs.writeFileSync(
    sidecarPath(slug),
    `${JSON.stringify({ lat: coords.lat, long: coords.long }, null, 2)}\n`,
    "utf8"
  );
}

export function readSidecar(slug) {
  const filePath = findSidecarPath(slug);
  if (!filePath) return null;
  try {
    return coordsFromUnknown(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

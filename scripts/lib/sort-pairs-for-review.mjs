/**
 * Sort scene pairs for the review UI (ingest date or alphabetical).
 */
import fs from "node:fs";
import path from "node:path";
import { BG_DIR } from "./paths.mjs";

function backgroundWebpFile(pair) {
  const raw = String(pair.background || "");
  if (!raw) return "";
  return path.basename(raw.replace(/^\/images\/background\//, ""));
}

/** @returns {number|null} birthtime ms, or null if file missing/unreadable */
export function backgroundWebpBirthtimeMs(pair) {
  const file = backgroundWebpFile(pair);
  if (!file) return null;
  const fullPath = path.join(BG_DIR, file);
  try {
    if (!fs.existsSync(fullPath)) return null;
    const stat = fs.statSync(fullPath);
    const birth = stat.birthtimeMs;
    if (Number.isFinite(birth) && birth > 0) return birth;
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/** @param {object} pair */
export function enrichPairForReview(pair) {
  return {
    ...pair,
    backgroundIngestMs: backgroundWebpBirthtimeMs(pair),
  };
}

function compareAlphabetical(a, b) {
  const bg = (a.backgroundId || "").localeCompare(b.backgroundId || "", undefined, {
    sensitivity: "base",
  });
  if (bg !== 0) return bg;
  return (a.foregroundFile || "").localeCompare(b.foregroundFile || "", undefined, {
    sensitivity: "base",
  });
}

function compareIngestDate(a, b) {
  const ta = a.backgroundIngestMs ?? backgroundWebpBirthtimeMs(a);
  const tb = b.backgroundIngestMs ?? backgroundWebpBirthtimeMs(b);
  const aMissing = ta == null;
  const bMissing = tb == null;
  if (aMissing && bMissing) return compareAlphabetical(a, b);
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (tb !== ta) return tb - ta;
  return compareAlphabetical(a, b);
}

export function sortPairsAlphabetical(pairs) {
  return [...pairs].sort(compareAlphabetical);
}

export function sortPairsByIngestDate(pairs) {
  return [...pairs].sort(compareIngestDate);
}

/** Default review order: newest background WebP first. */
export function sortPairsForReview(pairs) {
  return sortPairsByIngestDate(pairs);
}

export function sortPairsForReviewMode(pairs, mode) {
  if (mode === "alpha") return sortPairsAlphabetical(pairs);
  return sortPairsByIngestDate(pairs);
}

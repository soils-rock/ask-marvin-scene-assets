/**
 * Sort scene pairs for the review UI (newest background WebP first).
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
function backgroundWebpBirthtimeMs(pair) {
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

export function sortPairsForReview(pairs) {
  return [...pairs].sort((a, b) => {
    const ta = backgroundWebpBirthtimeMs(a);
    const tb = backgroundWebpBirthtimeMs(b);
    const aMissing = ta == null;
    const bMissing = tb == null;
    if (aMissing && bMissing) {
      const bg = a.backgroundId.localeCompare(b.backgroundId);
      if (bg !== 0) return bg;
      return (a.foregroundFile || "").localeCompare(b.foregroundFile || "");
    }
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (tb !== ta) return tb - ta;
    const bg = a.backgroundId.localeCompare(b.backgroundId);
    if (bg !== 0) return bg;
    return (a.foregroundFile || "").localeCompare(b.foregroundFile || "");
  });
}

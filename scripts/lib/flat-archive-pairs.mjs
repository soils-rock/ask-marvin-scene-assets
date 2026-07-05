/**
 * Flat archive layout: PNG files at Backgrounds_Raw/ and Foregrounds_Raw/ roots.
 * Matched pair = same basename in both folders.
 */
import fs from "node:fs";
import path from "node:path";

export const ARCHIVE_ROOT =
  process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files";

export function archiveRoot() {
  return process.env.SCENE_PNG_ARCHIVE || ARCHIVE_ROOT;
}

export function bgArchiveDir() {
  return path.join(archiveRoot(), "Backgrounds_Raw");
}

export function fgArchiveDir() {
  return path.join(archiveRoot(), "Foregrounds_Raw");
}

export function processedDir() {
  return path.join(archiveRoot(), "Processed_images");
}

/** @deprecated use bgArchiveDir() — kept for callers not yet migrated */
export const BG_ARCHIVE = path.join(
  process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files",
  "Backgrounds_Raw"
);
/** @deprecated use fgArchiveDir() */
export const FG_ARCHIVE = path.join(
  process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files",
  "Foregrounds_Raw"
);
/** @deprecated use processedDir() */
export const PROCESSED_DIR = path.join(
  process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files",
  "Processed_images"
);

/** @param {string} root */
export function listFlatArchivePngs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".png") &&
        !entry.name.startsWith(".")
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** @param {string} stem */
export function stemToBackgroundId(stem) {
  return String(stem || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

/** @param {string} stem */
export function stemToPlaceName(stem) {
  return String(stem || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/-/g, " ");
}

/** @param {string} stem */
export function processedDestinations(stem) {
  const dir = processedDir();
  return {
    bg: path.join(dir, `${stem}__bg.png`),
    fg: path.join(dir, `${stem}__fg.png`),
  };
}

/**
 * @returns {{
 *   matched: Array<{ basename: string, stem: string, bgPath: string, fgPath: string }>,
 *   orphans: Array<{ folder: "Backgrounds_Raw"|"Foregrounds_Raw", filename: string }>
 * }}
 */
export function scanFlatArchive({
  bgArchive = bgArchiveDir(),
  fgArchive = fgArchiveDir(),
} = {}) {
  const bgFiles = listFlatArchivePngs(bgArchive);
  const fgFiles = listFlatArchivePngs(fgArchive);
  const bgSet = new Set(bgFiles);
  const fgSet = new Set(fgFiles);

  /** @type {Array<{ basename: string, stem: string, bgPath: string, fgPath: string }>} */
  const matched = [];
  for (const basename of bgFiles) {
    if (!fgSet.has(basename)) continue;
    const stem = basename.replace(/\.png$/i, "");
    matched.push({
      basename,
      stem,
      bgPath: path.join(bgArchive, basename),
      fgPath: path.join(fgArchive, basename),
    });
  }

  /** @type {Array<{ folder: "Backgrounds_Raw"|"Foregrounds_Raw", filename: string }>} */
  const orphans = [];
  for (const filename of bgFiles) {
    if (!fgSet.has(filename)) {
      orphans.push({ folder: "Backgrounds_Raw", filename });
    }
  }
  for (const filename of fgFiles) {
    if (!bgSet.has(filename)) {
      orphans.push({ folder: "Foregrounds_Raw", filename });
    }
  }

  orphans.sort((a, b) =>
    a.folder === b.folder
      ? a.filename.localeCompare(b.filename)
      : a.folder.localeCompare(b.folder)
  );

  return { matched, orphans };
}

export function inferMarvinSide(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.includes("_l.")) return "left";
  if (lower.includes("_r.")) return "right";
  return "right";
}

export function ensureArchivePathsWritable() {
  const paths = [
    { path: bgArchiveDir(), label: "Backgrounds_Raw" },
    { path: fgArchiveDir(), label: "Foregrounds_Raw" },
    { path: processedDir(), label: "Processed_images" },
  ];
  for (const { path: dirPath, label } of paths) {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Missing ${label}: ${dirPath}`);
    }
    try {
      fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
      throw new Error(`${label} not readable/writable: ${dirPath} (${err.code || err.message})`);
    }
  }
}

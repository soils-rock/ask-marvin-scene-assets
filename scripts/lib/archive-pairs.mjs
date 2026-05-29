/**
 * Marvin archive folder pairing: map background_id ↔ Backgrounds_Raw / Foregrounds_Raw folders.
 * Sealed folders are prefixed with x (skipped on future ingest).
 */
import fs from "node:fs";
import path from "node:path";

const ARCHIVE_ROOT =
  process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files";

export const BG_ARCHIVE = path.join(ARCHIVE_ROOT, "Backgrounds_Raw");
export const FG_ARCHIVE = path.join(ARCHIVE_ROOT, "Foregrounds_Raw");

/** Archive folder name → scene_background_metadata background_id */
export const FOLDER_TO_BG_ID = {
  Page_Springs: "Page Springs",
};

/** background_id → archive folder when names differ */
export const BG_ID_TO_FOLDER = {
  "Page Springs": "Page_Springs",
};

export const EXCLUDE_ARCHIVE_FOLDERS = new Set(["IsITS1", "IsITS3"]);

export function archiveFolderForBackgroundId(backgroundId) {
  return BG_ID_TO_FOLDER[backgroundId] ?? backgroundId;
}

export function backgroundIdForArchiveFolder(folderName) {
  if (folderName.startsWith("x")) {
    return backgroundIdForArchiveFolder(folderName.slice(1));
  }
  return FOLDER_TO_BG_ID[folderName] ?? folderName;
}

export function isSealedArchiveFolderName(folderName) {
  return folderName.startsWith("x");
}

export function sealedArchiveFolderName(folderName) {
  const base = folderName.startsWith("x") ? folderName.slice(1) : folderName;
  return `x${base}`;
}

export function listArchiveDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

/** Active (not x-sealed) folder names present in both BG and FG archives. */
export function matchedActiveArchiveFolders() {
  const bg = new Set(
    listArchiveDirs(BG_ARCHIVE).filter(
      (n) => !isSealedArchiveFolderName(n) && !EXCLUDE_ARCHIVE_FOLDERS.has(n)
    )
  );
  const fg = new Set(
    listArchiveDirs(FG_ARCHIVE).filter(
      (n) => !isSealedArchiveFolderName(n) && !EXCLUDE_ARCHIVE_FOLDERS.has(n)
    )
  );
  return [...bg].filter((n) => fg.has(n)).sort();
}

export function isArchiveSealedForBackground(backgroundId) {
  const folder = archiveFolderForBackgroundId(backgroundId);
  return fs.existsSync(path.join(BG_ARCHIVE, sealedArchiveFolderName(folder)));
}

/** Matched BG+FG archive folder exists and is not yet x-sealed. */
export function isActiveArchiveBackground(backgroundId) {
  if (isArchiveSealedForBackground(backgroundId)) return false;
  const folder = archiveFolderForBackgroundId(backgroundId);
  return (
    fs.existsSync(path.join(BG_ARCHIVE, folder)) &&
    fs.existsSync(path.join(FG_ARCHIVE, folder))
  );
}

function archiveSortPriority(backgroundId) {
  if (isActiveArchiveBackground(backgroundId)) return 0;
  if (isArchiveSealedForBackground(backgroundId)) return 2;
  return 1;
}

/**
 * Rename BG+FG archive folders to x{Name} after review Complete.
 * @returns {{ sealed: boolean, folder?: string, reason?: string }}
 */
export function sealArchiveFolderForBackground(backgroundId) {
  const folder = archiveFolderForBackgroundId(backgroundId);
  const sealedName = sealedArchiveFolderName(folder);

  if (fs.existsSync(path.join(BG_ARCHIVE, sealedName))) {
    return { sealed: false, folder, reason: "already sealed" };
  }

  let renamed = false;
  for (const [root, label] of [
    [BG_ARCHIVE, "Backgrounds_Raw"],
    [FG_ARCHIVE, "Foregrounds_Raw"],
  ]) {
    const src = path.join(root, folder);
    const dest = path.join(root, sealedName);
    if (fs.existsSync(src)) {
      fs.renameSync(src, dest);
      renamed = true;
      console.log(`  sealed ${label}/${folder} → ${sealedName}`);
    }
  }

  if (!renamed) {
    return { sealed: false, folder, reason: "no active archive folder" };
  }
  return { sealed: true, folder: sealedName };
}

export function sortPairsForReview(pairs) {
  return [...pairs].sort((a, b) => {
    const pa = archiveSortPriority(a.backgroundId);
    const pb = archiveSortPriority(b.backgroundId);
    if (pa !== pb) return pa - pb;
    const bg = a.backgroundId.localeCompare(b.backgroundId);
    if (bg !== 0) return bg;
    return (a.foregroundFile || "").localeCompare(b.foregroundFile || "");
  });
}

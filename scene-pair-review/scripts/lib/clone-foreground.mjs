/**
 * Clone foreground WebPs to pair-unique filenames ({stem}__{background_id}.webp).
 */
import fs from "node:fs";
import path from "node:path";
import { readPairRows } from "./scene-playable-pairs.mjs";
import { FG_DIR as FG_DIR_PATH } from "../../lib/paths.mjs";

export const FG_DIR = FG_DIR_PATH;

/** @param {string} foregroundFile */
export function parseForegroundBasename(foregroundFile) {
  const file = path.basename(foregroundFile || "");
  const base = file.replace(/\.webp$/i, "");
  const uniqueMatch = base.match(/^(.+)__(.+)$/);
  const pairSuffix = uniqueMatch ? uniqueMatch[2] : null;
  const stem = uniqueMatch ? uniqueMatch[1] : base;
  const isL = /_L$/i.test(stem);
  const isR = /_R$/i.test(stem);
  return { file, base, stem, pairSuffix, isL, isR };
}

/** @param {string} foregroundFile @param {string} backgroundId */
export function isUniqueForegroundName(foregroundFile, backgroundId) {
  const { pairSuffix } = parseForegroundBasename(foregroundFile);
  return pairSuffix === backgroundId;
}

/** @param {string} foregroundFile @param {string} backgroundId */
export function uniqueForegroundName(foregroundFile, backgroundId) {
  const { file, pairSuffix, stem } = parseForegroundBasename(foregroundFile);
  if (pairSuffix === backgroundId) return file;
  return `${stem}__${backgroundId}.webp`;
}

/**
 * Flip targets for review UI: mirror the staged file to the opposite-side basename.
 * @param {string} foregroundFile — currently staged foreground (e.g. Valley_of_Fires_R__bg.webp)
 * @param {"left"|"right"} side
 */
export function flipTargetsToSide(foregroundFile, side) {
  const { file, stem, pairSuffix, isL, isR } = parseForegroundBasename(foregroundFile);
  if (!isL && !isR) return null;
  const wantLeft = side === "left";
  if ((wantLeft && isL) || (!wantLeft && isR)) return null;
  const suffix = pairSuffix ? `__${pairSuffix}` : "";
  const toStem = isL ? stem.replace(/_L$/i, "_R") : stem.replace(/_R$/i, "_L");
  return { from: file, to: `${toStem}${suffix}.webp` };
}

/**
 * @param {string} foregroundFile
 * @param {{ backgroundId?: string, pairs?: Array<{ backgroundId: string, foregroundFile: string }> }} [opts]
 */
export function isForegroundShared(foregroundFile, opts = {}) {
  const { backgroundId, pairs = [] } = opts;
  const file = path.basename(foregroundFile || "");
  if (backgroundId && isUniqueForegroundName(file, backgroundId)) return false;

  const csvRows = readPairRows().filter((row) => row.foreground_file === file);
  const pairRows = pairs.filter((row) => row.foregroundFile === file);

  if (csvRows.length > 1 || pairRows.length > 1) return true;

  const csvBackgrounds = new Set(csvRows.map((row) => row.background_id));
  const pairBackgrounds = new Set(pairRows.map((row) => row.backgroundId));
  const allBackgrounds = new Set([...csvBackgrounds, ...pairBackgrounds]);
  return allBackgrounds.size > 1;
}

/**
 * @param {{ from: string, to: string, overwrite?: boolean }} opts
 */
export async function cloneForeground({ from, to, overwrite = false }) {
  const sourceFile = path.basename(from);
  const destFile = path.basename(to);
  if (destFile === sourceFile) {
    return { from: sourceFile, to: destFile, existed: true, noop: true };
  }

  const sourcePath = path.join(FG_DIR, sourceFile);
  const destPath = path.join(FG_DIR, destFile);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source not found: ${sourceFile}`);
  }

  if (fs.existsSync(destPath) && !overwrite) {
    return { from: sourceFile, to: destFile, existed: true };
  }

  await fs.promises.copyFile(sourcePath, destPath);
  return { from: sourceFile, to: destFile, existed: false };
}

/**
 * @param {{ from: string, backgroundId: string, overwrite?: boolean }} opts
 */
export async function cloneForegroundForPair({ from, backgroundId, overwrite = false }) {
  const sourceFile = path.basename(from);
  const destFile = uniqueForegroundName(sourceFile, backgroundId);
  const result = await cloneForeground({ from: sourceFile, to: destFile, overwrite });
  return { ...result, backgroundId };
}

/**
 * Clone when foreground is shared across pairings; no-op when already unique.
 * @param {{ foregroundFile: string, backgroundId: string, pairs?: Array<{ backgroundId: string, foregroundFile: string }>, overwrite?: boolean }} opts
 */
export async function ensureUniqueForegroundForPair(opts) {
  const { foregroundFile, backgroundId, pairs = [], overwrite = false } = opts;
  const sourceFile = path.basename(foregroundFile);
  if (!isForegroundShared(sourceFile, { backgroundId, pairs })) {
    return { from: sourceFile, to: sourceFile, cloned: false, existed: true };
  }
  const result = await cloneForegroundForPair({
    from: sourceFile,
    backgroundId,
    overwrite,
  });
  return { ...result, cloned: result.to !== result.from };
}

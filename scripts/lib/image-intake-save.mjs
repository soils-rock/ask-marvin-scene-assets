/**
 * Image intake step 2 — preview and copy selected backgrounds to Backgrounds_Raw.
 * COPY only; never overwrite existing files.
 */
import fs from "node:fs";
import path from "node:path";
import { isImageFileName, resolveImageUnderRoot } from "./image-intake-binning.mjs";

export const BACKGROUNDS_RAW =
  process.env.BACKGROUNDS_RAW_DIR ||
  "/Volumes/Marvin/CyanoVerse_Source_Files/Backgrounds_Raw";

export const FOREGROUNDS_RAW =
  process.env.FOREGROUNDS_RAW_DIR ||
  "/Volumes/Marvin/CyanoVerse_Source_Files/Foregrounds_Raw";

const DEST_EXT = ".jpg";

export function slugLocationName(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "Location name is required." };
  }
  let slug = trimmed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  if (!slug) {
    return { ok: false, error: "Location name must contain letters or numbers." };
  }
  return { ok: true, slug, display: trimmed };
}

function ensureWritableDir(dirPath, label) {
  if (!fs.existsSync(dirPath)) {
    return { ok: false, error: `${label} not found: ${dirPath}` };
  }
  try {
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    return {
      ok: false,
      error: `${label} is not writable: ${dirPath} (${err.code || err.message})`,
    };
  }
  const st = fs.statSync(dirPath);
  if (!st.isDirectory()) {
    return { ok: false, error: `Not a directory: ${dirPath}` };
  }
  return { ok: true };
}

function destBackgroundFileName(slug, index) {
  return `${slug}-${index}${DEST_EXT}`;
}

function destForegroundFileName(slug, cycleLetter, index) {
  const letter = String(cycleLetter || "A")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 1) || "A";
  return `${slug}-${letter}-${index}${DEST_EXT}`;
}

function normalizeCycleLetter(cycleLetter) {
  const letter = String(cycleLetter || "A")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 1);
  if (!letter) {
    return { ok: false, error: "Cycle letter must be A–Z." };
  }
  return { ok: true, letter };
}

function planImageCopies({
  sourceRoot,
  binImageNames,
  files,
  locationName,
  destDir,
  destLabel,
  execute,
  resolveDestName,
}) {
  const dirCheck = ensureWritableDir(destDir, destLabel);
  if (!dirCheck.ok) return dirCheck;

  if (!sourceRoot) {
    return { ok: false, error: "Scan a source folder first." };
  }

  const slugResult = slugLocationName(locationName);
  if (!slugResult.ok) return slugResult;

  const binSet = new Set(binImageNames);
  const list = Array.isArray(files) ? files : [];

  const plans = [];
  let readyCount = 0;
  let skipCount = 0;
  const copied = [];

  for (let i = 0; i < list.length; i++) {
    const from = path.basename(String(list[i] || ""));
    const to = resolveDestName(slugResult.slug, i, list.length);
    const destPath = path.join(destDir, to);

    if (!binSet.has(from)) {
      plans.push({
        from,
        to,
        destPath,
        status: "error",
        error: "File is not in this bin.",
      });
      skipCount += 1;
      continue;
    }

    const resolved = resolveImageUnderRoot(sourceRoot, from);
    if (!resolved.ok) {
      plans.push({
        from,
        to,
        destPath,
        status: "error",
        error: resolved.error || "Source not found.",
      });
      skipCount += 1;
      continue;
    }

    if (fs.existsSync(destPath)) {
      plans.push({
        from,
        to,
        destPath,
        status: "collision",
        error: "Target already exists — skipped to avoid overwrite.",
      });
      skipCount += 1;
      continue;
    }

    if (execute) {
      try {
        fs.copyFileSync(resolved.path, destPath);
        plans.push({ from, to, destPath, status: "copied" });
        copied.push({ from, to, destPath });
        readyCount += 1;
      } catch (err) {
        plans.push({
          from,
          to,
          destPath,
          status: "error",
          error: err.message || String(err),
        });
        skipCount += 1;
      }
    } else {
      plans.push({ from, to, destPath, status: "ready" });
      readyCount += 1;
    }
  }

  return {
    ok: true,
    locationName: slugResult.display,
    locationSlug: slugResult.slug,
    destRoot: destDir,
    plans,
    readyCount,
    skipCount,
    copied: execute ? copied : undefined,
  };
}

export function planBackgroundSaves(
  sourceRoot,
  binImageNames,
  files,
  locationName,
  { execute = false, suffixIndex } = {}
) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) {
    return { ok: false, error: "Select at least one background image in this bin." };
  }

  const result = planImageCopies({
    sourceRoot,
    binImageNames,
    files: list,
    locationName,
    destDir: BACKGROUNDS_RAW,
    destLabel: "Backgrounds_Raw",
    execute,
    resolveDestName(slug, i, listLength) {
      const index =
        suffixIndex != null && listLength === 1
          ? Math.max(1, Number(suffixIndex) || 1)
          : i + 1;
      return destBackgroundFileName(slug, index);
    },
  });

  if (!result.ok) return result;
  return { ...result, backgroundsRaw: result.destRoot };
}

/**
 * @param {string} sourceRoot
 * @param {string[]} binImageNames
 * @param {string[]} files selected FG files in selection order (min 2)
 * @param {string} locationName
 * @param {{ execute?: boolean, cycleLetter?: string }} options
 */
export function planForegroundSaves(
  sourceRoot,
  binImageNames,
  files,
  locationName,
  { execute = false, cycleLetter = "A" } = {}
) {
  const list = Array.isArray(files) ? files : [];
  if (list.length < 2) {
    return {
      ok: false,
      error: "Select at least two foreground images in this bin.",
    };
  }

  const letterResult = normalizeCycleLetter(cycleLetter);
  if (!letterResult.ok) return letterResult;

  const result = planImageCopies({
    sourceRoot,
    binImageNames,
    files: list,
    locationName,
    destDir: FOREGROUNDS_RAW,
    destLabel: "Foregrounds_Raw",
    execute,
    resolveDestName(slug, i) {
      return destForegroundFileName(slug, letterResult.letter, i + 1);
    },
  });

  if (!result.ok) return result;
  return {
    ...result,
    cycleLetter: letterResult.letter,
    foregroundsRaw: result.destRoot,
  };
}

export function validateBinFiles(bin, binIndex) {
  if (!bin || !Array.isArray(bin.images)) {
    return { ok: false, error: `Bin ${binIndex} not found.` };
  }
  return {
    ok: true,
    names: bin.images.map((img) => img.name).filter(isImageFileName),
  };
}

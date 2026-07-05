/**
 * Read-only image listing, capture-time resolution, and gap binning for image intake.
 */
import fs from "node:fs";
import path from "node:path";
import exifr from "exifr";

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
]);

export function isImageFileName(name) {
  if (!name || name.startsWith(".")) return false;
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

export function listImageFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isImageFileName(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function statTime(filePath) {
  const st = fs.statSync(filePath);
  const birth = st.birthtimeMs;
  if (Number.isFinite(birth) && birth > 0) {
    return { ms: birth, source: "stat" };
  }
  return { ms: st.mtimeMs, source: "stat" };
}

async function captureTimeForFile(filePath) {
  try {
    const exif = await exifr.parse(filePath, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
    });
    const raw =
      exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.ModifyDate ?? null;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return { ms: raw.getTime(), source: "exif" };
    }
  } catch {
    // fall through to stat
  }
  return statTime(filePath);
}

export function validateSourceDir(sourcePath) {
  const resolved = path.resolve(
    String(sourcePath || "").replace(/^~(?=\/|$)/, process.env.HOME || "")
  );
  if (!resolved) {
    return { ok: false, error: "Source path is required." };
  }
  let st;
  try {
    st = fs.statSync(resolved);
  } catch (err) {
    return {
      ok: false,
      error: `Path not found or not readable: ${resolved} (${err.code || err.message})`,
    };
  }
  if (!st.isDirectory()) {
    return { ok: false, error: `Not a directory: ${resolved}` };
  }
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    return { ok: false, error: `Directory is not readable: ${resolved}` };
  }
  return { ok: true, path: resolved };
}

const DEFAULT_GAP_MINUTES = 30;

export { DEFAULT_GAP_MINUTES };

function gapStatsFromEntries(entries) {
  if (entries.length < 2) {
    return { maxGapMinutes: 0, gaps: [] };
  }
  const gaps = [];
  let maxGapMinutes = 0;
  for (let i = 1; i < entries.length; i++) {
    const gapMinutes = (entries[i]._ms - entries[i - 1]._ms) / 60000;
    gaps.push({
      after: entries[i - 1].name,
      before: entries[i].name,
      gapMinutes: Math.round(gapMinutes * 10) / 10,
    });
    if (gapMinutes > maxGapMinutes) maxGapMinutes = gapMinutes;
  }
  return {
    maxGapMinutes: Math.round(maxGapMinutes * 10) / 10,
    gaps,
  };
}

/**
 * @param {string} sourcePath absolute directory
 * @param {number} gapMinutes gap strictly greater than this starts a new bin
 */
export async function scanAndBin(sourcePath, gapMinutes = DEFAULT_GAP_MINUTES) {
  const validated = validateSourceDir(sourcePath);
  if (!validated.ok) {
    return validated;
  }

  const dir = validated.path;
  const gapMs =
    Math.max(1, Number(gapMinutes) || DEFAULT_GAP_MINUTES) * 60 * 1000;
  const names = listImageFiles(dir);

  const entries = [];
  for (const name of names) {
    const filePath = path.join(dir, name);
    const { ms, source } = await captureTimeForFile(filePath);
    entries.push({
      name,
      captureAt: new Date(ms).toISOString(),
      timeSource: source,
      _ms: ms,
    });
  }

  entries.sort((a, b) => a._ms - b._ms || a.name.localeCompare(b.name));

  const bins = [];
  for (const entry of entries) {
    const { _ms, ...image } = entry;
    const lastBin = bins[bins.length - 1];
    if (
      !lastBin ||
      _ms - lastBin._endMs > gapMs
    ) {
      bins.push({
        index: bins.length + 1,
        start: image.captureAt,
        end: image.captureAt,
        _startMs: _ms,
        _endMs: _ms,
        images: [image],
      });
    } else {
      lastBin.images.push(image);
      lastBin.end = image.captureAt;
      lastBin._endMs = _ms;
    }
  }

  const outBins = bins.map(({ _startMs, _endMs, ...bin }) => bin);
  const { maxGapMinutes } = gapStatsFromEntries(entries);
  const appliedGap = Math.max(1, Number(gapMinutes) || DEFAULT_GAP_MINUTES);

  return {
    ok: true,
    sourcePath: dir,
    gapMinutes: appliedGap,
    maxGapMinutes,
    imageCount: entries.length,
    binCount: outBins.length,
    bins: outBins,
  };
}

export function resolveImageUnderRoot(sourceRoot, fileName) {
  const base = path.basename(String(fileName || ""));
  if (!base || base !== fileName || !isImageFileName(base)) {
    return { ok: false, error: "Invalid image filename." };
  }
  const resolved = path.resolve(sourceRoot, base);
  if (
    resolved !== path.join(sourceRoot, base) ||
    !resolved.startsWith(sourceRoot + path.sep)
  ) {
    return { ok: false, error: "Path escape rejected." };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: "File not found." };
  }
  return { ok: true, path: resolved, name: base };
}

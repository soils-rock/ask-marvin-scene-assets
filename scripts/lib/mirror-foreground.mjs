/**
 * Shared horizontal flip for foreground WebPs (_L ↔ _R).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseForegroundBasename } from "./clone-foreground.mjs";
import { FG_DIR as FG_DIR_PATH, IP_SCRIPTS_DIR, PACKAGE_ROOT } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FG_DIR = FG_DIR_PATH;
export const CANVAS_W = 1920;
export const CANVAS_H = 1080;
const MIRROR_SCRIPT = path.join(IP_SCRIPTS_DIR, "mirror-foreground-side.mjs");

export function inferDest(sourceFile) {
  const { stem, pairSuffix, isL, isR } = parseForegroundBasename(sourceFile);
  if (!isL && !isR) return null;
  const suffix = pairSuffix ? `__${pairSuffix}` : "";
  const toStem = isL ? stem.replace(/_L$/i, "_R") : stem.replace(/_R$/i, "_L");
  return `${toStem}${suffix}.webp`;
}

/** Mirror staged file → opposite-side basename (_L ↔ _R, keeps __background_id). */
export function mirrorTargets(foregroundFile) {
  const { file, stem, pairSuffix, isL, isR } = parseForegroundBasename(foregroundFile);
  if (!isL && !isR) return null;
  const suffix = pairSuffix ? `__${pairSuffix}` : "";
  const toStem = isL ? stem.replace(/_L$/i, "_R") : stem.replace(/_R$/i, "_L");
  return { from: file, to: `${toStem}${suffix}.webp` };
}

export function reviewFlipErrorHint() {
  return (
    "Retry after restarting the review server. " +
    "If it still fails, run: arch -arm64 npm run review:scenes"
  );
}

export function sharpInstallHint() {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "x64") {
    return reviewFlipErrorHint();
  }
  return (
    `Could not load sharp for ${platform}-${arch}. ` +
    "Fix: npm install --include=optional sharp && npm rebuild sharp " +
    "(on Apple Silicon use native arm64 Node, e.g. arch -arm64 npm run reinstall:sharp)"
  );
}

export async function canLoadSharp() {
  try {
    await import("sharp");
    return true;
  } catch {
    return false;
  }
}

export function shouldUseArm64MirrorSubprocess() {
  return process.platform === "darwin" && process.arch === "x64";
}

export async function shouldMirrorViaSubprocess() {
  if (shouldUseArm64MirrorSubprocess()) return true;
  if (process.platform === "darwin" && !(await canLoadSharp())) return true;
  return false;
}

export async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch (err) {
    const hint = sharpInstallHint();
    err.mirrorHint = hint;
    throw err;
  }
}

export async function readForegroundWebpMeta(filePath) {
  const sharp = await loadSharp();
  return sharp(filePath).metadata();
}

/** @param {string} destPath */
export async function isValidForegroundWebp(destPath) {
  if (!fs.existsSync(destPath)) return false;
  try {
    const meta = await readForegroundWebpMeta(destPath);
    return meta.format === "webp";
  } catch {
    return false;
  }
}

/**
 * @param {{ from: string, to?: string, overwrite?: boolean }} opts
 */
export async function mirrorForeground({ from, to, overwrite = false }) {
  const sourceFile = path.basename(from);
  const destFile = path.basename(to || inferDest(sourceFile) || "");
  if (!destFile || destFile === sourceFile) {
    throw new Error("Could not infer destination (expected _L or _R suffix).");
  }

  const sourcePath = path.join(FG_DIR, sourceFile);
  const destPath = path.join(FG_DIR, destFile);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source not found: ${sourceFile}`);
  }

  if (fs.existsSync(destPath) && !overwrite) {
    throw new Error(
      `Destination already exists: ${destFile}. Pass overwrite: true (or --overwrite) to mirror from ${sourceFile}.`
    );
  }

  const sharp = await loadSharp();
  const meta = await sharp(sourcePath).metadata();
  const sizeWarning =
    meta.width !== CANVAS_W || meta.height !== CANVAS_H
      ? `${sourceFile} is ${meta.width}×${meta.height} (expected ${CANVAS_W}×${CANVAS_H}).`
      : null;

  await sharp(sourcePath).flop().webp({ quality: 80 }).toFile(destPath);

  return {
    from: sourceFile,
    to: destFile,
    destPath,
    sizeWarning,
    existed: false,
  };
}

function parseMirrorSubprocessOutput(stdout, stderr, status) {
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  if (line) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.ok === false) {
        const err = new Error(parsed.error || "Mirror subprocess failed");
        if (parsed.hint) err.mirrorHint = parsed.hint;
        throw err;
      }
      if (parsed.ok) {
        return {
          from: parsed.from,
          to: parsed.to,
          destPath: path.join(FG_DIR, parsed.to),
          sizeWarning: parsed.sizeWarning ?? null,
          existed: Boolean(parsed.existed),
        };
      }
    } catch (err) {
      if (err.mirrorHint) throw err;
    }
  }

  const detail = (stderr || stdout || "").trim();
  const err = new Error(
    detail ? `Mirror subprocess failed: ${detail}` : "Mirror subprocess failed"
  );
  err.mirrorHint = reviewFlipErrorHint();
  if (status != null && status !== 0) {
    err.code = status;
  }
  throw err;
}

/**
 * Run mirror-foreground-side.mjs under native arm64 Node on Apple Silicon x64 hosts.
 * @param {{ from: string, to: string, overwrite?: boolean }} opts
 */
export function mirrorForegroundViaSubprocess({ from, to, overwrite = false }) {
  const sourceFile = path.basename(from);
  const destFile = path.basename(to);
  const scriptArgs = [MIRROR_SCRIPT, "--from", sourceFile, "--to", destFile, "--json"];
  if (overwrite) scriptArgs.push("--overwrite");

  const result = shouldUseArm64MirrorSubprocess()
    ? spawnSync("arch", ["-arm64", process.execPath, ...scriptArgs], {
        encoding: "utf8",
        cwd: PACKAGE_ROOT,
      })
    : spawnSync(process.execPath, scriptArgs, {
        encoding: "utf8",
        cwd: PACKAGE_ROOT,
      });

  return parseMirrorSubprocessOutput(result.stdout ?? "", result.stderr ?? "", result.status);
}

/**
 * Prefer in-process sharp; fall back to arm64 subprocess on darwin x64 or sharp load failure.
 * @param {{ from: string, to?: string, overwrite?: boolean }} opts
 */
export async function mirrorForegroundWithFallback(opts) {
  if (await shouldMirrorViaSubprocess()) {
    const to = path.basename(opts.to || inferDest(opts.from) || "");
    return mirrorForegroundViaSubprocess({ from: opts.from, to, overwrite: opts.overwrite });
  }
  return mirrorForeground(opts);
}

export const mirrorForegroundSideCli = MIRROR_SCRIPT;

export function isMirrorForegroundSideMain(importMetaUrl, argv = process.argv) {
  const entry = argv[1];
  return Boolean(entry && pathToFileURL(entry).href === importMetaUrl);
}

/**
 * Bake foreground position/scale into 1920×1080 WebP (review tool).
 * Anchor: bottom-left for _L, bottom-right for _R.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CANVAS_H,
  CANVAS_W,
  FG_DIR,
  canLoadSharp,
  loadSharp,
  reviewFlipErrorHint,
  shouldUseArm64MirrorSubprocess,
  sharpInstallHint,
} from "./mirror-foreground.mjs";

import { PACKAGE_ROOT } from "./paths.mjs";

const BAKE_SCRIPT = path.join(PACKAGE_ROOT, "scripts/bake-foreground.mjs");

export const DEFAULT_FG_ADJUST = Object.freeze({
  scaleX: 100,
  scaleY: 100,
});

export function foregroundAnchorFromFile(file) {
  const base = path.basename(file || "").replace(/\.webp$/i, "");
  return /_L$/i.test(base) ? "left" : "right";
}

export function normalizeFgAdjust(raw = {}) {
  const scaleX = Number(raw.scaleX);
  const scaleY = Number(raw.scaleY);
  return {
    scaleX: Number.isFinite(scaleX) ? scaleX : 100,
    scaleY: Number.isFinite(scaleY) ? scaleY : 100,
  };
}

export function isDefaultFgAdjust(adjust) {
  const a = normalizeFgAdjust(adjust);
  return a.scaleX === 100 && a.scaleY === 100;
}

export function computeCompositePosition(adjust, anchor, srcW, srcH) {
  const { scaleX, scaleY } = normalizeFgAdjust(adjust);
  const sx = scaleX / 100;
  const sy = scaleY / 100;
  const scaledW = Math.max(1, Math.round(srcW * sx));
  const scaledH = Math.max(1, Math.round(srcH * sy));
  if (anchor === "left") {
    return {
      left: 0,
      top: CANVAS_H - scaledH,
      scaledW,
      scaledH,
    };
  }
  return {
    left: CANVAS_W - scaledW,
    top: CANVAS_H - scaledH,
    scaledW,
    scaledH,
  };
}

/**
 * @param {{ file: string, scaleX?: number, scaleY?: number, overwrite?: boolean }} opts
 */
export async function bakeForeground({
  file,
  scaleX = 100,
  scaleY = 100,
  overwrite = true,
}) {
  const filename = path.basename(String(file || ""));
  if (!filename) {
    throw new Error('Missing foreground "file" basename.');
  }
  if (!/\.webp$/i.test(filename)) {
    throw new Error("Foreground file must be a .webp basename.");
  }

  const adjust = normalizeFgAdjust({ scaleX, scaleY });
  const sourcePath = path.join(FG_DIR, filename);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Foreground not found: ${filename}`);
  }

  if (isDefaultFgAdjust(adjust)) {
    return {
      file: filename,
      destPath: sourcePath,
      adjust,
      noop: true,
    };
  }

  const anchor = foregroundAnchorFromFile(filename);
  const sharp = await loadSharp();
  const meta = await sharp(sourcePath).metadata();
  const srcW = meta.width ?? CANVAS_W;
  const srcH = meta.height ?? CANVAS_H;
  const { left, top, scaledW, scaledH } = computeCompositePosition(
    adjust,
    anchor,
    srcW,
    srcH
  );

  const resized = await sharp(sourcePath)
    .resize(scaledW, scaledH, { fit: "fill" })
    .toBuffer();

  const destPath = sourcePath;
  if (fs.existsSync(destPath) && !overwrite) {
    throw new Error(`Destination exists (use overwrite): ${filename}`);
  }

  await sharp({
    create: {
      width: CANVAS_W,
      height: CANVAS_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .webp({ quality: 80 })
    .toFile(destPath);

  let sizeWarning = null;
  if (srcW !== CANVAS_W || srcH !== CANVAS_H) {
    sizeWarning = `${filename} source was ${srcW}×${srcH} (expected ${CANVAS_W}×${CANVAS_H}).`;
  }

  return {
    file: filename,
    destPath,
    adjust,
    anchor,
    composite: { left, top, scaledW, scaledH },
    sizeWarning,
    noop: false,
  };
}

function parseBakeSubprocessOutput(stdout, stderr, status) {
  const line = stdout.trim().split("\n").filter(Boolean).pop();
  if (line) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.ok === false) {
        const err = new Error(parsed.error || "Bake subprocess failed");
        if (parsed.hint) err.bakeHint = parsed.hint;
        throw err;
      }
      if (parsed.ok) return parsed;
    } catch (err) {
      if (err.bakeHint) throw err;
    }
  }

  const detail = (stderr || stdout || "").trim();
  const err = new Error(
    detail ? `Bake subprocess failed: ${detail}` : "Bake subprocess failed"
  );
  err.bakeHint = reviewFlipErrorHint();
  if (status != null && status !== 0) err.code = status;
  throw err;
}

export function bakeForegroundViaSubprocess(opts) {
  const file = path.basename(opts.file);
  const adjust = normalizeFgAdjust(opts);
  const scriptArgs = [
    BAKE_SCRIPT,
    "--file",
    file,
    "--scale-x",
    String(adjust.scaleX),
    "--scale-y",
    String(adjust.scaleY),
    "--json",
  ];
  if (opts.overwrite === false) scriptArgs.push("--no-overwrite");

  const result = shouldUseArm64MirrorSubprocess()
    ? spawnSync("arch", ["-arm64", process.execPath, ...scriptArgs], {
        encoding: "utf8",
        cwd: PACKAGE_ROOT,
      })
    : spawnSync(process.execPath, scriptArgs, {
        encoding: "utf8",
        cwd: PACKAGE_ROOT,
      });

  return parseBakeSubprocessOutput(result.stdout ?? "", result.stderr ?? "", result.status);
}

export async function shouldBakeViaSubprocess() {
  if (shouldUseArm64MirrorSubprocess()) return true;
  if (process.platform === "darwin" && !(await canLoadSharp())) return true;
  return false;
}

export async function bakeForegroundWithFallback(opts) {
  if (await shouldBakeViaSubprocess()) {
    return bakeForegroundViaSubprocess(opts);
  }
  return bakeForeground(opts);
}

export function bakeErrorHint(err) {
  return err?.bakeHint || (err?.message?.includes("sharp") ? sharpInstallHint() : reviewFlipErrorHint());
}

export function isBakeForegroundMain(importMetaUrl, argv = process.argv) {
  const entry = argv[1];
  return Boolean(entry && pathToFileURL(entry).href === importMetaUrl);
}

/**
 * Bake anchors the foreground to the bottom and to its own side, scales it,
 * and crops whatever falls outside the 1920×1080 canvas.
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

  const width = Math.min(scaledW, CANVAS_W);
  const height = Math.min(scaledH, CANVAS_H);
  const extractTop = Math.max(0, scaledH - CANVAS_H);
  const compositeTop = Math.max(0, CANVAS_H - scaledH);

  let extractLeft;
  let compositeLeft;
  if (anchor === "left") {
    extractLeft = 0;
    compositeLeft = 0;
  } else {
    extractLeft = Math.max(0, scaledW - CANVAS_W);
    compositeLeft = Math.max(0, CANVAS_W - scaledW);
  }

  return {
    scaledW,
    scaledH,
    width,
    height,
    extractLeft,
    extractTop,
    compositeLeft,
    compositeTop,
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
  const {
    scaledW,
    scaledH,
    width,
    height,
    extractLeft,
    extractTop,
    compositeLeft,
    compositeTop,
  } = computeCompositePosition(adjust, anchor, srcW, srcH);

  const resized = await sharp(sourcePath)
    .resize(scaledW, scaledH, { fit: "fill" })
    .extract({ left: extractLeft, top: extractTop, width, height })
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
    .composite([{ input: resized, left: compositeLeft, top: compositeTop }])
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
    composite: { left: compositeLeft, top: compositeTop, scaledW, scaledH },
    cropped: { x: extractLeft > 0, y: extractTop > 0 },
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

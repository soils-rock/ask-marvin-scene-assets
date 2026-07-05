/**
 * PNG → WebP conversion for scene layers (1920×1080).
 * Shared by flat archive ingest; apply-scene-png-edits keeps its own copy for now.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { SCENE_CANVAS } from "./animation-primer.mjs";

const TARGET_BG_BYTES = 900 * 1024;
const BG_TOLERANCE = 80 * 1024;
const FG_QUALITY = 80;

export async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch (err) {
    const { platform, arch } = process;
    const hint =
      `Could not load sharp for ${platform}-${arch}.\n` +
      `Fix: npm install --include=optional sharp && npm rebuild sharp`;
    const error = new Error(hint);
    error.cause = err;
    throw error;
  }
}

function getSize(filePath) {
  const out = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}"`, {
    encoding: "utf8",
  });
  const width = Number(out.match(/pixelWidth: (\d+)/)?.[1]);
  const height = Number(out.match(/pixelHeight: (\d+)/)?.[1]);
  return { width, height };
}

/**
 * @param {string} srcPng
 * @param {string} workPng
 */
export function prepareCanvasPng(srcPng, workPng) {
  fs.mkdirSync(path.dirname(workPng), { recursive: true });
  fs.copyFileSync(srcPng, workPng);
  const { width, height } = getSize(workPng);

  if (width === SCENE_CANVAS.width && height === SCENE_CANVAS.height) {
    return { ok: true };
  }

  if (width === 1920 && height === 1280) {
    execSync(
      `sips -c ${SCENE_CANVAS.height} ${SCENE_CANVAS.width} "${workPng}" --out "${workPng}"`
    );
    return { ok: true, cropped: true };
  }

  return {
    ok: false,
    error: `${srcPng}: ${width}×${height} — expected 1920×1080 or 1920×1280`,
  };
}

/**
 * @param {{ srcPng: string, destWebp: string, kind: "background"|"foreground", sharp?: import("sharp").Sharp }} opts
 */
export async function convertArchivePngToWebp({ srcPng, destWebp, kind, sharp }) {
  const sharpImpl = sharp ?? (await loadSharp());
  const workDir = path.dirname(destWebp);
  const workPng = path.join(workDir, `.work_${path.basename(srcPng)}`);

  const prepared = prepareCanvasPng(srcPng, workPng);
  if (!prepared.ok) {
    throw new Error(prepared.error);
  }

  fs.mkdirSync(workDir, { recursive: true });

  async function encodeWebp(workFile, outWebp, quality) {
    await sharpImpl(workFile).webp({ quality }).toFile(outWebp);
    return fs.statSync(outWebp).size;
  }

  let quality;
  let size;
  if (kind === "background") {
    let bestQ = 96;
    let bestSize = await encodeWebp(workPng, destWebp, bestQ);
    let bestDiff = Math.abs(bestSize - TARGET_BG_BYTES);

    for (let q = 70; q <= 100; q++) {
      const qSize = await encodeWebp(workPng, destWebp, q);
      const diff = Math.abs(qSize - TARGET_BG_BYTES);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestQ = q;
        bestSize = qSize;
      }
      if (
        qSize >= TARGET_BG_BYTES - BG_TOLERANCE &&
        qSize <= TARGET_BG_BYTES + BG_TOLERANCE
      ) {
        quality = q;
        size = qSize;
        break;
      }
    }
    if (quality === undefined) {
      quality = bestQ;
      size = bestSize;
    }
  } else {
    quality = FG_QUALITY;
    size = await encodeWebp(workPng, destWebp, quality);
  }

  if (fs.existsSync(workPng)) fs.unlinkSync(workPng);

  return {
    quality,
    sizeBytes: size,
    sizeKb: Math.round(size / 1024),
  };
}

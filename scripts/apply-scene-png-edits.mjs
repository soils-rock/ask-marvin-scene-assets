#!/usr/bin/env node
/**
 * Apply scene PNG edits in public/images/background and foreground.
 *
 * When a PNG sits beside a matching .webp (same basename), treat the PNG as the
 * latest edit: normalize to 1920×1080, overwrite the .webp, delete the PNG.
 *
 * See docs/Animation_Primer.md — "PNG edit → WebP replacement".
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { SCENE_CANVAS } from "./lib/animation-primer.mjs";
import { BG_DIR, FG_DIR } from "./lib/paths.mjs";

const DIRS = {
  background: BG_DIR,
  foreground: FG_DIR,
};
const ARCHIVE_ROOT = process.env.SCENE_PNG_ARCHIVE || "/Volumes/Marvin/CyanoVerse_Source_Files";
const ARCHIVE_DIRS = {
  background: path.join(ARCHIVE_ROOT, "Backgrounds_Raw"),
  foreground: path.join(ARCHIVE_ROOT, "Foregrounds_Raw"),
};

const TARGET_BG_BYTES = 900 * 1024;
const BG_TOLERANCE = 80 * 1024;
const FG_QUALITY = 80;

const log = [];
const errors = [];

function listScenePngs(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".png") && !n.startsWith(".work_"));
}

function countScenePngEdits() {
  let found = 0;
  for (const dir of Object.values(DIRS)) {
    found += listScenePngs(dir).length;
  }
  return found;
}

async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch (err) {
    const { platform, arch } = process;
    console.error(
      `Could not load sharp for ${platform}-${arch} (needed only when scene PNG edits exist).\n` +
        `Fix: npm install --include=optional sharp\n` +
        `Or:  npm install --os=${platform} --cpu=${arch} sharp\n` +
        `Then: npm rebuild sharp`
    );
    console.error(err.message);
    process.exit(1);
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

async function prepareCanvas(srcPng, workPng) {
  fs.copyFileSync(srcPng, workPng);
  const { width, height } = getSize(workPng);

  if (width === SCENE_CANVAS.width && height === SCENE_CANVAS.height) {
    return true;
  }

  if (width === 1920 && height === 1280) {
    execSync(
      `sips -c ${SCENE_CANVAS.height} ${SCENE_CANVAS.width} "${workPng}" --out "${workPng}"`
    );
    log.push(`  cropped ${path.basename(srcPng)}: 1920×1280 → 1920×1080`);
    return true;
  }

  errors.push(
    `${srcPng}: ${width}×${height} — expected 1920×1080 or 1920×1280`
  );
  return false;
}

async function processDir(dir, kind, sharp) {
  const pngs = listScenePngs(dir);

  async function encodeWebp(workPng, outWebp, quality) {
    await sharp(workPng).webp({ quality }).toFile(outWebp);
    return fs.statSync(outWebp).size;
  }

  async function findBackgroundQuality(workPng, outWebp) {
    let bestQ = 96;
    let bestSize = await encodeWebp(workPng, outWebp, bestQ);
    let bestDiff = Math.abs(bestSize - TARGET_BG_BYTES);

    for (let q = 70; q <= 100; q++) {
      const size = await encodeWebp(workPng, outWebp, q);
      const diff = Math.abs(size - TARGET_BG_BYTES);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestQ = q;
        bestSize = size;
      }
      if (
        size >= TARGET_BG_BYTES - BG_TOLERANCE &&
        size <= TARGET_BG_BYTES + BG_TOLERANCE
      ) {
        return { quality: q, size };
      }
    }
    return { quality: bestQ, size: bestSize };
  }

  for (const name of pngs) {
    const srcPng = path.join(dir, name);
    const outWebp = path.join(dir, name.replace(/\.png$/i, ".webp"));
    const workPng = path.join(dir, `.work_${name}`);
    const replacing = fs.existsSync(outWebp);

    console.log(`\n${kind}/${name}${replacing ? " → replace .webp" : " → new .webp"}`);

    const ok = await prepareCanvas(srcPng, workPng);
    if (!ok) continue;

    let quality;
    let size;
    if (kind === "background") {
      ({ quality, size } = await findBackgroundQuality(workPng, outWebp));
    } else {
      quality = FG_QUALITY;
      size = await encodeWebp(workPng, outWebp, quality);
    }

    archivePng(kind, srcPng, name);
    fs.unlinkSync(srcPng);
    if (fs.existsSync(workPng)) fs.unlinkSync(workPng);

    log.push(
      `  ${name} → ${path.basename(outWebp)} q=${quality} (${Math.round(size / 1024)} KB)`
    );
    console.log(
      `  ✓ ${path.basename(outWebp)} (${Math.round(size / 1024)} KB, q=${quality})`
    );
    console.log(`  removed ${name}`);
  }
}

function archivePng(kind, srcPng, name) {
  if (!fs.existsSync(ARCHIVE_ROOT)) return;
  try {
    const archiveDir = ARCHIVE_DIRS[kind];
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.copyFileSync(srcPng, path.join(archiveDir, name));
    log.push(`  archived PNG → ${path.join(archiveDir, name)}`);
  } catch (err) {
    log.push(`  archive skipped (${err.code || err.message})`);
  }
}

console.log("Apply scene PNG edits → WebP (1920×1080)");

const found = countScenePngEdits();
if (found === 0) {
  console.log("No PNG edits in background/ or foreground/.");
  process.exit(0);
}

const sharp = await loadSharp();

for (const [kind, dir] of Object.entries(DIRS)) {
  await processDir(dir, kind, sharp);
}

if (errors.length) {
  console.error("\nErrors:");
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log("\n--- Summary ---");
log.forEach((l) => console.log(l));
console.log("\nDone. Run: npm run validate:assets");

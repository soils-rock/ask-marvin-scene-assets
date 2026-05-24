#!/usr/bin/env node
/**
 * Validate scene/character images against Animation Primer specs.
 * Run: npm run validate:assets
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  ANIMATION_PRIMER_VERSION,
  SCENE_CANVAS,
  MARVIN_CANVAS,
  CHARACTER_ASSET,
  SCENE_LAYER_ASSET,
} from "./lib/animation-primer.mjs";
import { IMAGES_DIR, PUBLIC_DIR } from "./lib/paths.mjs";

const IMAGES_ROOT = IMAGES_DIR;

const errors = [];
const warnings = [];

function readImageSize(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24) return null;

  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF (logical screen; animated Marvin GIFs stack frames vertically)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    const width = buf.readUInt16LE(6);
    let height = buf.readUInt16LE(8);
    if (
      height > MARVIN_CANVAS.height &&
      height % MARVIN_CANVAS.height === 0 &&
      width === MARVIN_CANVAS.width
    ) {
      height = MARVIN_CANVAS.height;
    }
    return { width, height };
  }

  // WebP (VP8X extended or VP8/VP8L chunk)
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === "VP8 " && buf.length >= 30) {
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      return { width: w, height: h };
    }
    if (chunk === "VP8L" && buf.length >= 25) {
      const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  return null;
}

function expectSize(relPath, actual, expected, label) {
  if (!actual) {
    errors.push(`${relPath}: could not read image dimensions`);
    return;
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    errors.push(
      `${relPath}: ${label} is ${actual.width}×${actual.height}, expected ${expected.width}×${expected.height}`
    );
  }
}

function assertWebpMagic(fullPath, relPath) {
  const buf = fs.readFileSync(fullPath, { start: 0, end: 11 });
  const riff = buf.toString("ascii", 0, 4);
  const webp = buf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || webp !== "WEBP") {
    const sizeMb = (fs.statSync(fullPath).size / (1024 * 1024)).toFixed(1);
    errors.push(
      `${relPath}: not a WebP file (${sizeMb} MB; starts with ${riff || "?"}) — export PNG and run npm run apply:scene-png-edits (do not save PSD as .webp)`
    );
  }
}

function walkDir(dir, extFilter) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) return [];
    if (name.startsWith(".")) return [];
    const ext = path.extname(name).toLowerCase();
    if (extFilter && !extFilter.includes(ext)) return [];
    return [full];
  });
}

function validateCharacterDir(dirName) {
  const dir = path.join(IMAGES_ROOT, dirName);
  const files = walkDir(dir);
  if (files.length === 0 && dirName !== "marvin") return;

  for (const full of files) {
    const rel = path.relative(PUBLIC_DIR, full).replace(/\\/g, "/");
    const ext = path.extname(full).toLowerCase();

    if (ext === ".psd") continue;

    if (ext === ".png" || ext === ".gif") {
      if (dirName === "marvin") {
        expectSize(
          rel,
          readImageSize(full),
          MARVIN_CANVAS,
          "Marvin asset"
        );
      }
      continue;
    }

    if (dirName === "marvin") {
      errors.push(`${rel}: character assets must be PNG or GIF, got ${ext}`);
    }
  }
}

function validateSceneDir(dirName) {
  const dir = path.join(IMAGES_ROOT, dirName);
  for (const full of walkDir(dir)) {
    const rel = path.relative(PUBLIC_DIR, full).replace(/\\/g, "/");
    const ext = path.extname(full).toLowerCase();

    if (ext !== ".webp") {
      warnings.push(
        `${rel}: scene layer should be WebP per Animation Primer v${ANIMATION_PRIMER_VERSION} (found ${ext})`
      );
      if (ext === ".png") {
        expectSize(rel, readImageSize(full), SCENE_CANVAS, "scene layer");
      }
      continue;
    }

    assertWebpMagic(full, rel);
    expectSize(rel, readImageSize(full), SCENE_CANVAS, "scene layer");
  }
}

console.log(`Animation Primer v${ANIMATION_PRIMER_VERSION} — validating assets in public/images/`);

for (const dir of CHARACTER_ASSET.directories) {
  validateCharacterDir(dir);
}

for (const dir of SCENE_LAYER_ASSET.directories) {
  validateSceneDir(dir);
}

if (warnings.length) {
  console.warn("\nWarnings:");
  warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
}

if (errors.length) {
  console.error("\nAsset dimension errors:");
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  console.error(
    "\nFix exports to match docs/Animation_Primer.md (Section 0), then re-run npm run validate:assets"
  );
  process.exit(1);
}

console.log("✓ All checked assets match Animation Primer canvas sizes.");

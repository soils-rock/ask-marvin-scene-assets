/**
 * Resolve package roots and asset/data directories from paths.json (+ env overrides).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(__dirname, "..");

const PATHS_FILE = path.join(PACKAGE_ROOT, "paths.json");

function readPathsFile() {
  if (!fs.existsSync(PATHS_FILE)) {
    throw new Error(
      `Missing ${PATHS_FILE}. Copy paths.example.json to paths.json and set publicRoot.`
    );
  }
  return JSON.parse(fs.readFileSync(PATHS_FILE, "utf8"));
}

function resolveMaybeRelative(base, value) {
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

/** @returns {{ packageRoot: string, dataDir: string, publicRoot: string, bgDir: string, fgDir: string, marvinSprite: string, reviewPublicDir: string }} */
export function loadPaths() {
  const file = readPathsFile();
  const dataDir = resolveMaybeRelative(PACKAGE_ROOT, file.dataDir ?? "data");
  const publicRoot = resolveMaybeRelative(
    PACKAGE_ROOT,
    process.env.SCENE_REVIEW_PUBLIC_ROOT || file.publicRoot
  );
  const reviewPublicDir = path.join(PACKAGE_ROOT, "public");
  const bgDir = path.join(publicRoot, "images/background");
  const fgDir = path.join(publicRoot, "images/foreground");
  const marvinSprite =
    process.env.SCENE_REVIEW_MARVIN_SPRITE ||
    file.marvinSprite ||
    path.join(publicRoot, "images/marvin/full.png");

  return {
    packageRoot: PACKAGE_ROOT,
    dataDir,
    publicRoot,
    bgDir,
    fgDir,
    marvinSprite,
    reviewPublicDir,
  };
}

export const PATHS = loadPaths();
export const DATA_DIR = PATHS.dataDir;
export const PUBLIC_ROOT = PATHS.publicRoot;
export const BG_DIR = PATHS.bgDir;
export const FG_DIR = PATHS.fgDir;
export const REVIEW_PUBLIC_DIR = PATHS.reviewPublicDir;

export const BG_CSV = path.join(DATA_DIR, "scene_background_metadata.csv");
export const FG_CSV = path.join(DATA_DIR, "scene_foreground_metadata.csv");
export const PAIRS_CSV = path.join(DATA_DIR, "scene_playable_pairs.csv");
export const REGISTRY_OUT = path.join(PACKAGE_ROOT, "generated/sceneRegistry.js");

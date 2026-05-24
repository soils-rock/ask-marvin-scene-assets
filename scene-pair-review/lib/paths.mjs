/**
 * Paths for the scene-pair-review package (paths.json + env overrides).
 *
 * Defaults: metadata CSVs in ./data (copied snapshots), scene WebPs and Marvin sprite
 * from ask-marvin public/, pairing commits to ask-marvin data/scene_playable_pairs.csv.
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
      `Missing ${PATHS_FILE}. Copy paths.example.json to paths.json and set publicRoot / askMarvinRoot.`
    );
  }
  return JSON.parse(fs.readFileSync(PATHS_FILE, "utf8"));
}

function resolveMaybeRelative(base, value) {
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

const file = readPathsFile();

export const ASK_MARVIN_ROOT = resolveMaybeRelative(
  PACKAGE_ROOT,
  process.env.ASK_MARVIN_ROOT || file.askMarvinRoot || "../../../ask-marvin"
);

export const DATA_DIR = resolveMaybeRelative(PACKAGE_ROOT, file.dataDir ?? "data");

export const PUBLIC_ROOT = resolveMaybeRelative(
  PACKAGE_ROOT,
  process.env.SCENE_REVIEW_PUBLIC_ROOT || file.publicRoot || path.join(ASK_MARVIN_ROOT, "public")
);

/** Where Complete writes playable pairs (default: ask-marvin canonical CSV). */
export const PAIRS_CSV = resolveMaybeRelative(
  PACKAGE_ROOT,
  process.env.SCENE_PAIRS_CSV || file.pairsCsv || path.join(ASK_MARVIN_ROOT, "data/scene_playable_pairs.csv")
);

export const BG_DIR = path.join(PUBLIC_ROOT, "images/background");
export const FG_DIR = path.join(PUBLIC_ROOT, "images/foreground");
export const BG_CSV = path.join(DATA_DIR, "scene_background_metadata.csv");
export const FG_CSV = path.join(DATA_DIR, "scene_foreground_metadata.csv");

/** Review-only registry (built from package metadata + ask-marvin images). */
export const REGISTRY_OUT = path.join(PACKAGE_ROOT, "generated/sceneRegistry.js");
export const SCENE_REGISTRY = REGISTRY_OUT;

export const REVIEW_DIST = path.join(PACKAGE_ROOT, "public/scene-pair-review");
export const REVIEW_HTML = path.join(REVIEW_DIST, "index.html");

/** Also rebuild ask-marvin app registry after Complete when true (default). */
export const SYNC_REGISTRY_TO_ASK_MARVIN =
  file.syncRegistryToAskMarvin !== false &&
  process.env.SCENE_REVIEW_SYNC_ASK_MARVIN !== "0";

export const ASK_MARVIN_REGISTRY = path.join(
  ASK_MARVIN_ROOT,
  "src/generated/sceneRegistry.js"
);

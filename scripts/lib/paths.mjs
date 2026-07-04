/**
 * Paths for ask-marvin (consumer) vs Image_Processing (authoring tools).
 *
 * Defaults assume sibling repos:
 *   ~/ask-marvin
 *   ~/CyanoVerse/Image_Processing
 *
 * Override:
 *   ASK_MARVIN_ROOT=/path/to/ask-marvin
 *   SCENE_PAIRS_CSV=/path/to/scene_playable_pairs.csv
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Image_Processing repo root */
export const PACKAGE_ROOT = path.resolve(__dirname, "../..");

/** ask-marvin dev app (scene WebPs + pairing CSV target) */
export const ASK_MARVIN_ROOT =
  process.env.ASK_MARVIN_ROOT || path.resolve(PACKAGE_ROOT, "../../ask-marvin");

/** Playable pairs output (written by scene pair review Complete) */
export const PAIRS_CSV =
  process.env.SCENE_PAIRS_CSV ||
  path.join(ASK_MARVIN_ROOT, "data/scene_playable_pairs.csv");

/** Background metadata (written by scene pair review Complete) */
export const BG_CSV =
  process.env.SCENE_BG_CSV ||
  path.join(ASK_MARVIN_ROOT, "data/scene_background_metadata.csv");

export const PUBLIC_DIR = path.join(ASK_MARVIN_ROOT, "public");
export const FG_DIR = path.join(PUBLIC_DIR, "images/foreground");
export const BG_DIR = path.join(PUBLIC_DIR, "images/background");
export const IMAGES_DIR = path.join(PUBLIC_DIR, "images");
export const SCENE_REGISTRY = path.join(
  ASK_MARVIN_ROOT,
  "src/generated/sceneRegistry.js"
);

/** Built static review page (gitignored under dist/) */
export const REVIEW_DIST = path.join(PACKAGE_ROOT, "dist/scene-pair-review");
export const REVIEW_HTML = path.join(REVIEW_DIST, "index.html");

export const IP_SCRIPTS_DIR = path.join(PACKAGE_ROOT, "scripts");

import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ASK_MARVIN_ROOT,
  PACKAGE_ROOT,
  SCENE_REGISTRY,
  SYNC_REGISTRY_TO_ASK_MARVIN,
} from "../../lib/paths.mjs";

export { ASK_MARVIN_ROOT as ROOT };

export function rebuildSceneRegistry() {
  execSync("node scripts/build-scene-registry.mjs", {
    cwd: PACKAGE_ROOT,
    stdio: "pipe",
  });
  if (SYNC_REGISTRY_TO_ASK_MARVIN && ASK_MARVIN_ROOT) {
    try {
      execSync("node scripts/build-scene-registry.mjs", {
        cwd: ASK_MARVIN_ROOT,
        stdio: "pipe",
      });
    } catch {
      // ask-marvin may not have the script in older checkouts
    }
  }
}

export function rebuildScenePairReview() {
  execSync("node scripts/build-scene-pair-review.mjs", {
    cwd: PACKAGE_ROOT,
    stdio: "pipe",
  });
}

export function rebuildScenePairs() {
  rebuildSceneRegistry();
  rebuildScenePairReview();
}

export async function loadPlayablePairs() {
  const url = `${pathToFileURL(SCENE_REGISTRY).href}?t=${Date.now()}`;
  const mod = await import(url);
  return mod.SCENE_PLAYABLE_PAIRS;
}

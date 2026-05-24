import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ASK_MARVIN_ROOT, PACKAGE_ROOT, SCENE_REGISTRY } from "./paths.mjs";

export { ASK_MARVIN_ROOT as ROOT };

export function rebuildSceneRegistry() {
  execSync("node scripts/build-scene-registry.mjs", {
    cwd: ASK_MARVIN_ROOT,
    stdio: "pipe",
  });
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

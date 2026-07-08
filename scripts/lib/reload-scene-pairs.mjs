import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { enrichPairForReview, sortPairsForReview } from "./sort-pairs-for-review.mjs";
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

/**
 * Load pairs from a freshly rebuilt sceneRegistry.js (subprocess avoids Node ESM import cache).
 */
export function loadPlayablePairs() {
  const registryUrl = pathToFileURL(SCENE_REGISTRY).href;
  const script = [
    `import('${registryUrl}?t=${Date.now()}')`,
    ".then((m) => console.log(JSON.stringify({",
    "pairs: m.SCENE_PLAYABLE_PAIRS ?? [],",
    "meta: m.BACKGROUND_META_BY_ID ?? {}",
    "})))",
    ".catch((e) => { console.error(e); process.exit(1); });",
  ].join("");

  const out = execSync(`node --input-type=module -e ${JSON.stringify(script)}`, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  const { pairs, meta } = JSON.parse(out.trim());
  return sortPairsForReview(pairs).map((pair) =>
    enrichPairForReview({
      ...pair,
      backgroundLat: meta[pair.backgroundId]?.lat ?? "",
      backgroundLong: meta[pair.backgroundId]?.lon ?? meta[pair.backgroundId]?.long ?? "",
    })
  );
}

#!/usr/bin/env node
/**
 * Build static scene-pair review page (no Vite).
 * Output: dist/scene-pair-review/index.html (gitignored)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sortPairsForReview } from "./lib/sort-pairs-for-review.mjs";
import {
  ASK_MARVIN_ROOT,
  PACKAGE_ROOT,
  REVIEW_DIST,
  REVIEW_HTML,
  SCENE_REGISTRY,
} from "./lib/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_SRC = path.join(PACKAGE_ROOT, "scene-pair-review/ui/scenePairReview.css");
const CLIENT_SRC = path.join(__dirname, "scene-pair-review-client.js");

function ensureRegistry() {
  if (!fs.existsSync(SCENE_REGISTRY)) {
    execSync("node scripts/build-scene-registry.mjs", {
      cwd: ASK_MARVIN_ROOT,
      stdio: "inherit",
    });
  }
}

function buildHtml(pairs, css) {
  const pairsJson = JSON.stringify(pairs);
  const clientJs = fs.readFileSync(CLIENT_SRC, "utf8");
  if (!clientJs.includes("__PAIRS_JSON__")) {
    throw new Error("scene-pair-review-client.js missing __PAIRS_JSON__ placeholder");
  }
  const inlined = clientJs.replaceAll("__PAIRS_JSON__", pairsJson);
  if (inlined.includes("__PAIRS_JSON__")) {
    throw new Error("Failed to replace all __PAIRS_JSON__ placeholders in client");
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Scene pair review — ask-marvin</title>
  <style>
${css}
  </style>
</head>
<body class="scene-pair-review">
  <header class="scene-pair-review__header">
    <h1>Scene pair review</h1>
    <div class="scene-pair-review__controls">
      <button type="button" id="btn-prev">← Prev</button>
      <button type="button" id="btn-next">Next →</button>
      <button type="button" id="btn-mode">Grid view (G)</button>
    </div>
    <p class="scene-pair-review__meta" id="meta"></p>
    <p class="scene-pair-review__meta-note" id="meta-note" hidden></p>
    <div id="toast" class="scene-pair-review__toast" hidden role="status"></div>
  </header>
  <main class="scene-pair-review__main">
    <div id="single" class="scene-pair-review__single" hidden>
      <div class="scene-pair-review__workspace">
        <section class="scene-pair-review__preview" aria-label="Scaled pair preview">
          <div class="scene-pair-review__preview-stage" id="preview-stage">
            <div class="scene-pair-review__preview-frame" id="preview-frame">
              <div class="scene-pair-review__viewport" id="viewport"></div>
            </div>
          </div>
          <p class="scene-pair-review__preview-caption">
            Scaled review preview only — source WebPs are not modified until you click
            <strong>Apply to image</strong> or <strong>Complete</strong>.
          </p>
        </section>
        <aside class="scene-pair-review__panel" id="copy-helper" hidden aria-label="Pairing and metadata"></aside>
      </div>
    </div>
    <div id="grid" class="scene-pair-review__grid" hidden></div>
    <p class="scene-pair-review__hint" id="hint" hidden>
      Staging review (1920×1080): background → Marvin → foreground. Use <strong>Foreground
      adjust</strong> (Scale X/Y %) for a CSS preview, then <strong>Apply to image</strong> to
      bake into the WebP (anchor: bottom-left for <code>_L</code>, bottom-right for
      <code>_R</code>). Marvin side and foreground filename commit via <strong>Complete</strong>
      (<code>scene_playable_pairs.csv</code>). Until then, pairing changes stay in browser
      localStorage. Flip mirrors the staged WebP to the opposite-side filename. Arrows: prev/next · G: grid.
    </p>
  </main>
  <div
    id="coords-warning-modal"
    class="scene-pair-review__modal"
    hidden
    role="dialog"
    aria-modal="true"
    aria-labelledby="coords-warning-title"
  >
    <div class="scene-pair-review__modal-backdrop" id="coords-warning-backdrop"></div>
    <div class="scene-pair-review__modal-panel">
      <h2 id="coords-warning-title">Background coordinates missing</h2>
      <p class="scene-pair-review__modal-hint" id="coords-warning-message"></p>
      <div class="scene-pair-review__modal-actions" id="coords-warning-actions"></div>
    </div>
  </div>
  <script>
${inlined}
  </script>
</body>
</html>
`;
}

async function main() {
  ensureRegistry();
  const { SCENE_PLAYABLE_PAIRS, BACKGROUND_META_BY_ID } = await import(SCENE_REGISTRY);
  const pairs = sortPairsForReview(SCENE_PLAYABLE_PAIRS).map((pair) => {
    const meta = BACKGROUND_META_BY_ID[pair.backgroundId];
    return {
      ...pair,
      backgroundLat: meta?.lat ?? "",
      backgroundLong: meta?.lon ?? meta?.long ?? "",
    };
  });
  const css = fs.readFileSync(CSS_SRC, "utf8");
  fs.mkdirSync(REVIEW_DIST, { recursive: true });
  fs.writeFileSync(REVIEW_HTML, buildHtml(pairs, css));
  console.log(`Wrote ${REVIEW_HTML} (${pairs.length} pairs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

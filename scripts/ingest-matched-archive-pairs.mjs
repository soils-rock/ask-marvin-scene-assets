#!/usr/bin/env node
/**
 * Flat archive ingest: matched PNG pairs from Backgrounds_Raw + Foregrounds_Raw.
 *
 * - Same basename in both folders = one matched pair
 * - Converts PNG → WebP in ask-marvin public/images
 * - Writes scene_*_metadata.csv rows (provisional; lat/long empty is OK)
 * - Moves raw PNGs to Processed_images as {stem}__bg.png / {stem}__fg.png
 *
 * Orphans (no twin) are listed in a browser dialog; matched pairs proceed after OK.
 * INGEST_SKIP_ORPHAN_DIALOG=1 — log orphans and skip UI (tests).
 *
 * Then run: npm run build:scene-registry && npm run build:scene-pair-review
 */
import {
  ensureArchivePathsWritable,
  scanFlatArchive,
} from "./lib/flat-archive-pairs.mjs";
import { ingestMatchedPairs, ingestCsvPaths } from "./lib/flat-archive-ingest.mjs";
import { showOrphanDialogIfNeeded } from "./lib/ingest-orphan-dialog.mjs";

async function main() {
  ensureArchivePathsWritable();

  const { matched, orphans } = scanFlatArchive();
  console.log(`Flat archive scan: ${matched.length} matched pair(s), ${orphans.length} orphan(s).`);

  if (matched.length === 0 && orphans.length === 0) {
    console.log("Nothing to ingest.");
    return;
  }

  await showOrphanDialogIfNeeded(orphans);

  if (matched.length === 0) {
    console.log("No matched pairs to ingest.");
    return;
  }

  console.log("\nIngesting matched pairs…");
  const results = await ingestMatchedPairs(matched);

  console.log("\n--- Ingest log ---");
  results.log.forEach((line) => console.log(line));
  console.log(
    `\nDone: ${results.succeeded} succeeded, ${results.skipped} skipped, ${results.failed} failed.`
  );
  const { bgCsv, fgCsv } = ingestCsvPaths();
  console.log(`Updated ${bgCsv}`);
  console.log(`Updated ${fgCsv}`);
  console.log("\nNext: npm run build:scene-registry && npm run build:scene-pair-review");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

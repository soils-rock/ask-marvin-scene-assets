#!/usr/bin/env node
/**
 * Prefix x on Marvin archive folders for every background_id in scene_playable_pairs.csv.
 */
import {
  archiveFolderForBackgroundId,
  sealArchiveFolderForBackground,
} from "./lib/archive-pairs.mjs";
import { readPairRows } from "./lib/scene-playable-pairs.mjs";

const backgroundIds = [...new Set(readPairRows().map((r) => r.background_id).filter(Boolean))];

console.log(`Sealing archive folders for ${backgroundIds.length} paired background(s)…\n`);

let sealed = 0;
let skipped = 0;

for (const id of backgroundIds.sort()) {
  const folder = archiveFolderForBackgroundId(id);
  const result = sealArchiveFolderForBackground(id);
  if (result.sealed) {
    sealed++;
    console.log(`  ✓ ${id} → ${result.folder}`);
  } else {
    skipped++;
    console.log(`  · ${id} (${folder}): ${result.reason}`);
  }
}

console.log(`\nDone: ${sealed} sealed, ${skipped} skipped.`);

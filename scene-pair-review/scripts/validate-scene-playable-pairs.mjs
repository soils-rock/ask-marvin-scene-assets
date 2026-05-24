#!/usr/bin/env node
/**
 * Fail on exact duplicate rows in scene_playable_pairs.csv.
 * Run: npm run validate:scene-pairs
 */
import { readPairRows } from "./lib/scene-playable-pairs.mjs";

function rowKey(row) {
  return [row.background_id, row.foreground_file, row.marvin_side, row.notes].join("|");
}

const rows = readPairRows();
const seen = new Map();
const duplicates = [];

for (let i = 0; i < rows.length; i++) {
  const key = rowKey(rows[i]);
  if (seen.has(key)) {
    duplicates.push({ key, lines: [seen.get(key) + 2, i + 2] });
  } else {
    seen.set(key, i);
  }
}

if (duplicates.length) {
  console.error("scene_playable_pairs.csv: exact duplicate rows:");
  for (const { key, lines } of duplicates) {
    console.error(`  ${key} (data lines ${lines.join(", ")})`);
  }
  process.exit(1);
}

console.log(`scene_playable_pairs.csv: ${rows.length} rows, no exact duplicates.`);

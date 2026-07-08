#!/usr/bin/env node
/**
 * Rename foreground WebPs missing _L/_R side suffix and patch CSV references.
 * Run: npm run audit:foreground-side-suffix
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { FG_DIR, ASK_MARVIN_ROOT, PACKAGE_ROOT } from "./lib/paths.mjs";
import {
  ensureForegroundSideSuffix,
  parseForegroundSideParts,
} from "./lib/foreground-side-suffix.mjs";
import { readPairRows } from "./lib/scene-playable-pairs.mjs";

function marvinSideForFile(file) {
  const pairRows = readPairRows().filter((row) => row.foreground_file === file);
  if (pairRows.length === 1 && pairRows[0].marvin_side) {
    return pairRows[0].marvin_side;
  }
  return undefined;
}

function listMissingSideSuffix() {
  if (!fs.existsSync(FG_DIR)) return [];
  return fs
    .readdirSync(FG_DIR)
    .filter((name) => name.toLowerCase().endsWith(".webp"))
    .filter((name) => {
      const { isL, isR } = parseForegroundSideParts(name);
      return !isL && !isR;
    })
    .sort();
}

function main() {
  const missing = listMissingSideSuffix();
  if (missing.length === 0) {
    console.log("All foreground WebPs have _L/_R side suffix.");
    return;
  }

  console.log(`Found ${missing.length} foreground file(s) missing _L/_R:`);
  for (const file of missing) {
    console.log(`  - ${file}`);
  }

  let renamed = 0;
  for (const file of missing) {
    const marvinSide = marvinSideForFile(file);
    const result = ensureForegroundSideSuffix({
      foregroundFile: file,
      marvinSide,
      fgDir: FG_DIR,
    });
    if (result.renamed) {
      renamed += 1;
      console.log(
        `Renamed ${result.from} → ${result.to}` +
          (marvinSide ? ` (marvin ${marvinSide})` : " (default _R)") +
          `; metadata rows ${result.metadataRows}, pair rows ${result.pairRows}`
      );
    }
  }

  if (renamed > 0) {
    console.log("\nRebuilding scene registry + guest scenes in ask-marvin…");
    execSync("node scripts/build-scene-registry.mjs", {
      cwd: ASK_MARVIN_ROOT,
      stdio: "inherit",
    });
    execSync("node scripts/build-guest-scenes.mjs", {
      cwd: ASK_MARVIN_ROOT,
      stdio: "inherit",
    });
    execSync("node scripts/build-scene-pair-review.mjs", {
      cwd: PACKAGE_ROOT,
      stdio: "inherit",
    });
  }

  console.log(`\nDone: ${renamed} renamed, ${missing.length - renamed} unchanged/skipped.`);
}

main();

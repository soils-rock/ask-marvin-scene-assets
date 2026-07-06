#!/usr/bin/env node
/**
 * Tests for flat archive ingest (discovery, orphans, collision skip).
 * Run: npm run test:flat-archive-ingest
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function writeMinimalCsv(csvPath, header) {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, `${header}\n`);
}

function setupTempArchive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flat-ingest-test-"));
  const archiveRoot = path.join(root, "archive");
  const bg = path.join(archiveRoot, "Backgrounds_Raw");
  const fg = path.join(archiveRoot, "Foregrounds_Raw");
  const proc = path.join(archiveRoot, "Processed_images");
  const ask = path.join(root, "ask-marvin");
  fs.mkdirSync(bg, { recursive: true });
  fs.mkdirSync(fg, { recursive: true });
  fs.mkdirSync(proc, { recursive: true });
  fs.mkdirSync(path.join(ask, "public/images/background"), { recursive: true });
  fs.mkdirSync(path.join(ask, "public/images/foreground"), { recursive: true });
  fs.mkdirSync(path.join(ask, "data"), { recursive: true });

  const bgHeader =
    "background_id,file,lat,long,location_key,scene_set_id,place_name,region,state_or_country,habitat,elevation_m,climate_notes,where_we_are,notable_features,status,notes";
  const fgHeader =
    "foreground_id,file,background_id,scene_set_id,marvin_side,foreground_subject,organisms_present,soil_crust_type,guest_characters,what_we_see,interaction_notes,status,notes";
  writeMinimalCsv(path.join(ask, "data/scene_background_metadata.csv"), bgHeader);
  writeMinimalCsv(path.join(ask, "data/scene_foreground_metadata.csv"), fgHeader);

  return { root, archiveRoot, bg, fg, proc, ask };
}

async function loadFlatModules(env) {
  const prev = {
    SCENE_PNG_ARCHIVE: process.env.SCENE_PNG_ARCHIVE,
    ASK_MARVIN_ROOT: process.env.ASK_MARVIN_ROOT,
  };
  process.env.SCENE_PNG_ARCHIVE = env.archiveRoot;
  process.env.ASK_MARVIN_ROOT = env.ask;

  const pairs = await import(`./lib/flat-archive-pairs.mjs?t=${Date.now()}`);
  const ingest = await import(`./lib/flat-archive-ingest.mjs?t=${Date.now()}`);
  return {
    pairs,
    ingest,
    restore() {
      if (prev.SCENE_PNG_ARCHIVE === undefined) delete process.env.SCENE_PNG_ARCHIVE;
      else process.env.SCENE_PNG_ARCHIVE = prev.SCENE_PNG_ARCHIVE;
      if (prev.ASK_MARVIN_ROOT === undefined) delete process.env.ASK_MARVIN_ROOT;
      else process.env.ASK_MARVIN_ROOT = prev.ASK_MARVIN_ROOT;
    },
  };
}

function testScanMatchedAndOrphans() {
  const env = setupTempArchive();
  fs.writeFileSync(path.join(env.bg, "Atacama-1.png"), "bg");
  fs.writeFileSync(path.join(env.fg, "Atacama-1.png"), "fg");
  fs.writeFileSync(path.join(env.bg, "Chile-only.png"), "bg");

  return loadFlatModules(env).then(({ pairs, restore }) => {
    try {
      const { matched, orphans } = pairs.scanFlatArchive();
      assert(matched.length === 1, "one matched pair");
      assert(matched[0].stem === "Atacama-1", "stem");
      assert(matched[0].webpFile === "Atacama-1.webp", "webpFile");
      assert(orphans.length === 1, "one orphan");
      assert(orphans[0].filename === "Chile-only.png", "orphan file");
      assert(orphans[0].folder === "Backgrounds_Raw", "orphan folder");
      console.log("scan-matched-orphans: ok");
    } finally {
      restore();
      fs.rmSync(env.root, { recursive: true, force: true });
    }
  });
}

async function testStemToBackgroundId() {
  const {
    stemToBackgroundId,
    processedDestinations,
    inferMarvinSide,
    webpFileNameFromBasename,
  } = await import("./lib/flat-archive-pairs.mjs");
  assert(stemToBackgroundId("Atacama-1") === "atacama_1", "atacama_1");
  assert(stemToBackgroundId("Great-wall-1") === "great_wall_1", "great_wall_1");
  assert(webpFileNameFromBasename("Atacama-1.png") === "Atacama-1.webp", "webp from basename");
  assert(webpFileNameFromBasename("Great-wall-1.PNG") === "Great-wall-1.webp", "webp case on ext");
  const dest = processedDestinations("Atacama-1");
  assert(dest.bg.endsWith("Atacama-1__bg.png"), "processed bg name");
  assert(dest.fg.endsWith("Atacama-1__fg.png"), "processed fg name");
  assert(inferMarvinSide("Foo_L.png") === "left", "marvin left");
  assert(inferMarvinSide("Foo_R.png") === "right", "marvin right");
  console.log("stem-and-processed-names: ok");
}

async function testOrphanDialogSkip() {
  const prev = process.env.INGEST_SKIP_ORPHAN_DIALOG;
  process.env.INGEST_SKIP_ORPHAN_DIALOG = "1";
  const { showOrphanDialogIfNeeded } = await import("./lib/ingest-orphan-dialog.mjs");
  await showOrphanDialogIfNeeded([
    { folder: "Backgrounds_Raw", filename: "solo.png" },
  ]);
  if (prev === undefined) delete process.env.INGEST_SKIP_ORPHAN_DIALOG;
  else process.env.INGEST_SKIP_ORPHAN_DIALOG = prev;
  console.log("orphan-dialog-skip: ok");
}

async function testProcessedCollisionSkip() {
  const env = setupTempArchive();
  fs.writeFileSync(path.join(env.bg, "Pair-1.png"), "bg");
  fs.writeFileSync(path.join(env.fg, "Pair-1.png"), "fg");
  fs.writeFileSync(path.join(env.proc, "Pair-1__bg.png"), "existing");

  const { pairs, ingest, restore } = await loadFlatModules(env);
  try {
    const { matched } = pairs.scanFlatArchive();
    const results = await ingest.ingestMatchedPairs(matched);
    assert(results.skipped === 1, "collision should skip");
    assert(fs.existsSync(path.join(env.bg, "Pair-1.png")), "raw bg remains");
    assert(fs.existsSync(path.join(env.fg, "Pair-1.png")), "raw fg remains");
    console.log("processed-collision-skip: ok");
  } finally {
    restore();
    fs.rmSync(env.root, { recursive: true, force: true });
  }
}

async function testIngestWebpFileMatchesDiskAndCsv() {
  const env = setupTempArchive();
  const sharp = (await import("sharp")).default;
  const pngBuf = await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(env.bg, "Atacama-1.png"), pngBuf);
  fs.writeFileSync(path.join(env.fg, "Atacama-1.png"), pngBuf);

  const { pairs, ingest, restore } = await loadFlatModules(env);
  try {
    const { matched } = pairs.scanFlatArchive();
    assert(matched.length === 1, "one pair");
    assert(matched[0].webpFile === "Atacama-1.webp", "canonical webpFile on pair");

    const results = await ingest.ingestMatchedPairs(matched);
    assert(results.succeeded === 1, "ingest succeeded");

    const bgDisk = fs.readdirSync(path.join(env.ask, "public/images/background"));
    const fgDisk = fs.readdirSync(path.join(env.ask, "public/images/foreground"));
    assert(bgDisk.includes("Atacama-1.webp"), "bg webp on disk");
    assert(fgDisk.includes("Atacama-1.webp"), "fg webp on disk");

    const bgCsv = fs.readFileSync(path.join(env.ask, "data/scene_background_metadata.csv"), "utf8");
    const fgCsv = fs.readFileSync(path.join(env.ask, "data/scene_foreground_metadata.csv"), "utf8");
    assert(bgCsv.includes("Atacama-1.webp"), "bg csv file field");
    assert(fgCsv.includes("Atacama-1.webp"), "fg csv file field");
    console.log("ingest-webp-file-matches-disk-and-csv: ok");
  } finally {
    restore();
    fs.rmSync(env.root, { recursive: true, force: true });
  }
}

async function main() {
  await testScanMatchedAndOrphans();
  await testStemToBackgroundId();
  await testOrphanDialogSkip();
  await testProcessedCollisionSkip();
  await testIngestWebpFileMatchesDiskAndCsv();
  console.log("All flat archive ingest tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

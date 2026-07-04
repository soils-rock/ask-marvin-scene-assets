#!/usr/bin/env node
/**
 * Smoke tests: mirror when destination exists, commitPairRow.
 * Run: node scripts/test-scene-pair-review-flow.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bakeForeground,
} from "./lib/bake-foreground.mjs";
import {
  FG_DIR,
  inferDest,
  loadSharp,
  mirrorForeground,
} from "./lib/mirror-foreground.mjs";
import {
  cloneForeground,
  ensureUniqueForegroundForPair,
  flipTargetsToSide,
  isForegroundShared,
  isUniqueForegroundName,
  uniqueForegroundName,
} from "./lib/clone-foreground.mjs";
import {
  commitPairRow,
  readPairRows,
  writePairRows,
  PAIRS_CSV,
} from "./lib/scene-playable-pairs.mjs";
import {
  coordinatesAreValid,
  parseCoordinate,
  readBackgroundRows,
  resolveBackgroundCoordinatePatch,
  upsertBackgroundRow,
} from "./lib/scene-background-metadata.mjs";
import { REVIEW_HTML, PACKAGE_ROOT } from "./lib/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Must match parseScalePercent in scene-pair-review-client.js / ScenePairReview.jsx */
function parseScalePercent(raw, fallback = 100) {
  const s = String(raw ?? "").trim();
  if (s === "") return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(999, Math.max(1, Math.round(n)));
}

function testScalePercentParsing() {
  assert(parseScalePercent("110") === 110, 'parseScalePercent("110") should be 110');
  assert(parseScalePercent("9") === 9, 'parseScalePercent("9") should be 9');
  assert(parseScalePercent("1000") === 999, "values above 999 clamp to 999");
  assert(parseScalePercent("", 100) === 100, "empty string uses fallback");
  console.log("scale-percent-parse: ok (110 parses correctly)");
}

async function testMirrorRequiresOverwrite() {
  const files = fs.readdirSync(FG_DIR).filter((f) => /_L\.webp$/i.test(f));
  assert(files.length > 0, "No _L foreground files to test mirror overwrite guard");
  const from = files[0];
  const to = inferDest(from);
  assert(to, `Could not infer dest for ${from}`);
  assert(fs.existsSync(path.join(FG_DIR, to)), `Expected dest ${to} to exist`);

  let threw = false;
  try {
    await mirrorForeground({ from, to, overwrite: false });
  } catch (err) {
    threw = true;
    assert(
      String(err.message).includes("overwrite"),
      "Expected overwrite hint when dest exists"
    );
  }
  assert(threw, "mirrorForeground should require overwrite when dest exists");
  console.log(`mirror-overwrite-guard: ok (${from} → ${to})`);
}

async function testMirrorFlipPixels() {
  const sharp = await loadSharp();
  const testFrom = "__mirror_flip_test_R.webp";
  const testTo = "__mirror_flip_test_L.webp";
  const testPathR = path.join(FG_DIR, testFrom);
  const testPathL = path.join(FG_DIR, testTo);
  const w = 64;
  const h = 64;
  const channels = 3;
  const pixels = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * channels;
      pixels[i] = x;
      pixels[i + 1] = y;
      pixels[i + 2] = 128;
    }
  }

  try {
    await sharp(pixels, { raw: { width: w, height: h, channels } })
      .webp({ lossless: true })
      .toFile(testPathR);

    const targets = flipTargetsToSide(testFrom, "left");
    assert(targets?.from === testFrom, "Flip source must be staged file");
    assert(targets?.to === testTo, "Flip dest must be opposite-side basename");

    await mirrorForeground({ from: targets.from, to: targets.to, overwrite: true });

    const viaMirror = fs.readFileSync(testPathL);
    const viaSharp = await sharp(testPathR).flop().webp({ quality: 80 }).toBuffer();
    assert(
      viaSharp.equals(viaMirror),
      "mirrorForeground output should match sharp horizontal flop"
    );
    const metaL = await sharp(testPathL).metadata();
    assert(metaL.width === w && metaL.height === h, "Mirrored file keeps dimensions");
    console.log("mirror-pixels: ok");
  } finally {
    for (const f of [testFrom, testTo]) {
      const p = path.join(FG_DIR, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
}

function testCommitPairRow() {
  const backup = fs.existsSync(PAIRS_CSV) ? fs.readFileSync(PAIRS_CSV, "utf8") : null;
  const testId = "__review_test_bg__";
  const testFg = "__Review_Test_L.webp";

  try {
    commitPairRow({
      backgroundId: testId,
      foregroundFile: testFg,
      marvinSide: "left",
      notes: "automated test row — safe to delete",
    });
    const rows = readPairRows();
    const row = rows.find(
      (r) => r.background_id === testId && r.foreground_file === testFg
    );
    assert(row, "commitPairRow should insert test row");
    assert(row.marvin_side === "left", "marvin_side should be left");
    console.log("commit-pair: ok (test row written)");

    commitPairRow({
      backgroundId: testId,
      foregroundFile: testFg,
      marvinSide: "right",
      notes: "updated",
    });
    const rows2 = readPairRows();
    const row2 = rows2.find(
      (r) => r.background_id === testId && r.foreground_file === testFg
    );
    assert(row2?.marvin_side === "right", "commitPairRow should update existing row");
    console.log("commit-pair-update: ok");
  } finally {
    if (backup !== null) {
      fs.writeFileSync(PAIRS_CSV, backup);
    } else {
      writePairRows(readPairRows().filter((r) => r.background_id !== testId));
    }
  }
}

function testFlipTargetsToSide() {
  const fromR = flipTargetsToSide("Valley_of_Fires_R.webp", "left");
  assert(fromR?.from === "Valley_of_Fires_R.webp", "Flip to L should mirror from R");
  assert(fromR?.to === "Valley_of_Fires_L.webp", "Flip to L should target L file");

  const fromL = flipTargetsToSide("Valley_of_Fires_L.webp", "right");
  assert(fromL?.from === "Valley_of_Fires_L.webp", "Flip to R should mirror from L");
  assert(fromL?.to === "Valley_of_Fires_R.webp", "Flip to R should target R file");

  const unique = flipTargetsToSide("Valley_of_Fires_L__valley_of_fires2.webp", "right");
  assert(
    unique?.from === "Valley_of_Fires_L__valley_of_fires2.webp",
    "Flip source must be staged unique file"
  );
  assert(
    unique?.to === "Valley_of_Fires_R__valley_of_fires2.webp",
    "Unique suffix preserved on flip to R"
  );

  const onR = flipTargetsToSide("Valley_of_Fires_R.webp", "right");
  assert(onR === null, "Flip to same side returns null");
  console.log("flip-targets: ok");
}

function testUniqueForegroundNaming() {
  assert(
    uniqueForegroundName("Valley_of_Fires_R.webp", "valley_of_fires2") ===
      "Valley_of_Fires_R__valley_of_fires2.webp",
    "uniqueForegroundName should append background_id"
  );
  assert(
    isUniqueForegroundName("Valley_of_Fires_R__valley_of_fires2.webp", "valley_of_fires2"),
    "isUniqueForegroundName should recognize pair suffix"
  );
  assert(
    isForegroundShared("Valley_of_Fires_R.webp", {
      pairs: [
        { backgroundId: "valley_of_fires2", foregroundFile: "Valley_of_Fires_R.webp" },
        { backgroundId: "valley_of_fires3", foregroundFile: "Valley_of_Fires_R.webp" },
      ],
    }),
    "Shared foreground detected across backgrounds"
  );
  assert(
    !isForegroundShared("Valley_of_Fires_R__valley_of_fires2.webp", {
      backgroundId: "valley_of_fires2",
      pairs: [
        { backgroundId: "valley_of_fires2", foregroundFile: "Valley_of_Fires_R__valley_of_fires2.webp" },
      ],
    }),
    "Pair-unique foreground is not shared"
  );
  console.log("unique-foreground: ok");
}

async function testCloneForeground() {
  const files = fs.readdirSync(FG_DIR).filter((f) => /\.webp$/i.test(f));
  assert(files.length > 0, "No foreground files to test clone");
  const source = files[0];
  const dest = `__clone_test__${Date.now()}.webp`;
  try {
    const result = await cloneForeground({ from: source, to: dest });
    assert(result.to === dest, "Clone should return dest filename");
    assert(fs.existsSync(path.join(FG_DIR, dest)), "Clone should write dest file");
    const again = await cloneForeground({ from: source, to: dest, overwrite: false });
    assert(again.existed === true, "Second clone should report existed");
    console.log(`clone-foreground: ok (${source} → ${dest})`);
  } finally {
    const destPath = path.join(FG_DIR, dest);
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  }
}

async function testEnsureUniqueOnComplete() {
  const backup = fs.existsSync(PAIRS_CSV) ? fs.readFileSync(PAIRS_CSV, "utf8") : null;
  const testId = "__review_clone_bg__";
  const sharedFg = fs.readdirSync(FG_DIR).find((f) => /\.webp$/i.test(f));
  assert(sharedFg, "Need a foreground file for ensureUnique test");

  try {
    writePairRows([
      { background_id: testId, foreground_file: sharedFg, marvin_side: "left", notes: "" },
      { background_id: `${testId}a`, foreground_file: sharedFg, marvin_side: "right", notes: "" },
    ]);
    const result = await ensureUniqueForegroundForPair({
      foregroundFile: sharedFg,
      backgroundId: testId,
      pairs: [
        { backgroundId: testId, foregroundFile: sharedFg },
        { backgroundId: `${testId}a`, foregroundFile: sharedFg },
      ],
    });
    assert(result.cloned === true, "ensureUnique should clone shared foreground");
    assert(
      result.to === uniqueForegroundName(sharedFg, testId),
      "ensureUnique should use pair naming convention"
    );
    assert(fs.existsSync(path.join(FG_DIR, result.to)), "Cloned file should exist on disk");
    fs.unlinkSync(path.join(FG_DIR, result.to));
    console.log("ensure-unique: ok");
  } finally {
    if (backup !== null) {
      fs.writeFileSync(PAIRS_CSV, backup);
    } else {
      writePairRows(readPairRows().filter((r) => !r.background_id.startsWith(testId)));
    }
  }
}

function testBuiltReviewHtml() {
  const htmlPath = REVIEW_HTML;
  assert(fs.existsSync(htmlPath), "Run build:scene-pair-review first");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert(
    !html.includes("__PAIRS_JSON__"),
    "Built HTML still contains __PAIRS_JSON__ (build replace bug)"
  );
  assert(/const PAIRS = \[\{/.test(html), "Built HTML missing const PAIRS = [...]");
  assert(
    html.includes("btn-fg-apply"),
    "Built HTML missing foreground adjust UI (rebuild scene-pair-review)"
  );
  assert(
    !html.includes('id="fg-dx"'),
    "Built HTML still has ΔX field (rebuild scene-pair-review)"
  );
  assert(
    html.includes('id="fg-scale-x"'),
    "Built HTML missing Scale X field (rebuild scene-pair-review)"
  );
  assert(
    html.includes('id="fg-scale-x"') && html.includes("SCALE_PERCENT_MAX"),
    "Built HTML Scale X missing max bound (rebuild scene-pair-review)"
  );
  assert(
    html.includes('id="btn-match-csv"'),
    "Built HTML missing Match CSV button (rebuild scene-pair-review)"
  );
  assert(
    html.includes('id="btn-flip-l"') && html.includes('id="btn-flip-r"'),
    "Built HTML missing Flip to L/R buttons (rebuild scene-pair-review)"
  );
  assert(
    html.includes('id="btn-clone-fg"'),
    "Built HTML missing Give unique foreground copy button (rebuild scene-pair-review)"
  );
  assert(
    !html.includes('id="btn-flip"'),
    "Built HTML still has single btn-flip (rebuild scene-pair-review)"
  );

  const pairsMatch = html.match(/const PAIRS = (\[[\s\S]*?\]);/);
  assert(pairsMatch, "Could not parse PAIRS from built HTML");
  const pairs = JSON.parse(pairsMatch[1]);
  assert(pairs.length > 0, "PAIRS array should not be empty");
  const vla = pairs.find((p) => p.backgroundId === "vla");
  assert(vla, "Expected a vla pair in PAIRS");
  assert(vla.foregroundFile === "VLA_R.webp", "vla foreground should be VLA_R.webp");
  assert(vla.marvinSide === "right", "vla marvinSide should be right");
  assert(vla.pairSource === "csv", "vla should be csv-sourced");
  console.log("built-review-html: ok (vla pair present)");
}

function testBackgroundCoordinateValidation() {
  assert(parseCoordinate("34.5", "lat").ok, "valid lat");
  assert(parseCoordinate("-113.09", "long").ok, "valid long");
  assert(!parseCoordinate("", "lat").ok, "empty lat rejected");
  assert(!parseCoordinate("abc", "long").ok, "non-numeric long rejected");
  assert(!parseCoordinate("91", "lat").ok, "lat > 90 rejected");
  assert(!parseCoordinate("-181", "long").ok, "long < -180 rejected");
  assert(coordinatesAreValid("34.5", "-113"), "coordinatesAreValid true");
  assert(!coordinatesAreValid("", "-113"), "coordinatesAreValid false when lat missing");

  const missing = resolveBackgroundCoordinatePatch({
    existingRow: { background_id: "test_bg", lat: "", long: "" },
    backgroundId: "test_bg",
    bodyLat: "",
    bodyLong: "",
  });
  assert(!missing.ok, "missing stored coords requires body");
  assert(
    String(missing.error).includes("has no coordinates stored"),
    "missing stored coords error message"
  );

  const valid = resolveBackgroundCoordinatePatch({
    existingRow: { background_id: "test_bg", lat: "", long: "" },
    backgroundId: "test_bg",
    bodyLat: "34.5",
    bodyLong: "-113.2",
  });
  assert(valid.ok && valid.patch.lat === "34.5" && valid.patch.long === "-113.2");

  const storedNoBody = resolveBackgroundCoordinatePatch({
    existingRow: { background_id: "az_hwy93", lat: "34.27", long: "-113.09" },
    backgroundId: "az_hwy93",
  });
  assert(storedNoBody.ok && storedNoBody.patch === null, "stored coords allow Complete without body");

  console.log("background-coordinate-validation: ok");
}

function testUpsertBackgroundRow() {
  const tempDir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".bg-meta-test-"));
  const tempCsv = path.join(tempDir, "scene_background_metadata.csv");
  const header =
    "background_id,file,lat,long,location_key,scene_set_id,place_name,region,state_or_country,habitat,elevation_m,climate_notes,where_we_are,notable_features,status,notes";
  const seedRow =
    "slice_test_bg,Slice_Test.webp,33.1,-112.1,slice_site,slice_test_bg,Slice Test,region,,habitat,,,,,ready,seed";
  fs.writeFileSync(tempCsv, `${header}\n${seedRow}\n`);

  const prev = process.env.SCENE_BG_CSV;
  process.env.SCENE_BG_CSV = tempCsv;
  try {
    const { row, created } = upsertBackgroundRow({
      backgroundId: "slice_test_bg",
      patch: { lat: "33.2", long: "-112.2" },
    });
    assert(!created, "update should not create");
    assert(row.lat === "33.2" && row.long === "-112.2", "patch applied");
    assert(row.place_name === "Slice Test", "other columns preserved");
    assert(row.file === "Slice_Test.webp", "file preserved");

    const { row: inserted, created: insertedCreated } = upsertBackgroundRow({
      backgroundId: "slice_new_bg",
      patch: { lat: "35.0", long: "-109.0" },
      insertDefaults: {
        file: "Slice_New.webp",
        status: "ready",
        location_key: "slice_new_site",
        scene_set_id: "slice_new_bg",
        place_name: "Slice New",
      },
    });
    assert(insertedCreated, "insert should create");
    assert(inserted.lat === "35.0", "insert lat");
    assert(inserted.notes === "", "insert fills missing header columns");

    const { header: writtenHeader, rows } = readBackgroundRows();
    assert(writtenHeader.length === 16, "header preserved");
    assert(rows.length === 2, "two rows after insert");
  } finally {
    if (prev === undefined) delete process.env.SCENE_BG_CSV;
    else process.env.SCENE_BG_CSV = prev;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("upsert-background-row: ok");
}

async function testCompletePairCoordinateApi() {
  const { spawn } = await import("node:child_process");
  const serverPath = path.join(__dirname, "serve-scene-pair-review.mjs");
  const pairs = readPairRows();
  const sample = pairs.find((row) => row.background_id && row.foreground_file);
  assert(sample, "Need a playable pair row for complete API coordinate test");

  const port = 5198;
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, SCENE_REVIEW_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/complete-pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backgroundId: sample.background_id,
        foregroundFile: sample.foreground_file,
        marvinSide: sample.marvin_side || undefined,
        notes: sample.notes || "",
        backgroundLat: "999",
        backgroundLong: "-113",
      }),
    });
    const data = await res.json();
    assert(res.status === 400 && !data.ok, "invalid lat should block Complete");
    assert(String(data.error).includes("lat"), "error mentions lat");
    console.log("complete-pair-coordinate-api: ok");
  } finally {
    child.kill("SIGTERM");
  }
}

async function testBakeForeground() {
  const files = fs.readdirSync(FG_DIR).filter((f) => /\.webp$/i.test(f));
  assert(files.length > 0, "No foreground files to test bake");
  const file = files[0];
  const result = await bakeForeground({
    file,
    scaleX: 100,
    scaleY: 100,
  });
  assert(result.noop === true, "Expected noop for default adjust");
  console.log(`bake-noop: ok (${file})`);
}

async function testBakeApi() {
  const { spawn } = await import("node:child_process");
  const serverPath = path.join(__dirname, "serve-scene-pair-review.mjs");
  const files = fs.readdirSync(FG_DIR).filter((f) => /\.webp$/i.test(f));
  assert(files.length > 0, "No foreground files for bake API test");
  const port = 5199;
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, SCENE_REVIEW_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/bake-foreground`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: files[0],
        scaleX: 100,
        scaleY: 100,
      }),
    });
    const data = await res.json();
    assert(res.ok && data.ok && data.noop === true, "Bake API should return ok noop");
    console.log("bake-api: ok");
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  testScalePercentParsing();
  testFlipTargetsToSide();
  testUniqueForegroundNaming();
  testBuiltReviewHtml();
  testBackgroundCoordinateValidation();
  testUpsertBackgroundRow();
  await testMirrorRequiresOverwrite();
  await testMirrorFlipPixels();
  await testCloneForeground();
  await testEnsureUniqueOnComplete();
  await testBakeForeground();
  await testBakeApi();
  await testCompletePairCoordinateApi();
  testCommitPairRow();
  console.log("All scene-pair-review flow tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

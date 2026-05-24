#!/usr/bin/env node
/**
 * Bake foreground scale (%) into a 1920×1080 WebP.
 *
 * Usage:
 *   node scripts/bake-foreground.mjs --file VLA_R.webp --scale-x 110 --scale-y 100
 */
import path from "node:path";
import {
  bakeForeground,
  bakeErrorHint,
  isBakeForegroundMain,
  normalizeFgAdjust,
} from "./lib/bake-foreground.mjs";

function usage() {
  console.log(`Bake foreground scale into public/images/foreground/*.webp.

Usage:
  npm run bake:foreground -- --file <name.webp> [--scale-x PCT] [--scale-y PCT] [--json]

Defaults: scale-x=100, scale-y=100 (no-op).
Anchor: bottom-left for _L, bottom-right for _R.
`);
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(0);
  }

  let file;
  let scaleX = 100;
  let scaleY = 100;
  let overwrite = true;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--file") {
      file = args[++i];
      continue;
    }
    if (arg === "--scale-x") {
      scaleX = Number(args[++i]);
      continue;
    }
    if (arg === "--scale-y") {
      scaleY = Number(args[++i]);
      continue;
    }
    if (arg === "--no-overwrite") {
      overwrite = false;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("-")) {
      usage();
      process.exit(1);
    }
    if (!file) file = arg;
  }

  if (!file) {
    usage();
    process.exit(1);
  }

  return {
    file: path.basename(file),
    ...normalizeFgAdjust({ scaleX, scaleY }),
    overwrite,
    json,
  };
}

export async function runBake(opts) {
  const result = await bakeForeground(opts);
  const payload = {
    ok: true,
    file: result.file,
    adjust: result.adjust,
    anchor: result.anchor,
    composite: result.composite,
    sizeWarning: result.sizeWarning ?? null,
    noop: Boolean(result.noop),
  };
  if (opts.json) {
    console.log(JSON.stringify(payload));
    return payload;
  }
  if (result.noop) {
    console.log(`No changes (defaults): ${result.file}`);
    return payload;
  }
  if (result.sizeWarning) console.warn(`Warning: ${result.sizeWarning}`);
  console.log(
    `Baked ${result.file}: scale ${result.adjust.scaleX}%×${result.adjust.scaleY}%`
  );
  return payload;
}

async function main() {
  const opts = parseArgs(process.argv);
  try {
    await runBake(opts);
  } catch (err) {
    if (opts.json) {
      console.log(
        JSON.stringify({
          ok: false,
          error: err.message || String(err),
          hint: bakeErrorHint(err),
        })
      );
    } else {
      const hint = bakeErrorHint(err);
      if (hint) console.error(hint);
      else console.error(err.message || err);
    }
    process.exit(1);
  }
}

if (isBakeForegroundMain(import.meta.url)) {
  main().catch((err) => {
    console.error(bakeErrorHint(err) || err.message || err);
    process.exit(1);
  });
}

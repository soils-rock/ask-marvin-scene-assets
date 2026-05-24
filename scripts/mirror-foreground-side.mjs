#!/usr/bin/env node
/**
 * Horizontally flip a foreground WebP to the opposite-side basename (_L ↔ _R).
 * Source is always the file you pass; destination is inferred or explicit. Use --overwrite when dest exists.
 *
 * Usage:
 *   node scripts/mirror-foreground-side.mjs Valley_of_Fires_L.webp Valley_of_Fires_R.webp
 *   node scripts/mirror-foreground-side.mjs --from Valley_of_Fires_L.webp
 *   node scripts/mirror-foreground-side.mjs --from Valley_of_Fires_L.webp --to Valley_of_Fires_R.webp
 *
 * Output stays 1920×1080 WebP in public/images/foreground/.
 * Review the mirrored art in scene pair review before committing.
 */
import path from "node:path";
import {
  FG_DIR,
  inferDest,
  isMirrorForegroundSideMain,
  mirrorForeground,
  reviewFlipErrorHint,
} from "./lib/mirror-foreground.mjs";

function usage() {
  console.log(`Mirror a foreground WebP horizontally (_L ↔ _R).

Usage:
  npm run mirror:foreground -- <source.webp> [dest.webp]
  npm run mirror:foreground -- --from <source.webp> [--to <dest.webp>] [--overwrite] [--json]

Examples:
  npm run mirror:foreground -- Valley_of_Fires_L.webp Valley_of_Fires_R.webp
  npm run mirror:foreground -- --from Valley_of_Fires_L.webp

If dest is omitted, infer from source (_L → _R or _R → _L).
Output: ${FG_DIR}
`);
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(0);
  }

  let source;
  let dest;
  let overwrite = false;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--from") {
      source = args[++i];
      continue;
    }
    if (arg === "--to") {
      dest = args[++i];
      continue;
    }
    if (arg === "--overwrite") {
      overwrite = true;
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
    if (!source) {
      source = arg;
      continue;
    }
    if (!dest) {
      dest = arg;
    }
  }

  if (!source) {
    usage();
    process.exit(1);
  }

  const resolvedDest = dest ?? inferDest(path.basename(source));
  if (!resolvedDest) {
    console.error("Could not infer destination from filename (expected _L or _R suffix).");
    process.exit(1);
  }

  return { source, dest: resolvedDest, overwrite, json };
}

export async function runMirror({ source, dest, overwrite = false, json = false }) {
  const result = await mirrorForeground({ from: source, to: dest, overwrite });
  if (json) {
    console.log(
      JSON.stringify({
        ok: true,
        from: result.from,
        to: result.to,
        sizeWarning: result.sizeWarning,
        existed: Boolean(result.existed),
      })
    );
    return result;
  }
  if (result.sizeWarning) {
    console.warn(`Warning: ${result.sizeWarning}`);
  }
  console.log(`Mirrored ${result.from} → ${result.to}`);
  console.log(`Review: npm run build:scene-pair-review && npm run review:scenes`);
  return result;
}

async function main() {
  const { source, dest, overwrite, json } = parseArgs(process.argv);
  try {
    await runMirror({ source, dest, overwrite, json });
  } catch (err) {
    if (json) {
      console.log(
        JSON.stringify({
          ok: false,
          error: err.message || String(err),
          hint: err.mirrorHint || reviewFlipErrorHint(),
        })
      );
    } else if (err.mirrorHint) {
      console.error(err.mirrorHint);
    } else {
      console.error(err.message || err);
    }
    process.exit(1);
  }
}

if (isMirrorForegroundSideMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err.mirrorHint || err.message || err);
    process.exit(1);
  });
}

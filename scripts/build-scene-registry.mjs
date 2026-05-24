#!/usr/bin/env node
/**
 * Rebuild ask-marvin scene registry (delegates to consumer repo).
 */
import { execSync } from "node:child_process";
import { ASK_MARVIN_ROOT } from "./lib/paths.mjs";

execSync("node scripts/build-scene-registry.mjs", {
  cwd: ASK_MARVIN_ROOT,
  stdio: "inherit",
});

#!/usr/bin/env node
/**
 * Serve public/ for static scene-pair review (no Vite).
 * Opens /scene-pair-review/ on port 5174 (darwin only).
 *
 * POST /api/mirror-foreground — mirror staged foreground to opposite-side basename (overwrite default).
 * POST /api/clone-foreground — copy WebP to pair-unique name ({stem}__{background_id}.webp).
 * POST /api/bake-foreground — bake scale (%) into foreground WebP (does not touch CSV).
 * POST /api/complete-pair — commit staging row to scene_playable_pairs.csv + rebuild registry.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  bakeErrorHint,
  bakeForegroundWithFallback,
  normalizeFgAdjust,
} from "./lib/bake-foreground.mjs";
import {
  inferDest,
  mirrorForegroundWithFallback,
  reviewFlipErrorHint,
  sharpInstallHint,
} from "./lib/mirror-foreground.mjs";
import {
  cloneForegroundForPair,
  ensureUniqueForegroundForPair,
} from "./lib/clone-foreground.mjs";
import { sealArchiveFolderForBackground } from "./lib/archive-pairs.mjs";
import { commitPairRow } from "./lib/scene-playable-pairs.mjs";
import {
  loadPlayablePairs,
  rebuildScenePairs,
} from "./lib/reload-scene-pairs.mjs";
import {
  PUBLIC_DIR,
  REVIEW_DIST,
} from "./lib/paths.mjs";

const PORT = Number(process.env.SCENE_REVIEW_PORT) || 5174;
const REVIEW_URL = `http://127.0.0.1:${PORT}/scene-pair-review/`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded.replace(/^\/+/, "") || "index.html";

  if (relative === "scene-pair-review" || relative.startsWith("scene-pair-review/")) {
    const reviewRel =
      relative === "scene-pair-review"
        ? "index.html"
        : relative.slice("scene-pair-review/".length) || "index.html";
    const resolved = path.resolve(REVIEW_DIST, reviewRel);
    if (!resolved.startsWith(REVIEW_DIST + path.sep) && resolved !== REVIEW_DIST) {
      return null;
    }
    return resolved;
  }

  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    return null;
  }
  return resolved;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function respondWithPairs(res, extra = {}) {
  const pairs = await loadPlayablePairs();
  sendJson(res, 200, { ok: true, pairs, ...extra });
}

async function handleMirrorForeground(req, res) {
  try {
    const body = await readJsonBody(req);
    const from = path.basename(String(body.from || ""));
    if (!from) {
      sendJson(res, 400, { ok: false, error: 'Missing "from" foreground filename.' });
      return;
    }
    const to = body.to ? path.basename(String(body.to)) : inferDest(from);
    if (!to) {
      sendJson(res, 400, {
        ok: false,
        error: "Could not infer destination (expected _L or _R suffix).",
      });
      return;
    }

    const result = await mirrorForegroundWithFallback({
      from,
      to,
      overwrite: body.overwrite !== false,
    });

    sendJson(res, 200, {
      ok: true,
      from: result.from,
      to: result.to,
      sizeWarning: result.sizeWarning,
      existed: Boolean(result.existed),
    });
  } catch (err) {
    const hint =
      err.mirrorHint ||
      (err.message?.includes("sharp") ? sharpInstallHint() : reviewFlipErrorHint());
    sendJson(res, 500, {
      ok: false,
      error: err.message || String(err),
      hint,
    });
  }
}

async function handleCloneForeground(req, res) {
  try {
    const body = await readJsonBody(req);
    const from = path.basename(String(body.from || ""));
    const backgroundId = String(body.backgroundId || "").trim();
    if (!from || !backgroundId) {
      sendJson(res, 400, {
        ok: false,
        error: 'Missing "from" or "backgroundId".',
      });
      return;
    }

    const result = await cloneForegroundForPair({
      from,
      backgroundId,
      overwrite: Boolean(body.overwrite),
    });

    sendJson(res, 200, {
      ok: true,
      from: result.from,
      to: result.to,
      backgroundId: result.backgroundId,
      existed: Boolean(result.existed),
      noop: Boolean(result.noop),
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err.message || String(err),
    });
  }
}

async function handleBakeForeground(req, res) {
  try {
    const body = await readJsonBody(req);
    const file = path.basename(String(body.file || ""));
    if (!file) {
      sendJson(res, 400, { ok: false, error: 'Missing "file" foreground filename.' });
      return;
    }
    const adjust = normalizeFgAdjust(body);
    const result = await bakeForegroundWithFallback({
      file,
      ...adjust,
      overwrite: body.overwrite !== false,
    });

    sendJson(res, 200, {
      ok: true,
      file: result.file,
      adjust: result.adjust,
      anchor: result.anchor,
      composite: result.composite,
      sizeWarning: result.sizeWarning ?? null,
      noop: Boolean(result.noop),
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err.message || String(err),
      hint: bakeErrorHint(err),
    });
  }
}

async function handleCompletePair(req, res) {
  try {
    const body = await readJsonBody(req);
    const backgroundId = String(body.backgroundId || "").trim();
    const foregroundFile = body.foregroundFile
      ? path.basename(String(body.foregroundFile))
      : "";
    if (!backgroundId || !foregroundFile) {
      sendJson(res, 400, {
        ok: false,
        error: 'Missing "backgroundId" or "foregroundFile".',
      });
      return;
    }
    const marvinSide = String(body.marvinSide || "").toLowerCase();
    if (marvinSide && marvinSide !== "left" && marvinSide !== "right") {
      sendJson(res, 400, {
        ok: false,
        error: 'marvinSide must be "left", "right", or omitted.',
      });
      return;
    }

    const previousForegroundFile = body.previousForegroundFile
      ? path.basename(String(body.previousForegroundFile))
      : undefined;

    const pairs = await loadPlayablePairs();
    const cloneResult = await ensureUniqueForegroundForPair({
      foregroundFile,
      backgroundId,
      pairs,
    });
    const committedForegroundFile = cloneResult.to;

    const row = commitPairRow({
      backgroundId,
      foregroundFile: committedForegroundFile,
      marvinSide: marvinSide || undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      previousForegroundFile,
    });

    rebuildScenePairs();

    const seal = sealArchiveFolderForBackground(backgroundId);

    await respondWithPairs(res, {
      row,
      committed: true,
      foregroundFile: committedForegroundFile,
      cloned: Boolean(cloneResult.cloned),
      cloneFrom: cloneResult.cloned ? cloneResult.from : undefined,
      archiveSealed: seal.sealed,
      archiveFolder: seal.folder,
      archiveSealNote: seal.reason,
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err.message || String(err),
    });
  }
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function openBrowser(url) {
  if (process.platform !== "darwin") return;
  try {
    execSync(`open "${url}"`, { stdio: "ignore" });
  } catch {
  }
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0];

  if (req.method === "POST" && urlPath === "/api/mirror-foreground") {
    handleMirrorForeground(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/clone-foreground") {
    handleCloneForeground(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/bake-foreground") {
    handleBakeForeground(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/complete-pair") {
    handleCompletePair(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  let filePath = safePath(urlPath === "/" ? "/" : urlPath);
  if (urlPath === "/") {
    res.writeHead(302, { Location: "/scene-pair-review/" });
    res.end();
    return;
  }

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    } else if (err && urlPath.endsWith("/")) {
      filePath = path.join(filePath, "index.html");
    }

    sendFile(res, filePath);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Scene pair review: ${REVIEW_URL}`);
  console.log(
    "Pairing API: POST /api/mirror-foreground, POST /api/clone-foreground, POST /api/bake-foreground, POST /api/complete-pair"
  );
  console.log("Press Ctrl+C to stop.");
  openBrowser(REVIEW_URL);
});

#!/usr/bin/env node
/**
 * Image intake — scan, bin, tag; copy backgrounds to Backgrounds_Raw (step 2).
 * Opens http://127.0.0.1:5175/ on darwin.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_GAP_MINUTES,
  resolveImageUnderRoot,
  scanAndBin,
} from "./lib/image-intake-binning.mjs";
import {
  planBackgroundSaves,
  planForegroundSaves,
  validateBinFiles,
} from "./lib/image-intake-save.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const INTAKE_DIR = path.join(PACKAGE_ROOT, "image-intake");
const CLIENT_JS = path.join(__dirname, "image-intake-client.js");

const PORT = Number(process.env.IMAGE_INTAKE_PORT) || 5175;
const INTAKE_URL = `http://127.0.0.1:${PORT}/`;

/** @type {string | null} set after successful scan */
let activeSourceRoot = null;

/** @type {object[] | null} bins from last scan */
let activeBins = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

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

function sendFile(res, filePath, { noCache = false } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    const headers = { "Content-Type": type };
    if (noCache) {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      headers.Pragma = "no-cache";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function safeIntakeStatic(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "") || "index.html";

  if (rel === "image-intake-client.js") {
    return CLIENT_JS;
  }

  const resolved = path.resolve(INTAKE_DIR, rel);
  if (!resolved.startsWith(INTAKE_DIR + path.sep) && resolved !== INTAKE_DIR) {
    return null;
  }
  return resolved;
}

function openBrowser(url) {
  if (process.platform !== "darwin") return;
  try {
    execSync(`open -a "Google Chrome" "${url}"`, { stdio: "ignore" });
  } catch {
    try {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } catch {}
  }
}

async function handleScan(req, res) {
  try {
    const body = await readJsonBody(req);
    const rawGap = body.gapMinutes;
    const gapMinutes =
      rawGap === undefined || rawGap === null || rawGap === ""
        ? DEFAULT_GAP_MINUTES
        : Number(rawGap);
    const result = await scanAndBin(body.sourcePath, gapMinutes);
    if (!result.ok) {
      sendJson(res, 400, result);
      return;
    }
    activeSourceRoot = result.sourcePath;
    activeBins = result.bins;
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
}

function handleImage(req, res, url) {
  if (!activeSourceRoot) {
    sendJson(res, 400, { ok: false, error: "Scan a source folder first." });
    return;
  }
  const file = url.searchParams.get("file");
  const resolved = resolveImageUnderRoot(activeSourceRoot, file);
  if (!resolved.ok) {
    sendJson(res, 400, resolved);
    return;
  }
  sendFile(res, resolved.path);
}

function findBin(binIndex) {
  if (!activeBins) return null;
  return activeBins.find((b) => b.index === binIndex) ?? null;
}

async function handlePreviewSaveBackgrounds(req, res) {
  try {
    const body = await readJsonBody(req);
    const binIndex = Number(body.binIndex);
    const bin = findBin(binIndex);
    const binCheck = validateBinFiles(bin, binIndex);
    if (!binCheck.ok) {
      sendJson(res, 400, binCheck);
      return;
    }
    const result = planBackgroundSaves(
      activeSourceRoot,
      binCheck.names,
      body.files,
      body.locationName,
      { execute: false, suffixIndex: body.suffixIndex }
    );
    if (!result.ok) {
      sendJson(res, 400, result);
      return;
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
}

async function handleSaveBackgrounds(req, res) {
  try {
    const body = await readJsonBody(req);
    if (body.confirm !== true) {
      sendJson(res, 400, {
        ok: false,
        error: 'Missing confirm: true — run preview first, then confirm.',
      });
      return;
    }
    const binIndex = Number(body.binIndex);
    const bin = findBin(binIndex);
    const binCheck = validateBinFiles(bin, binIndex);
    if (!binCheck.ok) {
      sendJson(res, 400, binCheck);
      return;
    }
    const result = planBackgroundSaves(
      activeSourceRoot,
      binCheck.names,
      body.files,
      body.locationName,
      { execute: true, suffixIndex: body.suffixIndex }
    );
    if (!result.ok) {
      sendJson(res, 400, result);
      return;
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
}

async function handlePreviewSaveForegrounds(req, res) {
  try {
    const body = await readJsonBody(req);
    const binIndex = Number(body.binIndex);
    const bin = findBin(binIndex);
    const binCheck = validateBinFiles(bin, binIndex);
    if (!binCheck.ok) {
      sendJson(res, 400, binCheck);
      return;
    }
    const result = planForegroundSaves(
      activeSourceRoot,
      binCheck.names,
      body.files,
      body.locationName,
      { execute: false, cycleLetter: body.cycleLetter }
    );
    if (!result.ok) {
      sendJson(res, 400, result);
      return;
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
}

async function handleSaveForegrounds(req, res) {
  try {
    const body = await readJsonBody(req);
    if (body.confirm !== true) {
      sendJson(res, 400, {
        ok: false,
        error: 'Missing confirm: true — run preview first, then confirm.',
      });
      return;
    }
    const binIndex = Number(body.binIndex);
    const bin = findBin(binIndex);
    const binCheck = validateBinFiles(bin, binIndex);
    if (!binCheck.ok) {
      sendJson(res, 400, binCheck);
      return;
    }
    const result = planForegroundSaves(
      activeSourceRoot,
      binCheck.names,
      body.files,
      body.locationName,
      { execute: true, cycleLetter: body.cycleLetter }
    );
    if (!result.ok) {
      sendJson(res, 400, result);
      return;
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || String(err) });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const urlPath = url.pathname;

  if (req.method === "POST" && urlPath === "/api/scan") {
    handleScan(req, res);
    return;
  }

  if (req.method === "GET" && urlPath === "/api/image") {
    handleImage(req, res, url);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/preview-save-backgrounds") {
    handlePreviewSaveBackgrounds(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/save-backgrounds") {
    handleSaveBackgrounds(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/preview-save-foregrounds") {
    handlePreviewSaveForegrounds(req, res);
    return;
  }

  if (req.method === "POST" && urlPath === "/api/save-foregrounds") {
    handleSaveForegrounds(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const filePath = safeIntakeStatic(urlPath === "/" ? "/index.html" : urlPath);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (req.method === "HEAD") {
    fs.stat(filePath, (err) => {
      res.writeHead(err ? 404 : 200);
      res.end();
    });
    return;
  }

  sendFile(res, filePath, {
    noCache: /\.(html|js|css)$/i.test(filePath),
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Image intake: ${INTAKE_URL}`);
  console.log("POST /api/scan — list and bin images from a folder");
  console.log("GET  /api/image?file= — thumbnails (after scan)");
  console.log("POST /api/preview-save-backgrounds — plan BG copies (no writes)");
  console.log("POST /api/save-backgrounds — copy BG JPEGs after confirm");
  console.log("POST /api/preview-save-foregrounds — plan FG copies (no writes)");
  console.log("POST /api/save-foregrounds — copy FG JPEGs after confirm");
  console.log("Press Ctrl+C to stop.");
  openBrowser(INTAKE_URL);
});

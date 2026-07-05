/**
 * Ephemeral browser dialog for flat ingest orphans.
 * Set INGEST_SKIP_ORPHAN_DIALOG=1 to log and proceed without UI (tests/CI).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_ROOT } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORPHAN_DIR = path.join(PACKAGE_ROOT, "ingest-orphans");
const PORT = Number(process.env.INGEST_ORPHAN_PORT) || 5176;

/**
 * @param {Array<{ folder: string, filename: string }>} orphans
 * @returns {Promise<void>}
 */
export async function showOrphanDialogIfNeeded(orphans) {
  if (!orphans.length) return;

  if (process.env.INGEST_SKIP_ORPHAN_DIALOG === "1") {
    console.log("\nUnmatched archive PNGs (no twin in the other folder):");
    for (const o of orphans) {
      console.log(`  ${o.folder}/${o.filename}`);
    }
    console.log("\nProceeding with matched pairs (INGEST_SKIP_ORPHAN_DIALOG=1).\n");
    return;
  }

  await new Promise((resolve, reject) => {
    /** @type {import("node:http").Server | null} */
    let server = null;

    const htmlPath = path.join(ORPHAN_DIR, "index.html");
    const cssPath = path.join(ORPHAN_DIR, "ui/ingestOrphans.css");

    const serverRef = http.createServer((req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0];

      if (req.method === "GET" && urlPath === "/api/orphans") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ orphans }));
        return;
      }

      if (req.method === "POST" && urlPath === "/api/ack") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
        server?.close(() => resolve());
        return;
      }

      if (req.method === "GET" && urlPath === "/ui/ingestOrphans.css") {
        sendFile(res, cssPath, "text/css; charset=utf-8");
        return;
      }

      if (req.method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
        sendFile(res, htmlPath, "text/html; charset=utf-8");
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server = serverRef;

    server.listen(PORT, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${PORT}/`;
      console.log(`\nOrphan dialog: ${url}`);
      console.log(`${orphans.length} unmatched PNG(s) — review in browser, then click OK to continue ingest.\n`);
      openBrowser(url);
    });

    server.on("error", reject);
  });
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
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

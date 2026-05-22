import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
export const MOBILE_IPA_FILENAME = "stock-dashboard.ipa";
export const MOBILE_IOS_MANIFEST = "ios-manifest.plist";
const IPA_ROUTE = `/downloads/${MOBILE_IPA_FILENAME}`;
const MANIFEST_ROUTE = `/downloads/${MOBILE_IOS_MANIFEST}`;

/** @returns {string | null} */
export function resolveMobileIpaPath() {
  const candidates = [
    path.join(PROJECT_ROOT, "public", "downloads", MOBILE_IPA_FILENAME),
    path.join(PROJECT_ROOT, "dist", "downloads", MOBILE_IPA_FILENAME),
  ];
  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 4096) return p;
    } catch {
      /* skip */
    }
  }
  return null;
}

/** @returns {string | null} */
export function resolveMobileIosManifestPath() {
  const candidates = [
    path.join(PROJECT_ROOT, "public", "downloads", MOBILE_IOS_MANIFEST),
    path.join(PROJECT_ROOT, "dist", "downloads", MOBILE_IOS_MANIFEST),
  ];
  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 32) return p;
    } catch {
      /* skip */
    }
  }
  return null;
}

/**
 * @param {import("express").Application} app
 */
export function installMobileIosDownload(app) {
  app.get(IPA_ROUTE, (req, res) => {
    const ipaPath = resolveMobileIpaPath();
    if (!ipaPath) {
      res.status(404).type("application/json").json({
        error: "ipa_not_found",
        hint: "Mac에서: npm run ipa:build",
      });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${MOBILE_IPA_FILENAME}"`,
    );
    res.sendFile(path.resolve(ipaPath), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "ipa_send_failed" });
      }
    });
  });

  app.head(IPA_ROUTE, (req, res) => {
    const ipaPath = resolveMobileIpaPath();
    if (!ipaPath) {
      res.status(404).end();
      return;
    }
    const st = fs.statSync(ipaPath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(st.size));
    res.status(200).end();
  });

  app.get(MANIFEST_ROUTE, (req, res) => {
    const manifestPath = resolveMobileIosManifestPath();
    if (!manifestPath) {
      res.status(404).type("application/json").json({
        error: "ios_manifest_not_found",
        hint: "Mac에서: npm run ipa:build",
      });
      return;
    }
    res.setHeader("Content-Type", "application/xml");
    res.sendFile(path.resolve(manifestPath));
  });
}

/**
 * @param {import("connect").Server} middlewares
 */
export function installViteMobileIosMiddleware(middlewares) {
  middlewares.use((req, res, next) => {
    const url = String(req.url ?? "").split("?")[0];
    if (url === IPA_ROUTE) {
      const ipaPath = resolveMobileIpaPath();
      if (!ipaPath) return next();
      const st = fs.statSync(ipaPath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${MOBILE_IPA_FILENAME}"`,
      );
      res.setHeader("Content-Length", String(st.size));
      if (req.method === "HEAD") {
        res.statusCode = 200;
        res.end();
        return;
      }
      if (req.method === "GET") {
        fs.createReadStream(ipaPath).pipe(res);
        return;
      }
    }
    if (url === MANIFEST_ROUTE && req.method === "GET") {
      const manifestPath = resolveMobileIosManifestPath();
      if (!manifestPath) return next();
      res.setHeader("Content-Type", "application/xml");
      fs.createReadStream(manifestPath).pipe(res);
      return;
    }
    next();
  });
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIosOtaManifestXml,
  getIosInstallStatus,
} from "./ios-ota-manifest.js";
import {
  resolvePublicHttpsOrigin,
  validateIosOtaHttpsOrigin,
} from "./public-app-origin.js";

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
function resolveStaticManifestPath() {
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

/** @returns {string | null} */
function resolveManifestXml() {
  const origin = resolvePublicHttpsOrigin();
  const check = validateIosOtaHttpsOrigin(origin);
  if (check.ok && origin) {
    return buildIosOtaManifestXml(origin);
  }
  const staticPath = resolveStaticManifestPath();
  if (!staticPath) return null;
  return fs.readFileSync(staticPath, "utf8");
}

function sendManifest(req, res) {
  const xml = resolveManifestXml();
  if (!xml) {
    res.status(404).type("application/json").json({
      error: "ios_manifest_not_found",
      hint:
        ".env에 APP_PUBLIC_BASE_URL=https://인증된-도메인 설정 후 npm run ipa:build (Mac)",
    });
    return;
  }
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(xml);
}

/**
 * @param {import("express").Request} req
 */
export function iosInstallStatusPayload(req) {
  const host = String(req.headers.host ?? "")
    .split(":")[0]
    .trim()
    .toLowerCase();
  const secure =
    req.secure === true ||
    String(req.headers["x-forwarded-proto"] ?? "").toLowerCase() === "https";
  const status = getIosInstallStatus({
    requestHost: host,
    requestIsSecure: secure,
  });
  const ipaReady = !!resolveMobileIpaPath();
  return {
    ...status,
    ipaReady,
    ota: {
      ...status.ota,
      canInstall: status.ota.canInstall && ipaReady,
    },
  };
}

/**
 * @param {import("express").Application} app
 */
export function installMobileIosDownload(app) {
  app.get("/api/mobile/ios-install-status", (req, res) => {
    res.json(iosInstallStatusPayload(req));
  });

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

  app.get(MANIFEST_ROUTE, sendManifest);
  app.head(MANIFEST_ROUTE, (req, res) => {
    const xml = resolveManifestXml();
    if (!xml) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Length", String(Buffer.byteLength(xml, "utf8")));
    res.status(200).end();
  });
}

/**
 * @param {import("connect").Server} middlewares
 */
export function installViteMobileIosMiddleware(middlewares) {
  middlewares.use((req, res, next) => {
    const url = String(req.url ?? "").split("?")[0];
    if (url === "/api/mobile/ios-install-status" && req.method === "GET") {
      const host = String(req.headers.host ?? "")
        .split(":")[0]
        .trim()
        .toLowerCase();
      const secure = (req.socket?.encrypted ?? false) === true;
      const payload = getIosInstallStatus({
        requestHost: host,
        requestIsSecure: secure,
      });
      const ipaReady = !!resolveMobileIpaPath();
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ...payload,
          ipaReady,
          ota: {
            ...payload.ota,
            canInstall: payload.ota.canInstall && ipaReady,
          },
        }),
      );
      return;
    }
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
    if (url === MANIFEST_ROUTE && (req.method === "GET" || req.method === "HEAD")) {
      const xml = resolveManifestXml();
      if (!xml) return next();
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      const len = Buffer.byteLength(xml, "utf8");
      res.setHeader("Content-Length", String(len));
      if (req.method === "HEAD") {
        res.statusCode = 200;
        res.end();
        return;
      }
      res.end(xml);
      return;
    }
    next();
  });
}

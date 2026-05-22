import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
export const MOBILE_APK_FILENAME = "stock-dashboard.apk";
const APK_ROUTE = `/downloads/${MOBILE_APK_FILENAME}`;

/** @returns {string | null} */
export function resolveMobileApkPath() {
  const candidates = [
    path.join(PROJECT_ROOT, "public", "downloads", MOBILE_APK_FILENAME),
    path.join(PROJECT_ROOT, "dist", "downloads", MOBILE_APK_FILENAME),
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

/**
 * APK 직접 다운로드 (Content-Disposition: attachment)
 * @param {import("express").Application} app
 */
export function installMobileApkDownload(app) {
  const sendApk = (req, res) => {
    const apkPath = resolveMobileApkPath();
    if (!apkPath) {
      res.status(404).type("application/json").json({
        error: "apk_not_found",
        hint: "Run: npm run apk:build",
      });
      return;
    }
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${MOBILE_APK_FILENAME}"`,
    );
    res.sendFile(path.resolve(apkPath), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "apk_send_failed" });
      }
    });
  };

  app.get(APK_ROUTE, sendApk);
  app.head(APK_ROUTE, (req, res) => {
    const apkPath = resolveMobileApkPath();
    if (!apkPath) {
      res.status(404).end();
      return;
    }
    const st = fs.statSync(apkPath);
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Length", String(st.size));
    res.status(200).end();
  });
}

/**
 * Vite dev: public 정적보다 먼저 APK attachment 로 응답
 * @param {import("connect").Server} middlewares
 */
export function installViteMobileApkMiddleware(middlewares) {
  middlewares.use((req, res, next) => {
    const url = String(req.url ?? "").split("?")[0];
    if (url !== APK_ROUTE) return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const apkPath = resolveMobileApkPath();
    if (!apkPath) return next();

    const st = fs.statSync(apkPath);
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${MOBILE_APK_FILENAME}"`,
    );
    res.setHeader("Content-Length", String(st.size));

    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return;
    }

    fs.createReadStream(apkPath).pipe(res);
  });
}

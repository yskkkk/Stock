import fs from "node:fs";
import https from "node:https";

/**
 * 선택적 HTTPS 리슨 (Let's Encrypt·win-acme 등으로 발급한 인증서 경로)
 * @param {import("http").RequestListener} handler
 * @param {{ httpPort?: number }} [opts]
 * @returns {import("https").Server | null}
 */
export function maybeStartHttpsServer(handler, opts = {}) {
  const certPath = String(process.env.STOCK_TLS_CERT_PATH ?? "").trim();
  const keyPath = String(process.env.STOCK_TLS_KEY_PATH ?? "").trim();
  if (!certPath || !keyPath) return null;

  const httpsPort = Number(process.env.HTTPS_PORT) || 443;
  let cert;
  let key;
  try {
    cert = fs.readFileSync(certPath);
    key = fs.readFileSync(keyPath);
  } catch (err) {
    console.warn(
      "[https] 인증서를 읽지 못했습니다:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  const server = https.createServer({ cert, key }, handler);
  server.listen(httpsPort, () => {
    console.log(`API server https://0.0.0.0:${httpsPort} (TLS)`);
    if (opts.httpPort) {
      console.log(
        `[https] iPhone IPA 설치: APP_PUBLIC_BASE_URL=https://도메인 + Safari에서 /install-ios.html`,
      );
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`HTTPS port ${httpsPort} in use`);
    } else {
      console.error("[https]", err);
    }
  });
  return server;
}

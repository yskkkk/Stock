/**
 * createApp() 기준 API 스모크 — 실제 HTTP로 전부 호출해 5xx·깨진 JSON·필수 필드 누락을 잡는다.
 * 접근 제어: ACCESS_CONTROL_DISABLED=1 (로컬 점검용)
 */
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "../server/create-app.js";
import { loadEnvFile } from "../server/load-env.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
loadEnvFile();
process.env.ACCESS_CONTROL_DISABLED = "1";
process.env.ACCESS_ALLOW_LOCALHOST = "1";

const app = createApp();
const server = http.createServer(app);
await new Promise((resolve, reject) => {
  server.listen(0, "127.0.0.1", () => resolve());
  server.on("error", reject);
});
const addr = server.address();
const port = typeof addr === "object" && addr ? addr.port : 3456;

/** @param {string} method @param {string} urlPath @param {object} [opt] */
function httpReq(method, urlPath, opt = {}) {
  const { body } = opt;
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        timeout: 120_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            /* non-JSON */
          }
          resolve({
            status: res.statusCode ?? 0,
            json,
            rawHead: raw.slice(0, 500),
          });
        });
      },
    );
    r.on("error", reject);
    r.on("timeout", () => {
      r.destroy();
      reject(new Error(`timeout ${method} ${urlPath}`));
    });
    if (body != null) r.write(typeof body === "string" ? body : JSON.stringify(body));
    r.end();
  });
}

const failures = [];

/**
 * @param {string} label
 * @param {string} method
 * @param {string} path
 * @param {object} [opt]
 * @param {(r: { status: number, json: any }) => boolean} pred
 */
async function expect(label, method, path, pred, opt) {
  try {
    const r = await httpReq(method, path, opt ?? {});
    if (!pred(r)) {
      failures.push({
        label,
        method,
        path,
        status: r.status,
        json: r.json,
        rawHead: r.rawHead,
      });
      console.error("FAIL", label, path, r.status, r.rawHead.slice(0, 120));
    } else {
      console.log("ok", label, r.status);
    }
  } catch (e) {
    failures.push({ label, method, path, error: String(e) });
    console.error("FAIL", label, path, e);
  }
}

const okJson = (r) => r.status >= 200 && r.status < 300 && r.json != null;
const okOr404 = (r) =>
  (r.status >= 200 && r.status < 300 && r.json != null) ||
  (r.status === 404 && r.json && typeof r.json.error === "string");

await expect("picks", "GET", "/api/picks", (r) => okJson(r) && "running" in r.json && Array.isArray(r.json.kr));
await expect("picks-refresh", "POST", "/api/picks/refresh", okJson);
await expect("macro-events", "GET", "/api/macro-events", okJson);
await expect(
  "config",
  "GET",
  "/api/config",
  (r) =>
    okJson(r) &&
    typeof r.json.dartEnabled === "boolean" &&
    typeof r.json.opsCursorAgentAvailable === "boolean",
);

await expect(
  "ops-cursor-agent-forbidden",
  "POST",
  "/api/ops/cursor-agent",
  (r) => r.status === 403 && r.json?.code === "FORBIDDEN",
  { body: { instruction: "smoke-test-do-not-run" } },
);

await expect(
  "ops-cursor-agent-history-forbidden",
  "GET",
  "/api/ops/cursor-agent-history",
  (r) => r.status === 403 && r.json?.code === "FORBIDDEN",
);

await expect(
  "access-status",
  "GET",
  "/api/access/status",
  (r) => okJson(r) && r.json.enabled === false && r.json.state === "allowed",
);

await expect(
  "access-request",
  "POST",
  "/api/access/request",
  (r) => okJson(r) && r.json.ok === true,
  { body: { message: "smoke" } },
);

await expect("feedback-inbox", "GET", "/api/feedback/inbox", okJson);

await expect(
  "feedback-post",
  "POST",
  "/api/feedback",
  (r) =>
    (r.status >= 200 && r.status < 300 && r.json?.ok === true) ||
    (r.status === 400 && r.json?.error) ||
    (r.status === 429 && r.json?.error),
  { body: { message: `api-smoke-test-${Date.now()}`, contact: "" } },
);

await expect("crypto-universe", "GET", "/api/crypto-universe", okOr404);
await expect("crypto-quotes", "GET", "/api/crypto-quotes", okOr404);
await expect("crypto-quotes-btc", "GET", "/api/crypto-quotes?symbols=BTCUSDT", okOr404);

await expect(
  "fx-usd-krw",
  "GET",
  "/api/fx/usd-krw",
  (r) =>
    okOr404(r) &&
    (r.status === 404 ||
      (typeof r.json?.rate === "number" &&
        r.json.rate > 0 &&
        typeof r.json?.updatedAt === "number")),
);

await expect("stock-aapl", "GET", "/api/stock/AAPL?timeframe=1d", okOr404);
await expect("stock-live", "GET", "/api/stock/AAPL?timeframe=1d&live=1", okOr404);

await expect(
  "stock-search",
  "GET",
  "/api/stock-search?q=AAPL&market=us",
  (r) =>
    okOr404(r) &&
    (r.status === 404 ||
      r.json == null ||
      (Array.isArray(r.json.quotes) &&
        r.json.quotes.every(
          (q) =>
            q &&
            typeof q.symbol === "string" &&
            typeof q.name === "string" &&
            (q.market === "kr" || q.market === "us"),
        ))),
);

await expect("news", "GET", "/api/news/AAPL?name=Apple", okOr404);

await expect(
  "telegram-sent",
  "GET",
  "/api/telegram/sent",
  (r) =>
    (r.status === 200 && Array.isArray(r.json?.items)) ||
    (r.status === 400 && r.json?.error),
);

await expect(
  "admin-requests-no-auth",
  "GET",
  "/api/access/admin/requests",
  (r) => r.status === 401 || r.status === 503,
);

await new Promise((resolve, reject) => {
  server.close((err) => (err ? reject(err) : resolve()));
});

if (failures.length) {
  console.error("verify-api-smoke: failures", failures.length);
  process.exit(1);
}
console.log("verify-api-smoke ok", { port });
// 스크리너 등이 백그라운드에서 타이머를 남겨도 스크립트는 여기서 종료한다.
process.exit(0);

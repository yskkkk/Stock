import http from "node:http";
import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { loadEnvFile } from "./load-env.js";
import { upsertStockVaultItemSync } from "./stock-vault-store.js";

vi.mock("./picks-live-quotes.js", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    fetchQuoteSnapshotsForSymbols: vi.fn(async () => {
      throw new Error("GET /api/stock-vault must not await live quote fetches");
    }),
  };
});

const { createApp } = await import("./create-app.js");

beforeEach(() => {
  process.env.STOCK_VAULT_STORE_TEST_FILE = `stock-vault-route-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  for (let i = 0; i < 40; i++) {
    upsertStockVaultItemSync({
      symbol: `${String(200000 + i)}.KS`,
      name: `라우트검증${i}`,
      market: "kr",
      source: "golden_cross",
      crosses: ["5>20"],
      scanDate: "2026-05-29",
    });
  }
});

/**
 * @param {number} port
 * @param {string} path
 * @param {number} timeoutMs
 */
function getJson(port, path, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        timeout: timeoutMs,
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
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, raw });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout GET ${path}`));
    });
    req.end();
  });
}

test("GET /api/stock-vault responds without blocking on live quotes", async () => {
  loadEnvFile();
  process.env.ACCESS_CONTROL_DISABLED = "1";
  process.env.ACCESS_ALLOW_LOCALHOST = "1";

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const port = /** @type {import("net").AddressInfo} */ (server.address()).port;

  try {
    const lite = await getJson(port, "/api/stock-vault?lite=1");
    assert.equal(lite.status, 200);
    assert.ok(Array.isArray(lite.json?.items));
    assert.ok(lite.json.items.length >= 40);

    const full = await getJson(port, "/api/stock-vault");
    assert.equal(full.status, 200);
    assert.ok(Array.isArray(full.json?.items));
    assert.ok(full.json.items.length >= 40);
    assert.ok(full.json.quotes && typeof full.json.quotes === "object");
    assert.ok(full.json.chartInsights && typeof full.json.chartInsights === "object");

    const favorites = await getJson(port, "/api/stock-vault/favorites");
    assert.equal(favorites.status, 200);
    assert.ok(Array.isArray(favorites.json?.favoriteSymbols));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

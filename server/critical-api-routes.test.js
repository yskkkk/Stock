import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { loadEnvFile } from "./load-env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const macroFile = path.join(__dirname, "data", "macro-releases.json");

/** @param {number} port @param {string} route */
function getJson(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: route, method: "GET", timeout: 8000 },
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
      reject(new Error(`timeout GET ${route}`));
    });
    req.end();
  });
}

/** @returns {Promise<{ port: number; close: () => Promise<void> }>} */
async function startTestServer() {
  loadEnvFile();
  process.env.ACCESS_CONTROL_DISABLED = "1";
  process.env.ACCESS_ALLOW_LOCALHOST = "1";
  const { createApp } = await import("./create-app.js");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const port = /** @type {import("net").AddressInfo} */ (server.address()).port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test("critical GET routes always return JSON (health, config, macro-events)", async () => {
  const { port, close } = await startTestServer();
  try {
    for (const route of ["/api/health", "/api/config", "/api/macro-events"]) {
      const r = await getJson(port, route);
      assert.ok(r.status >= 200 && r.status < 500, `${route} status=${r.status}`);
      assert.ok(r.json != null && typeof r.json === "object", `${route} must be JSON object`);
    }
    const macro = await getJson(port, "/api/macro-events");
    assert.ok(Array.isArray(macro.json?.events), "macro-events.events must be array");
  } finally {
    await close();
  }
});

test("macro-events stays JSON when static file is unreadable", async () => {
  const backup = fs.readFileSync(macroFile, "utf8");
  fs.writeFileSync(macroFile, "{ not valid json", "utf8");
  vi.resetModules();
  try {
    const { port, close } = await startTestServer();
    try {
      const r = await getJson(port, "/api/macro-events");
      assert.equal(r.status, 200);
      assert.ok(r.json != null && typeof r.json === "object");
      assert.ok(Array.isArray(r.json?.events));
    } finally {
      await close();
    }
  } finally {
    fs.writeFileSync(macroFile, backup, "utf8");
    vi.resetModules();
  }
});

afterEach(() => {
  vi.resetModules();
});

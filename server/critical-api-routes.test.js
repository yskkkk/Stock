import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { loadEnvFile } from "./load-env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const macroFile = path.join(__dirname, "data", "macro-releases.json");
const uiFeaturesFile = path.join(__dirname, ".data", "ui-feature-toggles.json");

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

const CRITICAL_ROUTES = [
  "/api/health",
  "/api/config",
  "/api/macro-events",
  "/api/ui-features",
  "/api/stock-vault?lite=1",
  "/api/stock-vault/favorites",
  "/api/picks",
];

test("critical GET routes always return JSON (health, config, macro, vault, picks, ui-features)", async () => {
  const { port, close } = await startTestServer();
  try {
    for (const route of CRITICAL_ROUTES) {
      const r = await getJson(port, route);
      assert.ok(r.status >= 200 && r.status < 500, `${route} status=${r.status}`);
      assert.ok(r.json != null && typeof r.json === "object", `${route} must be JSON object`);
    }
    const macro = await getJson(port, "/api/macro-events");
    assert.ok(Array.isArray(macro.json?.events), "macro-events.events must be array");
    const vault = await getJson(port, "/api/stock-vault?lite=1");
    assert.ok(Array.isArray(vault.json?.items), "stock-vault.items must be array");
    const ui = await getJson(port, "/api/ui-features");
    assert.ok(ui.json?.features && typeof ui.json.features === "object");
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

test("ui-features stays JSON when toggle store file is corrupt", async () => {
  const hadFile = fs.existsSync(uiFeaturesFile);
  const backup = hadFile ? fs.readFileSync(uiFeaturesFile, "utf8") : null;
  fs.mkdirSync(path.dirname(uiFeaturesFile), { recursive: true });
  fs.writeFileSync(uiFeaturesFile, "{ broken", "utf8");
  vi.resetModules();
  try {
    const { port, close } = await startTestServer();
    try {
      const r = await getJson(port, "/api/ui-features");
      assert.equal(r.status, 200);
      assert.ok(r.json != null && typeof r.json === "object");
      assert.ok(r.json?.features && typeof r.json.features === "object");
    } finally {
      await close();
    }
  } finally {
    if (backup != null) fs.writeFileSync(uiFeaturesFile, backup, "utf8");
    else if (fs.existsSync(uiFeaturesFile)) fs.unlinkSync(uiFeaturesFile);
    vi.resetModules();
  }
});

test("picks returns JSON error object when screener throws", async () => {
  vi.resetModules();
  vi.doMock("./screener.js", async (importOriginal) => {
    const orig = await importOriginal();
    return {
      ...orig,
      getPicksState: () => {
        throw new Error("simulated picks store failure");
      },
    };
  });
  try {
    const { port, close } = await startTestServer();
    try {
      const r = await getJson(port, "/api/picks");
      assert.ok(r.status >= 400 && r.status < 600, `picks status=${r.status}`);
      assert.ok(r.json != null && typeof r.json === "object", "picks must return JSON");
      assert.ok(typeof r.json?.error === "string" && r.json.error.length > 0);
    } finally {
      await close();
    }
  } finally {
    vi.doUnmock("./screener.js");
    vi.resetModules();
  }
});

test("stock-vault returns JSON error object when view builder throws", async () => {
  vi.resetModules();
  vi.doMock("./stock-vault-view.js", async (importOriginal) => {
    const orig = await importOriginal();
    return {
      ...orig,
      buildStockVaultItemsForUserSync: () => {
        throw new Error("simulated vault store failure");
      },
    };
  });
  try {
    const { port, close } = await startTestServer();
    try {
      const r = await getJson(port, "/api/stock-vault?lite=1");
      assert.ok(r.status >= 400 && r.status < 600, `stock-vault status=${r.status}`);
      assert.ok(r.json != null && typeof r.json === "object", "stock-vault must return JSON");
      assert.ok(typeof r.json?.error === "string" && r.json.error.length > 0);
      assert.equal(r.json?.code, "STOCK_VAULT_ERROR");
    } finally {
      await close();
    }
  } finally {
    vi.doUnmock("./stock-vault-view.js");
    vi.resetModules();
  }
});

test("config returns JSON error object when status builder throws", async () => {
  vi.resetModules();
  vi.doMock("./dart.js", async (importOriginal) => {
    const orig = await importOriginal();
    return {
      ...orig,
      isDartEnabled: () => {
        throw new Error("simulated config failure");
      },
    };
  });
  try {
    const { port, close } = await startTestServer();
    try {
      const r = await getJson(port, "/api/config");
      assert.ok(r.status >= 400 && r.status < 600, `config status=${r.status}`);
      assert.ok(r.json != null && typeof r.json === "object", "config must return JSON");
      assert.ok(typeof r.json?.error === "string" && r.json.error.length > 0);
      assert.equal(r.json?.code, "CONFIG_ERROR");
    } finally {
      await close();
    }
  } finally {
    vi.doUnmock("./dart.js");
    vi.resetModules();
  }
});

test("macro-events includes degraded flag when loader throws", async () => {
  vi.resetModules();
  vi.doMock("./macro-events.js", async (importOriginal) => {
    const orig = await importOriginal();
    return {
      ...orig,
      getMacroEventsCachedAsync: async () => {
        throw new Error("simulated macro loader failure");
      },
    };
  });
  try {
    const { port, close } = await startTestServer();
    try {
      const r = await getJson(port, "/api/macro-events");
      assert.equal(r.status, 200);
      assert.ok(r.json != null && typeof r.json === "object");
      assert.ok(Array.isArray(r.json?.events));
      assert.equal(r.json?.degraded, true);
    } finally {
      await close();
    }
  } finally {
    vi.doUnmock("./macro-events.js");
    vi.resetModules();
  }
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./screener.js");
  vi.doUnmock("./stock-vault-view.js");
  vi.doUnmock("./dart.js");
  vi.doUnmock("./macro-events.js");
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UI_FEATURE_CATALOG,
  UI_FEATURE_CATALOG_BY_ID,
  isUiFeatureId,
} from "../shared/ui-feature-catalog.js";
import { requireAccessAdmin } from "./route-guards.js";
import { parseJsonText } from "./store-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, ".data", "ui-feature-toggles.json");

function ensureDataDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** @type {{ mtimeMs: number; data: { overrides: Record<string, { enabled: boolean; updatedAtMs: number }> } } | null} */
let uiFeatureStoreCache = null;

/** @returns {{ overrides: Record<string, { enabled: boolean; updatedAtMs: number }> }} */
function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      uiFeatureStoreCache = null;
      return { overrides: {} };
    }
    const stat = fs.statSync(STORE_FILE);
    if (uiFeatureStoreCache && uiFeatureStoreCache.mtimeMs === stat.mtimeMs) {
      return uiFeatureStoreCache.data;
    }
    const o = parseJsonText(fs.readFileSync(STORE_FILE, "utf8"));
    const overrides =
      o?.overrides && typeof o.overrides === "object" ? o.overrides : {};
    const data = { overrides };
    uiFeatureStoreCache = { mtimeMs: stat.mtimeMs, data };
    return data;
  } catch {
    uiFeatureStoreCache = null;
    return { overrides: {} };
  }
}

/** @param {{ overrides: Record<string, { enabled: boolean; updatedAtMs: number }> }} store */
function writeStore(store) {
  ensureDataDir();
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(
      {
        overrides: store.overrides,
        updatedAtMs: Date.now(),
      },
      null,
      2,
    ),
    "utf8",
  );
  uiFeatureStoreCache = null;
}

export function resolveUiFeatureEnabled(id) {
  const row = UI_FEATURE_CATALOG_BY_ID[id];
  if (!row) return false;
  const override = readStore().overrides[id];
  if (override && typeof override.enabled === "boolean") return override.enabled;
  return row.defaultEnabled;
}

export function getUiFeaturesPublicSnapshot() {
  const store = readStore();
  /** @type {Record<string, boolean>} */
  const features = {};
  for (const row of UI_FEATURE_CATALOG) {
    const override = store.overrides[row.id];
    features[row.id] =
      override && typeof override.enabled === "boolean"
        ? override.enabled
        : row.defaultEnabled;
  }
  let updatedAtMs = 0;
  for (const o of Object.values(store.overrides)) {
    if (Number(o?.updatedAtMs) > updatedAtMs) updatedAtMs = Number(o.updatedAtMs);
  }
  return { features, updatedAtMs };
}

export function getUiFeaturesAdminSnapshot() {
  const store = readStore();
  return {
    items: UI_FEATURE_CATALOG.map((row) => {
      const override = store.overrides[row.id];
      const hasOverride = Boolean(
        override && typeof override.enabled === "boolean",
      );
      const enabled = hasOverride ? override.enabled : row.defaultEnabled;
      return {
        id: row.id,
        label: row.label,
        description: row.description,
        defaultEnabled: row.defaultEnabled,
        enabled,
        hasOverride,
        updatedAtMs: hasOverride ? Number(override.updatedAtMs) || null : null,
      };
    }),
    updatedAtMs: getUiFeaturesPublicSnapshot().updatedAtMs,
  };
}

export function setUiFeatureEnabled(id, enabled) {
  if (!isUiFeatureId(id)) {
    throw new Error("unknown_ui_feature_id");
  }
  if (typeof enabled !== "boolean") {
    throw new Error("enabled_must_be_boolean");
  }
  const row = UI_FEATURE_CATALOG_BY_ID[id];
  const store = readStore();
  if (enabled === row.defaultEnabled) {
    delete store.overrides[id];
  } else {
    store.overrides[id] = { enabled, updatedAtMs: Date.now() };
  }
  writeStore(store);
  return getUiFeaturesAdminSnapshot();
}

/** @param {import("express").Express} app */
export function registerUiFeatureToggleRoutes(app) {
  app.get("/api/ui-features", (_req, res) => {
    res.json(getUiFeaturesPublicSnapshot());
  });

  app.get("/api/access/admin/ui-features", requireAccessAdmin, (_req, res) => {
    res.json(getUiFeaturesAdminSnapshot());
  });

  app.post("/api/access/admin/ui-features/set", requireAccessAdmin, (req, res) => {
    const id = String(req.body?.id ?? "").trim();
    const enabled = req.body?.enabled;
    if (!isUiFeatureId(id)) {
      res.status(400).json({ error: "알 수 없는 기능 id입니다." });
      return;
    }
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled(boolean)가 필요합니다." });
      return;
    }
    try {
      const snapshot = setUiFeatureEnabled(id, enabled);
      res.json({ ok: true, ...snapshot });
    } catch {
      res.status(500).json({ error: "기능 상태 저장에 실패했습니다." });
    }
  });
}

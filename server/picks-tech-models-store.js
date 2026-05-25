/**
 * 기술 분석 가중치 모델 — 복수 선택·스크리너·텔레그램 알림
 * server/.data/picks-tech-models.json
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  getDefaultSignalScoreWeights,
  sanitizeWeightsRecord,
  sumTechScoreWeights,
} from "./picks-tech-weights-store.js";
import { BOX_RANGE_MODEL_ID, getBoxRangeTechModelStub } from "./box-range/constants.js";

export { getDefaultSignalScoreWeights };
export { sumTechScoreWeights };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const MODELS_FILE = path.join(DATA_DIR, "picks-tech-models.json");
/** @deprecated — 마이그레이션용 */
const LEGACY_WEIGHTS_FILE = path.join(DATA_DIR, "picks-tech-weights.json");

export const DEFAULT_TECH_MODEL_ID = "default";

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * @typedef {{ id: string; name: string; weights: Record<string, number>; createdAtMs: number; updatedAtMs?: number }} TechModel
 * @typedef {{ models: TechModel[]; activeModelIds: string[] }} TechModelsStore
 */

/** @returns {TechModelsStore} */
function defaultStore() {
  const now = Date.now();
  return {
    models: [
      {
        id: DEFAULT_TECH_MODEL_ID,
        name: "기본",
        weights: getDefaultSignalScoreWeights(),
        createdAtMs: now,
        updatedAtMs: now,
      },
    ],
    activeModelIds: [DEFAULT_TECH_MODEL_ID],
  };
}

/** @returns {TechModelsStore | null} */
function readRawSync() {
  try {
    if (!fs.existsSync(MODELS_FILE)) return null;
    const o = JSON.parse(fs.readFileSync(MODELS_FILE, "utf8"));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

function migrateLegacyWeightsSync() {
  if (!fs.existsSync(LEGACY_WEIGHTS_FILE)) return null;
  try {
    const o = JSON.parse(fs.readFileSync(LEGACY_WEIGHTS_FILE, "utf8"));
    if (!o?.weights || typeof o.weights !== "object") return null;
    const now = Date.now();
    return {
      models: [
        {
          id: DEFAULT_TECH_MODEL_ID,
          name: "기본",
          weights: getDefaultSignalScoreWeights(),
          createdAtMs: now,
          updatedAtMs: now,
        },
        {
          id: "legacy-applied",
          name: "승률 업그레이드(이전)",
          weights: sanitizeWeightsRecord(o.weights),
          createdAtMs: now,
          updatedAtMs: now,
        },
      ],
      activeModelIds: [DEFAULT_TECH_MODEL_ID, "legacy-applied"],
    };
  } catch {
    return null;
  }
}

/** @returns {TechModelsStore} */
function readStoreSync() {
  const raw = readRawSync();
  if (raw?.models?.length) {
    return normalizeStore(raw);
  }
  const migrated = migrateLegacyWeightsSync();
  if (migrated) {
    writeStoreSync(migrated);
    return migrated;
  }
  const def = defaultStore();
  writeStoreSync(def);
  return def;
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const def = defaultStore();
  /** @type {TechModel[]} */
  const models = [];
  const seen = new Set();
  for (const m of raw.models ?? []) {
    if (!m || typeof m !== "object") continue;
    const id = String(m.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = String(m.name ?? "").trim() || id;
    models.push({
      id,
      name,
      weights: sanitizeWeightsRecord(m.weights),
      createdAtMs:
        typeof m.createdAtMs === "number" && m.createdAtMs > 0 ? m.createdAtMs : Date.now(),
      updatedAtMs:
        typeof m.updatedAtMs === "number" && m.updatedAtMs > 0 ? m.updatedAtMs : undefined,
    });
  }
  if (!models.some((m) => m.id === DEFAULT_TECH_MODEL_ID)) {
    models.unshift(def.models[0]);
  }
  let activeModelIds = Array.isArray(raw.activeModelIds)
    ? raw.activeModelIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  activeModelIds = activeModelIds.filter((id) => models.some((m) => m.id === id));
  if (!activeModelIds.length) activeModelIds = [DEFAULT_TECH_MODEL_ID];
  return { models, activeModelIds };
}

/** @param {TechModelsStore} store */
function writeStoreSync(store) {
  ensureDirSync();
  fs.writeFileSync(MODELS_FILE, JSON.stringify(normalizeStore(store), null, 0), "utf8");
}

export function listTechModelsSync() {
  const store = readStoreSync();
  return {
    models: store.models.map((m) => ({
      ...m,
      maxTechScore: sumTechScoreWeights(m.weights),
    })),
    activeModelIds: [...store.activeModelIds],
  };
}

/** 실매매 등록 UI — 저장된 모델 + 가상 박스권 모델 */
export function listTechModelsForLiveTradingSync() {
  const listed = listTechModelsSync();
  if (listed.models.some((m) => m.id === BOX_RANGE_MODEL_ID)) return listed;
  const stub = getBoxRangeTechModelStub();
  return {
    models: [...listed.models, { ...stub, maxTechScore: 0 }],
    activeModelIds: [...listed.activeModelIds],
  };
}

export function getActiveTechModelsSync() {
  const { models, activeModelIds } = readStoreSync();
  const active = new Set(activeModelIds);
  return models.filter((m) => active.has(m.id));
}

export function getTechModelByIdSync(id) {
  const sid = String(id ?? "").trim();
  if (sid === BOX_RANGE_MODEL_ID) return getBoxRangeTechModelStub();
  return readStoreSync().models.find((m) => m.id === sid) ?? null;
}

export function setActiveTechModelIdsSync(ids) {
  const store = readStoreSync();
  const valid = new Set(store.models.map((m) => m.id));
  const activeModelIds = [...new Set(ids.map((x) => String(x ?? "").trim()).filter((id) => valid.has(id)))];
  if (!activeModelIds.length) activeModelIds.push(DEFAULT_TECH_MODEL_ID);
  store.activeModelIds = activeModelIds;
  writeStoreSync(store);
  return { activeModelIds: [...store.activeModelIds] };
}

/**
 * @param {{ name: string; weights?: Record<string, unknown>; copyFromId?: string }} opts
 */
export function createTechModelSync(opts) {
  const store = readStoreSync();
  const name = String(opts.name ?? "").trim() || "모델";
  let weights = getDefaultSignalScoreWeights();
  if (opts.copyFromId) {
    const src = store.models.find((m) => m.id === opts.copyFromId);
    if (src) weights = { ...src.weights };
  }
  if (opts.weights) weights = sanitizeWeightsRecord(opts.weights);
  const now = Date.now();
  const model = {
    id: randomUUID().slice(0, 8),
    name,
    weights,
    createdAtMs: now,
    updatedAtMs: now,
  };
  store.models.push(model);
  if (!store.activeModelIds.includes(model.id)) {
    store.activeModelIds.push(model.id);
  }
  writeStoreSync(store);
  return { ...model, maxTechScore: sumTechScoreWeights(model.weights) };
}

/**
 * @param {string} id
 * @param {{ name?: string; weights?: Record<string, unknown> }} patch
 */
export function updateTechModelSync(id, patch) {
  const sid = String(id ?? "").trim();
  const store = readStoreSync();
  const model = store.models.find((m) => m.id === sid);
  if (!model) throw new Error("모델을 찾을 수 없습니다.");
  if (patch.name != null) model.name = String(patch.name).trim() || model.name;
  if (patch.weights) model.weights = sanitizeWeightsRecord(patch.weights);
  model.updatedAtMs = Date.now();
  writeStoreSync(store);
  return { ...model, maxTechScore: sumTechScoreWeights(model.weights) };
}

export function deleteTechModelSync(id) {
  const sid = String(id ?? "").trim();
  if (sid === DEFAULT_TECH_MODEL_ID) throw new Error("기본 모델은 삭제할 수 없습니다.");
  const store = readStoreSync();
  const idx = store.models.findIndex((m) => m.id === sid);
  if (idx < 0) throw new Error("모델을 찾을 수 없습니다.");
  store.models.splice(idx, 1);
  store.activeModelIds = store.activeModelIds.filter((x) => x !== sid);
  if (!store.activeModelIds.length) store.activeModelIds = [DEFAULT_TECH_MODEL_ID];
  writeStoreSync(store);
  return { ok: true };
}

/** 첫 활성 모델 가중치(레거시 API) */
export function getPrimaryActiveWeightsSync() {
  const active = getActiveTechModelsSync();
  const m = active[0] ?? getTechModelByIdSync(DEFAULT_TECH_MODEL_ID);
  return m?.weights ?? getDefaultSignalScoreWeights();
}

export function getMaxTechScoreSync() {
  return sumTechScoreWeights(getPrimaryActiveWeightsSync());
}

export function resetDefaultTechModelWeightsSync() {
  const store = readStoreSync();
  const model = store.models.find((m) => m.id === DEFAULT_TECH_MODEL_ID);
  if (!model) throw new Error("기본 모델을 찾을 수 없습니다.");
  model.weights = getDefaultSignalScoreWeights();
  model.updatedAtMs = Date.now();
  writeStoreSync(store);
  return { ...model, maxTechScore: sumTechScoreWeights(model.weights) };
}

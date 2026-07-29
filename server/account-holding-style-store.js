/**
 * 사용자별 보유 성향 오버라이드 저장
 * server/.data/account-holding-style/{userId}.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonText } from "./store-json.js";
import {
  STYLE_SEED_TICKER_OVERRIDES,
  isAccountHoldingStyle,
  normalizeAccountStyleTicker,
  getAccountHoldingStylePolicySummaryKo,
} from "../shared/account-holding-style-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, ".data", "account-holding-style");

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

/**
 * @param {string} userId
 */
function storePath(userId) {
  const id = String(userId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  return path.join(ROOT, `${id || "anon"}.json`);
}

/**
 * @param {string} userId
 * @returns {{
 *   overrides: Record<string, "growth" | "value">;
 *   seededAtMs: number | null;
 *   updatedAtMs: number | null;
 * }}
 */
export function readAccountHoldingStyleStoreSync(userId) {
  try {
    const file = storePath(userId);
    if (!fs.existsSync(file)) {
      return { overrides: {}, seededAtMs: null, updatedAtMs: null };
    }
    const o = parseJsonText(fs.readFileSync(file, "utf8"));
    /** @type {Record<string, "growth" | "value">} */
    const overrides = {};
    if (o?.overrides && typeof o.overrides === "object") {
      for (const [k, v] of Object.entries(o.overrides)) {
        const t = normalizeAccountStyleTicker(k);
        if (t && isAccountHoldingStyle(v)) overrides[t] = v;
      }
    }
    return {
      overrides,
      seededAtMs:
        typeof o.seededAtMs === "number" && Number.isFinite(o.seededAtMs)
          ? o.seededAtMs
          : null,
      updatedAtMs:
        typeof o.updatedAtMs === "number" && Number.isFinite(o.updatedAtMs)
          ? o.updatedAtMs
          : null,
    };
  } catch {
    return { overrides: {}, seededAtMs: null, updatedAtMs: null };
  }
}

/**
 * @param {string} userId
 * @param {{
 *   overrides: Record<string, "growth" | "value">;
 *   seededAtMs: number | null;
 * }} data
 */
function writeStoreSync(userId, data) {
  ensureRoot();
  const file = storePath(userId);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        overrides: data.overrides,
        seededAtMs: data.seededAtMs,
        updatedAtMs: Date.now(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * 최초 1회 시드 티커를 사용자 오버라이드에 넣음(이후 사용자 수정 유지).
 * @param {string} userId
 */
export function ensureAccountHoldingStyleSeededSync(userId) {
  const cur = readAccountHoldingStyleStoreSync(userId);
  if (cur.seededAtMs != null) {
    return { ...cur, seeded: false };
  }
  /** @type {Record<string, "growth" | "value">} */
  const overrides = { ...cur.overrides };
  for (const [k, v] of Object.entries(STYLE_SEED_TICKER_OVERRIDES)) {
    const t = normalizeAccountStyleTicker(k);
    if (!t || !isAccountHoldingStyle(v)) continue;
    if (!isAccountHoldingStyle(overrides[t])) overrides[t] = v;
  }
  const next = { overrides, seededAtMs: Date.now() };
  writeStoreSync(userId, next);
  return { ...next, updatedAtMs: Date.now(), seeded: true };
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {"growth" | "value" | null} style — null이면 지정 해제(자동 규칙)
 */
export function setAccountHoldingStyleOverrideSync(userId, symbol, style) {
  const ticker = normalizeAccountStyleTicker(symbol);
  if (!ticker) return { ok: false, error: "invalid-symbol" };
  const cur = ensureAccountHoldingStyleSeededSync(userId);
  /** @type {Record<string, "growth" | "value">} */
  const overrides = { ...cur.overrides };
  if (style == null) {
    delete overrides[ticker];
  } else if (isAccountHoldingStyle(style)) {
    overrides[ticker] = style;
  } else {
    return { ok: false, error: "invalid-style" };
  }
  writeStoreSync(userId, {
    overrides,
    seededAtMs: cur.seededAtMs ?? Date.now(),
  });
  return {
    ok: true,
    ticker,
    style: style ?? null,
    overrides,
  };
}

/**
 * @param {string} userId
 */
export function getAccountHoldingStyleSnapshotSync(userId) {
  const store = ensureAccountHoldingStyleSeededSync(userId);
  return {
    ok: true,
    policy: getAccountHoldingStylePolicySummaryKo(),
    overrides: store.overrides,
    seededAtMs: store.seededAtMs,
    updatedAtMs: store.updatedAtMs ?? null,
  };
}

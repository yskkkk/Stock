import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STATE_FILE = "vault-scan-progress.json";

/** @typedef {'golden_cross'|'ma_align'|'ma120_near'|'low_slope_flip'|'book_accum'|'bottom_candle'|'book_accum_fast'} VaultScanProgressKind */

const KIND_LABEL_KO = {
  golden_cross: "골든",
  ma_align: "정배열",
  ma120_near: "120선",
  low_slope_flip: "저점기울",
  book_accum: "매집",
  bottom_candle: "바닥",
  book_accum_fast: "매집(고속)",
};

const TF_LABEL = { "1d": "일", "1wk": "주" };
const MARKET_LABEL = { kr: "KR", us: "US" };

/** @param {unknown} raw */
function normalizeProgress(raw) {
  const sessionId =
    typeof raw?.sessionId === "string" ? raw.sessionId.trim() : null;
  const rowsRaw = raw?.rows && typeof raw.rows === "object" ? raw.rows : {};
  /** @type {Record<string, VaultScanProgressRow>} */
  const rows = {};
  for (const [key, row] of Object.entries(rowsRaw)) {
    if (!row || typeof row !== "object") continue;
    const kind = String(row.kind ?? "").trim();
    const market = row.market === "us" ? "us" : row.market === "kr" ? "kr" : null;
    const timeframe = row.timeframe === "1wk" ? "1wk" : row.timeframe === "1d" ? "1d" : null;
    const scanned =
      typeof row.scanned === "number" && Number.isFinite(row.scanned)
        ? Math.max(0, row.scanned)
        : 0;
    const total =
      typeof row.total === "number" && Number.isFinite(row.total)
        ? Math.max(0, row.total)
        : 0;
    const phase =
      row.phase === "done" || row.phase === "error" || row.phase === "pending"
        ? row.phase
        : "running";
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : formatProgressLabel(kind, market, timeframe);
    rows[key] = {
      kind,
      market,
      timeframe,
      scanned,
      total,
      phase,
      label,
      pct: total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0,
      atMs:
        typeof row.atMs === "number" && Number.isFinite(row.atMs)
          ? row.atMs
          : Date.now(),
    };
  }
  return { sessionId, rows };
}

/**
 * @param {string} kind
 * @param {"kr"|"us"|null} market
 * @param {"1d"|"1wk"|null} timeframe
 */
function formatProgressLabel(kind, market, timeframe) {
  const kindKo = KIND_LABEL_KO[kind] ?? kind;
  const m = market ? MARKET_LABEL[market] ?? market : "";
  const tf = timeframe ? TF_LABEL[timeframe] ?? timeframe : "";
  return [kindKo, m, tf].filter(Boolean).join(" ");
}

function readProgressState() {
  return readJsonStoreSync(STATE_FILE, normalizeProgress, () => ({
    sessionId: null,
    rows: {},
  }));
}

/** @param {ReturnType<typeof normalizeProgress>} state */
function writeProgressState(state) {
  writeJsonStoreSync(STATE_FILE, normalizeProgress(state));
}

/**
 * @param {string} sessionId
 */
export function beginVaultScanProgressSession(sessionId) {
  writeProgressState({
    sessionId: String(sessionId ?? "").trim() || String(Date.now()),
    rows: {},
  });
}

export function endVaultScanProgressSession() {
  writeProgressState({ sessionId: null, rows: {} });
}

/**
 * @param {VaultScanProgressKind | string} kind
 * @param {"kr"|"us"} market
 * @param {"1d"|"1wk"} timeframe
 * @param {{ scanned: number; total: number; phase?: "running"|"done"|"pending"|"error" }} progress
 */
export function setVaultScanProgress(kind, market, timeframe, progress) {
  const state = readProgressState();
  if (!state.sessionId) return;
  const key = `${kind}:${market}:${timeframe}`;
  const scanned = Math.max(0, Number(progress.scanned) || 0);
  const total = Math.max(0, Number(progress.total) || 0);
  const phase = progress.phase ?? (total > 0 && scanned >= total ? "done" : "running");
  state.rows[key] = {
    kind: String(kind),
    market,
    timeframe,
    scanned,
    total,
    phase,
    label: formatProgressLabel(String(kind), market, timeframe),
    pct: total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0,
    atMs: Date.now(),
  };
  writeProgressState(state);
}

export function getVaultScanProgressSync() {
  const state = readProgressState();
  const rows = Object.values(state.rows).sort((a, b) =>
    a.label.localeCompare(b.label, "ko"),
  );
  const active =
    Boolean(state.sessionId) &&
    rows.some((r) => r.phase === "running" || r.phase === "pending");
  return {
    sessionId: state.sessionId,
    active,
    rows,
  };
}

export function isVaultScanProgressActiveSync() {
  return getVaultScanProgressSync().active;
}

/**
 * @param {VaultScanProgressKind | string} kind
 * @param {"kr"|"us"} market
 * @param {"1d"|"1wk"} timeframe
 * @returns {(progress: { scanned: number; total: number; phase?: "running"|"done"|"pending"|"error" }) => void}
 */
export function vaultScanProgressReporter(kind, market, timeframe) {
  return (progress) => setVaultScanProgress(kind, market, timeframe, progress);
}

/**
 * 마지막 스크리너 결과 — 서버 재기동 후에도 목록 복원용.
 * server/.data/picks-last-scan.json
 */
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const FILE = path.join(DATA_DIR, "picks-last-scan.json");

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @param {unknown} raw @param {"kr"|"us"} marketDefault */
function sanitizePick(raw, marketDefault) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const symbol = String(o.symbol ?? "").trim();
  if (!symbol) return null;
  const name = String(o.name ?? symbol).trim() || symbol;
  const market =
    o.market === "us"
      ? "us"
      : o.market === "crypto"
        ? "crypto"
        : o.market === "kr"
          ? "kr"
          : marketDefault;
  const score =
    typeof o.score === "number" && Number.isFinite(o.score) ? Math.max(0, o.score) : 0;
  const signals = Array.isArray(o.signals)
    ? o.signals.filter((x) => typeof x === "string")
    : [];
  const signalIds = Array.isArray(o.signalIds)
    ? o.signalIds.filter((x) => typeof x === "string")
    : undefined;
  const price =
    typeof o.price === "number" && Number.isFinite(o.price) && o.price >= 0 ? o.price : undefined;
  const change =
    typeof o.change === "number" && Number.isFinite(o.change) ? o.change : undefined;
  const changePercent =
    typeof o.changePercent === "number" && Number.isFinite(o.changePercent)
      ? o.changePercent
      : undefined;
  const currency = typeof o.currency === "string" ? o.currency : undefined;
  const marketState = typeof o.marketState === "string" ? o.marketState : undefined;
  const nameKo = typeof o.nameKo === "string" ? o.nameKo : undefined;
  const nameEn = typeof o.nameEn === "string" ? o.nameEn : undefined;
  const dh = o.dayHigh;
  const dl = o.dayLow;
  const dayHigh =
    typeof dh === "number" && Number.isFinite(dh) && dh > 0 ? dh : undefined;
  const dayLow =
    typeof dl === "number" && Number.isFinite(dl) && dl > 0 ? dl : undefined;
  return {
    symbol,
    name,
    market,
    price,
    change,
    changePercent,
    currency,
    score,
    signalIds,
    signals,
    marketState,
    nameKo,
    nameEn,
    dayHigh,
    dayLow,
  };
}

/** @returns {{ kr: object[]; us: object[]; crypto: object[]; updatedAt: number; message: string } | null} */
export function readLastScanSnapshotSync() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const raw = fs.readFileSync(FILE, "utf8");
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    const updatedAt =
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt) ? o.updatedAt : 0;
    const message = typeof o.message === "string" ? o.message : "";
    const kr = (Array.isArray(o.kr) ? o.kr : [])
      .map((p) => sanitizePick(p, "kr"))
      .filter(Boolean);
    const us = (Array.isArray(o.us) ? o.us : [])
      .map((p) => sanitizePick(p, "us"))
      .filter(Boolean);
    const crypto = (Array.isArray(o.crypto) ? o.crypto : [])
      .map((p) => sanitizePick(p, "crypto"))
      .filter(Boolean);
    if (!updatedAt && kr.length === 0 && us.length === 0 && crypto.length === 0) {
      return null;
    }
    return { kr, us, crypto, updatedAt, message };
  } catch {
    return null;
  }
}

/**
 * @param {{ kr: object[]; us: object[]; crypto?: object[]; updatedAt: number; message: string }} snapshot
 */
export function writeLastScanSnapshotSync(snapshot) {
  try {
    ensureDirSync();
    fs.writeFileSync(
      FILE,
      JSON.stringify({
        version: 1,
        updatedAt: snapshot.updatedAt,
        message: snapshot.message,
        kr: snapshot.kr,
        us: snapshot.us,
        crypto: snapshot.crypto ?? [],
      }),
      "utf8",
    );
  } catch {
    /* ignore disk errors */
  }
}

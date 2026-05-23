/**
 * 빗썸 보유 코인 시장가 전량 매도
 *   node scripts/bithumb-sell-holdings.mjs BTC DOGE
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  executeBithumbLiveSellOrder,
  getBithumbTradingStatus,
} from "../server/bithumb-trading-adapter.js";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

loadEnvFile();

const bases = process.argv.slice(2).map((s) => s.trim().toUpperCase()).filter(Boolean);
if (bases.length === 0) {
  console.error("Usage: node scripts/bithumb-sell-holdings.mjs BTC DOGE ...");
  process.exit(1);
}

const status = getBithumbTradingStatus();
console.log("[status]", { ready: status.ready, liveOrdersEnabled: status.liveOrdersEnabled });
if (!status.ready || !status.liveOrdersEnabled) {
  console.error("Bithumb live orders not ready");
  process.exit(1);
}

const key = process.env.BITHUMB_API_KEY;
const secret = process.env.BITHUMB_SECRET_KEY;

function b64(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signJwt(claims, sec) {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const b = b64(JSON.stringify(claims));
  const d = `${h}.${b}`;
  const sig = crypto
    .createHmac("sha256", sec)
    .update(d, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${d}.${sig}`;
}

async function fetchAccounts() {
  const claims = {
    access_key: key,
    nonce: randomUUID(),
    timestamp: Date.now(),
  };
  const res = await fetch("https://api.bithumb.com/v1/accounts", {
    headers: {
      Authorization: `Bearer ${signJwt(claims, secret)}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`accounts ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** @param {string} base */
function marketForBase(base) {
  return `KRW-${base}`;
}

/** 빗썸 수량 정밀도 — 소량은 8자리 */
function formatSellVolume(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  const floored = Math.floor(v * 1e8) / 1e8;
  if (floored <= 0) return null;
  return floored;
}

const accounts = await fetchAccounts();
/** @type {Array<{currency:string,balance:string,locked:string}>} */
const list = Array.isArray(accounts) ? accounts : [];

let any = false;
for (const base of bases) {
  const row = list.find(
    (a) => String(a.currency ?? "").toUpperCase() === base,
  );
  const bal = Number(row?.balance ?? 0);
  const locked = Number(row?.locked ?? 0);
  const available = bal - locked;
  const vol = formatSellVolume(available > 0 ? available : bal);
  console.log(`[${base}] balance=${bal} locked=${locked} sellVol=${vol ?? "—"}`);
  if (!vol) {
    console.log(`  → skip (보유 없음)`);
    continue;
  }
  any = true;
  const out = await executeBithumbLiveSellOrder({
    market: marketForBase(base),
    volume: vol,
  });
  console.log(`  →`, JSON.stringify(out));
}

if (!any) {
  console.log("매도할 수량 없음");
}
process.exit(0);

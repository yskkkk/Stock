/**
 * 미국 발표 인박스 — 카드·관심종목·컨센 스냅샷 영속
 */
import fs from "node:fs";
import path from "node:path";
import { resolveServerDataDir } from "./data-path.js";

const FILE = "us-announcement-inbox.json";
const MAX_CARDS = 400;

/** @typedef {"guidance"|"consensus"|"governance"|"earnings"} UsAnnouncementKind */

/**
 * @typedef {{
 *   id: string;
 *   symbol: string;
 *   kind: UsAnnouncementKind;
 *   title: string;
 *   filedAt: number;
 *   source: string;
 *   form?: string | null;
 *   accession?: string | null;
 *   metrics: {
 *     consensusEps?: number | null;
 *     priorConsensusEps?: number | null;
 *     guidanceEps?: number | null;
 *     trailingEps?: number | null;
 *     yoyPct?: number | null;
 *     vsConsensusPct?: number | null;
 *     consensusChangePct?: number | null;
 *     period?: string | null;
 *     numAnalysts?: number | null;
 *   };
 *   ai: { summary: string; generatedAt: number; engine?: string };
 *   links: { edgar?: string | null; yahooAnalysis?: string | null; ir?: string | null };
 *   notified?: { telegramAt?: number | null; emailAt?: number | null };
 *   createdAt: number;
 * }} UsAnnouncementCard
 */

/**
 * @typedef {{
 *   version: 1;
 *   watchlist: string[];
 *   cards: UsAnnouncementCard[];
 *   seenKeys: Record<string, number>;
 *   consensusSnapshots: Record<string, {
 *     at: number;
 *     forwardEps: number | null;
 *     periods: Record<string, { epsAvg: number | null; numAnalysts: number | null }>;
 *   }>;
 *   updatedAt: number;
 * }} UsAnnouncementStore
 */

const DEFAULT_WATCH = [
  "AAPL",
  "MSFT",
  "NVDA",
  "GOOGL",
  "AMZN",
  "META",
  "AVGO",
  "TSLA",
];

function storePath() {
  return path.join(resolveServerDataDir(), FILE);
}

/** @returns {UsAnnouncementStore} */
export function emptyUsAnnouncementStore() {
  return {
    version: 1,
    watchlist: [...DEFAULT_WATCH],
    cards: [],
    seenKeys: {},
    consensusSnapshots: {},
    updatedAt: Date.now(),
  };
}

/**
 * @param {unknown} raw
 * @returns {UsAnnouncementStore}
 */
function normalizeStore(raw) {
  const base = emptyUsAnnouncementStore();
  if (!raw || typeof raw !== "object") return base;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const watch = Array.isArray(o.watchlist)
    ? o.watchlist
        .map((s) => String(s ?? "").trim().toUpperCase())
        .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))
    : base.watchlist;
  const cards = Array.isArray(o.cards) ? /** @type {UsAnnouncementCard[]} */ (o.cards) : [];
  const seenKeys =
    o.seenKeys && typeof o.seenKeys === "object"
      ? /** @type {Record<string, number>} */ (o.seenKeys)
      : {};
  const consensusSnapshots =
    o.consensusSnapshots && typeof o.consensusSnapshots === "object"
      ? /** @type {UsAnnouncementStore["consensusSnapshots"]} */ (o.consensusSnapshots)
      : {};
  return {
    version: 1,
    watchlist: watch.length ? [...new Set(watch)] : [...DEFAULT_WATCH],
    cards,
    seenKeys,
    consensusSnapshots,
    updatedAt: Number(o.updatedAt) || Date.now(),
  };
}

/** @returns {UsAnnouncementStore} */
export function loadUsAnnouncementStoreSync() {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return emptyUsAnnouncementStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return normalizeStore(raw);
  } catch {
    return emptyUsAnnouncementStore();
  }
}

/** @param {UsAnnouncementStore} store */
export function saveUsAnnouncementStoreSync(store) {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = storePath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const next = {
    ...store,
    cards: store.cards.slice(0, MAX_CARDS),
    updatedAt: Date.now(),
  };
  fs.writeFileSync(tmp, JSON.stringify(next, null, 0), "utf8");
  fs.renameSync(tmp, file);
  return next;
}

/**
 * @param {string} symbol
 * @param {UsAnnouncementKind} kind
 * @param {string} keyPart
 */
export function buildAnnouncementDedupeKey(symbol, kind, keyPart) {
  return `${String(symbol).toUpperCase()}|${kind}|${String(keyPart)}`;
}

/**
 * @param {UsAnnouncementStore} store
 * @param {string} dedupeKey
 */
export function hasSeenAnnouncementKey(store, dedupeKey) {
  return Boolean(store.seenKeys[dedupeKey]);
}

/**
 * @param {UsAnnouncementStore} store
 * @param {UsAnnouncementCard} card
 * @param {string} dedupeKey
 */
export function insertAnnouncementCard(store, card, dedupeKey) {
  if (store.seenKeys[dedupeKey]) {
    return { store, inserted: false, card: null };
  }
  store.seenKeys[dedupeKey] = Date.now();
  store.cards = [card, ...store.cards].slice(0, MAX_CARDS);
  return { store, inserted: true, card };
}

/**
 * @param {UsAnnouncementStore} store
 * @param {{ symbol?: string; kind?: string; limit?: number }} [q]
 */
export function listAnnouncementCards(store, q = {}) {
  const sym = String(q.symbol ?? "")
    .trim()
    .toUpperCase();
  const kind = String(q.kind ?? "")
    .trim()
    .toLowerCase();
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 80));
  let rows = store.cards;
  if (sym) rows = rows.filter((c) => c.symbol === sym);
  if (
    kind === "guidance" ||
    kind === "consensus" ||
    kind === "governance" ||
    kind === "earnings"
  ) {
    rows = rows.filter((c) => c.kind === kind);
  }
  return rows.slice(0, limit);
}

/**
 * @param {UsAnnouncementStore} store
 * @param {string[]} symbols
 */
export function setWatchlistSync(store, symbols) {
  const next = [
    ...new Set(
      symbols
        .map((s) => String(s ?? "").trim().toUpperCase())
        .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)),
    ),
  ];
  store.watchlist = next.length ? next : [...DEFAULT_WATCH];
  return store;
}

/**
 * @param {UsAnnouncementStore} store
 * @param {string} symbol
 */
export function addWatchSymbolSync(store, symbol) {
  const s = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) return store;
  if (!store.watchlist.includes(s)) store.watchlist = [...store.watchlist, s];
  return store;
}

export function defaultUsAnnouncementWatchlist() {
  return [...DEFAULT_WATCH];
}

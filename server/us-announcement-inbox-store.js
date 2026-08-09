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
 *   notified?: {
 *     telegramAt?: number | null;
 *     emailAt?: number | null;
 *     skipped?: string;
 *   };
 *   createdAt: number;
 * }} UsAnnouncementCard
 */

/**
 * @typedef {{
 *   version: 1;
 *   watchlist: string[];
 *   cards: UsAnnouncementCard[];
 *   seenKeys: Record<string, number>;
 *   primedSymbols: Record<string, number>;
 *   alertedKeys: Record<string, number>;
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
    primedSymbols: {},
    alertedKeys: {},
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
  const primedSymbols =
    o.primedSymbols && typeof o.primedSymbols === "object"
      ? /** @type {Record<string, number>} */ (o.primedSymbols)
      : {};
  /** @type {Record<string, number>} */
  let alertedKeys = {};
  if (o.alertedKeys && typeof o.alertedKeys === "object") {
    alertedKeys = /** @type {Record<string, number>} */ (o.alertedKeys);
  } else if (o.notifySentAt && typeof o.notifySentAt === "object") {
    // 구 쿨다운 키 폐기 — 발표 단위 키만 유지(형식 symbol|kind|… 는 무시)
    for (const [k, v] of Object.entries(
      /** @type {Record<string, number>} */ (o.notifySentAt),
    )) {
      if (String(k).split("|").length >= 3) alertedKeys[k] = Number(v) || Date.now();
    }
  }
  return {
    version: 1,
    watchlist: watch.length ? [...new Set(watch)] : [...DEFAULT_WATCH],
    cards,
    seenKeys,
    primedSymbols,
    alertedKeys,
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
 * @param {string} symbol
 */
export function isSymbolAnnouncementPrimed(store, symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return false;
  return Boolean(store.primedSymbols?.[sym]);
}

/**
 * 이미 나와 있던 발표 백필 후 — 이후 신규만 알림
 * @param {UsAnnouncementStore} store
 * @param {string} symbol
 */
export function markSymbolAnnouncementPrimed(store, symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return store;
  if (!store.primedSymbols || typeof store.primedSymbols !== "object") {
    store.primedSymbols = {};
  }
  store.primedSymbols[sym] = Date.now();
  return store;
}

/**
 * @param {boolean | undefined} notifyOpt
 * @param {UsAnnouncementStore} store
 * @param {string} symbol
 */
export function shouldNotifyAnnouncement(notifyOpt, store, symbol) {
  if (notifyOpt === false) return false;
  return isSymbolAnnouncementPrimed(store, symbol);
}

/**
 * Form 3/4/5 내부자 매매 — 인박스 등록은 하되 알림은 보내지 않음
 * @param {string | null | undefined} form
 */
export function isQuietAnnouncementForm(form) {
  const f = String(form ?? "")
    .trim()
    .toUpperCase();
  return f === "3" || f === "4" || f === "5";
}

/**
 * @param {UsAnnouncementStore} store
 * @param {string} dedupeKey
 */
export function wasAnnouncementAlerted(store, dedupeKey) {
  return Boolean(store.alertedKeys?.[dedupeKey]);
}

/**
 * 발표 1건(dedupeKey)당 알림 1회 기록
 * @param {UsAnnouncementStore} store
 * @param {string} dedupeKey
 */
export function markAnnouncementAlerted(store, dedupeKey) {
  if (!store.alertedKeys || typeof store.alertedKeys !== "object") {
    store.alertedKeys = {};
  }
  store.alertedKeys[String(dedupeKey)] = Date.now();
  return store;
}

/**
 * 카드 삽입 후 실제 메일/텔레그램을 보낼지 — 발표(키)당 1번
 * @param {{
 *   notifyOpt?: boolean;
 *   store: UsAnnouncementStore;
 *   symbol: string;
 *   form?: string | null;
 *   dedupeKey: string;
 * }} args
 */
export function shouldSendAnnouncementAlert(args) {
  if (!shouldNotifyAnnouncement(args.notifyOpt, args.store, args.symbol)) {
    return { send: false, reason: "not_primed_or_disabled" };
  }
  if (isQuietAnnouncementForm(args.form)) {
    return { send: false, reason: "quiet_form" };
  }
  const key = String(args.dedupeKey ?? "");
  if (!key) return { send: false, reason: "missing_key" };
  if (wasAnnouncementAlerted(args.store, key)) {
    return { send: false, reason: "already_alerted", key };
  }
  return { send: true, key };
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
